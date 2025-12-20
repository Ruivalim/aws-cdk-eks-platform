#!/usr/bin/env bun
/**
 * Setup Gateway Server
 *
 * Configures a server as the main gateway/reverse proxy:
 * - Docker
 * - Tailscale
 * - Caddy (reverse proxy with automatic HTTPS)
 * - iptables rules for security
 *
 * Usage:
 *   bun scripts/setup-gateway-server.ts --host <ssh-host>
 *   bun scripts/setup-gateway-server.ts --create  # Create new droplet first
 */

import { select, input, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import * as SSH from '../src/lib/ssh';
import * as DO from '../src/lib/digitalocean';
import * as DB from '../src/lib/db';

const log = {
	info: (msg: string) => console.log(chalk.blue('ℹ'), msg),
	success: (msg: string) => console.log(chalk.green('✓'), msg),
	error: (msg: string) => console.log(chalk.red('✗'), msg),
	step: (msg: string) => console.log(chalk.yellow('→'), msg),
	warn: (msg: string) => console.log(chalk.yellow('⚠'), msg),
};

async function main() {
	console.log(
		chalk.bold.blue(`
╔═══════════════════════════════════════════════════════════╗
║            🌐  Gateway Server Setup (Caddy)               ║
╚═══════════════════════════════════════════════════════════╝
`)
	);

	// Parse arguments
	const args = process.argv.slice(2);
	let sshHost = '';
	let publicIP = '';

	if (args.includes('--create')) {
		const result = await createGatewayDroplet();
		sshHost = result.sshHost;
		publicIP = result.publicIP;
	} else if (args.includes('--host')) {
		const hostIndex = args.indexOf('--host');
		sshHost = args[hostIndex + 1];
	} else {
		// Interactive mode
		const choice = await select({
			message: 'How do you want to setup the gateway server?',
			choices: [
				{ name: 'Create new droplet', value: 'create' },
				{ name: 'Use existing server (SSH host)', value: 'existing' },
			],
		});

		if (choice === 'create') {
			const result = await createGatewayDroplet();
			sshHost = result.sshHost;
			publicIP = result.publicIP;
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
	await setupGatewayServer(sshHost, publicIP);
}

async function createGatewayDroplet(): Promise<{ sshHost: string; publicIP: string }> {
	log.step('Creating new gateway server droplet...');

	const name = await input({
		message: 'Droplet name:',
		default: 'gateway-server',
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
		tags: ['gateway-server'],
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

	return { sshHost, publicIP };
}

async function setupGatewayServer(sshHost: string, publicIP?: string): Promise<void> {
	log.info(`Setting up gateway server: ${sshHost}`);

	// Test connection
	log.step('Testing SSH connection...');
	const connected = await SSH.testConnection(sshHost);
	if (!connected) {
		log.error('Cannot connect to server');
		process.exit(1);
	}
	log.success('SSH connected');

	// Get public IP if not provided
	if (!publicIP) {
		const ipResult = await SSH.ssh(sshHost, 'curl -s ifconfig.me');
		publicIP = ipResult.stdout.trim();
	}

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

	// Install Caddy
	log.step('Checking Caddy...');
	const caddyCheck = await SSH.ssh(sshHost, 'caddy version');
	if (caddyCheck.exitCode !== 0) {
		log.step('Installing Caddy...');
		await SSH.sshOrFail(
			sshHost,
			`apt-get install -y debian-keyring debian-archive-keyring apt-transport-https && \
			curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && \
			curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list && \
			apt-get update && \
			apt-get install -y caddy`
		);
		log.success('Caddy installed');
	} else {
		log.success('Caddy already installed');
	}

	// Create initial Caddyfile
	log.step('Creating initial Caddyfile...');
	const initialCaddyfile = `# Managed by coolify-infra
# Routes will be added automatically when you deploy projects

{
	email admin@example.com
	acme_ca https://acme-v02.api.letsencrypt.org/directory
}

# Default - respond with info
:80 {
	respond "Gateway server ready. No routes configured yet." 200
}
`;

	await SSH.sshOrFail(sshHost, `mkdir -p /etc/caddy && echo '${initialCaddyfile}' > /etc/caddy/Caddyfile`);

	// Enable and start Caddy
	await SSH.sshOrFail(sshHost, 'systemctl enable caddy && systemctl restart caddy');
	log.success('Caddy configured and started');

	// Configure iptables (allow 80, 443, SSH, Tailscale)
	log.step('Configuring firewall...');
	const iptablesRules = [
		// Flush existing rules
		'iptables -F INPUT',
		'iptables -P INPUT DROP',
		'iptables -P FORWARD DROP',
		'iptables -P OUTPUT ACCEPT',
		// Allow established connections
		'iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
		// Allow loopback
		'iptables -A INPUT -i lo -j ACCEPT',
		// Allow SSH
		'iptables -A INPUT -p tcp --dport 22 -j ACCEPT',
		// Allow HTTP/HTTPS
		'iptables -A INPUT -p tcp --dport 80 -j ACCEPT',
		'iptables -A INPUT -p tcp --dport 443 -j ACCEPT',
		// Allow Tailscale
		'iptables -A INPUT -i tailscale0 -j ACCEPT',
		// Allow ICMP (ping)
		'iptables -A INPUT -p icmp -j ACCEPT',
	];

	// Install iptables-persistent
	await SSH.sshOrFail(
		sshHost,
		'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent'
	);

	await SSH.sshOrFail(sshHost, iptablesRules.join(' && '));
	await SSH.sshOrFail(sshHost, 'netfilter-persistent save');
	log.success('Firewall configured');

	// Get server info
	const serverInfo = await SSH.getServerInfo(sshHost);

	// Register in database
	if (tailscaleIp) {
		const existingServer = DB.getServerByTailscaleIp(tailscaleIp);
		if (!existingServer) {
			DB.createServer({
				name: serverInfo.hostname || 'gateway-server',
				tailscale_ip: tailscaleIp,
				public_ip: publicIP || null,
				role: 'gateway',
			});
			log.success('Server registered in database as gateway');
		} else {
			DB.updateServer(existingServer.id, { role: 'gateway', public_ip: publicIP || null });
			log.info('Server already registered, updated role to gateway');
		}
	}

	// Summary
	console.log(
		chalk.bold.green(`
╔═══════════════════════════════════════════════════════════╗
║            ✓ Gateway Server Ready!                        ║
╚═══════════════════════════════════════════════════════════╝
`)
	);

	console.log(chalk.bold('Server Info:'));
	console.log(`  Hostname:     ${serverInfo.hostname}`);
	console.log(`  Public IP:    ${publicIP || 'Unknown'}`);
	console.log(`  Tailscale IP: ${tailscaleIp || 'Not configured'}`);
	console.log(`  Docker:       ${serverInfo.docker ? 'Installed' : 'Not installed'}`);
	console.log(`  Caddy:        Installed and running`);
	console.log();

	console.log(chalk.bold('Ports Open:'));
	console.log('  - 22 (SSH)');
	console.log('  - 80 (HTTP)');
	console.log('  - 443 (HTTPS)');
	console.log('  - Tailscale (all ports)');
	console.log();

	console.log(chalk.bold('Next Steps:'));
	console.log(`  1. Point your domain's DNS to: ${publicIP}`);
	console.log('  2. Add a project in CLI: Projects & Deploy → Add Project');
	console.log('  3. Deploy your app - Caddy will auto-configure HTTPS');
	console.log();

	console.log(chalk.bold('DNS Example:'));
	console.log(`  A record: app.yourdomain.com → ${publicIP}`);
}

main().catch((err) => {
	log.error(String(err));
	process.exit(1);
});
