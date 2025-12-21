/**
 * Server Info Library
 *
 * Functions to get detailed server information via SSH.
 * Used by both CLI and TUI.
 */

import * as SSH from "./ssh";
import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// ============================================================
// Logging
// ============================================================

const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "tui.log");

function logToFile(level: string, message: string, source?: string): void {
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    const src = source ? `[${source}]` : "";
    appendFileSync(LOG_FILE, `${timestamp} [${level}] ${src} ${message}\n`);
  } catch {
    // Ignore
  }
}

export const log = {
  info: (msg: string, src?: string) => logToFile("INFO", msg, src),
  success: (msg: string, src?: string) => logToFile("SUCCESS", msg, src),
  error: (msg: string, src?: string) => logToFile("ERROR", msg, src),
  debug: (msg: string, src?: string) => logToFile("DEBUG", msg, src),
};

// ============================================================
// Types
// ============================================================

export interface ServerDetails {
  hostname: string;
  os: string;
  kernel: string;
  uptime: string;
  docker?: {
    version: string;
    containers: number;
    images: number;
  };
  tailscale?: {
    version: string;
    ip: string;
    hostname: string;
    magicDns: string;
    online: boolean;
  };
  caddy?: {
    version: string;
    running: boolean;
  };
  memory: {
    total: string;
    used: string;
    percent: number;
  };
  disk: {
    total: string;
    used: string;
    percent: number;
  };
  updates?: {
    available: number;
    security: number;
  };
}

// ============================================================
// Functions
// ============================================================

/**
 * Get comprehensive server details
 */
export async function getServerDetails(
  host: string,
): Promise<ServerDetails | null> {
  // Ensure host has user@ prefix
  const sshHost = host.includes("@") ? host : `root@${host}`;
  log.info(`Getting server details for ${sshHost}`, "server-info");

  try {
    // First test SSH connection
    log.debug(`Testing SSH connection to ${sshHost}`, "server-info");
    const testResult = await SSH.ssh(sshHost, "echo 'OK'");
    if (testResult.exitCode !== 0) {
      log.error(
        `SSH connection failed to ${host}: ${testResult.stderr}`,
        "server-info",
      );
      return null;
    }
    log.debug(`SSH connection OK to ${sshHost}`, "server-info");

    // Run all checks in parallel for speed
    log.debug(`Running parallel checks on ${sshHost}`, "server-info");
    const [
      hostnameResult,
      osResult,
      kernelResult,
      uptimeResult,
      dockerResult,
      tailscaleResult,
      caddyResult,
      memoryResult,
      diskResult,
    ] = await Promise.all([
      SSH.ssh(sshHost, "hostname"),
      SSH.ssh(
        sshHost,
        "cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"'",
      ),
      SSH.ssh(sshHost, "uname -r"),
      SSH.ssh(sshHost, "uptime -p"),
      getDockerInfo(sshHost),
      getTailscaleInfo(sshHost),
      getCaddyInfo(sshHost),
      SSH.ssh(sshHost, "free -h | awk '/^Mem:/ {print $2,$3}'"),
      SSH.ssh(sshHost, "df -h / | awk 'NR==2 {print $2,$3,$5}'"),
    ]);

    // Log raw results for debugging
    log.debug(
      `hostname: "${hostnameResult.stdout.trim()}" (exit: ${hostnameResult.exitCode})`,
      "server-info",
    );
    log.debug(
      `os: "${osResult.stdout.trim()}" (exit: ${osResult.exitCode})`,
      "server-info",
    );
    log.debug(
      `kernel: "${kernelResult.stdout.trim()}" (exit: ${kernelResult.exitCode})`,
      "server-info",
    );
    log.debug(
      `uptime: "${uptimeResult.stdout.trim()}" (exit: ${uptimeResult.exitCode})`,
      "server-info",
    );
    log.debug(
      `memory: "${memoryResult.stdout.trim()}" (exit: ${memoryResult.exitCode})`,
      "server-info",
    );
    log.debug(
      `disk: "${diskResult.stdout.trim()}" (exit: ${diskResult.exitCode})`,
      "server-info",
    );
    log.debug(`docker: ${JSON.stringify(dockerResult)}`, "server-info");
    log.debug(`tailscale: ${JSON.stringify(tailscaleResult)}`, "server-info");
    log.debug(`caddy: ${JSON.stringify(caddyResult)}`, "server-info");

    // Parse memory
    const memParts = memoryResult.stdout.trim().split(" ");
    const memPercent =
      memParts.length >= 2 ? parseMemoryPercent(memParts[0], memParts[1]) : 0;

    // Parse disk
    const diskParts = diskResult.stdout.trim().split(" ");
    const diskPercent = diskParts.length >= 3 ? parseInt(diskParts[2]) || 0 : 0;

    const details: ServerDetails = {
      hostname: hostnameResult.stdout.trim(),
      os: osResult.stdout.trim(),
      kernel: kernelResult.stdout.trim(),
      uptime: uptimeResult.stdout.trim().replace("up ", ""),
      docker: dockerResult,
      tailscale: tailscaleResult,
      caddy: caddyResult,
      memory: {
        total: memParts[0] || "?",
        used: memParts[1] || "?",
        percent: memPercent,
      },
      disk: {
        total: diskParts[0] || "?",
        used: diskParts[1] || "?",
        percent: diskPercent,
      },
    };

    log.success(`Got server details for ${host}`, "server-info");
    return details;
  } catch (err) {
    log.error(`Failed to get server details: ${err}`, "server-info");
    return null;
  }
}

/**
 * Get Docker info
 */
async function getDockerInfo(
  host: string,
): Promise<ServerDetails["docker"] | undefined> {
  try {
    log.debug(`Checking Docker on ${host}`, "server-info");
    const versionResult = await SSH.ssh(
      host,
      "docker --version 2>/dev/null | awk '{print $3}' | tr -d ','",
    );
    if (versionResult.exitCode !== 0) {
      log.debug(
        `Docker not found on ${host} (exit: ${versionResult.exitCode})`,
        "server-info",
      );
      return undefined;
    }

    const statsResult = await SSH.ssh(
      host,
      "docker info --format '{{.Containers}} {{.Images}}' 2>/dev/null",
    );
    const parts = statsResult.stdout.trim().split(" ");

    const result = {
      version: versionResult.stdout.trim(),
      containers: parseInt(parts[0]) || 0,
      images: parseInt(parts[1]) || 0,
    };
    log.debug(`Docker found: ${JSON.stringify(result)}`, "server-info");
    return result;
  } catch (err) {
    log.error(`Error getting Docker info: ${err}`, "server-info");
    return undefined;
  }
}

/**
 * Get Tailscale info
 */
async function getTailscaleInfo(
  host: string,
): Promise<ServerDetails["tailscale"] | undefined> {
  try {
    log.debug(`Checking Tailscale on ${host}`, "server-info");
    const versionResult = await SSH.ssh(
      host,
      "tailscale --version 2>/dev/null | head -1",
    );
    if (versionResult.exitCode !== 0) {
      log.debug(`Tailscale not found on ${host}`, "server-info");
      return undefined;
    }

    const statusResult = await SSH.ssh(
      host,
      "tailscale status --json 2>/dev/null",
    );
    if (statusResult.exitCode !== 0) {
      log.debug(`Tailscale status failed on ${host}`, "server-info");
      return undefined;
    }

    const status = JSON.parse(statusResult.stdout);
    const self = status.Self;

    const result = {
      version: versionResult.stdout.trim(),
      ip: self?.TailscaleIPs?.[0] || "",
      hostname: self?.HostName || "",
      magicDns: self?.DNSName || "",
      online: self?.Online ?? false,
    };
    log.debug(`Tailscale found: ${JSON.stringify(result)}`, "server-info");
    return result;
  } catch (err) {
    log.error(`Error getting Tailscale info: ${err}`, "server-info");
    return undefined;
  }
}

/**
 * Get Caddy info
 */
async function getCaddyInfo(
  host: string,
): Promise<ServerDetails["caddy"] | undefined> {
  try {
    log.debug(`Checking Caddy on ${host}`, "server-info");
    const versionResult = await SSH.ssh(
      host,
      "caddy version 2>/dev/null | awk '{print $1}'",
    );
    if (versionResult.exitCode !== 0) {
      log.debug(`Caddy not found on ${host}`, "server-info");
      return undefined;
    }

    const statusResult = await SSH.ssh(
      host,
      "systemctl is-active caddy 2>/dev/null",
    );

    const result = {
      version: versionResult.stdout.trim(),
      running: statusResult.stdout.trim() === "active",
    };
    log.debug(`Caddy found: ${JSON.stringify(result)}`, "server-info");
    return result;
  } catch (err) {
    log.error(`Error getting Caddy info: ${err}`, "server-info");
    return undefined;
  }
}

/**
 * Check for available updates
 */
export async function checkUpdates(
  host: string,
): Promise<ServerDetails["updates"] | undefined> {
  const sshHost = host.includes("@") ? host : `root@${host}`;
  log.info(`Checking updates for ${sshHost}`, "server-info");

  try {
    // First update package lists
    await SSH.ssh(sshHost, "apt-get update -qq 2>/dev/null");

    // Check for updates
    const result = await SSH.ssh(
      sshHost,
      "apt list --upgradable 2>/dev/null | grep -c upgradable || echo 0",
    );
    const available = parseInt(result.stdout.trim()) || 0;

    // Check for security updates
    const secResult = await SSH.ssh(
      sshHost,
      "apt list --upgradable 2>/dev/null | grep -i security | wc -l",
    );
    const security = parseInt(secResult.stdout.trim()) || 0;

    log.success(
      `Found ${available} updates (${security} security)`,
      "server-info",
    );
    return { available, security };
  } catch {
    return undefined;
  }
}

/**
 * Apply system updates
 */
export async function applyUpdates(
  host: string,
  onProgress?: (message: string) => void,
): Promise<boolean> {
  const sshHost = host.includes("@") ? host : `root@${host}`;
  log.info(`Applying updates on ${sshHost}`, "server-info");

  try {
    onProgress?.("Updating package lists...");
    await SSH.ssh(sshHost, "apt-get update -qq");

    onProgress?.("Upgrading packages...");
    await SSH.ssh(
      sshHost,
      "DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq",
    );

    onProgress?.("Cleaning up...");
    await SSH.ssh(sshHost, "apt-get autoremove -y -qq");

    log.success(`Updates applied on ${sshHost}`, "server-info");
    onProgress?.("Updates complete!");
    return true;
  } catch (err) {
    log.error(`Failed to apply updates: ${err}`, "server-info");
    return false;
  }
}

/**
 * Restart a service
 */
export async function restartService(
  host: string,
  service: string,
): Promise<boolean> {
  const sshHost = host.includes("@") ? host : `root@${host}`;
  log.info(`Restarting ${service} on ${sshHost}`, "server-info");

  try {
    await SSH.sshOrFail(sshHost, `systemctl restart ${service}`);
    log.success(`Restarted ${service}`, "server-info");
    return true;
  } catch (err) {
    log.error(`Failed to restart ${service}: ${err}`, "server-info");
    return false;
  }
}

/**
 * Parse memory percentage from total and used strings
 */
function parseMemoryPercent(total: string, used: string): number {
  const parseSize = (s: string): number => {
    const num = parseFloat(s);
    if (s.includes("G")) return num * 1024;
    if (s.includes("M")) return num;
    if (s.includes("K")) return num / 1024;
    return num;
  };

  const totalMb = parseSize(total);
  const usedMb = parseSize(used);
  return totalMb > 0 ? Math.round((usedMb / totalMb) * 100) : 0;
}

/**
 * Quick connectivity check
 */
export async function checkConnectivity(host: string): Promise<boolean> {
  const sshHost = host.includes("@") ? host : `root@${host}`;
  log.debug(`Checking connectivity to ${sshHost}`, "server-info");
  const result = await SSH.testConnection(sshHost);
  log.debug(
    `Connectivity to ${sshHost}: ${result ? "OK" : "FAILED"}`,
    "server-info",
  );
  return result;
}
