#!/usr/bin/env bun
/**
 * Setup Coolify Master Server
 *
 * Configures a Coolify master server with:
 * - Docker (installs if missing)
 * - Tailscale (installs if missing)
 * - Coolify (installs if missing)
 * - Docker daemon.json (disables userland-proxy)
 * - iptables/ip6tables rules for DOCKER-USER chain
 * - Tailscale-only access for admin ports
 * - Public access only for 80/443
 *
 * Usage: bun setup-coolify-master.ts [--ssh-host <host>]
 *
 * Requirements on target server:
 * - Ubuntu/Debian based system
 * - Root or sudo access
 * - iptables-persistent (will be installed if missing)
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
	hasCoolify: boolean;
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

	// Check Coolify
	log.step('Checking Coolify...');
	const coolifyResult = await ssh(sshHost, 'docker ps --format "{{.Names}}" | grep -E "^coolify$"');
	const hasCoolify = coolifyResult.exitCode === 0 && coolifyResult.stdout.includes('coolify');
	if (hasCoolify) {
		log.success('Coolify is running');
	} else {
		log.warn('Coolify not found (will install)');
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
		hasCoolify,
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

async function installCoolify(sshHost: string): Promise<void> {
	log.header('Installing Coolify');

	log.warn('Coolify installation will take a few minutes.');
	log.info('The installer will download and configure all required components.');
	console.log();

	const proceed = await confirm({
		message: 'Install Coolify now?',
		default: true,
	});

	if (!proceed) {
		log.warn('Skipping Coolify installation - you can install it manually later');
		log.info('Manual install: curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash');
		return;
	}

	log.step('Running Coolify installer (this may take 3-5 minutes)...');

	// Run Coolify installer with automatic yes to prompts
	const installResult = await ssh(sshHost, 'curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash');

	if (installResult.exitCode !== 0) {
		log.error('Coolify installation may have failed');
		log.info(`Output: ${installResult.stdout}`);
		log.info(`Errors: ${installResult.stderr}`);

		const continueAnyway = await confirm({
			message: 'Continue with firewall setup anyway?',
			default: true,
		});

		if (!continueAnyway) {
			throw new Error('Coolify installation failed');
		}
	} else {
		log.success('Coolify installed successfully');
	}

	// Wait for Coolify to start
	log.step('Waiting for Coolify to start...');
	await Bun.sleep(15000);

	// Check if Coolify is running
	const checkResult = await ssh(sshHost, 'docker ps --format "{{.Names}}" | grep coolify');
	if (checkResult.exitCode === 0) {
		log.success('Coolify is running');
	} else {
		log.warn('Coolify containers may still be starting');
	}
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
	await sshOrFail(sshHost, `sudo sh -c "iptables-save > ~/iptables-backup-${date}.rules" 2>/dev/null || true`);
	await sshOrFail(sshHost, `sudo sh -c "ip6tables-save > ~/ip6tables-backup-${date}.rules" 2>/dev/null || true`);
	log.success(`Backup saved to ~/iptables-backup-${date}.rules`);
}

async function configureIptables(sshHost: string, publicInterface: string): Promise<void> {
	log.header('Configuring iptables Rules');

	// IPv4 rules
	log.step('Configuring IPv4 DOCKER-USER chain...');
	const ipv4Commands = [
		// Clear existing DOCKER-USER rules (may not exist yet)
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
		// Clear existing DOCKER-USER rules (may not exist yet)
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

	log.warn('This will briefly stop all containers (~10-30 seconds)');
	const proceed = await confirm({
		message: 'Proceed with Docker restart?',
		default: true,
	});

	if (!proceed) {
		log.warn('Skipping Docker restart - you must restart Docker manually later');
		return;
	}

	log.step('Restarting Docker daemon...');
	await sshOrFail(sshHost, 'sudo systemctl restart docker');
	log.success('Docker restarted');

	log.step('Waiting for containers to come back up...');
	await Bun.sleep(10000);

	const containersResult = await sshOrFail(sshHost, "docker ps --format '{{.Names}}: {{.Status}}' | head -10");
	log.success('Containers status:');
	console.log(containersResult);
}

async function verifySetup(sshHost: string, publicIp: string, tailscaleIp: string): Promise<void> {
	log.header('Verifying Setup');

	// Check docker-proxy is not running
	log.step('Checking docker-proxy is disabled...');
	const proxyResult = await ssh(sshHost, 'ps aux | grep docker-proxy | grep -v grep');
	if (proxyResult.stdout) {
		log.warn('docker-proxy still running - may need container restart');
	} else {
		log.success('docker-proxy disabled');
	}

	// Check iptables rules
	log.step('Checking iptables rules...');
	const rulesResult = await sshOrFail(sshHost, 'sudo iptables -L DOCKER-USER -n | head -15');
	log.success('DOCKER-USER chain configured:');
	console.log(rulesResult);

	// Test connectivity
	log.header('Testing Connectivity');

	log.step(`Testing port 8000 via public IP (${publicIp}) - should timeout...`);
	const publicTest = await ssh('localhost', `curl -s --max-time 5 http://${publicIp}:8000`);
	if (publicTest.exitCode !== 0 || publicTest.stderr.includes('timed out')) {
		log.success('Port 8000 blocked on public IP');
	} else {
		log.warn('Port 8000 may still be accessible on public IP');
	}

	log.step(`Testing port 8000 via Tailscale (${tailscaleIp}) - should work...`);
	const tailscaleTest = await ssh('localhost', `curl -s --max-time 5 http://${tailscaleIp}:8000 | head -1`);
	if (tailscaleTest.exitCode === 0 && tailscaleTest.stdout) {
		log.success('Port 8000 accessible via Tailscale');
	} else {
		log.warn('Port 8000 test via Tailscale inconclusive (may need local Tailscale)');
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

async function printSummary(info: ServerInfo): Promise<void> {
	log.header('Setup Complete!');

	console.log(chalk.bold('Server Configuration:'));
	console.log(`  SSH Host:         ${info.sshHost}`);
	console.log(`  Public Interface: ${info.publicInterface}`);
	console.log(`  Public IP:        ${info.publicIp}`);
	console.log(`  Tailscale IP:     ${info.tailscaleIp}`);

	console.log(chalk.bold('\nAccess Rules:'));
	console.log('  Ports 80/443:     Public (via Traefik)');
	console.log('  All other ports:  Tailscale only');

	console.log(chalk.bold.green('\nCoolify Dashboard:'));
	console.log(`  URL (Tailscale):  http://${info.tailscaleIp}:8000`);
	console.log(`  URL (blocked):    http://${info.publicIp}:8000 (should timeout)`);
	console.log('  First access:     Create your admin account');

	console.log(chalk.bold('\nUseful Commands:'));
	console.log(`  View rules:       ssh ${info.sshHost} "sudo iptables -L DOCKER-USER -n -v --line-numbers"`);
	console.log(`  Emergency reset:  ssh ${info.sshHost} "sudo /root/restore-iptables.sh"`);
	console.log(`  Docker logs:      ssh ${info.sshHost} "docker logs coolify"`);

	console.log(chalk.bold('\nTo add additional servers, run:'));
	console.log(`  bun setup-coolify-adjacent.ts --master-tailscale-ip ${info.tailscaleIp}`);
}

async function main() {
	console.log(chalk.bold.blue('\n🚀 Coolify Master Server Setup\n'));

	// Parse arguments
	let sshHost = '';
	const args = process.argv.slice(2);
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--ssh-host' && args[i + 1]) {
			sshHost = args[i + 1];
		}
	}

	// Get SSH host if not provided
	if (!sshHost) {
		sshHost = await input({
			message: 'SSH host (e.g., doserver, root@1.2.3.4):',
			default: 'doserver',
			validate: (v) => (v.length > 0 ? true : 'SSH host is required'),
		});
	}

	try {
		// Test SSH connection
		log.step(`Testing SSH connection to ${sshHost}...`);
		await sshOrFail(sshHost, 'echo "Connected"');
		log.success('SSH connection successful');

		// Gather info
		const info = await gatherServerInfo(sshHost);

		// Show what will be done
		log.header('Configuration Plan');
		console.log('The following will be configured:');
		let stepNum = 1;
		if (!info.hasDocker) {
			console.log(`  ${stepNum++}. Install Docker`);
		}
		if (!info.hasTailscale) {
			console.log(`  ${stepNum++}. Install and configure Tailscale`);
		}
		if (!info.hasCoolify) {
			console.log(`  ${stepNum++}. Install Coolify`);
		}
		console.log(`  ${stepNum++}. Update /etc/docker/daemon.json (disable userland-proxy)`);
		console.log(`  ${stepNum++}. Configure iptables DOCKER-USER chain`);
		console.log(`  ${stepNum++}. Configure ip6tables DOCKER-USER chain`);
		console.log(`  ${stepNum++}. Save rules for persistence`);
		console.log(`  ${stepNum++}. Restart Docker daemon`);

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

		// Install Coolify if needed
		if (!info.hasCoolify) {
			await installCoolify(sshHost);
			info.hasCoolify = true;

			// Re-read daemon.json as Coolify may have created one
			const daemonResult = await ssh(sshHost, 'cat /etc/docker/daemon.json 2>/dev/null');
			if (daemonResult.exitCode === 0 && daemonResult.stdout) {
				try {
					info.existingDaemonJson = JSON.parse(daemonResult.stdout);
				} catch {
					// ignore
				}
			}
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

		// Verify setup
		await verifySetup(sshHost, info.publicIp, info.tailscaleIp);

		// Print summary
		await printSummary(info);
	} catch (error) {
		log.error(`Setup failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}

main();
