/**
 * Caddy Reverse Proxy Management
 *
 * Manages Caddy configuration on the gateway server:
 * - Generate Caddyfile from projects
 * - Reload Caddy after changes
 * - Health check Caddy status
 */

import { ssh, sshOrFail } from "./ssh";
import * as DB from "./db";
import * as Cloudflare from "./cloudflare";

// Default ACME email for Let's Encrypt certificates
const DEFAULT_ACME_EMAIL = "ruivalim@pm.me";

// ============ Types ============

export interface CaddyRoute {
  domain: string;
  upstream: string; // e.g., "100.x.x.x:3000"
}

// ============ Configuration ============

const CADDY_CONFIG_PATH = "/etc/caddy/Caddyfile";
const CADDY_DATA_PATH = "/data/caddy";

/**
 * Get the gateway server SSH host from environment or database
 */
export function getGatewayServer(): string {
  const envHost = process.env.GATEWAY_SERVER_HOST;
  if (envHost) return envHost;

  const server = DB.getGatewayServer();
  if (server) return `root@${server.tailscale_ip}`;

  throw new Error(
    "No gateway server configured. Set GATEWAY_SERVER_HOST or run setup-gateway-server.ts",
  );
}

// ============ Caddyfile Generation ============

/**
 * Generate Caddyfile content from all active projects
 */
export function generateCaddyfile(routes: CaddyRoute[]): string {
  const acmeEmail =
    DB.getSetting(DB.SETTING_KEYS.ACME_EMAIL) || DEFAULT_ACME_EMAIL;

  const lines: string[] = [
    "# Auto-generated Caddyfile - Do not edit manually",
    "# Managed by ruilify",
    "",
    "# Global options",
    "{",
    `\temail ${acmeEmail}`,
    "\tacme_ca https://acme-v02.api.letsencrypt.org/directory",
    "}",
    "",
  ];

  for (const route of routes) {
    lines.push(`# ${route.domain}`);
    lines.push(`${route.domain} {`);
    lines.push(`\treverse_proxy ${route.upstream} {`);
    lines.push("\t\theader_up Host {host}");
    lines.push("\t\theader_up X-Real-IP {remote_host}");
    lines.push("\t\theader_up X-Forwarded-For {remote_host}");
    lines.push("\t\theader_up X-Forwarded-Proto {scheme}");
    lines.push("\t}");
    lines.push("}");
    lines.push("");
  }

  // Add a default handler for unmatched domains
  lines.push("# Default - respond with 404");
  lines.push(":80 {");
  lines.push('\trespond "Not Found" 404');
  lines.push("}");

  return lines.join("\n");
}

/**
 * Get routes from all active projects in the database
 */
export function getRoutesFromProjects(): CaddyRoute[] {
  const projects = DB.listProjects();
  const routes: CaddyRoute[] = [];

  for (const project of projects) {
    // Skip projects without domain or not running
    if (!project.domain || project.status !== "running") {
      continue;
    }

    // Get the worker server's Tailscale IP
    const server = DB.getServer(project.target_server);
    if (!server) continue;

    // Use project port (for compose deploys) or blue/green slot
    const port = project.port || (project.current_slot === "blue" ? 3000 : 3001);

    routes.push({
      domain: project.domain,
      upstream: `${server.tailscale_ip}:${port}`,
    });
  }

  return routes;
}

// ============ Remote Operations ============

/**
 * Update Caddyfile on the gateway server
 */
export async function updateCaddyfile(
  gatewayHost: string,
  content: string,
): Promise<void> {
  // Escape content for shell
  const escaped = content.replace(/'/g, "'\\''");

  // Write to temporary file first
  await sshOrFail(gatewayHost, `echo '${escaped}' > /tmp/Caddyfile.new`);

  // Validate the new config
  const validateResult = await ssh(
    gatewayHost,
    "caddy validate --config /tmp/Caddyfile.new",
  );
  if (validateResult.exitCode !== 0) {
    throw new Error(
      `Invalid Caddyfile: ${validateResult.stderr || validateResult.stdout}`,
    );
  }

  // Move to final location
  await sshOrFail(gatewayHost, `mv /tmp/Caddyfile.new ${CADDY_CONFIG_PATH}`);
}

/**
 * Reload Caddy to apply new configuration
 */
export async function reloadCaddy(gatewayHost: string): Promise<void> {
  const result = await ssh(gatewayHost, "systemctl reload caddy");
  if (result.exitCode !== 0) {
    // Try restart if reload fails
    await sshOrFail(gatewayHost, "systemctl restart caddy");
  }
}

/**
 * Check if Caddy is running and healthy
 */
export async function checkCaddy(gatewayHost: string): Promise<{
  running: boolean;
  version: string;
  uptime: string;
}> {
  const [statusResult, versionResult] = await Promise.all([
    ssh(gatewayHost, "systemctl is-active caddy"),
    ssh(gatewayHost, "caddy version"),
  ]);

  const running =
    statusResult.exitCode === 0 && statusResult.stdout.trim() === "active";

  let uptime = "Unknown";
  if (running) {
    const uptimeResult = await ssh(
      gatewayHost,
      "systemctl show caddy --property=ActiveEnterTimestamp | cut -d'=' -f2",
    );
    uptime = uptimeResult.stdout.trim() || "Unknown";
  }

  return {
    running,
    version: versionResult.stdout.trim() || "Unknown",
    uptime,
  };
}

/**
 * Get current Caddyfile content from gateway
 */
export async function getCaddyfile(gatewayHost: string): Promise<string> {
  const result = await ssh(
    gatewayHost,
    `cat ${CADDY_CONFIG_PATH} 2>/dev/null || echo "# No Caddyfile found"`,
  );
  return result.stdout;
}

// ============ High-Level Operations ============

/**
 * Sync all project routes to Caddy
 * Call this after any project change (add, deploy, delete)
 */
export async function syncRoutes(): Promise<{
  success: boolean;
  routes: number;
  error?: string;
}> {
  try {
    const gatewayHost = getGatewayServer();
    const routes = getRoutesFromProjects();
    const caddyfile = generateCaddyfile(routes);

    await updateCaddyfile(gatewayHost, caddyfile);
    await reloadCaddy(gatewayHost);

    return { success: true, routes: routes.length };
  } catch (error) {
    return {
      success: false,
      routes: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Add or update a single route
 * More efficient than full sync for single project changes
 */
export async function updateRoute(
  domain: string,
  targetServer: string,
  slot: "blue" | "green",
): Promise<{ success: boolean; error?: string }> {
  try {
    const gatewayHost = getGatewayServer();
    const port = slot === "blue" ? 3000 : 3001;

    // Get all current routes
    const routes = getRoutesFromProjects();

    // Update or add the route
    const existingIndex = routes.findIndex((r) => r.domain === domain);
    const newRoute: CaddyRoute = {
      domain,
      upstream: `${targetServer}:${port}`,
    };

    if (existingIndex >= 0) {
      routes[existingIndex] = newRoute;
    } else {
      routes.push(newRoute);
    }

    // Generate and apply
    const caddyfile = generateCaddyfile(routes);
    await updateCaddyfile(gatewayHost, caddyfile);
    await reloadCaddy(gatewayHost);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Remove a route
 */
export async function removeRoute(
  domain: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const gatewayHost = getGatewayServer();

    // Get all current routes except the one to remove
    const routes = getRoutesFromProjects().filter((r) => r.domain !== domain);

    // Generate and apply
    const caddyfile = generateCaddyfile(routes);
    await updateCaddyfile(gatewayHost, caddyfile);
    await reloadCaddy(gatewayHost);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Test if a domain is accessible through the gateway
 */
export async function testRoute(
  domain: string,
): Promise<{ accessible: boolean; statusCode: number; responseTime: number }> {
  const start = Date.now();

  try {
    const response = await fetch(`https://${domain}`, {
      method: "HEAD",
      redirect: "manual",
    });

    return {
      accessible: true,
      statusCode: response.status,
      responseTime: Date.now() - start,
    };
  } catch {
    return {
      accessible: false,
      statusCode: 0,
      responseTime: Date.now() - start,
    };
  }
}

// ============ Domain Setup (Cloudflare + Caddy) ============

export interface SetupDomainResult {
  success: boolean;
  dns?: { created: boolean; recordId: string };
  caddy?: { synced: boolean };
  error?: string;
}

/**
 * Extract the root zone from a domain
 * e.g., "cloudbeaver.ruivalim.com.br" -> "ruivalim.com.br"
 */
function extractZone(domain: string): string {
  const parts = domain.split(".");
  // Handle .com.br, .co.uk style TLDs
  if (parts.length >= 3 && parts[parts.length - 2].length <= 3) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

/**
 * Setup domain for a project:
 * 1. Create DNS A record in Cloudflare pointing to gateway public IP
 * 2. Update Caddy routes on gateway
 */
export async function setupProjectDomain(
  projectId: string,
  onProgress?: (step: string, message: string) => void,
): Promise<SetupDomainResult> {
  const progress = onProgress || (() => {});

  try {
    const project = DB.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    if (!project.domain) {
      throw new Error("Project has no domain configured");
    }

    // Get gateway server for public IP
    const gatewayServer = DB.getGatewayServer();
    if (!gatewayServer || !gatewayServer.public_ip) {
      throw new Error("Gateway server not configured or has no public IP");
    }

    const result: SetupDomainResult = { success: true };

    // 1. Setup DNS in Cloudflare
    if (Cloudflare.hasCloudflareConfig()) {
      progress("dns", `Setting up DNS for ${project.domain}...`);

      const zoneName = extractZone(project.domain);
      const zone = await Cloudflare.getZoneByName(zoneName);

      if (!zone) {
        throw new Error(`Zone ${zoneName} not found in Cloudflare`);
      }

      // Check if record already exists
      const existingRecords = await Cloudflare.listDnsRecords(zone.id, "A");
      const existing = existingRecords.find((r) => r.name === project.domain);

      if (existing) {
        // Update existing record
        await Cloudflare.updateDnsRecord(zone.id, existing.id, {
          content: gatewayServer.public_ip,
        });
        result.dns = { created: false, recordId: existing.id };
        progress("dns", `Updated DNS record (${existing.id})`);
      } else {
        // Create new record
        const record = await Cloudflare.createARecord(
          zone.id,
          project.domain,
          gatewayServer.public_ip,
          true, // proxied through Cloudflare
        );
        result.dns = { created: true, recordId: record.id };
        progress("dns", `Created DNS record (${record.id})`);
      }
    } else {
      progress("dns", "Cloudflare not configured, skipping DNS setup");
    }

    // 2. Sync Caddy routes
    progress("caddy", "Syncing Caddy routes...");
    const caddyResult = await syncRoutes();

    if (!caddyResult.success) {
      throw new Error(`Caddy sync failed: ${caddyResult.error}`);
    }

    result.caddy = { synced: true };
    progress("caddy", `Caddy synced (${caddyResult.routes} routes)`);

    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Remove domain setup for a project:
 * 1. Remove DNS record from Cloudflare
 * 2. Update Caddy routes
 */
export async function removeProjectDomain(
  projectId: string,
  onProgress?: (step: string, message: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const progress = onProgress || (() => {});

  try {
    const project = DB.getProject(projectId);
    if (!project || !project.domain) {
      return { success: true }; // Nothing to remove
    }

    // 1. Remove DNS record
    if (Cloudflare.hasCloudflareConfig()) {
      progress("dns", `Removing DNS for ${project.domain}...`);

      const zoneName = extractZone(project.domain);
      const zone = await Cloudflare.getZoneByName(zoneName);

      if (zone) {
        const records = await Cloudflare.listDnsRecords(zone.id, "A");
        const existing = records.find((r) => r.name === project.domain);

        if (existing) {
          await Cloudflare.deleteDnsRecord(zone.id, existing.id);
          progress("dns", "DNS record removed");
        }
      }
    }

    // 2. Sync Caddy routes (will exclude this project)
    progress("caddy", "Syncing Caddy routes...");
    await syncRoutes();
    progress("caddy", "Caddy synced");

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
