#!/usr/bin/env bun
/**
 * Setup Databases for Coolify Services
 *
 * Creates databases and users in the central Postgres/Redis for services like:
 * - Outline
 * - Hoppscotch
 * - Glitchtip
 * - Soketi
 *
 * Usage: bun setup-databases.ts [--ssh-host <host>] [--postgres-container <name>]
 *
 * Requirements:
 * - SSH access to the server running Postgres
 * - Postgres container running (default: coolify-postgres or postgres)
 */

import { confirm, input, select, checkbox } from '@inquirer/prompts';
import chalk from 'chalk';

const log = {
	info: (msg: string) => console.log(chalk.blue('ℹ'), msg),
	success: (msg: string) => console.log(chalk.green('✓'), msg),
	warn: (msg: string) => console.log(chalk.yellow('⚠'), msg),
	error: (msg: string) => console.log(chalk.red('✗'), msg),
	step: (msg: string) => console.log(chalk.cyan('→'), msg),
	header: (msg: string) => console.log(chalk.bold.underline(`\n${msg}\n`)),
};

interface ServiceConfig {
	name: string;
	displayName: string;
	needsPostgres: boolean;
	needsRedis: boolean;
	redisDb: number;
	envVars: string[];
	secrets: string[];
}

const SERVICES: Record<string, ServiceConfig> = {
	outline: {
		name: 'outline',
		displayName: 'Outline (Wiki)',
		needsPostgres: true,
		needsRedis: true,
		redisDb: 0,
		envVars: ['SECRET_KEY', 'UTILS_SECRET', 'OUTLINE_URL'],
		secrets: ['SECRET_KEY', 'UTILS_SECRET'],
	},
	hoppscotch: {
		name: 'hoppscotch',
		displayName: 'Hoppscotch (API Testing)',
		needsPostgres: true,
		needsRedis: false,
		redisDb: -1,
		envVars: ['JWT_SECRET', 'SESSION_SECRET', 'APP_URL', 'ADMIN_URL', 'BACKEND_URL', 'BACKEND_WS_URL'],
		secrets: ['JWT_SECRET', 'SESSION_SECRET'],
	},
	glitchtip: {
		name: 'glitchtip',
		displayName: 'Glitchtip (Error Tracking)',
		needsPostgres: true,
		needsRedis: true,
		redisDb: 1,
		envVars: ['SECRET_KEY', 'GLITCHTIP_DOMAIN', 'EMAIL_URL'],
		secrets: ['SECRET_KEY'],
	},
	soketi: {
		name: 'soketi',
		displayName: 'Soketi (WebSocket Server)',
		needsPostgres: false,
		needsRedis: true,
		redisDb: 2,
		envVars: ['SOKETI_APP_ID', 'SOKETI_APP_KEY', 'SOKETI_APP_SECRET'],
		secrets: ['SOKETI_APP_KEY', 'SOKETI_APP_SECRET'],
	},
	n8n: {
		name: 'n8n',
		displayName: 'n8n (Workflow Automation)',
		needsPostgres: true,
		needsRedis: true,
		redisDb: 3,
		envVars: ['N8N_ENCRYPTION_KEY', 'N8N_HOST', 'WEBHOOK_URL'],
		secrets: ['N8N_ENCRYPTION_KEY'],
	},
	plausible: {
		name: 'plausible',
		displayName: 'Plausible (Analytics)',
		needsPostgres: true,
		needsRedis: false,
		redisDb: -1,
		envVars: ['SECRET_KEY_BASE', 'BASE_URL'],
		secrets: ['SECRET_KEY_BASE'],
	},
	umami: {
		name: 'umami',
		displayName: 'Umami (Simple Analytics)',
		needsPostgres: true,
		needsRedis: false,
		redisDb: -1,
		envVars: ['APP_SECRET', 'TRACKER_SCRIPT_NAME'],
		secrets: ['APP_SECRET'],
	},
	calcom: {
		name: 'calcom',
		displayName: 'Cal.com (Scheduling)',
		needsPostgres: true,
		needsRedis: false,
		redisDb: -1,
		envVars: ['NEXTAUTH_SECRET', 'CALENDSO_ENCRYPTION_KEY', 'NEXT_PUBLIC_WEBAPP_URL'],
		secrets: ['NEXTAUTH_SECRET', 'CALENDSO_ENCRYPTION_KEY'],
	},
	typebot: {
		name: 'typebot',
		displayName: 'Typebot (Chatbot Builder)',
		needsPostgres: true,
		needsRedis: false,
		redisDb: -1,
		envVars: ['ENCRYPTION_SECRET', 'NEXTAUTH_URL', 'NEXT_PUBLIC_VIEWER_URL'],
		secrets: ['ENCRYPTION_SECRET'],
	},
	minio: {
		name: 'minio',
		displayName: 'MinIO (S3 Storage)',
		needsPostgres: false,
		needsRedis: false,
		redisDb: -1,
		envVars: ['MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD'],
		secrets: ['MINIO_ROOT_PASSWORD'],
	},
	uptimekuma: {
		name: 'uptimekuma',
		displayName: 'Uptime Kuma (Monitoring)',
		needsPostgres: false,
		needsRedis: false,
		redisDb: -1,
		envVars: [],
		secrets: [],
	},
};

async function ssh(host: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(['ssh', host, command], {
		stdout: 'pipe',
		stderr: 'pipe',
	});

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

async function sshOrFail(host: string, command: string): Promise<string> {
	const result = await ssh(host, command);
	if (result.exitCode !== 0) {
		throw new Error(`Command failed: ${command}\n${result.stderr}`);
	}
	return result.stdout;
}

function generateSecret(length: number = 32): string {
	const chars = 'abcdef0123456789';
	let result = '';
	const randomBytes = new Uint8Array(length);
	crypto.getRandomValues(randomBytes);
	for (let i = 0; i < length; i++) {
		result += chars[randomBytes[i] % chars.length];
	}
	return result;
}

function generatePassword(length: number = 24): string {
	const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	let result = '';
	const randomBytes = new Uint8Array(length);
	crypto.getRandomValues(randomBytes);
	for (let i = 0; i < length; i++) {
		result += chars[randomBytes[i] % chars.length];
	}
	return result;
}

async function findPostgresContainer(sshHost: string): Promise<string | null> {
	log.step('Looking for Postgres container...');

	// First, try to find by image name (works with Coolify's random container names)
	const byImage = await ssh(
		sshHost,
		'docker ps --format "{{.Names}}|{{.Image}}" | grep -i postgres | grep -v coolify-db | head -1'
	);
	if (byImage.exitCode === 0 && byImage.stdout) {
		const containerName = byImage.stdout.split('|')[0];
		log.success(`Found Postgres container: ${containerName}`);
		return containerName;
	}

	// Try common container names as fallback
	const possibleNames = ['coolify-postgres', 'postgres', 'postgresql', 'pg'];
	for (const name of possibleNames) {
		const result = await ssh(sshHost, `docker ps --format "{{.Names}}" | grep -E "^${name}$"`);
		if (result.exitCode === 0 && result.stdout) {
			log.success(`Found Postgres container: ${result.stdout}`);
			return result.stdout;
		}
	}

	return null;
}

async function findRedisContainer(sshHost: string): Promise<string | null> {
	log.step('Looking for Redis container...');

	// First, try to find by image name (works with Coolify's random container names)
	// Exclude coolify-redis (internal) and redis-insight
	const byImage = await ssh(
		sshHost,
		'docker ps --format "{{.Names}}|{{.Image}}" | grep -i redis | grep -v coolify-redis | grep -v insight | head -1'
	);
	if (byImage.exitCode === 0 && byImage.stdout) {
		const containerName = byImage.stdout.split('|')[0];
		log.success(`Found Redis container: ${containerName}`);
		return containerName;
	}

	// Try common container names as fallback
	const possibleNames = ['redis'];
	for (const name of possibleNames) {
		const result = await ssh(sshHost, `docker ps --format "{{.Names}}" | grep -E "^${name}$"`);
		if (result.exitCode === 0 && result.stdout) {
			log.success(`Found Redis container: ${result.stdout}`);
			return result.stdout;
		}
	}

	return null;
}

async function getPostgresCredentials(sshHost: string, container: string): Promise<{ user: string; password: string }> {
	log.step('Getting Postgres admin credentials...');

	// Try to get from container environment
	const envResult = await ssh(sshHost, `docker exec ${container} env | grep -E "^POSTGRES_(USER|PASSWORD)="`);

	let user = 'postgres';
	let password = '';

	if (envResult.exitCode === 0) {
		const lines = envResult.stdout.split('\n');
		for (const line of lines) {
			if (line.startsWith('POSTGRES_USER=')) {
				user = line.split('=')[1];
			}
			if (line.startsWith('POSTGRES_PASSWORD=')) {
				password = line.split('=')[1];
			}
		}
	}

	if (!password) {
		password = await input({
			message: 'Postgres admin password:',
			validate: (v) => (v.length > 0 ? true : 'Password is required'),
		});
	} else {
		log.success(`Using Postgres user: ${user}`);
	}

	return { user, password };
}

async function checkDatabaseExists(
	sshHost: string,
	container: string,
	adminUser: string,
	dbName: string
): Promise<boolean> {
	const result = await ssh(
		sshHost,
		`docker exec ${container} psql -U ${adminUser} -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName}'"`
	);
	return result.stdout.trim() === '1';
}

async function checkUserExists(
	sshHost: string,
	container: string,
	adminUser: string,
	userName: string
): Promise<boolean> {
	const result = await ssh(
		sshHost,
		`docker exec ${container} psql -U ${adminUser} -tAc "SELECT 1 FROM pg_roles WHERE rolname='${userName}'"`
	);
	return result.stdout.trim() === '1';
}

async function createDatabase(
	sshHost: string,
	container: string,
	adminUser: string,
	dbName: string,
	dbUser: string,
	dbPassword: string
): Promise<void> {
	log.step(`Creating database '${dbName}' and user '${dbUser}'...`);

	// Check if user exists
	const userExists = await checkUserExists(sshHost, container, adminUser, dbUser);
	if (userExists) {
		log.warn(`User '${dbUser}' already exists`);
		// Update password anyway
		await sshOrFail(
			sshHost,
			`docker exec ${container} psql -U ${adminUser} -c "ALTER USER ${dbUser} WITH ENCRYPTED PASSWORD '${dbPassword}';"`
		);
		log.success(`Updated password for user '${dbUser}'`);
	} else {
		await sshOrFail(
			sshHost,
			`docker exec ${container} psql -U ${adminUser} -c "CREATE USER ${dbUser} WITH ENCRYPTED PASSWORD '${dbPassword}';"`
		);
		log.success(`Created user '${dbUser}'`);
	}

	// Check if database exists
	const dbExists = await checkDatabaseExists(sshHost, container, adminUser, dbName);
	if (dbExists) {
		log.warn(`Database '${dbName}' already exists`);
	} else {
		await sshOrFail(
			sshHost,
			`docker exec ${container} psql -U ${adminUser} -c "CREATE DATABASE ${dbName} OWNER ${dbUser};"`
		);
		log.success(`Created database '${dbName}'`);
	}

	// Grant all privileges
	await sshOrFail(
		sshHost,
		`docker exec ${container} psql -U ${adminUser} -c "GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${dbUser};"`
	);

	// Grant schema privileges (needed for Postgres 15+)
	await sshOrFail(
		sshHost,
		`docker exec ${container} psql -U ${adminUser} -d ${dbName} -c "GRANT ALL ON SCHEMA public TO ${dbUser};"`
	);

	log.success(`Granted all privileges on '${dbName}' to '${dbUser}'`);
}

async function testRedisConnection(sshHost: string, container: string, db: number): Promise<boolean> {
	const result = await ssh(sshHost, `docker exec ${container} redis-cli -n ${db} PING`);
	return result.stdout.trim() === 'PONG';
}

interface GeneratedConfig {
	service: string;
	postgresPassword?: string;
	redisDb?: number;
	secrets: Record<string, string>;
	envContent: string;
}

async function generateServiceConfig(
	sshHost: string,
	service: ServiceConfig,
	postgresHost: string,
	postgresPort: string,
	redisHost: string,
	redisPort: string,
	postgresContainer: string | null,
	adminUser: string
): Promise<GeneratedConfig> {
	log.header(`Configuring ${service.displayName}`);

	const config: GeneratedConfig = {
		service: service.name,
		secrets: {},
		envContent: '',
	};

	// Generate secrets
	for (const secret of service.secrets) {
		config.secrets[secret] = generateSecret(64);
	}

	// Generate Postgres password and create database
	if (service.needsPostgres && postgresContainer) {
		config.postgresPassword = generatePassword(24);
		await createDatabase(sshHost, postgresContainer, adminUser, service.name, service.name, config.postgresPassword);
	}

	// Test Redis connection
	if (service.needsRedis) {
		config.redisDb = service.redisDb;
		log.info(`Service will use Redis DB ${service.redisDb}`);
	}

	// Build .env content
	const envLines: string[] = [
		`# ${service.displayName} - Generated by setup-databases.ts`,
		`# Generated at: ${new Date().toISOString()}`,
		'',
	];

	if (service.needsPostgres) {
		envLines.push('# Postgres (central)');
		envLines.push(`POSTGRES_HOST=${postgresHost}`);
		envLines.push(`POSTGRES_PORT=${postgresPort}`);
		envLines.push(`POSTGRES_USER=${service.name}`);
		envLines.push(`POSTGRES_PASSWORD=${config.postgresPassword}`);
		envLines.push(`POSTGRES_DB=${service.name}`);
		envLines.push('');
	}

	if (service.needsRedis) {
		envLines.push('# Redis (central)');
		envLines.push(`REDIS_HOST=${redisHost}`);
		envLines.push(`REDIS_PORT=${redisPort}`);
		envLines.push(`REDIS_DB=${service.redisDb}`);
		envLines.push('');
	}

	envLines.push('# Secrets');
	for (const [key, value] of Object.entries(config.secrets)) {
		envLines.push(`${key}=${value}`);
	}

	// Add placeholder for other required env vars
	const otherVars = service.envVars.filter((v) => !service.secrets.includes(v));
	if (otherVars.length > 0) {
		envLines.push('');
		envLines.push('# Required (fill these in)');
		for (const v of otherVars) {
			envLines.push(`${v}=`);
		}
	}

	config.envContent = envLines.join('\n');

	return config;
}

async function main() {
	console.log(chalk.bold.blue('\n🗄️  Database Setup for Coolify Services\n'));

	// Parse arguments
	let sshHost = '';
	let postgresContainer = '';
	const args = process.argv.slice(2);
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--ssh-host' && args[i + 1]) {
			sshHost = args[i + 1];
		}
		if (args[i] === '--postgres-container' && args[i + 1]) {
			postgresContainer = args[i + 1];
		}
	}

	// Get SSH host
	if (!sshHost) {
		sshHost = await input({
			message: 'SSH host where Postgres/Redis are running:',
			default: 'doserver',
			validate: (v) => (v.length > 0 ? true : 'SSH host is required'),
		});
	}

	try {
		// Test SSH connection
		log.step(`Testing SSH connection to ${sshHost}...`);
		await sshOrFail(sshHost, 'echo "Connected"');
		log.success('SSH connection successful');

		// Find Postgres container
		const foundPostgres = postgresContainer || (await findPostgresContainer(sshHost));
		if (!foundPostgres) {
			log.warn('No Postgres container found automatically');
			postgresContainer = await input({
				message: 'Postgres container name:',
				validate: (v) => (v.length > 0 ? true : 'Container name is required'),
			});
		} else {
			postgresContainer = foundPostgres;
		}

		// Find Redis container
		const redisContainer = await findRedisContainer(sshHost);

		// Get Postgres admin credentials
		const { user: adminUser, password: adminPassword } = await getPostgresCredentials(sshHost, postgresContainer);

		// Test Postgres connection
		log.step('Testing Postgres connection...');
		const pgTest = await ssh(sshHost, `docker exec ${postgresContainer} psql -U ${adminUser} -c "SELECT 1"`);
		if (pgTest.exitCode !== 0) {
			throw new Error('Failed to connect to Postgres');
		}
		log.success('Postgres connection successful');

		// Test Redis if found
		if (redisContainer) {
			log.step('Testing Redis connection...');
			const redisTest = await testRedisConnection(sshHost, redisContainer, 0);
			if (redisTest) {
				log.success('Redis connection successful');
			} else {
				log.warn('Redis connection failed');
			}
		}

		// Get Tailscale IP for the database host
		log.step('Getting Tailscale IP...');
		const tailscaleResult = await ssh(sshHost, 'tailscale ip -4');
		let dbHost = 'localhost';
		if (tailscaleResult.exitCode === 0 && tailscaleResult.stdout) {
			dbHost = tailscaleResult.stdout;
			log.success(`Using Tailscale IP: ${dbHost}`);
		} else {
			dbHost = await input({
				message: 'Database host IP (for other services to connect):',
				default: 'localhost',
			});
		}

		// Select services to configure
		const serviceChoices = Object.entries(SERVICES).map(([key, svc]) => ({
			name: `${svc.displayName} ${svc.needsPostgres ? '(PG)' : ''} ${svc.needsRedis ? '(Redis)' : ''}`,
			value: key,
		}));

		const selectedServices = await checkbox({
			message: 'Which services do you want to configure?',
			choices: serviceChoices,
		});

		if (selectedServices.length === 0) {
			log.warn('No services selected');
			process.exit(0);
		}

		// Configure each service
		const configs: GeneratedConfig[] = [];

		for (const serviceKey of selectedServices) {
			const service = SERVICES[serviceKey];
			const config = await generateServiceConfig(
				sshHost,
				service,
				dbHost,
				'5432',
				dbHost,
				'6379',
				postgresContainer,
				adminUser
			);
			configs.push(config);
		}

		// Output results
		log.header('Generated Configurations');

		for (const config of configs) {
			const service = SERVICES[config.service];
			console.log(chalk.bold(`\n━━━ ${service.displayName} ━━━`));
			console.log(chalk.dim('─'.repeat(40)));
			console.log(config.envContent);
			console.log(chalk.dim('─'.repeat(40)));

			// Save to file
			const envPath = `${service.name}/.env.generated`;
			const shouldSave = await confirm({
				message: `Save to ${envPath}?`,
				default: true,
			});

			if (shouldSave) {
				await Bun.write(envPath, config.envContent);
				log.success(`Saved to ${envPath}`);
			}
		}

		// Summary
		log.header('Setup Complete!');

		console.log(chalk.bold('Next Steps:'));
		console.log('1. Review the generated .env files');
		console.log('2. Fill in any missing values (URLs, etc.)');
		console.log('3. Copy the env vars to Coolify when deploying');
		console.log('');
		console.log(chalk.bold('Database Connection Info:'));
		console.log(`  Host: ${dbHost}`);
		console.log(`  Port: 5432 (Postgres), 6379 (Redis)`);
		console.log('');
		console.log(chalk.bold('To verify databases were created:'));
		console.log(`  ssh ${sshHost} "docker exec ${postgresContainer} psql -U ${adminUser} -c '\\\\l'"`);
	} catch (error) {
		log.error(`Setup failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}

main();
