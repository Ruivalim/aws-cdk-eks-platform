/**
 * Docker Compose Deployment
 *
 * Handles compose-only deployments (no build step).
 * - Clone/pull repo on worker server
 * - Write .env file
 * - Normalize volumes to ./data/
 * - Run docker compose up -d
 */

import { ssh, sshOrFail } from "./ssh";
import * as DB from "./db";
import { log } from "./log";
import { toSSHUrl } from "./github";
import { setupProjectDomain } from "./caddy";

// ============ Types ============

export interface DeployConfig {
  projectId: string;
  onProgress?: (step: string, message: string) => void;
}

export interface DeployResult {
  success: boolean;
  commit?: string;
  error?: string;
}

// Base path for apps on worker servers
const APPS_BASE_PATH = "/opt/ruilify/apps";

// ============ Main Deploy Function ============

/**
 * Deploy a compose-only project to worker server
 */
export async function deployCompose(
  config: DeployConfig,
): Promise<DeployResult> {
  const { projectId, onProgress } = config;
  const progress = onProgress || ((step, msg) => log.info(`[${step}] ${msg}`));

  try {
    // Get project from DB
    const project = DB.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    // Get worker server
    const server = DB.getServer(project.target_server);
    if (!server) {
      throw new Error(`Server ${project.target_server} not found`);
    }

    const host = `root@${server.tailscale_ip}`;
    const appPath = `${APPS_BASE_PATH}/${project.name}`;

    progress("init", `Deploying ${project.name} to ${server.name}`);

    // Update project status
    DB.updateProjectStatus(projectId, "deploying");

    // 1. Ensure base directory exists
    progress("prepare", "Creating directories...");
    await sshOrFail(host, `mkdir -p ${APPS_BASE_PATH}`);

    // 2. Clone or pull repository
    progress("git", "Fetching repository...");
    const repoExists = await checkRepoExists(host, appPath);

    // Convert to SSH URL for authentication
    const sshUrl = toSSHUrl(project.repo_url);

    let commit: string;
    if (repoExists) {
      // Pull latest
      await sshOrFail(
        host,
        `cd ${appPath} && git fetch origin && git reset --hard origin/${project.repo_branch}`,
      );
      commit = await getCommitSha(host, appPath);
      progress("git", `Updated to ${commit.substring(0, 7)}`);
    } else {
      // Remove directory if exists but is not a git repo
      await ssh(host, `rm -rf ${appPath}`);
      // Clone using SSH URL
      await sshOrFail(
        host,
        `git clone --branch ${project.repo_branch} --depth 1 ${sshUrl} ${appPath}`,
      );
      commit = await getCommitSha(host, appPath);
      progress("git", `Cloned at ${commit.substring(0, 7)}`);
    }

    // 3. Create data directory for volumes
    await sshOrFail(host, `mkdir -p ${appPath}/data`);

    // 4. Write .env file
    progress("env", "Writing environment variables...");
    await writeEnvFile(host, appPath, project.env_vars);

    // 5. Copy compose file to root if it's in a subdirectory
    if (project.compose_path !== "docker-compose.yml") {
      progress("compose", `Copying ${project.compose_path}...`);
      await sshOrFail(
        host,
        `cp ${appPath}/${project.compose_path} ${appPath}/docker-compose.yml`,
      );
    }

    // 5. Stop existing containers (if any)
    progress("deploy", "Stopping existing containers...");
    await ssh(
      host,
      `cd ${appPath} && docker compose down --remove-orphans 2>/dev/null || true`,
    );

    // 6. Pull images and start containers
    progress("deploy", "Pulling images...");
    await sshOrFail(host, `cd ${appPath} && docker compose pull`);

    progress("deploy", "Starting containers...");
    await sshOrFail(host, `cd ${appPath} && docker compose up -d`);

    // 7. Verify containers are running
    progress("verify", "Verifying containers...");
    const containers = await getRunningContainers(host, appPath);
    if (containers.length === 0) {
      throw new Error("No containers started");
    }
    progress("verify", `${containers.length} container(s) running`);

    // Update project status
    DB.updateProjectStatus(projectId, "running", commit);

    // Setup domain (Cloudflare DNS + Caddy) if configured
    if (project.domain) {
      progress("domain", "Setting up domain...");
      const domainResult = await setupProjectDomain(projectId, progress);
      if (!domainResult.success) {
        progress("domain", `Warning: Domain setup failed: ${domainResult.error}`);
      }
    }

    progress("done", "Deployment complete!");

    return { success: true, commit };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`Deploy failed: ${error}`);

    // Update project status
    DB.updateProjectStatus(projectId, "failed");

    return { success: false, error };
  }
}

// ============ Helper Functions ============

/**
 * Check if git repo already exists in path
 */
async function checkRepoExists(host: string, path: string): Promise<boolean> {
  const result = await ssh(
    host,
    `test -d ${path}/.git && echo "yes" || echo "no"`,
  );
  return result.stdout.trim() === "yes";
}

/**
 * Get current commit SHA
 */
async function getCommitSha(host: string, path: string): Promise<string> {
  const result = await sshOrFail(host, `cd ${path} && git rev-parse HEAD`);
  return result.trim();
}

/**
 * Write environment variables to .env file
 */
async function writeEnvFile(
  host: string,
  path: string,
  envVars: Record<string, string>,
): Promise<void> {
  if (Object.keys(envVars).length === 0) {
    // Create empty .env file
    await sshOrFail(host, `touch ${path}/.env`);
    return;
  }

  // Build .env content
  const envContent = Object.entries(envVars)
    .map(([key, value]) => {
      // Escape single quotes in value
      const escapedValue = value.replace(/'/g, "'\\''");
      return `${key}='${escapedValue}'`;
    })
    .join("\n");

  // Write to file using heredoc
  await sshOrFail(
    host,
    `cat > ${path}/.env << 'ENVFILE'
${envContent}
ENVFILE`,
  );
}

/**
 * Get running containers for a compose project
 */
async function getRunningContainers(
  host: string,
  path: string,
): Promise<string[]> {
  const result = await ssh(
    host,
    `cd ${path} && docker compose ps --format '{{.Name}}' 2>/dev/null`,
  );
  if (result.exitCode !== 0) return [];
  return result.stdout
    .trim()
    .split("\n")
    .filter((name) => name.length > 0);
}

// ============ Additional Operations ============

/**
 * Stop a project's containers
 */
export async function stopProject(projectId: string): Promise<void> {
  const project = DB.getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const server = DB.getServer(project.target_server);
  if (!server) throw new Error(`Server ${project.target_server} not found`);

  const host = `root@${server.tailscale_ip}`;
  const appPath = `${APPS_BASE_PATH}/${project.name}`;

  await sshOrFail(host, `cd ${appPath} && docker compose down`);
  DB.updateProjectStatus(projectId, "stopped");
}

/**
 * Restart a project's containers (apply new env vars)
 */
export async function restartProject(
  projectId: string,
  onProgress?: (step: string, message: string) => void,
): Promise<void> {
  const project = DB.getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const server = DB.getServer(project.target_server);
  if (!server) throw new Error(`Server ${project.target_server} not found`);

  const host = `root@${server.tailscale_ip}`;
  const appPath = `${APPS_BASE_PATH}/${project.name}`;
  const progress = onProgress || ((step, msg) => log.info(`[${step}] ${msg}`));

  progress("env", "Updating environment variables...");
  await writeEnvFile(host, appPath, project.env_vars);

  progress("restart", "Restarting containers...");
  await sshOrFail(
    host,
    `cd ${appPath} && docker compose down && docker compose up -d`,
  );

  DB.updateProjectStatus(projectId, "running");
  progress("done", "Restart complete!");
}

/**
 * Get project logs
 */
export async function getProjectLogs(
  projectId: string,
  lines: number = 100,
): Promise<string> {
  const project = DB.getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const server = DB.getServer(project.target_server);
  if (!server) throw new Error(`Server ${project.target_server} not found`);

  const host = `root@${server.tailscale_ip}`;
  const appPath = `${APPS_BASE_PATH}/${project.name}`;

  const result = await ssh(
    host,
    `cd ${appPath} && docker compose logs --tail=${lines} 2>&1`,
  );
  return result.stdout;
}

/**
 * Get project container status
 */
export async function getProjectStatus(projectId: string): Promise<{
  containers: Array<{ name: string; status: string; ports: string }>;
}> {
  const project = DB.getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const server = DB.getServer(project.target_server);
  if (!server) throw new Error(`Server ${project.target_server} not found`);

  const host = `root@${server.tailscale_ip}`;
  const appPath = `${APPS_BASE_PATH}/${project.name}`;

  const result = await ssh(
    host,
    `cd ${appPath} && docker compose ps --format '{{.Name}}|{{.Status}}|{{.Ports}}' 2>/dev/null`,
  );

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return { containers: [] };
  }

  const containers = result.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, status, ports] = line.split("|");
      return { name, status, ports: ports || "" };
    });

  return { containers };
}
