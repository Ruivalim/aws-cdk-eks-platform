#!/usr/bin/env bun
/**
 * Setup Coolify Adjacent Server
 *
 * Configures an additional server to join a Coolify cluster:
 * - Installs Docker (if needed)
 * - Installs and configures Tailscale
 * - Docker daemon.json (disables userland-proxy)
 * - iptables/ip6tables rules for DOCKER-USER chain
 * - Generates SSH key for Coolify master to connect
 *
 * Usage: bun setup-coolify-adjacent.ts [--ssh-host <host>] [--master-tailscale-ip <ip>]
 *
 * After running this script:
 * 1. Add the server in Coolify dashboard using its Tailscale IP
 * 2. Paste the SSH public key shown at the end
 */

import { confirm, input, select } from '@inquirer/prompts';
import chalk from 'chalk';

const log = {
	info: (msg: string) => console.log(chalk.blue('ℹ'), msg),
	success: (msg: string) => console.log(chalk.green('✓'), msg),
	warn: (msg: string) => console.log(chalk.yellow('⚠'), msg),
	error: (msg: string) => console.log(chalk.red('✗'), msg),
	step: (msg: string) => console.log(chalk.cyan('→'), msg),
	header: (msg: string) => console.log(chalk.bold.underline(`\n${msg}\n`)),
};

interface ServerInfo {
	sshHost: string;
	publicInterface: string;
	publicIp: string;
	tailscaleIp: string;
	hasDocker: boolean;
	hasTailscale: boolean;
	hasIptablesPersistent: boolean;
	existingDaemonJson: Record<string, unknown> | null;
}

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

async function gatherServerInfo(sshHost: string): Promise<ServerInfo> {
	log.header('Gathering Server Information');

	// Check Docker
	log.step('Checking Docker...');
	const dockerResult = await ssh(sshHost, 'docker --version');
	const hasDocker = dockerResult.exitCode === 0;
	if (hasDocker) {
		log.success(`Docker: ${dockerResult.stdout.split('\n')[0]}`);
	} else {
		log.warn('Docker not found (will install)');
	}

	// Check Tailscale
	log.step('Checking Tailscale...');
	const tailscaleResult = await ssh(sshHost, 'tailscale ip -4');
	const hasTailscale = tailscaleResult.exitCode === 0;
	let tailscaleIp = hasTailscale ? tailscaleResult.stdout : '';
	if (hasTailscale) {
		log.success(`Tailscale IP: ${tailscaleIp}`);
	} else {
		log.warn('Tailscale not found (will install)');
	}

	// Check iptables-persistent
	log.step('Checking iptables-persistent...');
	const iptablesResult = await ssh(sshHost, 'dpkg -l | grep iptables-persistent');
	const hasIptablesPersistent = iptablesResult.exitCode === 0 && iptablesResult.stdout.includes('ii');
	if (hasIptablesPersistent) {
		log.success('iptables-persistent installed');
	} else {
		log.warn('iptables-persistent not installed (will install)');
	}

	// Get public interface
	log.step('Detecting public interface...');
	const routeResult = await sshOrFail(sshHost, "ip route | grep default | awk '{print $5}'");
	const publicInterface = routeResult.split('\n')[0];
	log.success(`Public interface: ${publicInterface}`);

	// Get public IP
	log.step('Detecting public IP...');
	const ipResult = await sshOrFail(sshHost, `ip addr show ${publicInterface} | grep 'inet ' | awk '{print $2}' | cut -d/ -f1 | head -1`);
	const publicIp = ipResult;
	log.success(`Public IP: ${publicIp}`);

	// Check existing daemon.json
	log.step('Checking Docker daemon.json...');
	const daemonResult = await ssh(sshHost, 'cat /etc/docker/daemon.json 2>/dev/null');
	let existingDaemonJson: Record<string, unknown> | null = null;
	if (daemonResult.exitCode === 0 && daemonResult.stdout) {
		try {
			existingDaemonJson = JSON.parse(daemonResult.stdout);
			log.success('Found existing daemon.json');
		} catch {
			log.warn('Invalid daemon.json found');
		}
	} else {
		log.info('No daemon.json found (will create)');
	}

	return {
		sshHost,
		publicInterface,
		publicIp,
		tailscaleIp,
		hasDocker,
		hasTailscale,
		hasIptablesPersistent,
		existingDaemonJson,
	};
}

async function installDocker(sshHost: string): Promise<void> {
	log.header('Installing Docker');

	log.step('Downloading Docker install script...');
	await sshOrFail(sshHost, 'curl -fsSL https://get.docker.com -o /tmp/get-docker.sh');

	log.step('Running Docker install script (this may take a few minutes)...');
	await sshOrFail(sshHost, 'sudo sh /tmp/get-docker.sh');

	log.step('Starting Docker service...');
	await sshOrFail(sshHost, 'sudo systemctl enable docker && sudo systemctl start docker');

	log.success('Docker installed successfully');
}

async function installTailscale(sshHost: string): Promise<string> {
	log.header('Installing Tailscale');

	log.step('Downloading Tailscale install script...');
	await sshOrFail(sshHost, 'curl -fsSL https://tailscale.com/install.sh -o /tmp/install-tailscale.sh');

	log.step('Running Tailscale install script...');
	await sshOrFail(sshHost, 'sudo sh /tmp/install-tailscale.sh');

	log.step('Starting Tailscale...');
	const authResult = await ssh(sshHost, 'sudo tailscale up 2>&1');

	if (authResult.stdout.includes('https://')) {
		// Extract auth URL
		const urlMatch = authResult.stdout.match(/(https:\/\/login\.tailscale\.com\/[^\s]+)/);
		if (urlMatch) {
			log.warn('Tailscale needs authentication!');
			console.log(chalk.yellow('\nPlease open this URL in your browser to authenticate:'));
			console.log(chalk.bold.cyan(urlMatch[1]));
			console.log();

			await input({
				message: 'Press Enter after authenticating in the browser...',
			});
		}
	}

	// Get Tailscale IP
	log.step('Getting Tailscale IP...');
	const ipResult = await sshOrFail(sshHost, 'tailscale ip -4');
	log.success(`Tailscale IP: ${ipResult}`);

	return ipResult;
}

async function installIptablesPersistent(sshHost: string): Promise<void> {
	log.step('Installing iptables-persistent...');
	await sshOrFail(sshHost, 'sudo DEBIAN_FRONTEND=noninteractive apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent');
	log.success('iptables-persistent installed');
}

async function configureDockerDaemon(sshHost: string, existingConfig: Record<string, unknown> | null): Promise<void> {
	log.header('Configuring Docker Daemon');

	const newConfig = {
		...(existingConfig || {}),
		'userland-proxy': false,
	};

	// Ensure log settings exist
	if (!newConfig['log-driver']) {
		newConfig['log-driver'] = 'json-file';
		newConfig['log-opts'] = {
			'max-size': '10m',
			'max-file': '3',
		};
	}

	const configJson = JSON.stringify(newConfig, null, 2);
	log.step('Writing daemon.json...');
	log.info(`Config:\n${configJson}`);

	// Escape for shell
	const escapedJson = configJson.replace(/'/g, "'\\''");
	await sshOrFail(sshHost, `echo '${escapedJson}' | sudo tee /etc/docker/daemon.json > /dev/null`);
	log.success('daemon.json updated');
}

async function backupIptables(sshHost: string): Promise<void> {
	log.step('Backing up current iptables rules...');
	const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
	await sshOrFail(sshHost, `sudo iptables-save > ~/iptables-backup-${date}.rules 2>/dev/null || true`);
	await sshOrFail(sshHost, `sudo ip6tables-save > ~/ip6tables-backup-${date}.rules 2>/dev/null || true`);
	log.success(`Backup saved to ~/iptables-backup-${date}.rules`);
}

async function configureIptables(sshHost: string, publicInterface: string): Promise<void> {
	log.header('Configuring iptables Rules');

	// IPv4 rules
	log.step('Configuring IPv4 DOCKER-USER chain...');
	const ipv4Commands = [
		// Clear existing DOCKER-USER rules
		'sudo iptables -F DOCKER-USER 2>/dev/null || true',
		// 1. Accept established connections
		'sudo iptables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
		// 2. Accept localhost
		'sudo iptables -A DOCKER-USER -i lo -j ACCEPT',
		// 3. Accept Tailscale network
		'sudo iptables -A DOCKER-USER -s 100.64.0.0/10 -j ACCEPT',
		// 4. Accept Docker bridge traffic (container-to-container)
		'sudo iptables -A DOCKER-USER -i br-+ -j ACCEPT',
		// 5. Accept original port 80 (before NAT)
		'sudo iptables -A DOCKER-USER -p tcp -m conntrack --ctorigdstport 80 -j ACCEPT',
		// 6. Accept original port 443 TCP (before NAT)
		'sudo iptables -A DOCKER-USER -p tcp -m conntrack --ctorigdstport 443 -j ACCEPT',
		// 7. Accept original port 443 UDP (before NAT)
		'sudo iptables -A DOCKER-USER -p udp -m conntrack --ctorigdstport 443 -j ACCEPT',
		// 8. Drop everything else from public interface
		`sudo iptables -A DOCKER-USER -i ${publicInterface} -j DROP`,
		// 9. Return for other traffic
		'sudo iptables -A DOCKER-USER -j RETURN',
	];

	for (const cmd of ipv4Commands) {
		await sshOrFail(sshHost, cmd);
	}
	log.success('IPv4 rules configured');

	// IPv6 rules
	log.step('Configuring IPv6 DOCKER-USER chain...');
	const ipv6Commands = [
		// Clear existing DOCKER-USER rules
		'sudo ip6tables -F DOCKER-USER 2>/dev/null || true',
		// 1. Accept established connections
		'sudo ip6tables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
		// 2. Accept localhost
		'sudo ip6tables -A DOCKER-USER -i lo -j ACCEPT',
		// 3. Accept Tailscale IPv6 network
		'sudo ip6tables -A DOCKER-USER -s fd7a:115c:a1e0::/48 -j ACCEPT',
		// 4. Accept Docker bridge traffic (container-to-container)
		'sudo ip6tables -A DOCKER-USER -i br-+ -j ACCEPT',
		// 5. Accept port 80 TCP
		'sudo ip6tables -A DOCKER-USER -p tcp --dport 80 -j ACCEPT',
		// 6. Accept port 443 TCP
		'sudo ip6tables -A DOCKER-USER -p tcp --dport 443 -j ACCEPT',
		// 7. Accept port 443 UDP
		'sudo ip6tables -A DOCKER-USER -p udp --dport 443 -j ACCEPT',
		// 8. Drop everything else from public interface
		`sudo ip6tables -A DOCKER-USER -i ${publicInterface} -j DROP`,
		// 9. Return for other traffic
		'sudo ip6tables -A DOCKER-USER -j RETURN',
	];

	for (const cmd of ipv6Commands) {
		await sshOrFail(sshHost, cmd);
	}
	log.success('IPv6 rules configured');
}

async function saveIptables(sshHost: string): Promise<void> {
	log.step('Saving iptables rules (persistent)...');
	await sshOrFail(sshHost, 'sudo netfilter-persistent save');
	log.success('Rules saved - will persist after reboot');
}

async function restartDocker(sshHost: string): Promise<void> {
	log.header('Restarting Docker');

	log.step('Restarting Docker daemon...');
	await sshOrFail(sshHost, 'sudo systemctl restart docker');
	log.success('Docker restarted');

	log.step('Waiting for Docker to be ready...');
	await Bun.sleep(5000);

	const dockerResult = await ssh(sshHost, 'docker ps');
	if (dockerResult.exitCode === 0) {
		log.success('Docker is ready');
	}
}

async function createRestoreScript(sshHost: string): Promise<void> {
	log.step('Creating emergency restore script...');

	const script = `#!/bin/bash
# Emergency restore script - resets DOCKER-USER to allow all traffic
echo "Restoring DOCKER-USER to default (allow all)..."
iptables -F DOCKER-USER
iptables -A DOCKER-USER -j RETURN
ip6tables -F DOCKER-USER
ip6tables -A DOCKER-USER -j RETURN
echo "Done. All traffic is now allowed."
echo "Run 'netfilter-persistent save' to make permanent."
`;

	const escapedScript = script.replace(/'/g, "'\\''");
	await sshOrFail(sshHost, `echo '${escapedScript}' | sudo tee /root/restore-iptables.sh > /dev/null && sudo chmod +x /root/restore-iptables.sh`);
	log.success('Restore script created at /root/restore-iptables.sh');
}

async function setupSshKey(sshHost: string): Promise<string> {
	log.header('Setting up SSH Key for Coolify');

	// Check if key exists
	const keyResult = await ssh(sshHost, 'cat ~/.ssh/authorized_keys 2>/dev/null | grep "coolify" || true');

	if (!keyResult.stdout) {
		log.info('You will need to add the SSH public key from your Coolify master server.');
		log.info('In Coolify dashboard, go to: Settings → Servers → Add Server');
		log.info('Copy the SSH public key shown there.');
		console.log();

		const sshKey = await input({
			message: 'Paste the SSH public key from Coolify (or press Enter to skip):',
		});

		if (sshKey.trim()) {
			const escapedKey = sshKey.trim().replace(/'/g, "'\\''");
			await sshOrFail(sshHost, `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${escapedKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`);
			log.success('SSH key added');
		} else {
			log.warn('SSH key skipped - you will need to add it manually later');
		}
	} else {
		log.success('SSH key already configured');
	}

	return '';
}

async function testConnectivity(sshHost: string, masterTailscaleIp: string, tailscaleIp: string): Promise<void> {
	log.header('Testing Connectivity');

	if (masterTailscaleIp) {
		log.step(`Testing connection to master server (${masterTailscaleIp})...`);
		const pingResult = await ssh(sshHost, `ping -c 2 -W 3 ${masterTailscaleIp}`);
		if (pingResult.exitCode === 0) {
			log.success('Can reach master server via Tailscale');
		} else {
			log.warn('Cannot reach master server - check Tailscale connection');
		}

		// Test Postgres connectivity
		log.step(`Testing Postgres connection (${masterTailscaleIp}:5432)...`);
		const pgResult = await ssh(sshHost, `timeout 3 bash -c "echo > /dev/tcp/${masterTailscaleIp}/5432" 2>/dev/null && echo "OK"`);
		if (pgResult.stdout.includes('OK')) {
			log.success('Postgres port is reachable');
		} else {
			log.warn('Postgres port NOT reachable!');
			log.info('  → No Coolify, vá no serviço Postgres e exponha a porta 5432:5432');
		}

		// Test Redis connectivity
		log.step(`Testing Redis connection (${masterTailscaleIp}:6379)...`);
		const redisResult = await ssh(sshHost, `timeout 3 bash -c "echo > /dev/tcp/${masterTailscaleIp}/6379" 2>/dev/null && echo "OK"`);
		if (redisResult.stdout.includes('OK')) {
			log.success('Redis port is reachable');
		} else {
			log.warn('Redis port NOT reachable!');
			log.info('  → No Coolify, vá no serviço Redis e exponha a porta 6379:6379');
		}
	}

	log.step('Checking iptables rules...');
	const rulesResult = await sshOrFail(sshHost, 'sudo iptables -L DOCKER-USER -n | head -12');
	log.success('DOCKER-USER chain:');
	console.log(rulesResult);
}

async function printSummary(info: ServerInfo, masterTailscaleIp: string): Promise<void> {
	log.header('Setup Complete!');

	console.log(chalk.bold('Server Configuration:'));
	console.log(`  SSH Host:         ${info.sshHost}`);
	console.log(`  Public Interface: ${info.publicInterface}`);
	console.log(`  Public IP:        ${info.publicIp}`);
	console.log(`  Tailscale IP:     ${info.tailscaleIp}`);

	console.log(chalk.bold('\nAccess Rules:'));
	console.log('  Ports 80/443:     Public (via Traefik)');
	console.log('  All other ports:  Tailscale only');

	console.log(chalk.bold.yellow('\n⚠️  Next Steps in Coolify Dashboard:'));
	console.log('  1. Go to Settings → Servers → Add Server');
	console.log(`  2. Use this IP address: ${chalk.cyan(info.tailscaleIp)}`);
	console.log('  3. User: root');
	console.log('  4. Port: 22');
	console.log('  5. Click "Validate Server"');

	console.log(chalk.bold('\nUseful Commands:'));
	console.log(`  View rules:       ssh ${info.sshHost} "sudo iptables -L DOCKER-USER -n -v --line-numbers"`);
	console.log(`  Emergency reset:  ssh ${info.sshHost} "sudo /root/restore-iptables.sh"`);
	console.log(`  Test from master: ssh ${masterTailscaleIp || '<master>'} "ping ${info.tailscaleIp}"`);

	console.log(chalk.bold('\nConnecting to Master Databases:'));
	console.log('  Containers on this server can access the master via Tailscale IP.');
	console.log('');
	console.log('  Postgres:');
	console.log(`    DATABASE_URL=postgres://USER:PASS@${masterTailscaleIp || '<master-tailscale-ip>'}:5432/DATABASE`);
	console.log('');
	console.log('  Redis:');
	console.log(`    REDIS_URL=redis://${masterTailscaleIp || '<master-tailscale-ip>'}:6379/0`);
	console.log('');
	console.log(chalk.dim('  Tip: Use .env.child-1 files in each service folder for pre-configured examples'));
}

async function main() {
	console.log(chalk.bold.blue('\n🚀 Coolify Adjacent Server Setup\n'));

	// Parse arguments
	let sshHost = '';
	let masterTailscaleIp = '';
	const args = process.argv.slice(2);
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--ssh-host' && args[i + 1]) {
			sshHost = args[i + 1];
		}
		if (args[i] === '--master-tailscale-ip' && args[i + 1]) {
			masterTailscaleIp = args[i + 1];
		}
	}

	// Get SSH host if not provided
	if (!sshHost) {
		sshHost = await input({
			message: 'SSH host for the NEW server (e.g., root@1.2.3.4):',
			validate: (v) => (v.length > 0 ? true : 'SSH host is required'),
		});
	}

	// Get master Tailscale IP if not provided
	if (!masterTailscaleIp) {
		masterTailscaleIp = await input({
			message: 'Tailscale IP of your Coolify MASTER server (doserver):',
			default: '100.77.201.55',
		});
	}

	try {
		// Test SSH connection
		log.step(`Testing SSH connection to ${sshHost}...`);
		await sshOrFail(sshHost, 'echo "Connected"');
		log.success('SSH connection successful');

		// Gather info
		let info = await gatherServerInfo(sshHost);

		// Show what will be done
		log.header('Configuration Plan');
		console.log('The following will be configured:');
		if (!info.hasDocker) {
			console.log('  1. Install Docker');
		}
		if (!info.hasTailscale) {
			console.log('  2. Install and configure Tailscale');
		}
		console.log('  3. Update /etc/docker/daemon.json (disable userland-proxy)');
		console.log('  4. Configure iptables DOCKER-USER chain');
		console.log('  5. Configure ip6tables DOCKER-USER chain');
		console.log('  6. Save rules for persistence');
		console.log('  7. Setup SSH key for Coolify master');

		const proceed = await confirm({
			message: 'Proceed with setup?',
			default: true,
		});

		if (!proceed) {
			log.warn('Setup cancelled');
			process.exit(0);
		}

		// Install Docker if needed
		if (!info.hasDocker) {
			await installDocker(sshHost);
			info.hasDocker = true;
		}

		// Install Tailscale if needed
		if (!info.hasTailscale) {
			info.tailscaleIp = await installTailscale(sshHost);
			info.hasTailscale = true;
		}

		// Install iptables-persistent if needed
		if (!info.hasIptablesPersistent) {
			await installIptablesPersistent(sshHost);
		}

		// Backup current rules
		await backupIptables(sshHost);

		// Configure Docker daemon
		await configureDockerDaemon(sshHost, info.existingDaemonJson);

		// Configure iptables
		await configureIptables(sshHost, info.publicInterface);

		// Save rules
		await saveIptables(sshHost);

		// Create restore script
		await createRestoreScript(sshHost);

		// Restart Docker
		await restartDocker(sshHost);

		// Setup SSH key
		await setupSshKey(sshHost);

		// Test connectivity
		await testConnectivity(sshHost, masterTailscaleIp, info.tailscaleIp);

		// Print summary
		await printSummary(info, masterTailscaleIp);
	} catch (error) {
		log.error(`Setup failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}

main();
