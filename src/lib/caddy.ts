/**
 * Caddy Reverse Proxy Management
 *
 * Manages Caddy configuration on the gateway server:
 * - Generate Caddyfile from projects
 * - Reload Caddy after changes
 * - Health check Caddy status
 */

import { ssh, sshOrFail } from './ssh';
import * as DB from './db';

// ============ Types ============

export interface CaddyRoute {
	domain: string;
	upstream: string; // e.g., "100.x.x.x:3000"
}

// ============ Configuration ============

const CADDY_CONFIG_PATH = '/etc/caddy/Caddyfile';
const CADDY_DATA_PATH = '/data/caddy';

/**
 * Get the gateway server from environment or database
 */
export function getGatewayServer(): string {
	const envHost = process.env.GATEWAY_SERVER_HOST;
	if (envHost) return envHost;

	const server = DB.getGatewayServer();
	if (server) return server.tailscale_ip;

	throw new Error('No gateway server configured. Set GATEWAY_SERVER_HOST or run setup-gateway-server.ts');
}

// ============ Caddyfile Generation ============

/**
 * Generate Caddyfile content from all active projects
 */
export function generateCaddyfile(routes: CaddyRoute[]): string {
	const lines: string[] = [
		'# Auto-generated Caddyfile - Do not edit manually',
		'# Managed by coolify-infra',
		'',
		'# Global options',
		'{',
		'\temail admin@example.com',
		'\tacme_ca https://acme-v02.api.letsencrypt.org/directory',
		'}',
		'',
	];

	for (const route of routes) {
		lines.push(`# ${route.domain}`);
		lines.push(`${route.domain} {`);
		lines.push(`\treverse_proxy ${route.upstream} {`);
		lines.push('\t\theader_up Host {host}');
		lines.push('\t\theader_up X-Real-IP {remote_host}');
		lines.push('\t\theader_up X-Forwarded-For {remote_host}');
		lines.push('\t\theader_up X-Forwarded-Proto {scheme}');
		lines.push('\t}');
		lines.push('}');
		lines.push('');
	}

	// Add a default handler for unmatched domains
	lines.push('# Default - respond with 404');
	lines.push(':80 {');
	lines.push('\trespond "Not Found" 404');
	lines.push('}');

	return lines.join('\n');
}

/**
 * Get routes from all active projects in the database
 */
export function getRoutesFromProjects(): CaddyRoute[] {
	const projects = DB.listProjects();
	const routes: CaddyRoute[] = [];

	for (const project of projects) {
		if (!project.domain || !project.current_slot) {
			continue; // Skip projects without domain or not deployed
		}

		const port = project.current_slot === 'blue' ? 3000 : 3001;
		routes.push({
			domain: project.domain,
			upstream: `${project.target_server}:${port}`,
		});
	}

	return routes;
}

// ============ Remote Operations ============

/**
 * Update Caddyfile on the gateway server
 */
export async function updateCaddyfile(gatewayHost: string, content: string): Promise<void> {
	// Escape content for shell
	const escaped = content.replace(/'/g, "'\\''");

	// Write to temporary file first
	await sshOrFail(gatewayHost, `echo '${escaped}' > /tmp/Caddyfile.new`);

	// Validate the new config
	const validateResult = await ssh(gatewayHost, 'caddy validate --config /tmp/Caddyfile.new');
	if (validateResult.exitCode !== 0) {
		throw new Error(`Invalid Caddyfile: ${validateResult.stderr || validateResult.stdout}`);
	}

	// Move to final location
	await sshOrFail(gatewayHost, `mv /tmp/Caddyfile.new ${CADDY_CONFIG_PATH}`);
}

/**
 * Reload Caddy to apply new configuration
 */
export async function reloadCaddy(gatewayHost: string): Promise<void> {
	const result = await ssh(gatewayHost, 'systemctl reload caddy');
	if (result.exitCode !== 0) {
		// Try restart if reload fails
		await sshOrFail(gatewayHost, 'systemctl restart caddy');
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
		ssh(gatewayHost, 'systemctl is-active caddy'),
		ssh(gatewayHost, 'caddy version'),
	]);

	const running = statusResult.exitCode === 0 && statusResult.stdout.trim() === 'active';

	let uptime = 'Unknown';
	if (running) {
		const uptimeResult = await ssh(
			gatewayHost,
			"systemctl show caddy --property=ActiveEnterTimestamp | cut -d'=' -f2"
		);
		uptime = uptimeResult.stdout.trim() || 'Unknown';
	}

	return {
		running,
		version: versionResult.stdout.trim() || 'Unknown',
		uptime,
	};
}

/**
 * Get current Caddyfile content from gateway
 */
export async function getCaddyfile(gatewayHost: string): Promise<string> {
	const result = await ssh(gatewayHost, `cat ${CADDY_CONFIG_PATH} 2>/dev/null || echo "# No Caddyfile found"`);
	return result.stdout;
}

// ============ High-Level Operations ============

/**
 * Sync all project routes to Caddy
 * Call this after any project change (add, deploy, delete)
 */
export async function syncRoutes(): Promise<{ success: boolean; routes: number; error?: string }> {
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
	slot: 'blue' | 'green'
): Promise<{ success: boolean; error?: string }> {
	try {
		const gatewayHost = getGatewayServer();
		const port = slot === 'blue' ? 3000 : 3001;

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
export async function removeRoute(domain: string): Promise<{ success: boolean; error?: string }> {
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
	domain: string
): Promise<{ accessible: boolean; statusCode: number; responseTime: number }> {
	const start = Date.now();

	try {
		const response = await fetch(`https://${domain}`, {
			method: 'HEAD',
			redirect: 'manual',
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
