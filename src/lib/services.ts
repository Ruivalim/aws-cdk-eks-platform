/**
 * Service configurations for Coolify deployments
 */

export interface ServiceConfig {
	name: string;
	displayName: string;
	description: string;
	needsPostgres: boolean;
	needsRedis: boolean;
	redisDb: number;
	envVars: string[];
	secrets: string[];
	ports: number[];
	docs: string;
}

export const SERVICES: Record<string, ServiceConfig> = {
	outline: {
		name: 'outline',
		displayName: 'Outline',
		description: 'Team wiki and knowledge base',
		needsPostgres: true,
		needsRedis: true,
		redisDb: 0,
		envVars: ['SECRET_KEY', 'UTILS_SECRET', 'OUTLINE_URL'],
		secrets: ['SECRET_KEY', 'UTILS_SECRET'],
		ports: [3000],
		docs: 'https://docs.getoutline.com/',
	},
	hoppscotch: {
		name: 'hoppscotch',
		displayName: 'Hoppscotch',
		description: 'API testing tool (Postman alternative)',
		needsPostgres: true,
		needsRedis: false,
		redisDb: -1,
		envVars: ['JWT_SECRET', 'SESSION_SECRET', 'APP_URL', 'ADMIN_URL', 'BACKEND_URL', 'BACKEND_WS_URL'],
		secrets: ['JWT_SECRET', 'SESSION_SECRET'],
		ports: [3000, 3100, 3170],
		docs: 'https://docs.hoppscotch.io/',
	},
	glitchtip: {
		name: 'glitchtip',
		displayName: 'Glitchtip',
		description: 'Error tracking (Sentry alternative)',
		needsPostgres: true,
		needsRedis: true,
		redisDb: 1,
		envVars: ['SECRET_KEY', 'GLITCHTIP_DOMAIN', 'EMAIL_URL'],
		secrets: ['SECRET_KEY'],
		ports: [8000],
		docs: 'https://glitchtip.com/documentation',
	},
	soketi: {
		name: 'soketi',
		displayName: 'Soketi',
		description: 'WebSocket server (Pusher compatible)',
		needsPostgres: false,
		needsRedis: true,
		redisDb: 2,
		envVars: ['SOKETI_APP_ID', 'SOKETI_APP_KEY', 'SOKETI_APP_SECRET'],
		secrets: ['SOKETI_APP_KEY', 'SOKETI_APP_SECRET'],
		ports: [6001],
		docs: 'https://docs.soketi.app/',
	},
	n8n: {
		name: 'n8n',
		displayName: 'n8n',
		description: 'Workflow automation platform',
		needsPostgres: true,
		needsRedis: true,
		redisDb: 3,
		envVars: ['N8N_ENCRYPTION_KEY', 'N8N_HOST', 'WEBHOOK_URL'],
		secrets: ['N8N_ENCRYPTION_KEY'],
		ports: [5678],
		docs: 'https://docs.n8n.io/',
	},
	plausible: {
		name: 'plausible',
		displayName: 'Plausible',
		description: 'Privacy-friendly analytics',
		needsPostgres: true,
		needsRedis: false,
		redisDb: -1,
		envVars: ['SECRET_KEY_BASE', 'BASE_URL'],
		secrets: ['SECRET_KEY_BASE'],
		ports: [8000],
		docs: 'https://plausible.io/docs/',
	},
	umami: {
		name: 'umami',
		displayName: 'Umami',
		description: 'Simple web analytics',
		needsPostgres: true,
		needsRedis: false,
		redisDb: -1,
		envVars: ['APP_SECRET', 'TRACKER_SCRIPT_NAME'],
		secrets: ['APP_SECRET'],
		ports: [3000],
		docs: 'https://umami.is/docs/',
	},
	calcom: {
		name: 'calcom',
		displayName: 'Cal.com',
		description: 'Scheduling platform',
		needsPostgres: true,
		needsRedis: false,
		redisDb: -1,
		envVars: ['NEXTAUTH_SECRET', 'CALENDSO_ENCRYPTION_KEY', 'NEXT_PUBLIC_WEBAPP_URL'],
		secrets: ['NEXTAUTH_SECRET', 'CALENDSO_ENCRYPTION_KEY'],
		ports: [3000],
		docs: 'https://cal.com/docs/',
	},
	typebot: {
		name: 'typebot',
		displayName: 'Typebot',
		description: 'Chatbot builder',
		needsPostgres: true,
		needsRedis: false,
		redisDb: -1,
		envVars: ['ENCRYPTION_SECRET', 'NEXTAUTH_URL', 'NEXT_PUBLIC_VIEWER_URL'],
		secrets: ['ENCRYPTION_SECRET'],
		ports: [3000, 3001],
		docs: 'https://docs.typebot.io/',
	},
	minio: {
		name: 'minio',
		displayName: 'MinIO',
		description: 'S3-compatible object storage',
		needsPostgres: false,
		needsRedis: false,
		redisDb: -1,
		envVars: ['MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD'],
		secrets: ['MINIO_ROOT_PASSWORD'],
		ports: [9000, 9001],
		docs: 'https://min.io/docs/',
	},
	uptimekuma: {
		name: 'uptimekuma',
		displayName: 'Uptime Kuma',
		description: 'Self-hosted monitoring tool',
		needsPostgres: false,
		needsRedis: false,
		redisDb: -1,
		envVars: [],
		secrets: [],
		ports: [3001],
		docs: 'https://github.com/louislam/uptime-kuma',
	},
};

export function generateSecret(length: number = 32): string {
	const chars = 'abcdef0123456789';
	let result = '';
	const randomBytes = new Uint8Array(length);
	crypto.getRandomValues(randomBytes);
	for (let i = 0; i < length; i++) {
		result += chars[randomBytes[i] % chars.length];
	}
	return result;
}

export function generatePassword(length: number = 24): string {
	const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	let result = '';
	const randomBytes = new Uint8Array(length);
	crypto.getRandomValues(randomBytes);
	for (let i = 0; i < length; i++) {
		result += chars[randomBytes[i] % chars.length];
	}
	return result;
}

export function getServicesNeedingPostgres(): ServiceConfig[] {
	return Object.values(SERVICES).filter((s) => s.needsPostgres);
}

export function getServicesNeedingRedis(): ServiceConfig[] {
	return Object.values(SERVICES).filter((s) => s.needsRedis);
}
