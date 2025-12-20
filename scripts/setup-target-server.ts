#!/usr/bin/env bun
/**
 * Setup Target Server
 *
 * Configures a server to receive deployments:
 * - Docker
 * - Tailscale
 * - cloudflared (Cloudflare Tunnel)
 * - iptables rules for security
 *
 * Usage:
 *   bun scripts/setup-target-server.ts --host <ssh-host>
 *   bun scripts/setup-target-server.ts --create  # Create new droplet first
 */

import { select, input, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import * as SSH from '../src/lib/ssh';
import * as DO from '../src/lib/digitalocean';
import * as CF from '../src/lib/cloudflare';
import * as DB from '../src/lib/db';
import * as Registry from '../src/lib/registry';

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
║            🖥️  Target Server Setup                         ║
╚═══════════════════════════════════════════════════════════╝
`));

	// Parse arguments
	const args = process.argv.slice(2);
	let sshHost = '';

	if (args.includes('--create')) {
		sshHost = await createTargetDroplet();
	} else if (args.includes('--host')) {
		const hostIndex = args.indexOf('--host');
		sshHost = args[hostIndex + 1];
	} else {
		// Interactive mode
		const choice = await select({
			message: 'How do you want to setup the target server?',
			choices: [
				{ name: 'Create new droplet', value: 'create' },
				{ name: 'Use existing server (SSH host)', value: 'existing' },
			],
		});

		if (choice === 'create') {
			sshHost = await createTargetDroplet();
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
	await setupTargetServer(sshHost);
}

async function createTargetDroplet(): Promise<string> {
	log.step('Creating new target server droplet...');

	const name = await input({
		message: 'Droplet name:',
		default: 'app-server-1',
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
		tags: ['target-server'],
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

async function setupTargetServer(sshHost: string): Promise<void> {
	log.info(`Setting up target server: ${sshHost}`);

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

	// Configure Docker for insecure registry
	if (process.env.REGISTRY_URL) {
		log.step('Configuring Docker for private registry...');
		await Registry.configureDockerForRegistry(sshHost, process.env.REGISTRY_URL);
		log.success('Docker configured for registry');
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

	// Install cloudflared
	log.step('Checking cloudflared...');
	const cloudflaredCheck = await SSH.ssh(sshHost, 'cloudflared --version');
	if (cloudflaredCheck.exitCode !== 0) {
		log.step('Installing cloudflared...');
		await SSH.sshOrFail(
			sshHost,
			`curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb && \
			dpkg -i /tmp/cloudflared.deb && \
			rm /tmp/cloudflared.deb`
		);
		log.success('cloudflared installed');
	} else {
		log.success('cloudflared already installed');
	}

	// Setup Cloudflare Tunnel if configured
	let tunnelId = '';
	if (CF.hasCloudflareConfig()) {
		const setupTunnel = await confirm({
			message: 'Setup Cloudflare Tunnel for this server?',
			default: true,
		});

		if (setupTunnel) {
			const tunnels = await CF.listTunnels();

			let selectedTunnel: string;
			if (tunnels.length === 0) {
				// Create new tunnel
				const tunnelName = await input({
					message: 'New tunnel name:',
					default: sshHost.split('@')[1] || 'app-tunnel',
				});

				log.step('Creating tunnel...');
				const { tunnel, token } = await CF.createTunnel(tunnelName);
				tunnelId = tunnel.id;

				log.step('Installing tunnel service...');
				await SSH.sshOrFail(sshHost, `cloudflared service install ${token}`);
				log.success('Tunnel installed and started');
			} else {
				// Use existing tunnel
				selectedTunnel = await select({
					message: 'Select tunnel to use:',
					choices: [
						...tunnels.map((t) => ({ name: t.name, value: t.id })),
						{ name: 'Create new tunnel', value: 'new' },
					],
				});

				if (selectedTunnel === 'new') {
					const tunnelName = await input({
						message: 'New tunnel name:',
					});

					log.step('Creating tunnel...');
					const { tunnel, token } = await CF.createTunnel(tunnelName);
					tunnelId = tunnel.id;

					log.step('Installing tunnel service...');
					await SSH.sshOrFail(sshHost, `cloudflared service install ${token}`);
					log.success('Tunnel installed');
				} else {
					tunnelId = selectedTunnel;
					const token = await CF.getTunnelToken(tunnelId);

					log.step('Installing tunnel service...');
					await SSH.sshOrFail(sshHost, `cloudflared service install ${token}`);
					log.success('Tunnel installed');
				}
			}
		}
	}

	// Configure iptables
	log.step('Installing iptables-persistent...');
	await SSH.sshOrFail(
		sshHost,
		'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent'
	);

	log.step('Configuring iptables...');
	const iface = (await SSH.ssh(sshHost, "ip route | grep default | awk '{print $5}' | head -1"))
		.stdout.trim() || 'eth0';

	const iptablesRules = [
		'iptables -F DOCKER-USER 2>/dev/null || true',
		'iptables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
		'iptables -A DOCKER-USER -i lo -j ACCEPT',
		'iptables -A DOCKER-USER -s 100.64.0.0/10 -j ACCEPT', // Tailscale
		'iptables -A DOCKER-USER -i br-+ -j ACCEPT', // Docker bridges
		'iptables -A DOCKER-USER -p tcp -m conntrack --ctorigdstport 80 -j ACCEPT',
		'iptables -A DOCKER-USER -p tcp -m conntrack --ctorigdstport 443 -j ACCEPT',
		`iptables -A DOCKER-USER -i ${iface} -j DROP`, // Block public access
		'iptables -A DOCKER-USER -j RETURN',
	];

	await SSH.sshOrFail(sshHost, iptablesRules.join(' && '));
	await SSH.sshOrFail(sshHost, 'netfilter-persistent save');
	log.success('iptables configured');

	// Get server info
	const serverInfo = await SSH.getServerInfo(sshHost);

	// Register in database
	if (tailscaleIp) {
		const existingServer = DB.getServerByTailscaleIp(tailscaleIp);
		if (!existingServer) {
			DB.createServer({
				name: serverInfo.hostname || 'app-server',
				tailscale_ip: tailscaleIp,
				public_ip: sshHost.includes('@') ? sshHost.split('@')[1] : null,
				role: 'worker',
				tunnel_id: tunnelId || undefined,
			});
			log.success('Server registered in database');
		} else {
			DB.updateServer(existingServer.id, { tunnel_id: tunnelId || undefined });
			log.info('Server already registered, updated tunnel ID');
		}
	}

	// Summary
	console.log(chalk.bold.green(`
╔═══════════════════════════════════════════════════════════╗
║            ✓ Target Server Ready!                         ║
╚═══════════════════════════════════════════════════════════╝
`));

	console.log(chalk.bold('Server Info:'));
	console.log(`  Hostname:     ${serverInfo.hostname}`);
	console.log(`  Tailscale IP: ${tailscaleIp || 'Not configured'}`);
	console.log(`  Docker:       ${serverInfo.docker ? 'Installed' : 'Not installed'}`);
	if (tunnelId) {
		console.log(`  Tunnel ID:    ${tunnelId}`);
	}
	console.log();

	console.log(chalk.bold('Security:'));
	console.log('  - Docker ports only accessible via Tailscale');
	console.log('  - Public ports 80/443 allowed (for Cloudflare Tunnel)');
	console.log();

	if (tailscaleIp) {
		console.log(chalk.bold('Next Steps:'));
		console.log('  1. Add a project in CLI: Projects & Deploy → Add Project');
		console.log(`  2. Select this server: ${serverInfo.hostname} (${tailscaleIp})`);
		console.log('  3. Deploy your first app!');
	}
}

main().catch((err) => {
	log.error(String(err));
	process.exit(1);
});
