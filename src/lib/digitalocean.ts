/**
 * Digital Ocean API Client
 * Docs: https://docs.digitalocean.com/reference/api/api-reference/
 */

const DO_API_BASE = 'https://api.digitalocean.com/v2';

function getToken(): string {
	const token = process.env.DIGITALOCEAN_TOKEN || process.env.DO_TOKEN;
	if (!token) {
		throw new Error('DIGITALOCEAN_TOKEN or DO_TOKEN environment variable is required');
	}
	return token;
}

async function doFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
	const token = getToken();
	const response = await fetch(`${DO_API_BASE}${endpoint}`, {
		...options,
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
			...options.headers,
		},
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Digital Ocean API error: ${response.status} - ${error}`);
	}

	if (response.status === 204) {
		return {} as T;
	}

	return response.json();
}

// ============ Account ============

export interface Account {
	uuid: string;
	email: string;
	status: string;
	droplet_limit: number;
	floating_ip_limit: number;
}

export async function getAccount(): Promise<Account> {
	const { account } = await doFetch<{ account: Account }>('/account');
	return account;
}

// ============ Balance / Billing ============

export interface Balance {
	month_to_date_balance: string;
	account_balance: string;
	month_to_date_usage: string;
	generated_at: string;
}

export async function getBalance(): Promise<Balance> {
	return doFetch<Balance>('/customers/my/balance');
}

export interface BillingHistory {
	description: string;
	amount: string;
	invoice_id: string;
	invoice_uuid: string;
	date: string;
	type: string;
}

export async function getBillingHistory(): Promise<BillingHistory[]> {
	const { billing_history } = await doFetch<{ billing_history: BillingHistory[] }>('/customers/my/billing_history');
	return billing_history;
}

// ============ Droplets ============

export interface Droplet {
	id: number;
	name: string;
	status: string;
	memory: number;
	vcpus: number;
	disk: number;
	created_at: string;
	region: { slug: string; name: string };
	image: { slug: string; name: string; distribution: string };
	size: { slug: string; price_monthly: number; price_hourly: number };
	networks: {
		v4: Array<{ ip_address: string; type: string }>;
		v6: Array<{ ip_address: string; type: string }>;
	};
	tags: string[];
}

export async function listDroplets(): Promise<Droplet[]> {
	const { droplets } = await doFetch<{ droplets: Droplet[] }>('/droplets?per_page=100');
	return droplets;
}

export async function getDroplet(id: number): Promise<Droplet> {
	const { droplet } = await doFetch<{ droplet: Droplet }>(`/droplets/${id}`);
	return droplet;
}

export interface CreateDropletOptions {
	name: string;
	region: string;
	size: string;
	image: string;
	ssh_keys?: (number | string)[];
	backups?: boolean;
	ipv6?: boolean;
	monitoring?: boolean;
	tags?: string[];
	user_data?: string;
}

export async function createDroplet(options: CreateDropletOptions): Promise<Droplet> {
	const { droplet } = await doFetch<{ droplet: Droplet }>('/droplets', {
		method: 'POST',
		body: JSON.stringify(options),
	});
	return droplet;
}

export async function deleteDroplet(id: number): Promise<void> {
	await doFetch(`/droplets/${id}`, { method: 'DELETE' });
}

export async function rebootDroplet(id: number): Promise<void> {
	await doFetch(`/droplets/${id}/actions`, {
		method: 'POST',
		body: JSON.stringify({ type: 'reboot' }),
	});
}

export async function powerOffDroplet(id: number): Promise<void> {
	await doFetch(`/droplets/${id}/actions`, {
		method: 'POST',
		body: JSON.stringify({ type: 'power_off' }),
	});
}

export async function powerOnDroplet(id: number): Promise<void> {
	await doFetch(`/droplets/${id}/actions`, {
		method: 'POST',
		body: JSON.stringify({ type: 'power_on' }),
	});
}

// ============ SSH Keys ============

export interface SSHKey {
	id: number;
	name: string;
	public_key: string;
	fingerprint: string;
}

export async function listSSHKeys(): Promise<SSHKey[]> {
	const { ssh_keys } = await doFetch<{ ssh_keys: SSHKey[] }>('/account/keys');
	return ssh_keys;
}

export async function createSSHKey(name: string, publicKey: string): Promise<SSHKey> {
	const { ssh_key } = await doFetch<{ ssh_key: SSHKey }>('/account/keys', {
		method: 'POST',
		body: JSON.stringify({ name, public_key: publicKey }),
	});
	return ssh_key;
}

export async function deleteSSHKey(id: number): Promise<void> {
	await doFetch(`/account/keys/${id}`, { method: 'DELETE' });
}

// ============ Regions ============

export interface Region {
	slug: string;
	name: string;
	available: boolean;
	sizes: string[];
	features: string[];
}

export async function listRegions(): Promise<Region[]> {
	const { regions } = await doFetch<{ regions: Region[] }>('/regions');
	return regions.filter((r) => r.available);
}

// ============ Sizes ============

export interface Size {
	slug: string;
	memory: number;
	vcpus: number;
	disk: number;
	transfer: number;
	price_monthly: number;
	price_hourly: number;
	regions: string[];
	available: boolean;
	description: string;
}

export async function listSizes(): Promise<Size[]> {
	const { sizes } = await doFetch<{ sizes: Size[] }>('/sizes?per_page=100');
	return sizes.filter((s) => s.available);
}

// ============ Images ============

export interface Image {
	id: number;
	slug: string;
	name: string;
	distribution: string;
	public: boolean;
	regions: string[];
	type: string;
	min_disk_size: number;
	size_gigabytes: number;
}

export async function listImages(type: 'distribution' | 'application' = 'distribution'): Promise<Image[]> {
	const { images } = await doFetch<{ images: Image[] }>(`/images?type=${type}&per_page=100`);
	return images;
}

// ============ Helpers ============

export function getPublicIP(droplet: Droplet): string | null {
	const publicNetwork = droplet.networks.v4.find((n) => n.type === 'public');
	return publicNetwork?.ip_address || null;
}

export function getPrivateIP(droplet: Droplet): string | null {
	const privateNetwork = droplet.networks.v4.find((n) => n.type === 'private');
	return privateNetwork?.ip_address || null;
}

export function formatMemory(mb: number): string {
	if (mb >= 1024) {
		return `${(mb / 1024).toFixed(0)}GB`;
	}
	return `${mb}MB`;
}

export function formatPrice(monthly: number): string {
	return `$${monthly.toFixed(2)}/mo`;
}

// ============ Presets ============

export const RECOMMENDED_SIZES = [
	{ slug: 's-1vcpu-1gb', name: 'Basic 1GB', price: 6 },
	{ slug: 's-1vcpu-2gb', name: 'Basic 2GB', price: 12 },
	{ slug: 's-2vcpu-4gb', name: 'Basic 4GB', price: 24 },
	{ slug: 's-4vcpu-8gb', name: 'Basic 8GB', price: 48 },
	{ slug: 's-2vcpu-4gb-amd', name: 'Premium AMD 4GB', price: 28 },
	{ slug: 's-4vcpu-8gb-amd', name: 'Premium AMD 8GB', price: 56 },
];

export const RECOMMENDED_REGIONS = [
	{ slug: 'nyc1', name: 'New York 1' },
	{ slug: 'nyc3', name: 'New York 3' },
	{ slug: 'sfo3', name: 'San Francisco 3' },
	{ slug: 'ams3', name: 'Amsterdam 3' },
	{ slug: 'sgp1', name: 'Singapore 1' },
	{ slug: 'lon1', name: 'London 1' },
	{ slug: 'fra1', name: 'Frankfurt 1' },
];

export const RECOMMENDED_IMAGES = [
	{ slug: 'ubuntu-24-04-x64', name: 'Ubuntu 24.04 LTS' },
	{ slug: 'ubuntu-22-04-x64', name: 'Ubuntu 22.04 LTS' },
	{ slug: 'debian-12-x64', name: 'Debian 12' },
];
