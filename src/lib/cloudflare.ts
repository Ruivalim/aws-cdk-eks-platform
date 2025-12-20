/**
 * Cloudflare API Client
 *
 * Manages DNS zones/records and Cloudflare Tunnels.
 * Docs: https://developers.cloudflare.com/api/
 */

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

function getToken(): string {
	const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
	if (!token) {
		throw new Error('CLOUDFLARE_API_TOKEN environment variable is required');
	}
	return token;
}

function getAccountId(): string {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
	if (!accountId) {
		throw new Error('CLOUDFLARE_ACCOUNT_ID environment variable is required');
	}
	return accountId;
}

interface CloudflareResponse<T> {
	success: boolean;
	errors: Array<{ code: number; message: string }>;
	messages: string[];
	result: T;
	result_info?: {
		page: number;
		per_page: number;
		total_count: number;
		total_pages: number;
	};
}

async function cfFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
	const token = getToken();
	const response = await fetch(`${CF_API_BASE}${endpoint}`, {
		...options,
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
			...options.headers,
		},
	});

	const data = (await response.json()) as CloudflareResponse<T>;

	if (!data.success) {
		const errorMsg = data.errors.map((e) => e.message).join(', ');
		throw new Error(`Cloudflare API error: ${errorMsg}`);
	}

	return data.result;
}

// ============ DNS Zones ============

export interface Zone {
	id: string;
	name: string;
	status: string;
	paused: boolean;
	type: string;
	name_servers: string[];
}

export async function listZones(): Promise<Zone[]> {
	return cfFetch<Zone[]>('/zones?per_page=50');
}

export async function getZone(zoneId: string): Promise<Zone> {
	return cfFetch<Zone>(`/zones/${zoneId}`);
}

export async function getZoneByName(name: string): Promise<Zone | null> {
	const zones = await cfFetch<Zone[]>(`/zones?name=${name}`);
	return zones.length > 0 ? zones[0] : null;
}

// ============ DNS Records ============

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'NS' | 'SRV' | 'CAA';

export interface DnsRecord {
	id: string;
	zone_id: string;
	zone_name: string;
	name: string;
	type: DnsRecordType;
	content: string;
	proxied: boolean;
	proxiable: boolean;
	ttl: number;
	priority?: number;
	comment?: string;
	created_on: string;
	modified_on: string;
}

export async function listDnsRecords(zoneId: string, type?: DnsRecordType): Promise<DnsRecord[]> {
	const typeParam = type ? `&type=${type}` : '';
	return cfFetch<DnsRecord[]>(`/zones/${zoneId}/dns_records?per_page=100${typeParam}`);
}

export async function getDnsRecord(zoneId: string, recordId: string): Promise<DnsRecord> {
	return cfFetch<DnsRecord>(`/zones/${zoneId}/dns_records/${recordId}`);
}

export interface CreateDnsRecordOptions {
	type: DnsRecordType;
	name: string;
	content: string;
	ttl?: number;
	proxied?: boolean;
	priority?: number;
	comment?: string;
}

export async function createDnsRecord(zoneId: string, options: CreateDnsRecordOptions): Promise<DnsRecord> {
	return cfFetch<DnsRecord>(`/zones/${zoneId}/dns_records`, {
		method: 'POST',
		body: JSON.stringify({
			type: options.type,
			name: options.name,
			content: options.content,
			ttl: options.ttl || 1, // 1 = automatic
			proxied: options.proxied ?? false,
			priority: options.priority,
			comment: options.comment,
		}),
	});
}

export async function updateDnsRecord(
	zoneId: string,
	recordId: string,
	options: Partial<CreateDnsRecordOptions>
): Promise<DnsRecord> {
	return cfFetch<DnsRecord>(`/zones/${zoneId}/dns_records/${recordId}`, {
		method: 'PATCH',
		body: JSON.stringify(options),
	});
}

export async function deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
	await cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, {
		method: 'DELETE',
	});
}

// ============ Quick DNS Helpers ============

export async function createARecord(zoneId: string, name: string, ip: string, proxied = false): Promise<DnsRecord> {
	return createDnsRecord(zoneId, {
		type: 'A',
		name,
		content: ip,
		proxied,
	});
}

export async function createCnameRecord(
	zoneId: string,
	name: string,
	target: string,
	proxied = false
): Promise<DnsRecord> {
	return createDnsRecord(zoneId, {
		type: 'CNAME',
		name,
		content: target,
		proxied,
	});
}

// ============ Cloudflare Tunnels ============

export interface Tunnel {
	id: string;
	account_tag: string;
	name: string;
	status: string;
	created_at: string;
	deleted_at: string | null;
	connections: TunnelConnection[];
	conns_active_at: string | null;
	conns_inactive_at: string | null;
}

export interface TunnelConnection {
	id: string;
	features: string[];
	version: string;
	arch: string;
	run_at: string;
	colo_name: string;
	is_pending_reconnect: boolean;
	origin_ip: string;
	opened_at: string;
}

export async function listTunnels(): Promise<Tunnel[]> {
	const accountId = getAccountId();
	return cfFetch<Tunnel[]>(`/accounts/${accountId}/cfd_tunnel?is_deleted=false`);
}

export async function getTunnel(tunnelId: string): Promise<Tunnel> {
	const accountId = getAccountId();
	return cfFetch<Tunnel>(`/accounts/${accountId}/cfd_tunnel/${tunnelId}`);
}

export async function createTunnel(name: string): Promise<{ tunnel: Tunnel; token: string }> {
	const accountId = getAccountId();

	// Generate a random secret for the tunnel
	const secretBytes = new Uint8Array(32);
	crypto.getRandomValues(secretBytes);
	const tunnelSecret = btoa(String.fromCharCode(...secretBytes));

	const tunnel = await cfFetch<Tunnel>(`/accounts/${accountId}/cfd_tunnel`, {
		method: 'POST',
		body: JSON.stringify({
			name,
			tunnel_secret: tunnelSecret,
			config_src: 'cloudflare',
		}),
	});

	// Get the token for this tunnel
	const token = await getTunnelToken(tunnel.id);

	return { tunnel, token };
}

export async function deleteTunnel(tunnelId: string): Promise<void> {
	const accountId = getAccountId();
	await cfFetch(`/accounts/${accountId}/cfd_tunnel/${tunnelId}`, {
		method: 'DELETE',
	});
}

export async function getTunnelToken(tunnelId: string): Promise<string> {
	const accountId = getAccountId();
	const result = await cfFetch<{ token: string }>(`/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`);
	return result.token;
}

// ============ Tunnel Configuration ============

export interface TunnelIngress {
	hostname?: string;
	path?: string;
	service: string;
	originRequest?: {
		connectTimeout?: number;
		tlsTimeout?: number;
		tcpKeepAlive?: number;
		noHappyEyeballs?: boolean;
		keepAliveConnections?: number;
		keepAliveTimeout?: number;
		httpHostHeader?: string;
		originServerName?: string;
		noTLSVerify?: boolean;
	};
}

export interface TunnelConfig {
	ingress: TunnelIngress[];
	originRequest?: object;
	warp_routing?: { enabled: boolean };
}

export async function getTunnelConfig(tunnelId: string): Promise<TunnelConfig> {
	const accountId = getAccountId();
	const result = await cfFetch<{ config: TunnelConfig }>(`/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`);
	return result.config;
}

export async function updateTunnelConfig(tunnelId: string, config: TunnelConfig): Promise<void> {
	const accountId = getAccountId();
	await cfFetch(`/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
		method: 'PUT',
		body: JSON.stringify({ config }),
	});
}

export async function addTunnelRoute(tunnelId: string, hostname: string, service: string): Promise<void> {
	const config = await getTunnelConfig(tunnelId);

	// Remove catch-all if it exists, we'll add it back at the end
	const catchAll = config.ingress.find((i) => !i.hostname);
	const ingress = config.ingress.filter((i) => i.hostname);

	// Check if hostname already exists
	const existingIndex = ingress.findIndex((i) => i.hostname === hostname);
	if (existingIndex >= 0) {
		ingress[existingIndex].service = service;
	} else {
		ingress.push({ hostname, service });
	}

	// Add catch-all back (required by Cloudflare)
	ingress.push(catchAll || { service: 'http_status:404' });

	await updateTunnelConfig(tunnelId, { ...config, ingress });
}

export async function removeTunnelRoute(tunnelId: string, hostname: string): Promise<void> {
	const config = await getTunnelConfig(tunnelId);

	const ingress = config.ingress.filter((i) => i.hostname !== hostname);

	// Ensure catch-all exists
	if (!ingress.find((i) => !i.hostname)) {
		ingress.push({ service: 'http_status:404' });
	}

	await updateTunnelConfig(tunnelId, { ...config, ingress });
}

// ============ Tunnel DNS ============

export async function createTunnelCnameRecord(zoneId: string, hostname: string, tunnelId: string): Promise<DnsRecord> {
	// Get the zone to know the domain
	const zone = await getZone(zoneId);

	// The subdomain part
	const subdomain = hostname.replace(`.${zone.name}`, '');

	return createDnsRecord(zoneId, {
		type: 'CNAME',
		name: subdomain,
		content: `${tunnelId}.cfargotunnel.com`,
		proxied: true,
		comment: `Tunnel route for ${hostname}`,
	});
}

// ============ Helpers ============

export function buildServiceUrl(host: string, port: number, https = false): string {
	const protocol = https ? 'https' : 'http';
	return `${protocol}://${host}:${port}`;
}

export function buildLocalhostService(port: number): string {
	return `http://localhost:${port}`;
}

export async function verifyTunnelConnection(tunnelId: string): Promise<boolean> {
	try {
		const tunnel = await getTunnel(tunnelId);
		return tunnel.connections.length > 0;
	} catch {
		return false;
	}
}

// ============ Config Check ============

export function hasCloudflareConfig(): boolean {
	return !!(process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN) &&
		!!(process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID);
}
