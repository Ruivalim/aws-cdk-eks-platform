/**
 * Setup Library
 *
 * Pure functions for server setup - no UI/prompts.
 * Can be used by CLI (with inquirer) or TUI (with Ink).
 */

import * as SSH from "./ssh";
import * as DB from "./db";
import * as DO from "./digitalocean";
import * as GitHub from "./github";
import * as Registry from "./registry";
import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// ============================================================
// Logging
// ============================================================

const LOG_DIR = join(process.cwd(), "data");
const LOG_FILE = join(LOG_DIR, "setup.log");

function logToFile(level: string, message: string): void {
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    appendFileSync(LOG_FILE, `${timestamp} [${level}] ${message}\n`);
  } catch {
    // Ignore
  }
}

const log = {
  info: (msg: string) => logToFile("INFO", msg),
  success: (msg: string) => logToFile("SUCCESS", msg),
  error: (msg: string) => logToFile("ERROR", msg),
  debug: (msg: string) => logToFile("DEBUG", msg),
};

// Types for setup progress callbacks
export type SetupStep =
  | "connecting"
  | "updating"
  | "docker"
  | "docker-registry"
  | "tailscale"
  | "tailscale-auth"
  | "caddy"
  | "iptables"
  | "git"
  | "github-key"
  | "registering"
  | "done";

export type StepStatus = "pending" | "running" | "done" | "error" | "waiting";

export interface StepProgress {
  step: SetupStep;
  status: StepStatus;
  message?: string;
}

export type ProgressCallback = (progress: StepProgress) => void;

// Result types
export interface TailscaleResult {
  installed: boolean;
  needsAuth: boolean;
  authUrl?: string;
  ip?: string;
}

export interface SetupResult {
  success: boolean;
  tailscaleIp?: string;
  publicIp?: string;
  hostname?: string;
  error?: string;
  deployKey?: string;
  registryUrl?: string;
}

export interface DropletCreateResult {
  success: boolean;
  dropletId?: number;
  publicIp?: string;
  sshHost?: string;
  error?: string;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Wait for all apt locks to be released (max 90s)
 */
async function waitForAptLock(host: string): Promise<void> {
  log.info(`Waiting for apt locks on ${host}...`);

  // Wait for any apt/dpkg processes to finish
  const waitCmd = `
    i=0
    while [ $i -lt 30 ]; do
      if ! pgrep -f 'apt-get|dpkg|unattended-upgrade' >/dev/null 2>&1; then
        if ! fuser /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock 2>/dev/null; then
          echo "APT_READY"
          exit 0
        fi
      fi
      echo "Waiting for apt... ($i)"
      sleep 3
      i=$((i + 1))
    done
    echo "APT_TIMEOUT"
  `;

  const result = await SSH.ssh(host, waitCmd);

  if (result.stdout.includes("APT_READY")) {
    log.info("All apt locks are free");
  } else {
    log.info(
      `apt lock wait: ${result.stdout.includes("APT_TIMEOUT") ? "timeout" : result.stdout.trim()}`,
    );
  }
}

// ============================================================
// Core Setup Functions
// ============================================================

/**
 * Test SSH connection to a host
 */
export async function testConnection(
  host: string,
  onProgress?: ProgressCallback,
): Promise<boolean> {
  onProgress?.({
    step: "connecting",
    status: "running",
    message: "Testing SSH connection...",
  });

  const connected = await SSH.testConnection(host);

  if (connected) {
    onProgress?.({
      step: "connecting",
      status: "done",
      message: "SSH connected",
    });
  } else {
    onProgress?.({
      step: "connecting",
      status: "error",
      message: "Cannot connect to server",
    });
  }

  return connected;
}

/**
 * Update system packages
 */
export async function updateSystem(
  host: string,
  onProgress?: ProgressCallback,
): Promise<boolean> {
  onProgress?.({
    step: "updating",
    status: "running",
    message: "Updating system packages...",
  });
  log.info(`Updating system packages on ${host}`);

  try {
    await waitForAptLock(host);
    log.debug("Running apt-get update...");
    await SSH.sshOrFail(host, "apt-get update -qq");
    log.debug("Running apt-get upgrade...");
    await waitForAptLock(host);
    await SSH.sshOrFail(host, "apt-get upgrade -y -qq");
    onProgress?.({
      step: "updating",
      status: "done",
      message: "System updated",
    });
    log.success("System updated");
    return true;
  } catch (err) {
    log.error(`Failed to update system: ${err}`);
    onProgress?.({ step: "updating", status: "error", message: String(err) });
    return false;
  }
}

/**
 * Install Docker if not present
 */
export async function installDocker(
  host: string,
  onProgress?: ProgressCallback,
): Promise<boolean> {
  onProgress?.({
    step: "docker",
    status: "running",
    message: "Checking Docker...",
  });
  log.info(`Checking Docker on ${host}`);

  try {
    const dockerCheck = await SSH.ssh(host, "docker --version");

    if (dockerCheck.exitCode !== 0) {
      onProgress?.({
        step: "docker",
        status: "running",
        message: "Installing Docker...",
      });
      log.info("Installing Docker...");
      await waitForAptLock(host);
      await SSH.sshOrFail(host, "curl -fsSL https://get.docker.com | sh");
      await SSH.sshOrFail(
        host,
        "systemctl enable docker && systemctl start docker",
      );
      onProgress?.({
        step: "docker",
        status: "done",
        message: "Docker installed",
      });
      log.success("Docker installed");
    } else {
      onProgress?.({
        step: "docker",
        status: "done",
        message: "Docker already installed",
      });
      log.info("Docker already installed");
    }

    return true;
  } catch (err) {
    log.error(`Failed to install Docker: ${err}`);
    onProgress?.({ step: "docker", status: "error", message: String(err) });
    return false;
  }
}

/**
 * Install and start Docker Registry (for build servers)
 */
export async function installDockerRegistry(
  host: string,
  onProgress?: ProgressCallback,
): Promise<boolean> {
  onProgress?.({
    step: "docker-registry",
    status: "running",
    message: "Setting up Docker Registry...",
  });

  try {
    const registryExists = await SSH.ssh(
      host,
      'docker ps --format "{{.Names}}" | grep -q registry',
    );

    if (registryExists.exitCode !== 0) {
      await SSH.sshOrFail(
        host,
        `docker run -d --name registry --restart always -p 5000:5000 \
        -v /opt/registry:/var/lib/registry \
        registry:2`,
      );
      onProgress?.({
        step: "docker-registry",
        status: "done",
        message: "Docker Registry started on port 5000",
      });
    } else {
      onProgress?.({
        step: "docker-registry",
        status: "done",
        message: "Docker Registry already running",
      });
    }

    return true;
  } catch (err) {
    onProgress?.({
      step: "docker-registry",
      status: "error",
      message: String(err),
    });
    return false;
  }
}

/**
 * Configure Docker to use insecure registry
 */
export async function configureDockerRegistry(
  host: string,
  registryUrl: string,
  onProgress?: ProgressCallback,
): Promise<boolean> {
  onProgress?.({
    step: "docker",
    status: "running",
    message: "Configuring Docker for private registry...",
  });

  try {
    await Registry.configureDockerForRegistry(host, registryUrl);
    onProgress?.({
      step: "docker",
      status: "done",
      message: "Docker configured for registry",
    });
    return true;
  } catch (err) {
    onProgress?.({ step: "docker", status: "error", message: String(err) });
    return false;
  }
}

/**
 * Install Git (for build servers)
 */
export async function installGit(
  host: string,
  onProgress?: ProgressCallback,
): Promise<boolean> {
  onProgress?.({
    step: "git",
    status: "running",
    message: "Installing Git...",
  });
  log.info(`Installing Git on ${host}`);

  try {
    await waitForAptLock(host);
    await SSH.sshOrFail(host, "apt-get install -y -qq git");
    await SSH.sshOrFail(host, "mkdir -p /opt/builds");
    onProgress?.({
      step: "git",
      status: "done",
      message: "Git installed, workspace at /opt/builds",
    });
    log.success("Git installed");
    return true;
  } catch (err) {
    log.error(`Failed to install Git: ${err}`);
    onProgress?.({ step: "git", status: "error", message: String(err) });
    return false;
  }
}

/**
 * Generate GitHub deploy key
 */
export async function generateGitHubDeployKey(
  host: string,
  onProgress?: ProgressCallback,
): Promise<string | null> {
  onProgress?.({
    step: "github-key",
    status: "running",
    message: "Generating GitHub deploy key...",
  });

  try {
    const { publicKey } = await GitHub.generateDeployKey(host);
    onProgress?.({
      step: "github-key",
      status: "done",
      message: "Deploy key generated",
    });
    return publicKey;
  } catch (err) {
    onProgress?.({ step: "github-key", status: "error", message: String(err) });
    return null;
  }
}

/**
 * Install Tailscale - returns auth URL if authentication is needed
 */
export async function installTailscale(
  host: string,
  onProgress?: ProgressCallback,
): Promise<TailscaleResult> {
  onProgress?.({
    step: "tailscale",
    status: "running",
    message: "Checking Tailscale...",
  });

  try {
    const tailscaleCheck = await SSH.ssh(host, "tailscale ip -4 2>/dev/null");

    if (tailscaleCheck.exitCode === 0) {
      const ip = tailscaleCheck.stdout.trim();
      onProgress?.({
        step: "tailscale",
        status: "done",
        message: `Tailscale already configured: ${ip}`,
      });
      return { installed: true, needsAuth: false, ip };
    }

    // Install Tailscale
    onProgress?.({
      step: "tailscale",
      status: "running",
      message: "Installing Tailscale...",
    });
    await SSH.sshOrFail(
      host,
      "curl -fsSL https://tailscale.com/install.sh | sh",
    );

    // Try to bring it up
    const tsUp = await SSH.ssh(host, "tailscale up --timeout=10s 2>&1 || true");

    if (tsUp.stdout.includes("https://")) {
      const urlMatch = tsUp.stdout.match(
        /(https:\/\/login\.tailscale\.com\/[^\s]+)/,
      );
      if (urlMatch) {
        onProgress?.({
          step: "tailscale-auth",
          status: "waiting",
          message: urlMatch[1],
        });
        return { installed: true, needsAuth: true, authUrl: urlMatch[1] };
      }
    }

    // Check if it connected without auth
    const ipResult = await SSH.ssh(host, "tailscale ip -4");
    if (ipResult.exitCode === 0) {
      const ip = ipResult.stdout.trim();
      onProgress?.({
        step: "tailscale",
        status: "done",
        message: `Tailscale configured: ${ip}`,
      });
      return { installed: true, needsAuth: false, ip };
    }

    return { installed: true, needsAuth: true };
  } catch (err) {
    onProgress?.({ step: "tailscale", status: "error", message: String(err) });
    return { installed: false, needsAuth: false };
  }
}

/**
 * Get Tailscale IP after authentication
 */
export async function getTailscaleIp(
  host: string,
  onProgress?: ProgressCallback,
): Promise<string | null> {
  onProgress?.({
    step: "tailscale",
    status: "running",
    message: "Getting Tailscale IP...",
  });

  try {
    const ipResult = await SSH.ssh(host, "tailscale ip -4");
    if (ipResult.exitCode === 0) {
      const ip = ipResult.stdout.trim();
      onProgress?.({
        step: "tailscale",
        status: "done",
        message: `Tailscale IP: ${ip}`,
      });
      return ip;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Install Caddy (for gateway servers)
 */
export async function installCaddy(
  host: string,
  acmeEmail: string = "admin@example.com",
  onProgress?: ProgressCallback,
): Promise<boolean> {
  onProgress?.({
    step: "caddy",
    status: "running",
    message: "Checking Caddy...",
  });
  log.info(`Checking Caddy on ${host}`);

  try {
    const caddyCheck = await SSH.ssh(host, "caddy version");

    if (caddyCheck.exitCode !== 0) {
      onProgress?.({
        step: "caddy",
        status: "running",
        message: "Installing Caddy...",
      });
      log.info("Installing Caddy...");
      await waitForAptLock(host);
      await SSH.sshOrFail(
        host,
        `apt-get install -y debian-keyring debian-archive-keyring apt-transport-https && \
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && \
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list`,
      );
      await waitForAptLock(host);
      await SSH.sshOrFail(host, `apt-get update && apt-get install -y caddy`);
    } else {
      log.info("Caddy already installed");
    }

    // Create initial Caddyfile
    const initialCaddyfile = `# Managed by ruilify
{
  email ${acmeEmail}
  acme_ca https://acme-v02.api.letsencrypt.org/directory
}

:80 {
  respond "Gateway server ready. No routes configured yet." 200
}
`;

    await SSH.sshOrFail(
      host,
      `mkdir -p /etc/caddy && cat > /etc/caddy/Caddyfile << 'CADDYFILE'
${initialCaddyfile}
CADDYFILE`,
    );

    await SSH.sshOrFail(
      host,
      "systemctl enable caddy && systemctl restart caddy",
    );
    onProgress?.({
      step: "caddy",
      status: "done",
      message: "Caddy installed and configured",
    });
    log.success("Caddy installed and configured");

    return true;
  } catch (err) {
    log.error(`Failed to install Caddy: ${err}`);
    onProgress?.({ step: "caddy", status: "error", message: String(err) });
    return false;
  }
}

/**
 * Configure iptables for worker servers (Tailscale only)
 */
export async function configureIptablesWorker(
  host: string,
  onProgress?: ProgressCallback,
): Promise<boolean> {
  onProgress?.({
    step: "iptables",
    status: "running",
    message: "Configuring firewall...",
  });
  log.info(`Configuring iptables (worker) on ${host}`);

  try {
    await waitForAptLock(host);
    await SSH.sshOrFail(
      host,
      "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent",
    );

    const iface =
      (
        await SSH.ssh(
          host,
          "ip route | grep default | awk '{print $5}' | head -1",
        )
      ).stdout.trim() || "eth0";

    const rules = [
      "iptables -F DOCKER-USER 2>/dev/null || true",
      "iptables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT",
      "iptables -A DOCKER-USER -i lo -j ACCEPT",
      "iptables -A DOCKER-USER -s 100.64.0.0/10 -j ACCEPT",
      "iptables -A DOCKER-USER -i br-+ -j ACCEPT",
      `iptables -A DOCKER-USER -i ${iface} -j DROP`,
      "iptables -A DOCKER-USER -j RETURN",
    ];

    await SSH.sshOrFail(host, rules.join(" && "));
    await SSH.sshOrFail(host, "netfilter-persistent save");

    onProgress?.({
      step: "iptables",
      status: "done",
      message: "Firewall configured (Tailscale only)",
    });
    log.success("Firewall configured (Tailscale only)");
    return true;
  } catch (err) {
    log.error(`Failed to configure iptables (worker): ${err}`);
    onProgress?.({ step: "iptables", status: "error", message: String(err) });
    return false;
  }
}

/**
 * Configure iptables for gateway servers (allow 80, 443)
 */
export async function configureIptablesGateway(
  host: string,
  onProgress?: ProgressCallback,
): Promise<boolean> {
  onProgress?.({
    step: "iptables",
    status: "running",
    message: "Configuring firewall...",
  });
  log.info(`Configuring iptables (gateway) on ${host}`);

  try {
    await waitForAptLock(host);
    await SSH.sshOrFail(
      host,
      "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent",
    );

    const rules = [
      "iptables -F INPUT",
      "iptables -P INPUT DROP",
      "iptables -P FORWARD DROP",
      "iptables -P OUTPUT ACCEPT",
      "iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT",
      "iptables -A INPUT -i lo -j ACCEPT",
      "iptables -A INPUT -p tcp --dport 22 -j ACCEPT",
      "iptables -A INPUT -p tcp --dport 80 -j ACCEPT",
      "iptables -A INPUT -p tcp --dport 443 -j ACCEPT",
      "iptables -A INPUT -i tailscale0 -j ACCEPT",
      "iptables -A INPUT -p icmp -j ACCEPT",
    ];

    await SSH.sshOrFail(host, rules.join(" && "));
    await SSH.sshOrFail(host, "netfilter-persistent save");

    onProgress?.({
      step: "iptables",
      status: "done",
      message: "Firewall configured (HTTP/HTTPS open)",
    });
    log.success("Firewall configured (HTTP/HTTPS open)");
    return true;
  } catch (err) {
    log.error(`Failed to configure iptables (gateway): ${err}`);
    onProgress?.({ step: "iptables", status: "error", message: String(err) });
    return false;
  }
}

/**
 * Register server in database
 */
export async function registerServer(
  host: string,
  tailscaleIp: string,
  role: "worker" | "build" | "gateway",
  onProgress?: ProgressCallback,
): Promise<boolean> {
  onProgress?.({
    step: "registering",
    status: "running",
    message: "Registering server...",
  });

  try {
    const serverInfo = await SSH.getServerInfo(host);
    const publicIp = host.includes("@") ? host.split("@")[1] : undefined;

    const existingServer = DB.getServerByTailscaleIp(tailscaleIp);

    if (!existingServer) {
      DB.createServer({
        name: serverInfo.hostname || `${role}-server`,
        tailscale_ip: tailscaleIp,
        public_ip: publicIp || null,
        role,
      });
      onProgress?.({
        step: "registering",
        status: "done",
        message: "Server registered",
      });
    } else {
      DB.updateServer(existingServer.id, {
        role,
        public_ip: publicIp || undefined,
      });
      onProgress?.({
        step: "registering",
        status: "done",
        message: "Server already registered, updated",
      });
    }

    return true;
  } catch (err) {
    onProgress?.({
      step: "registering",
      status: "error",
      message: String(err),
    });
    return false;
  }
}

// ============================================================
// Droplet Creation
// ============================================================

export interface CreateDropletOptions {
  name: string;
  region: string;
  size: string;
  sshKeyId: string;
  tags?: string[];
}

/**
 * Create a new droplet and wait for SSH
 */
export async function createDroplet(
  options: CreateDropletOptions,
  onProgress?: ProgressCallback,
): Promise<DropletCreateResult> {
  try {
    onProgress?.({
      step: "connecting",
      status: "running",
      message: "Creating droplet...",
    });

    const droplet = await DO.createDroplet({
      name: options.name,
      region: options.region,
      size: options.size,
      image: "ubuntu-24-04-x64",
      ssh_keys: [options.sshKeyId],
      tags: options.tags || [],
      monitoring: true,
    });

    // Wait for IP
    onProgress?.({
      step: "connecting",
      status: "running",
      message: "Waiting for public IP...",
    });
    let publicIp = "";

    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const updated = await DO.getDroplet(droplet.id);
      publicIp = DO.getPublicIP(updated) || "";
      if (publicIp) break;
    }

    if (!publicIp) {
      return { success: false, error: "Failed to get public IP" };
    }

    // Wait for SSH
    onProgress?.({
      step: "connecting",
      status: "running",
      message: `IP: ${publicIp}, waiting for SSH...`,
    });
    const sshHost = `root@${publicIp}`;

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const connected = await SSH.testConnection(sshHost);
      if (connected) {
        onProgress?.({
          step: "connecting",
          status: "done",
          message: "SSH connected!",
        });
        return {
          success: true,
          dropletId: droplet.id,
          publicIp,
          sshHost,
        };
      }
    }

    return { success: false, error: "SSH connection timeout" };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ============================================================
// High-level Setup Functions
// ============================================================

/**
 * Full setup for a worker/target server
 */
export async function setupWorkerServer(
  host: string,
  onProgress?: ProgressCallback,
): Promise<SetupResult> {
  const result: SetupResult = { success: false };

  // Test connection
  if (!(await testConnection(host, onProgress))) {
    return { ...result, error: "Cannot connect to server" };
  }

  // Update system
  await updateSystem(host, onProgress);

  // Install Docker
  if (!(await installDocker(host, onProgress))) {
    return { ...result, error: "Failed to install Docker" };
  }

  // Configure registry if available
  if (process.env.REGISTRY_URL) {
    await configureDockerRegistry(host, process.env.REGISTRY_URL, onProgress);
  }

  // Install Tailscale
  const tsResult = await installTailscale(host, onProgress);
  if (tsResult.needsAuth) {
    return {
      ...result,
      success: true, // Partial success - needs auth
      error: "TAILSCALE_AUTH_NEEDED",
    };
  }

  result.tailscaleIp = tsResult.ip;

  // Configure iptables
  await configureIptablesWorker(host, onProgress);

  // Register server
  if (result.tailscaleIp) {
    await registerServer(host, result.tailscaleIp, "worker", onProgress);
  }

  // Get server info
  const serverInfo = await SSH.getServerInfo(host);
  result.hostname = serverInfo.hostname;
  result.publicIp = host.includes("@") ? host.split("@")[1] : undefined;

  onProgress?.({
    step: "done",
    status: "done",
    message: "Worker server setup complete!",
  });

  return { ...result, success: true };
}

/**
 * Full setup for a build server
 */
export async function setupBuildServer(
  host: string,
  onProgress?: ProgressCallback,
): Promise<SetupResult> {
  const result: SetupResult = { success: false };

  // Test connection
  if (!(await testConnection(host, onProgress))) {
    return { ...result, error: "Cannot connect to server" };
  }

  // Update system
  await updateSystem(host, onProgress);

  // Install Docker
  if (!(await installDocker(host, onProgress))) {
    return { ...result, error: "Failed to install Docker" };
  }

  // Install Git
  await installGit(host, onProgress);

  // Setup Docker Registry
  await installDockerRegistry(host, onProgress);

  // Generate GitHub deploy key
  result.deployKey =
    (await generateGitHubDeployKey(host, onProgress)) || undefined;

  // Install Tailscale
  const tsResult = await installTailscale(host, onProgress);
  if (tsResult.needsAuth) {
    return {
      ...result,
      success: true, // Partial success - needs auth
      error: "TAILSCALE_AUTH_NEEDED",
    };
  }

  result.tailscaleIp = tsResult.ip;

  if (result.tailscaleIp) {
    result.registryUrl = `${result.tailscaleIp}:5000`;
    await registerServer(host, result.tailscaleIp, "build", onProgress);
  }

  // Get server info
  const serverInfo = await SSH.getServerInfo(host);
  result.hostname = serverInfo.hostname;
  result.publicIp = host.includes("@") ? host.split("@")[1] : undefined;

  onProgress?.({
    step: "done",
    status: "done",
    message: "Build server setup complete!",
  });

  return { ...result, success: true };
}

/**
 * Full setup for a gateway server
 */
export async function setupGatewayServer(
  host: string,
  acmeEmail?: string,
  onProgress?: ProgressCallback,
): Promise<SetupResult> {
  const result: SetupResult = { success: false };

  // Test connection
  if (!(await testConnection(host, onProgress))) {
    return { ...result, error: "Cannot connect to server" };
  }

  // Get public IP
  const ipResult = await SSH.ssh(host, "curl -s ifconfig.me");
  result.publicIp = ipResult.stdout.trim();

  // Update system
  await updateSystem(host, onProgress);

  // Install Docker
  if (!(await installDocker(host, onProgress))) {
    return { ...result, error: "Failed to install Docker" };
  }

  // Install Tailscale
  const tsResult = await installTailscale(host, onProgress);
  if (tsResult.needsAuth) {
    return {
      ...result,
      success: true, // Partial success - needs auth
      error: "TAILSCALE_AUTH_NEEDED",
    };
  }

  result.tailscaleIp = tsResult.ip;

  // Install Caddy
  await installCaddy(
    host,
    acmeEmail || DB.getSettingOrDefault("acme_email", "admin@example.com"),
    onProgress,
  );

  // Configure iptables
  await configureIptablesGateway(host, onProgress);

  // Register server
  if (result.tailscaleIp) {
    await registerServer(host, result.tailscaleIp, "gateway", onProgress);
  }

  // Get server info
  const serverInfo = await SSH.getServerInfo(host);
  result.hostname = serverInfo.hostname;

  onProgress?.({
    step: "done",
    status: "done",
    message: "Gateway server setup complete!",
  });

  return { ...result, success: true };
}

/**
 * Continue setup after Tailscale authentication
 */
export async function continueAfterTailscaleAuth(
  host: string,
  serverType: "worker" | "build" | "gateway",
  onProgress?: ProgressCallback,
): Promise<SetupResult> {
  const result: SetupResult = { success: false };

  // Get Tailscale IP
  const tailscaleIp = await getTailscaleIp(host, onProgress);
  if (!tailscaleIp) {
    return { ...result, error: "Failed to get Tailscale IP after auth" };
  }

  result.tailscaleIp = tailscaleIp;

  // Continue with remaining steps based on server type
  if (serverType === "worker") {
    await configureIptablesWorker(host, onProgress);
  } else if (serverType === "gateway") {
    // Install Caddy for gateway servers
    await installCaddy(
      host,
      DB.getSettingOrDefault("acme_email", "admin@example.com"),
      onProgress,
    );
    await configureIptablesGateway(host, onProgress);
  }
  // build server doesn't need iptables

  // Register server
  await registerServer(host, tailscaleIp, serverType, onProgress);

  // Get server info
  const serverInfo = await SSH.getServerInfo(host);
  result.hostname = serverInfo.hostname;
  result.publicIp = host.includes("@") ? host.split("@")[1] : undefined;

  if (serverType === "build") {
    result.registryUrl = `${tailscaleIp}:5000`;
  }

  onProgress?.({
    step: "done",
    status: "done",
    message: `${serverType} server setup complete!`,
  });

  return { ...result, success: true };
}
