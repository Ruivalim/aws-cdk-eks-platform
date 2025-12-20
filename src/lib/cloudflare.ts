/**
 * Cloudflare API Client
 *
 * Manages DNS zones and records.
 * Note: Tunnel functionality has been removed - using Caddy on gateway server instead.
 *
 * Docs: https://developers.cloudflare.com/api/
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

function getToken(): string {
  const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
  if (!token) {
    throw new Error("CLOUDFLARE_API_TOKEN environment variable is required");
  }
  return token;
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

async function cfFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const response = await fetch(`${CF_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const data = (await response.json()) as CloudflareResponse<T>;

  if (!data.success) {
    const errorMsg = data.errors.map((e) => e.message).join(", ");
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
  return cfFetch<Zone[]>("/zones?per_page=50");
}

export async function getZone(zoneId: string): Promise<Zone> {
  return cfFetch<Zone>(`/zones/${zoneId}`);
}

export async function getZoneByName(name: string): Promise<Zone | null> {
  const zones = await cfFetch<Zone[]>(`/zones?name=${name}`);
  return zones.length > 0 ? zones[0] : null;
}

// ============ DNS Records ============

export type DnsRecordType =
  | "A"
  | "AAAA"
  | "CNAME"
  | "TXT"
  | "MX"
  | "NS"
  | "SRV"
  | "CAA";

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

export async function listDnsRecords(
  zoneId: string,
  type?: DnsRecordType,
): Promise<DnsRecord[]> {
  const typeParam = type ? `&type=${type}` : "";
  return cfFetch<DnsRecord[]>(
    `/zones/${zoneId}/dns_records?per_page=100${typeParam}`,
  );
}

export async function getDnsRecord(
  zoneId: string,
  recordId: string,
): Promise<DnsRecord> {
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

export async function createDnsRecord(
  zoneId: string,
  options: CreateDnsRecordOptions,
): Promise<DnsRecord> {
  return cfFetch<DnsRecord>(`/zones/${zoneId}/dns_records`, {
    method: "POST",
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
  options: Partial<CreateDnsRecordOptions>,
): Promise<DnsRecord> {
  return cfFetch<DnsRecord>(`/zones/${zoneId}/dns_records/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify(options),
  });
}

export async function deleteDnsRecord(
  zoneId: string,
  recordId: string,
): Promise<void> {
  await cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, {
    method: "DELETE",
  });
}

// ============ Quick DNS Helpers ============

export async function createARecord(
  zoneId: string,
  name: string,
  ip: string,
  proxied = false,
): Promise<DnsRecord> {
  return createDnsRecord(zoneId, {
    type: "A",
    name,
    content: ip,
    proxied,
  });
}

export async function createCnameRecord(
  zoneId: string,
  name: string,
  target: string,
  proxied = false,
): Promise<DnsRecord> {
  return createDnsRecord(zoneId, {
    type: "CNAME",
    name,
    content: target,
    proxied,
  });
}

// ============ Config Check ============

export function hasCloudflareConfig(): boolean {
  return !!(process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN);
}
