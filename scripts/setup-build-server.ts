#!/usr/bin/env bun
/**
 * Setup Build Server
 *
 * Configures a dedicated droplet as a build server with:
 * - Docker
 * - Docker Registry (for storing built images)
 * - Git
 * - SSH key for GitHub access
 *
 * Usage:
 *   bun scripts/setup-build-server.ts --host <ssh-host>
 *   bun scripts/setup-build-server.ts --create  # Create new droplet first
 */

import { select, input, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import * as SSH from '../src/lib/ssh';
import * as DO from '../src/lib/digitalocean';
import * as DB from '../src/lib/db';
import * as GitHub from '../src/lib/github';

const log = {
	info: (msg: string) => console.log(chalk.blue('ℹ'), msg),
	success: (msg: string) => console.log(chalk.green('✓'), msg),
	error: (msg: string) => console.log(chalk.red('✗'), msg),
	step: (msg: string) => console.log(chalk.yellow('→'), msg),
	warn: (msg: string) => console.log(chalk.yellow('⚠'), msg),
};

async function main() {
	console.log(chalk.bold.blue(`
╔═══════════════════════════════════════════════════════════╗
║            🔧 Build Server Setup                          ║
╚═══════════════════════════════════════════════════════════╝
`));

	// Parse arguments
	const args = process.argv.slice(2);
	let sshHost = '';

	if (args.includes('--create')) {
		// Create new droplet
		sshHost = await createBuildDroplet();
	} else if (args.includes('--host')) {
		const hostIndex = args.indexOf('--host');
		sshHost = args[hostIndex + 1];
	} else {
		// Interactive mode
		const choice = await select({
			message: 'How do you want to setup the build server?',
			choices: [
				{ name: 'Create new droplet', value: 'create' },
				{ name: 'Use existing server (SSH host)', value: 'existing' },
			],
		});

		if (choice === 'create') {
			sshHost = await createBuildDroplet();
		} else {
			sshHost = await input({
				message: 'SSH host (e.g., root@1.2.3.4 or hostname):',
				validate: (v) => v.length > 0 || 'Required',
			});
		}
	}

	if (!sshHost) {
		log.error('No SSH host provided');
		process.exit(1);
	}

	// Run setup
	await setupBuildServer(sshHost);
}

async function createBuildDroplet(): Promise<string> {
	log.step('Creating new build server droplet...');

	const name = await input({
		message: 'Droplet name:',
		default: 'build-server',
	});

	const region = await select({
		message: 'Region:',
		choices: DO.RECOMMENDED_REGIONS.map((r) => ({ name: r.name, value: r.slug })),
	});

	const size = await select({
		message: 'Size:',
		choices: DO.RECOMMENDED_SIZES.map((s) => ({
			name: `${s.name} - $${s.price}/mo`,
			value: s.slug,
		})),
	});

	// Get SSH keys
	const sshKeys = await DO.listSSHKeys();
	const selectedKeys = await select({
		message: 'SSH key to use:',
		choices: sshKeys.map((k) => ({ name: k.name, value: k.id.toString() })),
	});

	log.step('Creating droplet...');
	const droplet = await DO.createDroplet({
		name,
		region,
		size,
		image: 'ubuntu-24-04-x64',
		ssh_keys: [selectedKeys],
		tags: ['build-server'],
		monitoring: true,
	});

	log.success(`Droplet created: ${droplet.name} (ID: ${droplet.id})`);

	// Wait for IP
	log.step('Waiting for public IP...');
	let publicIP = '';
	for (let i = 0; i < 60; i++) {
		await new Promise((r) => setTimeout(r, 2000));
		const updated = await DO.getDroplet(droplet.id);
		publicIP = DO.getPublicIP(updated) || '';
		if (publicIP) break;
		process.stdout.write('.');
	}
	console.log();

	if (!publicIP) {
		log.error('Failed to get public IP');
		process.exit(1);
	}

	log.success(`Public IP: ${publicIP}`);

	// Wait for SSH
	log.step('Waiting for SSH to be ready...');
	const sshHost = `root@${publicIP}`;
	for (let i = 0; i < 30; i++) {
		await new Promise((r) => setTimeout(r, 5000));
		const connected = await SSH.testConnection(sshHost);
		if (connected) {
			log.success('SSH connected!');
			break;
		}
		process.stdout.write('.');
	}
	console.log();

	return sshHost;
}

async function setupBuildServer(sshHost: string): Promise<void> {
	log.info(`Setting up build server: ${sshHost}`);

	// Test connection
	log.step('Testing SSH connection...');
	const connected = await SSH.testConnection(sshHost);
	if (!connected) {
		log.error('Cannot connect to server');
		process.exit(1);
	}
	log.success('SSH connected');

	// Update system
	log.step('Updating system packages...');
	await SSH.sshOrFail(sshHost, 'apt-get update -qq && apt-get upgrade -y -qq');
	log.success('System updated');

	// Install Docker
	log.step('Checking Docker...');
	const dockerCheck = await SSH.ssh(sshHost, 'docker --version');
	if (dockerCheck.exitCode !== 0) {
		log.step('Installing Docker...');
		await SSH.sshOrFail(sshHost, 'curl -fsSL https://get.docker.com | sh');
		await SSH.sshOrFail(sshHost, 'systemctl enable docker && systemctl start docker');
		log.success('Docker installed');
	} else {
		log.success('Docker already installed');
	}

	// Install Git
	log.step('Installing Git...');
	await SSH.sshOrFail(sshHost, 'apt-get install -y -qq git');
	log.success('Git installed');

	// Create build workspace
	log.step('Creating build workspace...');
	await SSH.sshOrFail(sshHost, 'mkdir -p /opt/builds');
	log.success('Workspace created at /opt/builds');

	// Setup Docker Registry
	log.step('Setting up Docker Registry...');
	const registryExists = await SSH.ssh(sshHost, 'docker ps --format "{{.Names}}" | grep -q registry');
	if (registryExists.exitCode !== 0) {
		await SSH.sshOrFail(
			sshHost,
			`docker run -d --name registry --restart always -p 5000:5000 \
			-v /opt/registry:/var/lib/registry \
			registry:2`
		);
		log.success('Docker Registry started on port 5000');
	} else {
		log.success('Docker Registry already running');
	}

	// Generate SSH key for GitHub
	log.step('Setting up GitHub deploy key...');
	const { publicKey } = await GitHub.generateDeployKey(sshHost);
	log.success('Deploy key generated');

	// Install Tailscale
	log.step('Checking Tailscale...');
	const tailscaleCheck = await SSH.ssh(sshHost, 'tailscale ip -4 2>/dev/null');
	let tailscaleIp = '';

	if (tailscaleCheck.exitCode !== 0) {
		log.step('Installing Tailscale...');
		await SSH.sshOrFail(sshHost, 'curl -fsSL https://tailscale.com/install.sh | sh');

		const tsUp = await SSH.ssh(sshHost, 'tailscale up --timeout=10s 2>&1 || true');
		if (tsUp.stdout.includes('https://')) {
			const urlMatch = tsUp.stdout.match(/(https:\/\/login\.tailscale\.com\/[^\s]+)/);
			if (urlMatch) {
				log.warn('Tailscale needs authentication!');
				console.log(chalk.bold('\nOpen this URL to authenticate:'));
				console.log(chalk.cyan(urlMatch[1]));
				console.log();

				await input({ message: 'Press Enter after authenticating...' });

				// Check for IP
				const ipResult = await SSH.ssh(sshHost, 'tailscale ip -4');
				if (ipResult.exitCode === 0) {
					tailscaleIp = ipResult.stdout.trim();
				}
			}
		}
	} else {
		tailscaleIp = tailscaleCheck.stdout.trim();
		log.success(`Tailscale already configured: ${tailscaleIp}`);
	}

	// Get server info
	const serverInfo = await SSH.getServerInfo(sshHost);

	// Register in database
	const existingServer = DB.getServerByTailscaleIp(tailscaleIp);
	if (!existingServer && tailscaleIp) {
		DB.createServer({
			name: serverInfo.hostname || 'build-server',
			tailscale_ip: tailscaleIp,
			public_ip: sshHost.includes('@') ? sshHost.split('@')[1] : null,
			role: 'build',
		});
		log.success('Build server registered in database');
	}

	// Summary
	console.log(chalk.bold.green(`
╔═══════════════════════════════════════════════════════════╗
║            ✓ Build Server Ready!                          ║
╚═══════════════════════════════════════════════════════════╝
`));

	console.log(chalk.bold('Server Info:'));
	console.log(`  Hostname:     ${serverInfo.hostname}`);
	console.log(`  Tailscale IP: ${tailscaleIp || 'Not configured'}`);
	console.log(`  Docker:       ${serverInfo.docker ? 'Installed' : 'Not installed'}`);
	console.log();

	console.log(chalk.bold('Docker Registry:'));
	console.log(`  URL: ${tailscaleIp}:5000`);
	console.log(`  Example: docker push ${tailscaleIp}:5000/myapp:latest`);
	console.log();

	console.log(chalk.bold('GitHub Deploy Key (add to your repos):'));
	console.log(chalk.dim('─'.repeat(60)));
	console.log(chalk.cyan(publicKey));
	console.log(chalk.dim('─'.repeat(60)));
	console.log();
	console.log(chalk.dim('Add this key at: https://github.com/<owner>/<repo>/settings/keys'));
	console.log();

	if (tailscaleIp) {
		console.log(chalk.bold('Add to your .env:'));
		console.log(chalk.cyan(`BUILD_SERVER_HOST=${sshHost.includes('@') ? sshHost : `root@${tailscaleIp}`}`));
		console.log(chalk.cyan(`REGISTRY_URL=${tailscaleIp}:5000`));
	}
}

main().catch((err) => {
	log.error(String(err));
	process.exit(1);
});
