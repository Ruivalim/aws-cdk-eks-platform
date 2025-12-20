#!/usr/bin/env bun
/**
 * Coolify Infrastructure CLI
 *
 * Interactive CLI for managing Coolify infrastructure:
 * - Digital Ocean droplets
 * - Server setup (master/adjacent)
 * - Database provisioning
 * - Service deployment
 *
 * Usage: bun src/cli.ts
 */

import { select, input, confirm, checkbox } from '@inquirer/prompts';
import chalk from 'chalk';
import log from './lib/log';
import * as DO from './lib/digitalocean';
import * as CF from './lib/cloudflare';
import * as SSH from './lib/ssh';
import * as GitHub from './lib/github';
import * as DB from './lib/db';
import * as Build from './lib/build';
import * as Deploy from './lib/deploy';
import { SERVICES, generateSecret, generatePassword } from './lib/services';

// ============ Main Menu ============

async function mainMenu(): Promise<void> {
	console.clear();
	console.log(chalk.bold.blue(`
╔═══════════════════════════════════════════════════════════╗
║           🚀 Coolify Infrastructure Manager               ║
╚═══════════════════════════════════════════════════════════╝
`));

	const choice = await select({
		message: 'What would you like to do?',
		choices: [
			{ name: '☁️  Digital Ocean', value: 'digitalocean', description: 'Manage droplets, SSH keys, billing' },
			{ name: '🌐  Cloudflare', value: 'cloudflare', description: 'DNS and Tunnels' },
			{ name: '🖥️  Servers', value: 'servers', description: 'Setup and manage servers' },
			{ name: '🚀  Projects & Deploy', value: 'projects', description: 'Manage apps and deployments' },
			{ name: '🗄️  Databases', value: 'databases', description: 'Provision databases for services' },
			{ name: '📦  Services', value: 'services', description: 'View and manage services' },
			{ name: '🌐  Web Dashboard', value: 'web', description: 'Open web interface' },
			{ name: '❌  Exit', value: 'exit' },
		],
	});

	switch (choice) {
		case 'digitalocean':
			await digitalOceanMenu();
			break;
		case 'cloudflare':
			await cloudflareMenu();
			break;
		case 'servers':
			await serversMenu();
			break;
		case 'projects':
			await projectsMenu();
			break;
		case 'databases':
			await databasesMenu();
			break;
		case 'services':
			await servicesMenu();
			break;
		case 'web':
			await startWebDashboard();
			break;
		case 'exit':
			console.log(chalk.dim('\nGoodbye! 👋\n'));
			process.exit(0);
	}

	// Loop back to main menu
	await mainMenu();
}

// ============ Digital Ocean Menu ============

async function digitalOceanMenu(): Promise<void> {
	console.clear();
	log.header('☁️  Digital Ocean');

	// Check for token
	if (!process.env.DIGITALOCEAN_TOKEN && !process.env.DO_TOKEN) {
		log.error('DIGITALOCEAN_TOKEN or DO_TOKEN not set');
		log.info('Add to your .env file: DIGITALOCEAN_TOKEN=your_token_here');
		await input({ message: 'Press Enter to go back...' });
		return;
	}

	const choice = await select({
		message: 'Digital Ocean Options:',
		choices: [
			{ name: '📋  List Droplets', value: 'list' },
			{ name: '➕  Create Droplet', value: 'create' },
			{ name: '🗑️  Delete Droplet', value: 'delete' },
			{ name: '🌐  DNS Management', value: 'dns' },
			{ name: '🔑  SSH Keys', value: 'sshkeys' },
			{ name: '💰  Billing', value: 'billing' },
			{ name: '←   Back', value: 'back' },
		],
	});

	switch (choice) {
		case 'list':
			await listDroplets();
			break;
		case 'create':
			await createDroplet();
			break;
		case 'delete':
			await deleteDroplet();
			break;
		case 'dns':
			await dnsMenu();
			break;
		case 'sshkeys':
			await sshKeysMenu();
			break;
		case 'billing':
			await showBilling();
			break;
		case 'back':
			return;
	}

	await digitalOceanMenu();
}

async function listDroplets(): Promise<void> {
	log.step('Fetching droplets...');
	try {
		const droplets = await DO.listDroplets();

		if (droplets.length === 0) {
			log.warn('No droplets found');
		} else {
			console.log('\n' + chalk.bold('Your Droplets:'));
			console.log(chalk.dim('─'.repeat(80)));

			for (const d of droplets) {
				const ip = DO.getPublicIP(d) || 'No IP';
				const statusColor = d.status === 'active' ? chalk.green : chalk.yellow;
				console.log(
					`  ${statusColor('●')} ${chalk.bold(d.name)} (${d.id})` +
						`\n    ${chalk.dim('IP:')} ${ip}` +
						`\n    ${chalk.dim('Region:')} ${d.region.name}` +
						`\n    ${chalk.dim('Size:')} ${DO.formatMemory(d.memory)} / ${d.vcpus} vCPU / ${d.disk}GB` +
						`\n    ${chalk.dim('Price:')} ${DO.formatPrice(d.size.price_monthly)}` +
						`\n    ${chalk.dim('Tags:')} ${d.tags.join(', ') || 'none'}` +
						'\n'
				);
			}
		}
	} catch (error) {
		log.error(`Failed to list droplets: ${error}`);
	}
	await input({ message: 'Press Enter to continue...' });
}

async function createDroplet(): Promise<void> {
	log.header('Create New Droplet');

	try {
		// Get SSH keys first
		const sshKeys = await DO.listSSHKeys();
		if (sshKeys.length === 0) {
			log.error('No SSH keys found. Please add an SSH key first.');
			await input({ message: 'Press Enter to go back...' });
			return;
		}

		const name = await input({
			message: 'Droplet name:',
			validate: (v) => (v.length > 0 ? true : 'Name is required'),
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

		const image = await select({
			message: 'Image:',
			choices: DO.RECOMMENDED_IMAGES.map((i) => ({ name: i.name, value: i.slug })),
		});

		const selectedKeys = await checkbox({
			message: 'SSH Keys to add:',
			choices: sshKeys.map((k) => ({ name: k.name, value: k.id, checked: true })),
		});

		const tags = await input({
			message: 'Tags (comma-separated, optional):',
			default: 'coolify',
		});

		const monitoring = await confirm({
			message: 'Enable monitoring?',
			default: true,
		});

		const proceed = await confirm({
			message: `Create droplet "${name}" in ${region}?`,
			default: true,
		});

		if (!proceed) {
			log.warn('Cancelled');
			return;
		}

		log.step('Creating droplet...');

		const droplet = await DO.createDroplet({
			name,
			region,
			size,
			image,
			ssh_keys: selectedKeys,
			tags: tags
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean),
			monitoring,
			ipv6: true,
		});

		log.success(`Droplet created! ID: ${droplet.id}`);
		log.info('Droplet is being provisioned. It may take a few minutes to get an IP.');
		log.info(`Check status: bun src/cli.ts → Digital Ocean → List Droplets`);
	} catch (error) {
		log.error(`Failed to create droplet: ${error}`);
	}

	await input({ message: 'Press Enter to continue...' });
}

async function deleteDroplet(): Promise<void> {
	log.header('Delete Droplet');

	try {
		const droplets = await DO.listDroplets();

		if (droplets.length === 0) {
			log.warn('No droplets found');
			await input({ message: 'Press Enter to go back...' });
			return;
		}

		const dropletId = await select({
			message: 'Select droplet to delete:',
			choices: [
				...droplets.map((d) => ({
					name: `${d.name} (${DO.getPublicIP(d) || 'No IP'}) - ${d.region.name}`,
					value: d.id,
				})),
				{ name: '← Cancel', value: 0 },
			],
		});

		if (dropletId === 0) return;

		const droplet = droplets.find((d) => d.id === dropletId)!;

		const confirmDelete = await confirm({
			message: chalk.red(`Are you sure you want to DELETE "${droplet.name}"? This cannot be undone!`),
			default: false,
		});

		if (!confirmDelete) {
			log.warn('Cancelled');
			return;
		}

		log.step('Deleting droplet...');
		await DO.deleteDroplet(dropletId);
		log.success('Droplet deleted');
	} catch (error) {
		log.error(`Failed to delete droplet: ${error}`);
	}

	await input({ message: 'Press Enter to continue...' });
}

async function sshKeysMenu(): Promise<void> {
	log.header('SSH Keys');

	const choice = await select({
		message: 'SSH Keys Options:',
		choices: [
			{ name: '📋  List SSH Keys', value: 'list' },
			{ name: '➕  Add SSH Key', value: 'add' },
			{ name: '🗑️  Delete SSH Key', value: 'delete' },
			{ name: '←   Back', value: 'back' },
		],
	});

	try {
		switch (choice) {
			case 'list': {
				const keys = await DO.listSSHKeys();
				console.log('\n' + chalk.bold('Your SSH Keys:'));
				for (const key of keys) {
					console.log(`  • ${chalk.bold(key.name)} (ID: ${key.id})`);
					console.log(`    ${chalk.dim(key.fingerprint)}`);
				}
				break;
			}
			case 'add': {
				const name = await input({ message: 'Key name:' });
				const publicKey = await input({ message: 'Public key (ssh-rsa ...):' });
				const key = await DO.createSSHKey(name, publicKey);
				log.success(`SSH key added: ${key.name} (${key.fingerprint})`);
				break;
			}
			case 'delete': {
				const keys = await DO.listSSHKeys();
				const keyId = await select({
					message: 'Select key to delete:',
					choices: [...keys.map((k) => ({ name: k.name, value: k.id })), { name: '← Cancel', value: 0 }],
				});
				if (keyId !== 0) {
					await DO.deleteSSHKey(keyId);
					log.success('SSH key deleted');
				}
				break;
			}
			case 'back':
				return;
		}
	} catch (error) {
		log.error(`SSH key operation failed: ${error}`);
	}

	await input({ message: 'Press Enter to continue...' });
	await sshKeysMenu();
}

async function showBilling(): Promise<void> {
	log.header('💰 Billing');

	try {
		const [balance, account] = await Promise.all([DO.getBalance(), DO.getAccount()]);

		console.log(chalk.bold('\nAccount:'));
		console.log(`  Email: ${account.email}`);
		console.log(`  Status: ${account.status}`);
		console.log(`  Droplet Limit: ${account.droplet_limit}`);

		console.log(chalk.bold('\nBilling:'));
		console.log(`  Account Balance: ${chalk.green('$' + balance.account_balance)}`);
		console.log(`  Month to Date Usage: ${chalk.yellow('$' + balance.month_to_date_usage)}`);
		console.log(`  Month to Date Balance: $${balance.month_to_date_balance}`);

		// Show estimated monthly cost from droplets
		const droplets = await DO.listDroplets();
		const monthlyTotal = droplets.reduce((sum, d) => sum + d.size.price_monthly, 0);
		console.log(`\n  ${chalk.dim('Estimated Monthly Cost:')} ${chalk.bold('$' + monthlyTotal.toFixed(2))}`);
	} catch (error) {
		log.error(`Failed to fetch billing: ${error}`);
	}

	await input({ message: 'Press Enter to continue...' });
}

// ============ DNS Menu ============

async function dnsMenu(): Promise<void> {
	console.clear();
	log.header('🌐 DNS Management');

	const choice = await select({
		message: 'DNS Options:',
		choices: [
			{ name: '📋  List Domains', value: 'list' },
			{ name: '➕  Add Domain', value: 'add' },
			{ name: '📝  Manage Records', value: 'records' },
			{ name: '🗑️  Delete Domain', value: 'delete' },
			{ name: '←   Back', value: 'back' },
		],
	});

	switch (choice) {
		case 'list':
			await listDomains();
			break;
		case 'add':
			await addDomain();
			break;
		case 'records':
			await manageRecords();
			break;
		case 'delete':
			await deleteDomainPrompt();
			break;
		case 'back':
			return;
	}

	await dnsMenu();
}

async function listDomains(): Promise<void> {
	log.step('Fetching domains...');
	try {
		const domains = await DO.listDomains();

		if (domains.length === 0) {
			log.warn('No domains found');
		} else {
			console.log('\n' + chalk.bold('Your Domains:'));
			console.log(chalk.dim('─'.repeat(60)));

			for (const d of domains) {
				console.log(`  ${chalk.bold(d.name)}`);
				console.log(`    ${chalk.dim('TTL:')} ${d.ttl}s`);
				console.log();
			}
		}
	} catch (error) {
		log.error(`Failed to list domains: ${error}`);
	}
	await input({ message: 'Press Enter to continue...' });
}

async function addDomain(): Promise<void> {
	log.header('Add Domain');

	try {
		const name = await input({
			message: 'Domain name (e.g., example.com):',
			validate: (v) => {
				if (!v) return 'Domain name is required';
				if (!/^[a-zA-Z0-9][a-zA-Z0-9-_.]+\.[a-zA-Z]{2,}$/.test(v)) {
					return 'Invalid domain format';
				}
				return true;
			},
		});

		const addIp = await confirm({
			message: 'Add an A record pointing to an IP address?',
			default: false,
		});

		let ipAddress: string | undefined;
		if (addIp) {
			ipAddress = await input({
				message: 'IP address:',
				validate: (v) => {
					if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)) {
						return 'Invalid IP address format';
					}
					return true;
				},
			});
		}

		log.step('Adding domain...');
		const domain = await DO.createDomain(name, ipAddress);
		log.success(`Domain added: ${domain.name}`);

		console.log(chalk.bold('\nNext Steps:'));
		console.log('  1. Update your domain registrar to use DigitalOcean nameservers:');
		console.log(chalk.cyan('     ns1.digitalocean.com'));
		console.log(chalk.cyan('     ns2.digitalocean.com'));
		console.log(chalk.cyan('     ns3.digitalocean.com'));
		console.log('  2. DNS propagation may take up to 48 hours');
	} catch (error) {
		log.error(`Failed to add domain: ${error}`);
	}

	await input({ message: '\nPress Enter to continue...' });
}

async function deleteDomainPrompt(): Promise<void> {
	log.header('Delete Domain');

	try {
		const domains = await DO.listDomains();

		if (domains.length === 0) {
			log.warn('No domains found');
			await input({ message: 'Press Enter to go back...' });
			return;
		}

		const domainName = await select({
			message: 'Select domain to delete:',
			choices: [
				...domains.map((d) => ({ name: d.name, value: d.name })),
				{ name: '← Cancel', value: '' },
			],
		});

		if (!domainName) return;

		const confirmDelete = await confirm({
			message: chalk.red(`Are you sure you want to DELETE "${domainName}" and ALL its records? This cannot be undone!`),
			default: false,
		});

		if (!confirmDelete) {
			log.warn('Cancelled');
			return;
		}

		log.step('Deleting domain...');
		await DO.deleteDomain(domainName);
		log.success('Domain deleted');
	} catch (error) {
		log.error(`Failed to delete domain: ${error}`);
	}

	await input({ message: 'Press Enter to continue...' });
}

async function manageRecords(): Promise<void> {
	try {
		const domains = await DO.listDomains();

		if (domains.length === 0) {
			log.warn('No domains found. Add a domain first.');
			await input({ message: 'Press Enter to go back...' });
			return;
		}

		const domainName = await select({
			message: 'Select domain:',
			choices: [
				...domains.map((d) => ({ name: d.name, value: d.name })),
				{ name: '← Cancel', value: '' },
			],
		});

		if (!domainName) return;

		await recordsMenu(domainName);
	} catch (error) {
		log.error(`Failed to load domains: ${error}`);
		await input({ message: 'Press Enter to continue...' });
	}
}

async function recordsMenu(domain: string): Promise<void> {
	console.clear();
	log.header(`📝 DNS Records: ${domain}`);

	const choice = await select({
		message: 'Record Options:',
		choices: [
			{ name: '📋  List Records', value: 'list' },
			{ name: '➕  Add Record', value: 'add' },
			{ name: '✏️  Edit Record', value: 'edit' },
			{ name: '🗑️  Delete Record', value: 'delete' },
			{ name: '⚡  Quick Add (A/CNAME)', value: 'quick' },
			{ name: '←   Back', value: 'back' },
		],
	});

	switch (choice) {
		case 'list':
			await listRecords(domain);
			break;
		case 'add':
			await addRecord(domain);
			break;
		case 'edit':
			await editRecord(domain);
			break;
		case 'delete':
			await deleteRecord(domain);
			break;
		case 'quick':
			await quickAddRecord(domain);
			break;
		case 'back':
			return;
	}

	await recordsMenu(domain);
}

async function listRecords(domain: string): Promise<void> {
	log.step('Fetching records...');
	try {
		const records = await DO.listDnsRecords(domain);

		// Group by type
		const grouped: Record<string, typeof records> = {};
		for (const r of records) {
			if (!grouped[r.type]) grouped[r.type] = [];
			grouped[r.type].push(r);
		}

		console.log('\n' + chalk.bold(`DNS Records for ${domain}:`));
		console.log(chalk.dim('─'.repeat(80)));

		for (const type of Object.keys(grouped).sort()) {
			console.log(chalk.bold.cyan(`\n${type} Records:`));
			for (const r of grouped[type]) {
				const name = r.name === '@' ? domain : `${r.name}.${domain}`;
				let info = `  ${chalk.bold(name)} → ${r.data}`;

				if (r.priority !== null) info += ` (priority: ${r.priority})`;
				if (r.port !== null) info += ` (port: ${r.port})`;
				info += chalk.dim(` [TTL: ${r.ttl}s, ID: ${r.id}]`);

				console.log(info);
			}
		}

		console.log();
	} catch (error) {
		log.error(`Failed to list records: ${error}`);
	}
	await input({ message: 'Press Enter to continue...' });
}

async function addRecord(domain: string): Promise<void> {
	log.header('Add DNS Record');

	try {
		const type = await select({
			message: 'Record type:',
			choices: DO.DNS_RECORD_TYPES.map((t) => ({
				name: `${t} - ${DO.DNS_RECORD_DESCRIPTIONS[t]}`,
				value: t,
			})),
		});

		const name = await input({
			message: 'Name (@ for root, or subdomain):',
			default: '@',
		});

		let data = '';
		let priority: number | undefined;
		let port: number | undefined;
		let weight: number | undefined;
		let flags: number | undefined;
		let tag: string | undefined;

		switch (type) {
			case 'A':
				data = await input({
					message: 'IPv4 Address:',
					validate: (v) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) || 'Invalid IPv4',
				});
				break;
			case 'AAAA':
				data = await input({
					message: 'IPv6 Address:',
					validate: (v) => v.includes(':') || 'Invalid IPv6',
				});
				break;
			case 'CNAME':
				data = await input({
					message: 'Target hostname (e.g., example.com.):',
					validate: (v) => v.length > 0 || 'Target is required',
				});
				if (!data.endsWith('.')) data += '.';
				break;
			case 'MX':
				data = await input({
					message: 'Mail server hostname:',
					validate: (v) => v.length > 0 || 'Hostname is required',
				});
				if (!data.endsWith('.')) data += '.';
				priority = parseInt(
					await input({
						message: 'Priority (lower = higher priority):',
						default: '10',
					})
				);
				break;
			case 'TXT':
				data = await input({
					message: 'Text value:',
					validate: (v) => v.length > 0 || 'Value is required',
				});
				break;
			case 'NS':
				data = await input({
					message: 'Nameserver hostname:',
					validate: (v) => v.length > 0 || 'Hostname is required',
				});
				if (!data.endsWith('.')) data += '.';
				break;
			case 'SRV':
				data = await input({
					message: 'Target hostname:',
					validate: (v) => v.length > 0 || 'Target is required',
				});
				priority = parseInt(await input({ message: 'Priority:', default: '10' }));
				weight = parseInt(await input({ message: 'Weight:', default: '100' }));
				port = parseInt(await input({ message: 'Port:', validate: (v) => !isNaN(parseInt(v)) || 'Invalid port' }));
				break;
			case 'CAA':
				flags = parseInt(await input({ message: 'Flags (0 or 128):', default: '0' }));
				tag = await select({
					message: 'Tag:',
					choices: [
						{ name: 'issue - Authorize CA to issue certificates', value: 'issue' },
						{ name: 'issuewild - Authorize CA for wildcard certificates', value: 'issuewild' },
						{ name: 'iodef - Report policy violations', value: 'iodef' },
					],
				});
				data = await input({
					message: 'Value (e.g., letsencrypt.org):',
					validate: (v) => v.length > 0 || 'Value is required',
				});
				break;
		}

		const ttl = parseInt(
			await input({
				message: 'TTL in seconds:',
				default: String(DO.DEFAULT_TTL),
			})
		);

		log.step('Creating record...');
		const record = await DO.createDnsRecord(domain, {
			type,
			name,
			data,
			ttl,
			priority,
			port,
			weight,
			flags,
			tag,
		});
		log.success(`Record created (ID: ${record.id})`);
	} catch (error) {
		log.error(`Failed to create record: ${error}`);
	}

	await input({ message: 'Press Enter to continue...' });
}

async function editRecord(domain: string): Promise<void> {
	log.header('Edit DNS Record');

	try {
		const records = await DO.listDnsRecords(domain);
		const editableRecords = records.filter((r) => r.type !== 'SOA' && r.type !== 'NS');

		if (editableRecords.length === 0) {
			log.warn('No editable records found');
			await input({ message: 'Press Enter to go back...' });
			return;
		}

		const recordId = await select({
			message: 'Select record to edit:',
			choices: [
				...editableRecords.map((r) => ({
					name: `${r.type} | ${r.name === '@' ? domain : r.name + '.' + domain} → ${r.data}`,
					value: r.id,
				})),
				{ name: '← Cancel', value: 0 },
			],
		});

		if (recordId === 0) return;

		const record = editableRecords.find((r) => r.id === recordId)!;

		console.log(chalk.dim('\nCurrent values:'));
		console.log(`  Type: ${record.type}`);
		console.log(`  Name: ${record.name}`);
		console.log(`  Data: ${record.data}`);
		console.log(`  TTL: ${record.ttl}`);
		console.log();

		const newName = await input({
			message: 'New name (leave empty to keep current):',
			default: '',
		});

		const newData = await input({
			message: 'New data/value (leave empty to keep current):',
			default: '',
		});

		const newTtl = await input({
			message: 'New TTL (leave empty to keep current):',
			default: '',
		});

		const updates: DO.UpdateDnsRecordOptions = {};
		if (newName) updates.name = newName;
		if (newData) updates.data = newData;
		if (newTtl) updates.ttl = parseInt(newTtl);

		if (Object.keys(updates).length === 0) {
			log.warn('No changes made');
			return;
		}

		log.step('Updating record...');
		await DO.updateDnsRecord(domain, recordId, updates);
		log.success('Record updated');
	} catch (error) {
		log.error(`Failed to edit record: ${error}`);
	}

	await input({ message: 'Press Enter to continue...' });
}

async function deleteRecord(domain: string): Promise<void> {
	log.header('Delete DNS Record');

	try {
		const records = await DO.listDnsRecords(domain);
		const deletableRecords = records.filter((r) => r.type !== 'SOA' && r.type !== 'NS');

		if (deletableRecords.length === 0) {
			log.warn('No deletable records found');
			await input({ message: 'Press Enter to go back...' });
			return;
		}

		const recordId = await select({
			message: 'Select record to delete:',
			choices: [
				...deletableRecords.map((r) => ({
					name: `${r.type} | ${r.name === '@' ? domain : r.name + '.' + domain} → ${r.data}`,
					value: r.id,
				})),
				{ name: '← Cancel', value: 0 },
			],
		});

		if (recordId === 0) return;

		const record = deletableRecords.find((r) => r.id === recordId)!;

		const confirmDelete = await confirm({
			message: chalk.red(`Delete ${record.type} record "${record.name}" → "${record.data}"?`),
			default: false,
		});

		if (!confirmDelete) {
			log.warn('Cancelled');
			return;
		}

		log.step('Deleting record...');
		await DO.deleteDnsRecord(domain, recordId);
		log.success('Record deleted');
	} catch (error) {
		log.error(`Failed to delete record: ${error}`);
	}

	await input({ message: 'Press Enter to continue...' });
}

async function quickAddRecord(domain: string): Promise<void> {
	log.header('Quick Add Record');

	try {
		const type = await select({
			message: 'Record type:',
			choices: [
				{ name: 'A - Point subdomain to IP', value: 'A' as const },
				{ name: 'CNAME - Alias to another domain', value: 'CNAME' as const },
			],
		});

		const name = await input({
			message: 'Subdomain (e.g., www, api, @):',
			default: '@',
		});

		let data: string;
		if (type === 'A') {
			// Offer to use existing droplet IPs
			const droplets = await DO.listDroplets();
			const activeDroplets = droplets.filter((d) => d.status === 'active');

			if (activeDroplets.length > 0) {
				const useDroplet = await confirm({
					message: 'Use IP from an existing droplet?',
					default: true,
				});

				if (useDroplet) {
					const dropletId = await select({
						message: 'Select droplet:',
						choices: activeDroplets.map((d) => ({
							name: `${d.name} (${DO.getPublicIP(d)})`,
							value: d.id,
						})),
					});
					data = DO.getPublicIP(activeDroplets.find((d) => d.id === dropletId)!)!;
				} else {
					data = await input({
						message: 'IPv4 Address:',
						validate: (v) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) || 'Invalid IP',
					});
				}
			} else {
				data = await input({
					message: 'IPv4 Address:',
					validate: (v) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) || 'Invalid IP',
				});
			}
		} else {
			data = await input({
				message: 'Target hostname:',
				validate: (v) => v.length > 0 || 'Required',
			});
			if (!data.endsWith('.')) data += '.';
		}

		log.step('Creating record...');
		const record = await DO.createDnsRecord(domain, {
			type,
			name,
			data,
			ttl: DO.DEFAULT_TTL,
		});

		log.success(`Created: ${name === '@' ? domain : name + '.' + domain} → ${data}`);
		log.info(`Record ID: ${record.id}`);
	} catch (error) {
		log.error(`Failed to create record: ${error}`);
	}

	await input({ message: 'Press Enter to continue...' });
}

// ============ Servers Menu ============

async function serversMenu(): Promise<void> {
	console.clear();
	log.header('🖥️  Servers');

	const choice = await select({
		message: 'Server Options:',
		choices: [
			{ name: '📋  List Registered Servers', value: 'list', description: 'View servers in database' },
			{ name: '📊  Server Status', value: 'status', description: 'Check server status and info' },
			{ name: '➕  Register Existing Server', value: 'register', description: 'Add existing server to database' },
			{ name: '🌐  Setup Gateway Server', value: 'gateway', description: 'Configure Caddy reverse proxy' },
			{ name: '🔨  Setup Build Server', value: 'build', description: 'Configure build server with Docker + Registry' },
			{ name: '🎯  Setup Target Server', value: 'target', description: 'Configure app server with Docker' },
			{ name: '🐳  Docker Containers', value: 'containers', description: 'View running containers' },
			{ name: chalk.dim('───  Legacy  ───'), value: '', disabled: true },
			{ name: '🆕  Setup Master Server (Coolify)', value: 'master' },
			{ name: '➕  Setup Adjacent Server (Coolify)', value: 'adjacent' },
			{ name: '←   Back', value: 'back' },
		],
	});

	switch (choice) {
		case 'list':
			await listRegisteredServers();
			break;
		case 'status':
			await showServerStatus();
			break;
		case 'register':
			await registerExistingServer();
			break;
		case 'gateway':
			await setupGatewayServer();
			break;
		case 'build':
			await setupBuildServer();
			break;
		case 'target':
			await setupTargetServer();
			break;
		case 'master':
			await runSetupMaster();
			break;
		case 'adjacent':
			await runSetupAdjacent();
			break;
		case 'containers':
			await showContainers();
			break;
		case 'back':
			return;
	}

	await serversMenu();
}

async function registerExistingServer(): Promise<void> {
	log.header('Register Existing Server');

	const sshHost = await input({
		message: 'SSH host (e.g., root@143.198.140.78 or hostname from ~/.ssh/config):',
		validate: (v) => v.length > 0 || 'Required',
	});

	log.step('Connecting to server...');
	if (!(await SSH.testConnection(sshHost))) {
		log.error('Cannot connect to server');
		await input({ message: 'Press Enter to go back...' });
		return;
	}
	log.success('Connected');

	// Get server info
	log.step('Getting server info...');
	const serverInfo = await SSH.getServerInfo(sshHost);

	// Get Tailscale IP
	const tsResult = await SSH.ssh(sshHost, 'tailscale ip -4 2>/dev/null');
	const tailscaleIp = tsResult.stdout.trim();

	if (!tailscaleIp) {
		log.error('Tailscale not configured on this server');
		log.info('Run "Setup Gateway/Build/Target Server" to configure Tailscale');
		await input({ message: 'Press Enter to go back...' });
		return;
	}

	// Get public IP
	const ipResult = await SSH.ssh(sshHost, 'curl -s ifconfig.me');
	const publicIp = ipResult.stdout.trim();

	console.log();
	console.log(chalk.bold('Server Info:'));
	console.log(`  Hostname:     ${serverInfo.hostname}`);
	console.log(`  Tailscale IP: ${tailscaleIp}`);
	console.log(`  Public IP:    ${publicIp}`);
	console.log(`  Docker:       ${serverInfo.docker ? chalk.green('Yes') : chalk.red('No')}`);
	console.log();

	// Check if already registered
	const existing = DB.getServerByTailscaleIp(tailscaleIp);
	if (existing) {
		log.warn(`Server already registered as "${existing.name}" [${existing.role}]`);
		const update = await confirm({
			message: 'Update existing registration?',
			default: true,
		});
		if (!update) return;
	}

	// Ask for role
	const role = await select({
		message: 'Server role:',
		choices: [
			{ name: 'Gateway (Caddy reverse proxy)', value: 'gateway' as const },
			{ name: 'Build (Docker Registry)', value: 'build' as const },
			{ name: 'Worker (App deployment)', value: 'worker' as const },
		],
	});

	const name = await input({
		message: 'Server name:',
		default: serverInfo.hostname || `${role}-server`,
	});

	// Register or update
	if (existing) {
		DB.updateServer(existing.id, { name, role, public_ip: publicIp });
		log.success(`Server updated: ${name} [${role}]`);
	} else {
		const server = DB.createServer({
			name,
			tailscale_ip: tailscaleIp,
			public_ip: publicIp,
			role,
		});
		log.success(`Server registered: ${server.name} [${role}]`);
	}

	// Show env hint
	console.log();
	if (role === 'gateway') {
		console.log(chalk.bold('Add to .env:'));
		console.log(chalk.cyan(`GATEWAY_SERVER_HOST=${tailscaleIp}`));
	} else if (role === 'build') {
		console.log(chalk.bold('Add to .env:'));
		console.log(chalk.cyan(`BUILD_SERVER_HOST=${tailscaleIp}`));
		console.log(chalk.cyan(`REGISTRY_URL=${tailscaleIp}:5000`));
	}

	await input({ message: '\nPress Enter to continue...' });
}

async function listRegisteredServers(): Promise<void> {
	const servers = DB.listServers();

	if (servers.length === 0) {
		log.warn('No servers registered yet');
		log.info('Use "Setup Gateway Server", "Setup Build Server" or "Setup Target Server" to add servers');
	} else {
		console.log('\n' + chalk.bold('Registered Servers:'));
		console.log(chalk.dim('─'.repeat(70)));

		for (const s of servers) {
			const roleColor =
				s.role === 'gateway'
					? chalk.cyan
					: s.role === 'build'
						? chalk.yellow
						: s.role === 'master'
							? chalk.blue
							: chalk.green;
			const statusIcon = s.status === 'active' ? chalk.green('●') : chalk.red('●');

			console.log(`  ${statusIcon} ${chalk.bold(s.name)} ${roleColor(`[${s.role}]`)}`);
			console.log(`    ${chalk.dim('Tailscale:')} ${s.tailscale_ip}`);
			if (s.public_ip) console.log(`    ${chalk.dim('Public IP:')} ${s.public_ip}`);
			if (s.tunnel_id) console.log(`    ${chalk.dim('Tunnel:')} ${s.tunnel_id}`);
			console.log();
		}
	}

	await input({ message: 'Press Enter to continue...' });
}

async function setupGatewayServer(): Promise<void> {
	log.header('Setup Gateway Server (Caddy)');

	// Setup logging
	const logFile = `logs/gateway-setup-${Date.now()}.log`;
	const logLines: string[] = [];
	const logToFile = (msg: string) => {
		const line = `[${new Date().toISOString()}] ${msg}`;
		logLines.push(line);
		console.log(chalk.dim(`  [LOG] ${msg}`));
	};
	const saveLog = async () => {
		await Bun.write(logFile, logLines.join('\n'));
		console.log(chalk.dim(`\n  Logs saved to: ${logFile}`));
	};

	logToFile('Starting gateway server setup');

	const method = await select({
		message: 'How do you want to setup the gateway server?',
		choices: [
			{ name: 'Create new droplet on Digital Ocean', value: 'create' },
			{ name: 'Use existing server (SSH host)', value: 'existing' },
		],
	});

	logToFile(`Method selected: ${method}`);

	let sshHost = '';
	let publicIP = '';

	if (method === 'create') {
		// Create droplet
		const name = await input({ message: 'Droplet name:', default: 'gateway-server' });
		const region = await select({
			message: 'Region:',
			choices: DO.RECOMMENDED_REGIONS.map((r) => ({ name: r.name, value: r.slug })),
		});
		const size = await select({
			message: 'Size:',
			choices: DO.RECOMMENDED_SIZES.map((s) => ({ name: `${s.name} - $${s.price}/mo`, value: s.slug })),
		});
		const sshKeys = await DO.listSSHKeys();
		const selectedKey = await select({
			message: 'SSH key:',
			choices: sshKeys.map((k) => ({ name: k.name, value: k.id.toString() })),
		});

		log.step('Creating droplet...');
		const droplet = await DO.createDroplet({
			name,
			region,
			size,
			image: 'ubuntu-24-04-x64',
			ssh_keys: [selectedKey],
			tags: ['gateway-server'],
		});

		log.success(`Droplet created: ${droplet.name}`);
		log.step('Waiting for IP...');

		for (let i = 0; i < 60; i++) {
			await new Promise((r) => setTimeout(r, 2000));
			const updated = await DO.getDroplet(droplet.id);
			publicIP = DO.getPublicIP(updated) || '';
			if (publicIP) break;
			process.stdout.write('.');
		}
		console.log();

		if (!publicIP) {
			log.error('Failed to get IP');
			return;
		}

		log.success(`IP: ${publicIP}`);
		log.step('Waiting for SSH...');

		sshHost = `root@${publicIP}`;
		for (let i = 0; i < 30; i++) {
			await new Promise((r) => setTimeout(r, 5000));
			if (await SSH.testConnection(sshHost)) break;
			process.stdout.write('.');
		}
		console.log();
	} else {
		sshHost = await input({
			message: 'SSH host (e.g., root@1.2.3.4):',
			validate: (v) => v.length > 0 || 'Required',
		});
	}

	// Test connection
	log.step('Testing SSH connection...');
	logToFile(`Testing SSH connection to: ${sshHost}`);
	if (!(await SSH.testConnection(sshHost))) {
		log.error('Cannot connect');
		logToFile('ERROR: SSH connection failed');
		await saveLog();
		await input({ message: 'Press Enter to go back...' });
		return;
	}
	log.success('Connected');
	logToFile('SSH connection successful');

	// Get public IP if not set
	if (!publicIP) {
		const ipResult = await SSH.ssh(sshHost, 'curl -s ifconfig.me');
		publicIP = ipResult.stdout.trim();
		logToFile(`Public IP obtained: ${publicIP}`);
	}

	// Update system
	log.step('Updating system...');
	logToFile('Updating system packages...');
	const updateResult = await SSH.ssh(sshHost, 'apt-get update -qq && apt-get upgrade -y -qq');
	logToFile(`System update exit code: ${updateResult.exitCode}`);

	// Docker
	log.step('Installing Docker...');
	const dockerCheck = await SSH.ssh(sshHost, 'docker --version');
	logToFile(`Docker check exit code: ${dockerCheck.exitCode}, stdout: ${dockerCheck.stdout}`);
	if (dockerCheck.exitCode !== 0) {
		logToFile('Installing Docker...');
		await SSH.ssh(sshHost, 'curl -fsSL https://get.docker.com | sh');
		await SSH.ssh(sshHost, 'systemctl enable docker && systemctl start docker');
	}
	log.success('Docker ready');

	// Tailscale
	log.step('Setting up Tailscale...');
	let tailscaleIp = '';
	const tsCheck = await SSH.ssh(sshHost, 'tailscale ip -4 2>/dev/null');
	logToFile(`Tailscale check exit code: ${tsCheck.exitCode}, stdout: "${tsCheck.stdout.trim()}"`);

	if (tsCheck.exitCode !== 0) {
		logToFile('Installing Tailscale...');
		await SSH.ssh(sshHost, 'curl -fsSL https://tailscale.com/install.sh | sh');
		const tsUp = await SSH.ssh(sshHost, 'tailscale up --timeout=10s 2>&1 || true');
		logToFile(`Tailscale up stdout: ${tsUp.stdout}`);
		if (tsUp.stdout.includes('https://')) {
			const urlMatch = tsUp.stdout.match(/(https:\/\/login\.tailscale\.com\/[^\s]+)/);
			if (urlMatch) {
				log.warn('Tailscale needs auth!');
				console.log(chalk.cyan(urlMatch[1]));
				logToFile(`Tailscale auth URL: ${urlMatch[1]}`);
				await input({ message: 'Press Enter after authenticating...' });
			}
		}
		const ipResult = await SSH.ssh(sshHost, 'tailscale ip -4');
		tailscaleIp = ipResult.stdout.trim();
		logToFile(`Tailscale IP after auth: "${tailscaleIp}"`);
	} else {
		tailscaleIp = tsCheck.stdout.trim();
		logToFile(`Tailscale already configured, IP: "${tailscaleIp}"`);
	}
	log.success(`Tailscale IP: ${tailscaleIp}`);

	// Install Caddy
	log.step('Installing Caddy...');
	const caddyCheck = await SSH.ssh(sshHost, 'caddy version');
	logToFile(`Caddy check exit code: ${caddyCheck.exitCode}`);
	if (caddyCheck.exitCode !== 0) {
		logToFile('Installing Caddy...');
		const caddyInstall = await SSH.ssh(
			sshHost,
			`apt-get install -y debian-keyring debian-archive-keyring apt-transport-https && \
			curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && \
			curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list && \
			apt-get update && \
			apt-get install -y caddy`
		);
		logToFile(`Caddy install exit code: ${caddyInstall.exitCode}`);
	}
	log.success('Caddy installed');

	// Create initial Caddyfile
	log.step('Configuring Caddy...');
	const initialCaddyfile = `# Managed by coolify-infra
{
	email admin@example.com
}

:80 {
	respond "Gateway ready. No routes configured." 200
}`;

	await SSH.ssh(sshHost, `mkdir -p /etc/caddy && echo '${initialCaddyfile}' > /etc/caddy/Caddyfile`);
	await SSH.ssh(sshHost, 'systemctl enable caddy && systemctl restart caddy');
	log.success('Caddy configured');
	logToFile('Caddy configured');

	// Configure iptables
	log.step('Configuring firewall...');
	await SSH.ssh(sshHost, 'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent');

	const rules = [
		'iptables -F INPUT',
		'iptables -P INPUT DROP',
		'iptables -P FORWARD DROP',
		'iptables -P OUTPUT ACCEPT',
		'iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
		'iptables -A INPUT -i lo -j ACCEPT',
		'iptables -A INPUT -p tcp --dport 22 -j ACCEPT',
		'iptables -A INPUT -p tcp --dport 80 -j ACCEPT',
		'iptables -A INPUT -p tcp --dport 443 -j ACCEPT',
		'iptables -A INPUT -i tailscale0 -j ACCEPT',
		'iptables -A INPUT -p icmp -j ACCEPT',
	];
	await SSH.ssh(sshHost, rules.join(' && '));
	await SSH.ssh(sshHost, 'netfilter-persistent save');
	log.success('Firewall configured');
	logToFile('Firewall configured');

	// Register in DB
	logToFile('=== DATABASE REGISTRATION ===');
	const serverInfo = await SSH.getServerInfo(sshHost);
	logToFile(`Server hostname: ${serverInfo.hostname}`);
	logToFile(`Tailscale IP for DB: "${tailscaleIp}"`);
	logToFile(`Public IP for DB: "${publicIP}"`);

	if (!tailscaleIp) {
		logToFile('ERROR: tailscaleIp is empty! Cannot register server.');
		log.error('Tailscale IP is empty - server NOT registered!');
	} else {
		const existing = DB.getServerByTailscaleIp(tailscaleIp);
		logToFile(`Existing server with this IP: ${existing ? existing.name : 'none'}`);

		if (!existing) {
			logToFile('Creating new server entry...');
			try {
				const newServer = DB.createServer({
					name: serverInfo.hostname || 'gateway-server',
					tailscale_ip: tailscaleIp,
					public_ip: publicIP || null,
					role: 'gateway',
				});
				logToFile(`Server created with ID: ${newServer.id}`);
				log.success('Server registered as gateway');
			} catch (err) {
				logToFile(`ERROR creating server: ${err}`);
				log.error(`Failed to register server: ${err}`);
			}
		} else {
			logToFile('Updating existing server...');
			DB.updateServer(existing.id, { role: 'gateway', public_ip: publicIP || null });
			log.info('Server updated to gateway role');
		}
	}

	// Verify registration
	const allServers = DB.listServers();
	logToFile(`Total servers in DB after registration: ${allServers.length}`);
	allServers.forEach(s => logToFile(`  - ${s.name} [${s.role}] ${s.tailscale_ip}`));

	// Save log
	await saveLog();

	// Summary
	console.log(chalk.bold.green('\n✓ Gateway Server Ready!\n'));
	console.log(`  Hostname: ${serverInfo.hostname}`);
	console.log(`  Public IP: ${publicIP}`);
	console.log(`  Tailscale IP: ${tailscaleIp}`);
	console.log(`  Caddy: Running`);
	console.log();
	console.log(chalk.bold('Ports Open:'));
	console.log('  - 22 (SSH)');
	console.log('  - 80 (HTTP)');
	console.log('  - 443 (HTTPS)');
	console.log('  - Tailscale (internal)');
	console.log();
	console.log(chalk.bold('Add to .env:'));
	console.log(chalk.cyan(`GATEWAY_SERVER_HOST=${tailscaleIp}`));
	console.log();
	console.log(chalk.bold('Next Steps:'));
	console.log(`  1. Point your domain DNS A records to: ${publicIP}`);
	console.log('  2. Add and deploy projects - Caddy will auto-configure HTTPS');

	await input({ message: '\nPress Enter to continue...' });
}

async function setupBuildServer(): Promise<void> {
	log.header('Setup Build Server');

	const method = await select({
		message: 'How do you want to setup the build server?',
		choices: [
			{ name: 'Create new droplet on Digital Ocean', value: 'create' },
			{ name: 'Use existing server (SSH host)', value: 'existing' },
		],
	});

	let sshHost = '';

	if (method === 'create') {
		// Create droplet
		const name = await input({ message: 'Droplet name:', default: 'build-server' });
		const region = await select({
			message: 'Region:',
			choices: DO.RECOMMENDED_REGIONS.map((r) => ({ name: r.name, value: r.slug })),
		});
		const size = await select({
			message: 'Size:',
			choices: DO.RECOMMENDED_SIZES.map((s) => ({ name: `${s.name} - $${s.price}/mo`, value: s.slug })),
		});
		const sshKeys = await DO.listSSHKeys();
		const selectedKey = await select({
			message: 'SSH key:',
			choices: sshKeys.map((k) => ({ name: k.name, value: k.id.toString() })),
		});

		log.step('Creating droplet...');
		const droplet = await DO.createDroplet({
			name,
			region,
			size,
			image: 'ubuntu-24-04-x64',
			ssh_keys: [selectedKey],
			tags: ['build-server'],
		});

		log.success(`Droplet created: ${droplet.name}`);
		log.step('Waiting for IP...');

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
			log.error('Failed to get IP');
			return;
		}

		log.success(`IP: ${publicIP}`);
		log.step('Waiting for SSH...');

		sshHost = `root@${publicIP}`;
		for (let i = 0; i < 30; i++) {
			await new Promise((r) => setTimeout(r, 5000));
			if (await SSH.testConnection(sshHost)) break;
			process.stdout.write('.');
		}
		console.log();
	} else {
		sshHost = await input({
			message: 'SSH host (e.g., root@1.2.3.4):',
			validate: (v) => v.length > 0 || 'Required',
		});
	}

	// Test connection
	log.step('Testing SSH connection...');
	if (!(await SSH.testConnection(sshHost))) {
		log.error('Cannot connect');
		await input({ message: 'Press Enter to go back...' });
		return;
	}
	log.success('Connected');

	// Update system
	log.step('Updating system...');
	await SSH.ssh(sshHost, 'apt-get update -qq && apt-get upgrade -y -qq');

	// Docker
	log.step('Installing Docker...');
	const dockerCheck = await SSH.ssh(sshHost, 'docker --version');
	if (dockerCheck.exitCode !== 0) {
		await SSH.ssh(sshHost, 'curl -fsSL https://get.docker.com | sh');
		await SSH.ssh(sshHost, 'systemctl enable docker && systemctl start docker');
	}
	log.success('Docker ready');

	// Git
	log.step('Installing Git...');
	await SSH.ssh(sshHost, 'apt-get install -y -qq git');

	// Build workspace
	log.step('Creating build workspace...');
	await SSH.ssh(sshHost, 'mkdir -p /opt/builds');

	// Registry
	log.step('Setting up Docker Registry...');
	const registryCheck = await SSH.ssh(sshHost, 'docker ps --format "{{.Names}}" | grep -q registry');
	if (registryCheck.exitCode !== 0) {
		await SSH.ssh(
			sshHost,
			'docker run -d --name registry --restart always -p 5000:5000 -v /opt/registry:/var/lib/registry registry:2'
		);
	}
	log.success('Registry running on port 5000');

	// GitHub deploy key
	log.step('Generating GitHub deploy key...');
	const keyResult = await GitHub.generateDeployKey(sshHost);
	log.success('Deploy key generated');

	// Tailscale
	log.step('Setting up Tailscale...');
	let tailscaleIp = '';
	const tsCheck = await SSH.ssh(sshHost, 'tailscale ip -4 2>/dev/null');
	if (tsCheck.exitCode !== 0) {
		await SSH.ssh(sshHost, 'curl -fsSL https://tailscale.com/install.sh | sh');
		const tsUp = await SSH.ssh(sshHost, 'tailscale up --timeout=10s 2>&1 || true');
		if (tsUp.stdout.includes('https://')) {
			const urlMatch = tsUp.stdout.match(/(https:\/\/login\.tailscale\.com\/[^\s]+)/);
			if (urlMatch) {
				log.warn('Tailscale needs auth!');
				console.log(chalk.cyan(urlMatch[1]));
				await input({ message: 'Press Enter after authenticating...' });
			}
		}
		const ipResult = await SSH.ssh(sshHost, 'tailscale ip -4');
		tailscaleIp = ipResult.stdout.trim();
	} else {
		tailscaleIp = tsCheck.stdout.trim();
	}
	log.success(`Tailscale IP: ${tailscaleIp}`);

	// Register in DB
	const serverInfo = await SSH.getServerInfo(sshHost);
	const existing = DB.getServerByTailscaleIp(tailscaleIp);
	if (!existing && tailscaleIp) {
		DB.createServer({
			name: serverInfo.hostname || 'build-server',
			tailscale_ip: tailscaleIp,
			public_ip: sshHost.includes('@') ? sshHost.split('@')[1] : null,
			role: 'build',
		});
	}

	// Summary
	console.log(chalk.bold.green('\n✓ Build Server Ready!\n'));
	console.log(chalk.bold('GitHub Deploy Key (add to your repos):'));
	console.log(chalk.dim('─'.repeat(60)));
	console.log(chalk.cyan(keyResult.publicKey));
	console.log(chalk.dim('─'.repeat(60)));
	console.log();
	console.log(chalk.bold('Add to .env:'));
	console.log(chalk.cyan(`BUILD_SERVER_HOST=${tailscaleIp}`));
	console.log(chalk.cyan(`REGISTRY_URL=${tailscaleIp}:5000`));

	await input({ message: '\nPress Enter to continue...' });
}

async function setupTargetServer(): Promise<void> {
	log.header('Setup Target Server');

	const method = await select({
		message: 'How do you want to setup the target server?',
		choices: [
			{ name: 'Create new droplet on Digital Ocean', value: 'create' },
			{ name: 'Use existing server (SSH host)', value: 'existing' },
		],
	});

	let sshHost = '';

	if (method === 'create') {
		const name = await input({ message: 'Droplet name:', default: 'app-server-1' });
		const region = await select({
			message: 'Region:',
			choices: DO.RECOMMENDED_REGIONS.map((r) => ({ name: r.name, value: r.slug })),
		});
		const size = await select({
			message: 'Size:',
			choices: DO.RECOMMENDED_SIZES.map((s) => ({ name: `${s.name} - $${s.price}/mo`, value: s.slug })),
		});
		const sshKeys = await DO.listSSHKeys();
		const selectedKey = await select({
			message: 'SSH key:',
			choices: sshKeys.map((k) => ({ name: k.name, value: k.id.toString() })),
		});

		log.step('Creating droplet...');
		const droplet = await DO.createDroplet({
			name,
			region,
			size,
			image: 'ubuntu-24-04-x64',
			ssh_keys: [selectedKey],
			tags: ['target-server'],
		});

		log.success(`Droplet created: ${droplet.name}`);
		log.step('Waiting for IP...');

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
			log.error('Failed to get IP');
			return;
		}

		log.success(`IP: ${publicIP}`);
		log.step('Waiting for SSH...');

		sshHost = `root@${publicIP}`;
		for (let i = 0; i < 30; i++) {
			await new Promise((r) => setTimeout(r, 5000));
			if (await SSH.testConnection(sshHost)) break;
			process.stdout.write('.');
		}
		console.log();
	} else {
		sshHost = await input({
			message: 'SSH host (e.g., root@1.2.3.4):',
			validate: (v) => v.length > 0 || 'Required',
		});
	}

	// Test connection
	log.step('Testing SSH connection...');
	if (!(await SSH.testConnection(sshHost))) {
		log.error('Cannot connect');
		await input({ message: 'Press Enter to go back...' });
		return;
	}
	log.success('Connected');

	// Update system
	log.step('Updating system...');
	await SSH.ssh(sshHost, 'apt-get update -qq && apt-get upgrade -y -qq');

	// Docker
	log.step('Installing Docker...');
	const dockerCheck = await SSH.ssh(sshHost, 'docker --version');
	if (dockerCheck.exitCode !== 0) {
		await SSH.ssh(sshHost, 'curl -fsSL https://get.docker.com | sh');
		await SSH.ssh(sshHost, 'systemctl enable docker && systemctl start docker');
	}
	log.success('Docker ready');

	// Configure Docker for registry
	if (process.env.REGISTRY_URL) {
		log.step('Configuring Docker for private registry...');
		const daemonJson = JSON.stringify({ 'insecure-registries': [process.env.REGISTRY_URL] }, null, 2);
		await SSH.ssh(sshHost, `mkdir -p /etc/docker && echo '${daemonJson}' > /etc/docker/daemon.json && systemctl restart docker`);
		log.success('Docker configured for registry');
	}

	// Tailscale
	log.step('Setting up Tailscale...');
	let tailscaleIp = '';
	const tsCheck = await SSH.ssh(sshHost, 'tailscale ip -4 2>/dev/null');
	if (tsCheck.exitCode !== 0) {
		await SSH.ssh(sshHost, 'curl -fsSL https://tailscale.com/install.sh | sh');
		const tsUp = await SSH.ssh(sshHost, 'tailscale up --timeout=10s 2>&1 || true');
		if (tsUp.stdout.includes('https://')) {
			const urlMatch = tsUp.stdout.match(/(https:\/\/login\.tailscale\.com\/[^\s]+)/);
			if (urlMatch) {
				log.warn('Tailscale needs auth!');
				console.log(chalk.cyan(urlMatch[1]));
				await input({ message: 'Press Enter after authenticating...' });
			}
		}
		const ipResult = await SSH.ssh(sshHost, 'tailscale ip -4');
		tailscaleIp = ipResult.stdout.trim();
	} else {
		tailscaleIp = tsCheck.stdout.trim();
	}
	log.success(`Tailscale IP: ${tailscaleIp}`);

	// cloudflared
	log.step('Installing cloudflared...');
	const cfCheck = await SSH.ssh(sshHost, 'cloudflared --version');
	if (cfCheck.exitCode !== 0) {
		await SSH.ssh(
			sshHost,
			'curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb && dpkg -i /tmp/cloudflared.deb'
		);
	}
	log.success('cloudflared installed');

	// Cloudflare Tunnel
	let tunnelId = '';
	if (CF.hasCloudflareConfig()) {
		const setupTunnel = await confirm({
			message: 'Setup Cloudflare Tunnel?',
			default: true,
		});

		if (setupTunnel) {
			const tunnels = await CF.listTunnels();
			const tunnelChoice = await select({
				message: 'Tunnel:',
				choices: [
					...tunnels.map((t) => ({ name: `Use: ${t.name}`, value: t.id })),
					{ name: 'Create new tunnel', value: 'new' },
				],
			});

			if (tunnelChoice === 'new') {
				const tunnelName = await input({ message: 'Tunnel name:', default: 'app-tunnel' });
				const { tunnel, token } = await CF.createTunnel(tunnelName);
				tunnelId = tunnel.id;
				await SSH.ssh(sshHost, `cloudflared service install ${token}`);
			} else {
				tunnelId = tunnelChoice;
				const token = await CF.getTunnelToken(tunnelId);
				await SSH.ssh(sshHost, `cloudflared service install ${token}`);
			}
			log.success('Tunnel configured');
		}
	}

	// iptables
	log.step('Configuring iptables...');
	await SSH.ssh(sshHost, 'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent');
	const iface = (await SSH.ssh(sshHost, "ip route | grep default | awk '{print $5}' | head -1")).stdout.trim() || 'eth0';

	const rules = [
		'iptables -F DOCKER-USER 2>/dev/null || true',
		'iptables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
		'iptables -A DOCKER-USER -i lo -j ACCEPT',
		'iptables -A DOCKER-USER -s 100.64.0.0/10 -j ACCEPT',
		'iptables -A DOCKER-USER -i br-+ -j ACCEPT',
		'iptables -A DOCKER-USER -p tcp -m conntrack --ctorigdstport 80 -j ACCEPT',
		'iptables -A DOCKER-USER -p tcp -m conntrack --ctorigdstport 443 -j ACCEPT',
		`iptables -A DOCKER-USER -i ${iface} -j DROP`,
		'iptables -A DOCKER-USER -j RETURN',
	];
	await SSH.ssh(sshHost, rules.join(' && '));
	await SSH.ssh(sshHost, 'netfilter-persistent save');
	log.success('iptables configured');

	// Register in DB
	const serverInfo = await SSH.getServerInfo(sshHost);
	const existing = DB.getServerByTailscaleIp(tailscaleIp);
	if (!existing && tailscaleIp) {
		DB.createServer({
			name: serverInfo.hostname || 'app-server',
			tailscale_ip: tailscaleIp,
			public_ip: sshHost.includes('@') ? sshHost.split('@')[1] : null,
			role: 'worker',
			tunnel_id: tunnelId || undefined,
		});
		log.success('Server registered in database');
	}

	// Summary
	console.log(chalk.bold.green('\n✓ Target Server Ready!\n'));
	console.log(`  Name: ${serverInfo.hostname}`);
	console.log(`  Tailscale IP: ${tailscaleIp}`);
	if (tunnelId) console.log(`  Tunnel: ${tunnelId}`);
	console.log();
	console.log(chalk.bold('Next:'));
	console.log('  Projects & Deploy → Add Project');

	await input({ message: '\nPress Enter to continue...' });
}

async function showServerStatus(): Promise<void> {
	const host = await input({
		message: 'SSH host (e.g., doserver):',
		default: 'doserver',
	});

	log.step(`Connecting to ${host}...`);

	try {
		const info = await SSH.getServerInfo(host);

		console.log('\n' + chalk.bold(`Server: ${info.hostname}`));
		console.log(chalk.dim('─'.repeat(50)));
		console.log(`  OS:        ${info.os}`);
		console.log(`  Kernel:    ${info.kernel}`);
		console.log(`  Uptime:    ${info.uptime}`);
		console.log(`  Memory:    ${info.memory.used} / ${info.memory.total} (${info.memory.free} free)`);
		console.log(`  Disk:      ${info.disk.used} / ${info.disk.total} (${info.disk.percent} used)`);
		console.log(`  Docker:    ${info.docker ? chalk.green('✓ Installed') : chalk.red('✗ Not installed')}`);
		console.log(
			`  Tailscale: ${info.tailscale.installed ? chalk.green('✓ ' + info.tailscale.ip) : chalk.red('✗ Not installed')}`
		);
		console.log(`  Coolify:   ${info.coolify ? chalk.green('✓ Running') : chalk.yellow('✗ Not running')}`);
	} catch (error) {
		log.error(`Failed to connect: ${error}`);
	}

	await input({ message: '\nPress Enter to continue...' });
}

async function showContainers(): Promise<void> {
	const host = await input({
		message: 'SSH host:',
		default: 'doserver',
	});

	log.step('Fetching containers...');

	try {
		const containers = await SSH.getDockerContainers(host);

		if (containers.length === 0) {
			log.warn('No containers running');
		} else {
			console.log('\n' + chalk.bold('Running Containers:'));
			console.log(chalk.dim('─'.repeat(80)));

			for (const c of containers) {
				const statusColor = c.status.includes('Up') ? chalk.green : chalk.yellow;
				console.log(`  ${statusColor('●')} ${chalk.bold(c.name)}`);
				console.log(`    ${chalk.dim('Image:')} ${c.image}`);
				console.log(`    ${chalk.dim('Status:')} ${c.status}`);
				if (c.ports) console.log(`    ${chalk.dim('Ports:')} ${c.ports}`);
				console.log();
			}
		}
	} catch (error) {
		log.error(`Failed to fetch containers: ${error}`);
	}

	await input({ message: 'Press Enter to continue...' });
}

async function runSetupMaster(): Promise<void> {
	log.info('Launching setup-coolify-master.ts...');
	const proc = Bun.spawn(['bun', 'setup-coolify-master.ts'], {
		stdout: 'inherit',
		stderr: 'inherit',
		stdin: 'inherit',
	});
	await proc.exited;
}

async function runSetupAdjacent(): Promise<void> {
	log.info('Launching setup-coolify-adjacent.ts...');
	const proc = Bun.spawn(['bun', 'setup-coolify-adjacent.ts'], {
		stdout: 'inherit',
		stderr: 'inherit',
		stdin: 'inherit',
	});
	await proc.exited;
}

// ============ Databases Menu ============

async function databasesMenu(): Promise<void> {
	console.clear();
	log.header('🗄️  Databases');

	const choice = await select({
		message: 'Database Options:',
		choices: [
			{ name: '➕  Provision Databases', value: 'provision', description: 'Create DB for services' },
			{ name: '📋  List Databases', value: 'list', description: 'Show existing databases' },
			{ name: '←   Back', value: 'back' },
		],
	});

	switch (choice) {
		case 'provision':
			await runSetupDatabases();
			break;
		case 'list':
			await listDatabases();
			break;
		case 'back':
			return;
	}

	await databasesMenu();
}

async function runSetupDatabases(): Promise<void> {
	log.info('Launching setup-databases.ts...');
	const proc = Bun.spawn(['bun', 'setup-databases.ts'], {
		stdout: 'inherit',
		stderr: 'inherit',
		stdin: 'inherit',
	});
	await proc.exited;
}

async function listDatabases(): Promise<void> {
	const host = await input({
		message: 'SSH host where Postgres is running:',
		default: 'doserver',
	});

	log.step('Looking for Postgres container...');

	try {
		const { stdout } = await SSH.ssh(
			host,
			'docker ps --format "{{.Names}}|{{.Image}}" | grep -i postgres | grep -v coolify-db | head -1'
		);

		if (!stdout) {
			log.warn('No Postgres container found');
			await input({ message: 'Press Enter to continue...' });
			return;
		}

		const containerName = stdout.split('|')[0];
		log.success(`Found: ${containerName}`);

		const { stdout: dbList } = await SSH.ssh(host, `docker exec ${containerName} psql -U postgres -c "\\\\l"`);

		console.log('\n' + chalk.bold('Databases:'));
		console.log(dbList);
	} catch (error) {
		log.error(`Failed to list databases: ${error}`);
	}

	await input({ message: '\nPress Enter to continue...' });
}

// ============ Services Menu ============

async function servicesMenu(): Promise<void> {
	console.clear();
	log.header('📦  Services');

	console.log(chalk.bold('Available Services:\n'));

	for (const [key, service] of Object.entries(SERVICES)) {
		const pg = service.needsPostgres ? chalk.blue('PG') : '';
		const redis = service.needsRedis ? chalk.red(`Redis:${service.redisDb}`) : '';
		const deps = [pg, redis].filter(Boolean).join(' ');

		console.log(`  ${chalk.bold(service.displayName)} ${chalk.dim(`(${key})`)}`);
		console.log(`    ${service.description}`);
		if (deps) console.log(`    ${chalk.dim('Needs:')} ${deps}`);
		console.log(`    ${chalk.dim('Ports:')} ${service.ports.join(', ')}`);
		console.log();
	}

	await input({ message: 'Press Enter to go back...' });
}

// ============ Cloudflare Menu ============

async function cloudflareMenu(): Promise<void> {
	console.clear();
	log.header('🌐  Cloudflare');

	if (!CF.hasCloudflareConfig()) {
		log.error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID not set');
		log.info('Add to your .env file:');
		log.info('  CLOUDFLARE_API_TOKEN=your_token');
		log.info('  CLOUDFLARE_ACCOUNT_ID=your_account_id');
		await input({ message: 'Press Enter to go back...' });
		return;
	}

	const choice = await select({
		message: 'Cloudflare Options:',
		choices: [
			{ name: '📋  List Zones (Domains)', value: 'zones' },
			{ name: '📝  DNS Records', value: 'dns' },
			{ name: '🚇  Tunnels', value: 'tunnels' },
			{ name: '←   Back', value: 'back' },
		],
	});

	switch (choice) {
		case 'zones':
			await listCfZones();
			break;
		case 'dns':
			await cfDnsMenu();
			break;
		case 'tunnels':
			await cfTunnelsMenu();
			break;
		case 'back':
			return;
	}

	await cloudflareMenu();
}

async function listCfZones(): Promise<void> {
	log.step('Fetching zones...');
	try {
		const zones = await CF.listZones();

		if (zones.length === 0) {
			log.warn('No zones found');
		} else {
			console.log('\n' + chalk.bold('Your Domains:'));
			console.log(chalk.dim('─'.repeat(60)));

			for (const z of zones) {
				const statusColor = z.status === 'active' ? chalk.green : chalk.yellow;
				console.log(`  ${statusColor('●')} ${chalk.bold(z.name)}`);
				console.log(`    ${chalk.dim('Status:')} ${z.status}`);
				console.log(`    ${chalk.dim('Nameservers:')} ${z.name_servers.join(', ')}`);
				console.log();
			}
		}
	} catch (error) {
		log.error(`Failed to list zones: ${error}`);
	}
	await input({ message: 'Press Enter to continue...' });
}

async function cfDnsMenu(): Promise<void> {
	try {
		const zones = await CF.listZones();

		if (zones.length === 0) {
			log.warn('No zones found');
			await input({ message: 'Press Enter to go back...' });
			return;
		}

		const zoneId = await select({
			message: 'Select domain:',
			choices: [
				...zones.map((z) => ({ name: z.name, value: z.id })),
				{ name: '← Cancel', value: '' },
			],
		});

		if (!zoneId) return;

		const zone = zones.find((z) => z.id === zoneId)!;

		const choice = await select({
			message: `DNS for ${zone.name}:`,
			choices: [
				{ name: '📋  List Records', value: 'list' },
				{ name: '➕  Add A Record', value: 'add-a' },
				{ name: '➕  Add CNAME Record', value: 'add-cname' },
				{ name: '🗑️  Delete Record', value: 'delete' },
				{ name: '←   Back', value: 'back' },
			],
		});

		switch (choice) {
			case 'list':
				await listCfDnsRecords(zoneId, zone.name);
				break;
			case 'add-a':
				await addCfARecord(zoneId, zone.name);
				break;
			case 'add-cname':
				await addCfCnameRecord(zoneId, zone.name);
				break;
			case 'delete':
				await deleteCfDnsRecord(zoneId, zone.name);
				break;
		}
	} catch (error) {
		log.error(`DNS operation failed: ${error}`);
		await input({ message: 'Press Enter to continue...' });
	}
}

async function listCfDnsRecords(zoneId: string, zoneName: string): Promise<void> {
	log.step('Fetching DNS records...');
	try {
		const records = await CF.listDnsRecords(zoneId);

		// Group by type
		const grouped: Record<string, typeof records> = {};
		for (const r of records) {
			if (!grouped[r.type]) grouped[r.type] = [];
			grouped[r.type].push(r);
		}

		console.log('\n' + chalk.bold(`DNS Records for ${zoneName}:`));
		console.log(chalk.dim('─'.repeat(80)));

		for (const type of Object.keys(grouped).sort()) {
			console.log(chalk.bold.cyan(`\n${type} Records:`));
			for (const r of grouped[type]) {
				const proxied = r.proxied ? chalk.yellow(' (proxied)') : '';
				console.log(`  ${chalk.bold(r.name)} → ${r.content}${proxied}`);
				console.log(`    ${chalk.dim(`TTL: ${r.ttl === 1 ? 'Auto' : r.ttl + 's'} | ID: ${r.id}`)}`);
			}
		}
		console.log();
	} catch (error) {
		log.error(`Failed to list records: ${error}`);
	}
	await input({ message: 'Press Enter to continue...' });
}

async function addCfARecord(zoneId: string, zoneName: string): Promise<void> {
	try {
		const name = await input({
			message: `Subdomain (or @ for ${zoneName}):`,
			default: '@',
		});

		const content = await input({
			message: 'IPv4 Address:',
			validate: (v) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) || 'Invalid IP',
		});

		const proxied = await confirm({
			message: 'Enable Cloudflare proxy (orange cloud)?',
			default: true,
		});

		log.step('Creating A record...');
		const record = await CF.createARecord(zoneId, name === '@' ? zoneName : name, content, proxied);
		log.success(`Created: ${record.name} → ${record.content}`);
	} catch (error) {
		log.error(`Failed to create record: ${error}`);
	}
	await input({ message: 'Press Enter to continue...' });
}

async function addCfCnameRecord(zoneId: string, zoneName: string): Promise<void> {
	try {
		const name = await input({
			message: 'Subdomain:',
			validate: (v) => v.length > 0 || 'Required',
		});

		const content = await input({
			message: 'Target hostname:',
			validate: (v) => v.length > 0 || 'Required',
		});

		const proxied = await confirm({
			message: 'Enable Cloudflare proxy (orange cloud)?',
			default: true,
		});

		log.step('Creating CNAME record...');
		const record = await CF.createCnameRecord(zoneId, name, content, proxied);
		log.success(`Created: ${record.name} → ${record.content}`);
	} catch (error) {
		log.error(`Failed to create record: ${error}`);
	}
	await input({ message: 'Press Enter to continue...' });
}

async function deleteCfDnsRecord(zoneId: string, zoneName: string): Promise<void> {
	try {
		const records = await CF.listDnsRecords(zoneId);
		const deletable = records.filter((r) => r.type !== 'NS' && r.type !== 'SOA');

		if (deletable.length === 0) {
			log.warn('No deletable records found');
			return;
		}

		const recordId = await select({
			message: 'Select record to delete:',
			choices: [
				...deletable.map((r) => ({
					name: `${r.type} | ${r.name} → ${r.content}`,
					value: r.id,
				})),
				{ name: '← Cancel', value: '' },
			],
		});

		if (!recordId) return;

		const confirmDelete = await confirm({
			message: chalk.red('Are you sure you want to delete this record?'),
			default: false,
		});

		if (!confirmDelete) return;

		log.step('Deleting record...');
		await CF.deleteDnsRecord(zoneId, recordId);
		log.success('Record deleted');
	} catch (error) {
		log.error(`Failed to delete record: ${error}`);
	}
	await input({ message: 'Press Enter to continue...' });
}

async function cfTunnelsMenu(): Promise<void> {
	const choice = await select({
		message: 'Tunnel Options:',
		choices: [
			{ name: '📋  List Tunnels', value: 'list' },
			{ name: '➕  Create Tunnel', value: 'create' },
			{ name: '🔗  View Routes', value: 'routes' },
			{ name: '➕  Add Route', value: 'add-route' },
			{ name: '🗑️  Delete Tunnel', value: 'delete' },
			{ name: '←   Back', value: 'back' },
		],
	});

	try {
		switch (choice) {
			case 'list':
				await listCfTunnels();
				break;
			case 'create':
				await createCfTunnel();
				break;
			case 'routes':
				await viewTunnelRoutes();
				break;
			case 'add-route':
				await addTunnelRoute();
				break;
			case 'delete':
				await deleteCfTunnel();
				break;
			case 'back':
				return;
		}
	} catch (error) {
		log.error(`Tunnel operation failed: ${error}`);
		await input({ message: 'Press Enter to continue...' });
	}

	await cfTunnelsMenu();
}

async function listCfTunnels(): Promise<void> {
	log.step('Fetching tunnels...');
	const tunnels = await CF.listTunnels();

	if (tunnels.length === 0) {
		log.warn('No tunnels found');
	} else {
		console.log('\n' + chalk.bold('Your Tunnels:'));
		console.log(chalk.dim('─'.repeat(60)));

		for (const t of tunnels) {
			const statusColor = t.status === 'healthy' ? chalk.green : chalk.yellow;
			const connections = t.connections.length;
			console.log(`  ${statusColor('●')} ${chalk.bold(t.name)}`);
			console.log(`    ${chalk.dim('ID:')} ${t.id}`);
			console.log(`    ${chalk.dim('Status:')} ${t.status}`);
			console.log(`    ${chalk.dim('Connections:')} ${connections}`);
			if (t.connections.length > 0) {
				const conn = t.connections[0];
				console.log(`    ${chalk.dim('Location:')} ${conn.colo_name}`);
			}
			console.log();
		}
	}
	await input({ message: 'Press Enter to continue...' });
}

async function createCfTunnel(): Promise<void> {
	const name = await input({
		message: 'Tunnel name:',
		validate: (v) => v.length > 0 || 'Required',
	});

	log.step('Creating tunnel...');
	const { tunnel, token } = await CF.createTunnel(name);

	log.success(`Tunnel created: ${tunnel.name}`);
	console.log();
	console.log(chalk.bold('Tunnel Token:'));
	console.log(chalk.cyan(token));
	console.log();
	console.log(chalk.bold('To connect a server, run:'));
	console.log(chalk.dim(`  cloudflared service install ${token}`));
	console.log();

	await input({ message: 'Press Enter to continue...' });
}

async function viewTunnelRoutes(): Promise<void> {
	const tunnels = await CF.listTunnels();

	if (tunnels.length === 0) {
		log.warn('No tunnels found');
		return;
	}

	const tunnelId = await select({
		message: 'Select tunnel:',
		choices: [
			...tunnels.map((t) => ({ name: `${t.name} (${t.status})`, value: t.id })),
			{ name: '← Cancel', value: '' },
		],
	});

	if (!tunnelId) return;

	log.step('Fetching tunnel config...');
	const config = await CF.getTunnelConfig(tunnelId);

	console.log('\n' + chalk.bold('Tunnel Routes:'));
	console.log(chalk.dim('─'.repeat(60)));

	for (const ingress of config.ingress) {
		if (ingress.hostname) {
			console.log(`  ${chalk.bold(ingress.hostname)} → ${chalk.cyan(ingress.service)}`);
		} else {
			console.log(`  ${chalk.dim('(catch-all)')} → ${ingress.service}`);
		}
	}
	console.log();

	await input({ message: 'Press Enter to continue...' });
}

async function addTunnelRoute(): Promise<void> {
	const tunnels = await CF.listTunnels();

	if (tunnels.length === 0) {
		log.warn('No tunnels found. Create a tunnel first.');
		return;
	}

	const tunnelId = await select({
		message: 'Select tunnel:',
		choices: tunnels.map((t) => ({ name: `${t.name} (${t.status})`, value: t.id })),
	});

	const hostname = await input({
		message: 'Hostname (e.g., app.example.com):',
		validate: (v) => v.includes('.') || 'Invalid hostname',
	});

	const service = await input({
		message: 'Service URL (e.g., http://localhost:3000):',
		default: 'http://localhost:3000',
	});

	log.step('Adding route...');
	await CF.addTunnelRoute(tunnelId, hostname, service);
	log.success(`Route added: ${hostname} → ${service}`);

	const createDns = await confirm({
		message: 'Create DNS CNAME record for this hostname?',
		default: true,
	});

	if (createDns) {
		const zones = await CF.listZones();
		// Find matching zone
		const matchingZone = zones.find((z) => hostname.endsWith(z.name));

		if (matchingZone) {
			const subdomain = hostname.replace(`.${matchingZone.name}`, '');
			await CF.createDnsRecord(matchingZone.id, {
				type: 'CNAME',
				name: subdomain,
				content: `${tunnelId}.cfargotunnel.com`,
				proxied: true,
			});
			log.success(`DNS record created: ${hostname} → tunnel`);
		} else {
			log.warn('No matching zone found for this hostname');
		}
	}

	await input({ message: 'Press Enter to continue...' });
}

async function deleteCfTunnel(): Promise<void> {
	const tunnels = await CF.listTunnels();

	if (tunnels.length === 0) {
		log.warn('No tunnels found');
		return;
	}

	const tunnelId = await select({
		message: 'Select tunnel to delete:',
		choices: [
			...tunnels.map((t) => ({ name: `${t.name} (${t.connections.length} connections)`, value: t.id })),
			{ name: '← Cancel', value: '' },
		],
	});

	if (!tunnelId) return;

	const tunnel = tunnels.find((t) => t.id === tunnelId)!;

	if (tunnel.connections.length > 0) {
		log.warn('This tunnel has active connections!');
	}

	const confirmDelete = await confirm({
		message: chalk.red(`Delete tunnel "${tunnel.name}"? This cannot be undone!`),
		default: false,
	});

	if (!confirmDelete) return;

	log.step('Deleting tunnel...');
	await CF.deleteTunnel(tunnelId);
	log.success('Tunnel deleted');

	await input({ message: 'Press Enter to continue...' });
}

// ============ Projects Menu ============

async function projectsMenu(): Promise<void> {
	console.clear();
	log.header('🚀  Projects & Deploy');

	const choice = await select({
		message: 'Project Options:',
		choices: [
			{ name: '📋  List Projects', value: 'list' },
			{ name: '➕  Add Project', value: 'add' },
			{ name: '🚀  Deploy / Update', value: 'deploy' },
			{ name: '📜  Deployment History', value: 'history' },
			{ name: '↩️   Rollback', value: 'rollback' },
			{ name: '🔧  Edit Project', value: 'edit' },
			{ name: '🗑️  Delete Project', value: 'delete' },
			{ name: '←   Back', value: 'back' },
		],
	});

	try {
		switch (choice) {
			case 'list':
				await listProjects();
				break;
			case 'add':
				await addProject();
				break;
			case 'deploy':
				await deployProject();
				break;
			case 'history':
				await viewDeploymentHistory();
				break;
			case 'rollback':
				await rollbackProject();
				break;
			case 'edit':
				await editProject();
				break;
			case 'delete':
				await deleteProject();
				break;
			case 'back':
				return;
		}
	} catch (error) {
		log.error(`Operation failed: ${error}`);
		await input({ message: 'Press Enter to continue...' });
	}

	await projectsMenu();
}

async function listProjects(): Promise<void> {
	const projects = DB.listProjects();

	if (projects.length === 0) {
		log.warn('No projects found. Add one with "Add Project"');
	} else {
		console.log('\n' + chalk.bold('Your Projects:'));
		console.log(chalk.dim('─'.repeat(80)));

		for (const p of projects) {
			const slotColor = p.current_slot === 'blue' ? chalk.blue : p.current_slot === 'green' ? chalk.green : chalk.gray;
			const slot = p.current_slot ? slotColor(`[${p.current_slot}]`) : chalk.gray('[not deployed]');
			const typeIcon = p.deploy_type === 'compose' ? '📦' : '🐳';

			console.log(`  ${typeIcon} ${chalk.bold(p.name)} ${slot}`);
			console.log(`    ${chalk.dim('Repo:')} ${p.repo_url} (${p.repo_branch})`);
			if (p.domain && !p.domain.startsWith('internal-')) {
				console.log(`    ${chalk.dim('Domain:')} ${p.domain}`);
			} else {
				console.log(`    ${chalk.dim('Access:')} ${chalk.yellow('Internal only (Tailscale)')}`);
			}
			console.log(`    ${chalk.dim('Server:')} ${p.target_server}`);
			if (p.current_image_tag) {
				console.log(`    ${chalk.dim('Image:')} ${p.current_image_tag}`);
			}
			console.log();
		}
	}
	await input({ message: 'Press Enter to continue...' });
}

async function addProject(): Promise<void> {
	log.header('Add New Project');

	let repoUrl = '';
	let repoBranch = 'main';
	let isPrivate = false;
	let suggestedName = '';

	// Check if GitHub token is available
	if (GitHub.hasGitHubToken()) {
		const repoSource = await select({
			message: 'How do you want to select the repository?',
			choices: [
				{ name: '📋  Select from GitHub', value: 'github' },
				{ name: '✏️   Enter URL manually', value: 'manual' },
			],
		});

		if (repoSource === 'github') {
			try {
				log.step('Loading GitHub repositories...');

				// Get user and orgs
				const user = await GitHub.getCurrentUser();
				const orgs = await GitHub.listOrganizations();

				// Ask which account
				const accountChoices = [
					{ name: `👤 ${user.login} (personal)`, value: user.login },
					...orgs.map((o) => ({ name: `🏢 ${o.login}`, value: o.login })),
				];

				const account = await select({
					message: 'Select account:',
					choices: accountChoices,
				});

				// Load repos for selected account
				log.step(`Loading repositories for ${account}...`);
				const repos =
					account === user.login
						? await GitHub.listUserRepos()
						: await GitHub.listOrgRepos(account);

				if (repos.length === 0) {
					log.warn('No repositories found');
					await input({ message: 'Press Enter to continue...' });
					return;
				}

				// Select repo
				const selectedRepo = await select({
					message: 'Select repository:',
					choices: repos.map((r) => ({
						name: `${r.private ? '🔒' : '🌐'} ${r.name} ${r.language ? chalk.dim(`(${r.language})`) : ''} ${r.description ? chalk.dim('- ' + r.description.substring(0, 40)) : ''}`,
						value: r,
					})),
				});

				repoUrl = selectedRepo.ssh_url;
				isPrivate = selectedRepo.private;
				suggestedName = selectedRepo.name;

				// Load branches
				log.step('Loading branches...');
				const parsed = GitHub.parseGitHubUrl(repoUrl);
				if (parsed) {
					const branches = await GitHub.listBranches(parsed.owner, parsed.repo);
					repoBranch = await select({
						message: 'Select branch:',
						choices: branches.map((b) => ({
							name: b.name + (b.name === selectedRepo.default_branch ? chalk.dim(' (default)') : ''),
							value: b.name,
						})),
					});
				}

				log.success(`Selected: ${selectedRepo.full_name} (${repoBranch})`);
			} catch (error) {
				log.error(`GitHub API error: ${error}`);
				log.info('Falling back to manual entry');
			}
		}
	}

	// Manual entry if not selected from GitHub
	if (!repoUrl) {
		repoUrl = await input({
			message: 'Git repository URL:',
			validate: (v) => v.includes('github.com') || v.includes('git@') || 'Invalid git URL',
		});

		repoBranch = await input({
			message: 'Branch:',
			default: 'main',
		});

		isPrivate = await confirm({
			message: 'Is this a private repository?',
			default: false,
		});
	}

	const name = await input({
		message: 'Project name:',
		default: suggestedName,
		validate: (v) => {
			if (!v) return 'Required';
			if (DB.getProjectByName(v)) return 'Project already exists';
			return true;
		},
	});

	// Deployment type
	const deployType = await select({
		message: 'Deployment type:',
		choices: [
			{ name: '🐳  Dockerfile - Build image from Dockerfile', value: 'dockerfile' },
			{ name: '📦  Docker Compose - Use docker-compose.yaml', value: 'compose' },
		],
	});

	let buildContext = '.';
	let dockerfile = 'Dockerfile';
	let buildScript: string | null = null;

	if (deployType === 'dockerfile') {
		buildContext = await input({
			message: 'Build context (directory with Dockerfile):',
			default: '.',
		});

		dockerfile = await input({
			message: 'Dockerfile name:',
			default: 'Dockerfile',
		});

		const hasBuildScript = await confirm({
			message: 'Run a build script before docker build?',
			default: false,
		});

		if (hasBuildScript) {
			buildScript = await input({
				message: 'Path to build script:',
				default: './build.sh',
			});
		}
	} else {
		// Docker Compose
		const composePath = await input({
			message: 'Path to docker-compose file:',
			default: 'docker-compose.yaml',
		});
		// Store compose path in dockerfile field for now
		dockerfile = composePath;
		buildContext = 'compose'; // Flag to indicate compose mode
	}

	// Get servers
	const servers = DB.listActiveServers('worker');
	if (servers.length === 0) {
		log.warn('No worker servers registered. Add one in Servers menu first.');
		await input({ message: 'Press Enter to go back...' });
		return;
	}

	const targetServer = await select({
		message: 'Target server for deployment:',
		choices: servers.map((s) => ({
			name: `${s.name} (${s.tailscale_ip})`,
			value: s.tailscale_ip,
		})),
	});

	// Domain - optional
	const hasPublicUrl = await confirm({
		message: 'Does this service need a public URL?',
		default: true,
	});

	let domain = '';
	let healthCheckPath = '/health';

	if (hasPublicUrl) {
		domain = await input({
			message: 'Domain (e.g., app.example.com):',
			validate: (v) => v.includes('.') || 'Invalid domain',
		});

		healthCheckPath = await input({
			message: 'Health check path:',
			default: '/health',
		});
	} else {
		// Internal service - generate internal identifier
		domain = `internal-${name}`;
		log.info(`Internal service - accessible via Tailscale only`);
	}

	const hasEnvVars = await confirm({
		message: 'Add environment variables?',
		default: false,
	});

	let envVars: Record<string, string> = {};
	if (hasEnvVars) {
		const envInput = await input({
			message: 'Environment variables (KEY=value, comma-separated):',
		});
		for (const pair of envInput.split(',')) {
			const [key, ...valueParts] = pair.trim().split('=');
			if (key && valueParts.length > 0) {
				envVars[key.trim()] = valueParts.join('=').trim();
			}
		}
	}

	const project = DB.createProject({
		name,
		repo_url: GitHub.toSSHUrl(repoUrl),
		repo_branch: repoBranch,
		is_private: isPrivate,
		deploy_type: deployType as 'dockerfile' | 'compose',
		build_context: buildContext,
		dockerfile,
		build_script: buildScript,
		target_server: targetServer,
		domain: domain || null,
		health_check_path: healthCheckPath,
		env_vars: envVars,
	});

	log.success(`Project "${project.name}" created!`);
	console.log();
	console.log(chalk.bold('Webhook Secret:'));
	console.log(chalk.cyan(project.webhook_secret));
	console.log();

	await input({ message: 'Press Enter to continue...' });
}

async function deployProject(): Promise<void> {
	const projects = DB.listProjects();

	if (projects.length === 0) {
		log.warn('No projects found');
		return;
	}

	// Check build server
	try {
		const buildStatus = await Build.checkBuildServer();
		if (!buildStatus.ready) {
			log.error('Build server not ready!');
			if (!buildStatus.docker) log.error('  - Docker not installed');
			if (!buildStatus.registry) log.error('  - Registry not running');
			if (!buildStatus.git) log.error('  - Git not installed');
			log.info('Run: bun scripts/setup-build-server.ts');
			await input({ message: 'Press Enter to go back...' });
			return;
		}
	} catch (error) {
		log.error(`Build server error: ${error}`);
		log.info('Make sure BUILD_SERVER_HOST is configured in .env');
		await input({ message: 'Press Enter to go back...' });
		return;
	}

	const projectId = await select({
		message: 'Select project to deploy:',
		choices: [
			...projects.map((p) => ({
				name: `${p.name} (${p.domain})`,
				value: p.id,
			})),
			{ name: '← Cancel', value: '' },
		],
	});

	if (!projectId) return;

	const project = DB.getProject(projectId)!;

	console.log();
	log.info(`Project: ${chalk.bold(project.name)}`);
	log.info(`Repository: ${project.repo_url} (${project.repo_branch})`);
	log.info(`Target: ${project.target_server}`);
	log.info(`Domain: ${project.domain}`);
	console.log();

	const proceed = await confirm({
		message: 'Start deployment?',
		default: true,
	});

	if (!proceed) return;

	console.log();
	console.log(chalk.bold('Starting deployment...\n'));

	const result = await Deploy.fullDeploy(project);

	console.log();
	if (result.success) {
		log.success('Deployment completed successfully!');
		log.info(`View at: https://${project.domain}`);
	} else {
		log.error(`Deployment failed: ${result.error}`);
	}

	await input({ message: 'Press Enter to continue...' });
}

async function viewDeploymentHistory(): Promise<void> {
	const projects = DB.listProjects();

	if (projects.length === 0) {
		log.warn('No projects found');
		return;
	}

	const projectId = await select({
		message: 'Select project:',
		choices: [
			...projects.map((p) => ({ name: p.name, value: p.id })),
			{ name: '← Cancel', value: '' },
		],
	});

	if (!projectId) return;

	const deployments = DB.listDeployments(projectId);

	if (deployments.length === 0) {
		log.warn('No deployments found for this project');
	} else {
		console.log('\n' + chalk.bold('Deployment History:'));
		console.log(chalk.dim('─'.repeat(80)));

		for (const d of deployments) {
			const stateColor =
				d.state === 'completed'
					? chalk.green
					: d.state === 'failed'
						? chalk.red
						: chalk.yellow;

			console.log(`  ${stateColor('●')} ${d.commit_sha.substring(0, 8)} - ${d.state}`);
			console.log(`    ${chalk.dim('Started:')} ${d.started_at}`);
			if (d.finished_at) console.log(`    ${chalk.dim('Finished:')} ${d.finished_at}`);
			if (d.error) console.log(`    ${chalk.red('Error:')} ${d.error}`);
			console.log();
		}
	}

	await input({ message: 'Press Enter to continue...' });
}

async function rollbackProject(): Promise<void> {
	const projects = DB.listProjects();

	if (projects.length === 0) {
		log.warn('No projects found');
		return;
	}

	const projectId = await select({
		message: 'Select project to rollback:',
		choices: [
			...projects.map((p) => ({ name: p.name, value: p.id })),
			{ name: '← Cancel', value: '' },
		],
	});

	if (!projectId) return;

	const project = DB.getProject(projectId)!;
	const deployments = DB.listDeployments(projectId).filter((d) => d.state === 'completed');

	if (deployments.length < 2) {
		log.warn('Need at least 2 successful deployments to rollback');
		await input({ message: 'Press Enter to go back...' });
		return;
	}

	const targetDeploymentId = await select({
		message: 'Rollback to which deployment?',
		choices: [
			...deployments.slice(1).map((d) => ({
				name: `${d.commit_sha.substring(0, 8)} - ${d.started_at}${d.commit_message ? ' - ' + d.commit_message : ''}`,
				value: d.id,
			})),
			{ name: '← Cancel', value: '' },
		],
	});

	if (!targetDeploymentId) return;

	const targetDeployment = DB.getDeployment(targetDeploymentId)!;

	const confirmRollback = await confirm({
		message: chalk.yellow(`Rollback to ${targetDeployment.commit_sha.substring(0, 8)}?`),
		default: false,
	});

	if (!confirmRollback) return;

	console.log();
	console.log(chalk.bold('Starting rollback...\n'));

	const result = await Deploy.rollback(project, targetDeployment);

	console.log();
	if (result.success) {
		log.success('Rollback completed successfully!');
	} else {
		log.error(`Rollback failed: ${result.error}`);
	}

	await input({ message: 'Press Enter to continue...' });
}

async function editProject(): Promise<void> {
	const projects = DB.listProjects();

	if (projects.length === 0) {
		log.warn('No projects found');
		return;
	}

	const projectId = await select({
		message: 'Select project to edit:',
		choices: [
			...projects.map((p) => ({ name: p.name, value: p.id })),
			{ name: '← Cancel', value: '' },
		],
	});

	if (!projectId) return;

	const project = DB.getProject(projectId)!;

	const field = await select({
		message: 'What to edit?',
		choices: [
			{ name: `Branch (${project.repo_branch})`, value: 'branch' },
			{ name: `Build context (${project.build_context})`, value: 'context' },
			{ name: `Health check (${project.health_check_path})`, value: 'health' },
			{ name: 'Environment variables', value: 'env' },
			{ name: '← Cancel', value: '' },
		],
	});

	if (!field) return;

	switch (field) {
		case 'branch': {
			const newBranch = await input({
				message: 'New branch:',
				default: project.repo_branch,
			});
			DB.updateProject(projectId, { repo_branch: newBranch });
			break;
		}
		case 'context': {
			const newContext = await input({
				message: 'New build context:',
				default: project.build_context,
			});
			DB.updateProject(projectId, { build_context: newContext });
			break;
		}
		case 'health': {
			const newPath = await input({
				message: 'New health check path:',
				default: project.health_check_path,
			});
			DB.updateProject(projectId, { health_check_path: newPath });
			break;
		}
		case 'env': {
			const currentEnv = Object.entries(project.env_vars)
				.map(([k, v]) => `${k}=${v}`)
				.join(', ');
			const newEnv = await input({
				message: 'Environment variables (KEY=value, comma-separated):',
				default: currentEnv,
			});
			const envVars: Record<string, string> = {};
			for (const pair of newEnv.split(',')) {
				const [key, ...valueParts] = pair.trim().split('=');
				if (key && valueParts.length > 0) {
					envVars[key.trim()] = valueParts.join('=').trim();
				}
			}
			DB.updateProject(projectId, { env_vars: envVars });
			break;
		}
	}

	log.success('Project updated!');
	await input({ message: 'Press Enter to continue...' });
}

async function deleteProject(): Promise<void> {
	const projects = DB.listProjects();

	if (projects.length === 0) {
		log.warn('No projects found');
		return;
	}

	const projectId = await select({
		message: 'Select project to delete:',
		choices: [
			...projects.map((p) => ({ name: p.name, value: p.id })),
			{ name: '← Cancel', value: '' },
		],
	});

	if (!projectId) return;

	const project = DB.getProject(projectId)!;

	const confirmDelete = await confirm({
		message: chalk.red(`Delete project "${project.name}"? This will remove all deployment history!`),
		default: false,
	});

	if (!confirmDelete) return;

	DB.deleteProject(projectId);
	log.success('Project deleted');

	await input({ message: 'Press Enter to continue...' });
}

// ============ Web Dashboard ============

async function startWebDashboard(): Promise<void> {
	log.info('Starting web dashboard on http://localhost:3456...');
	const proc = Bun.spawn(['bun', 'src/web/server.ts'], {
		stdout: 'inherit',
		stderr: 'inherit',
	});

	log.success('Web dashboard started!');
	log.info('Open http://localhost:3456 in your browser');
	log.info('Press Ctrl+C to stop the server and return to CLI');

	// Wait for the process to exit
	await proc.exited;
}

// ============ Main ============

async function main() {
	try {
		await mainMenu();
	} catch (error) {
		if ((error as any).name === 'ExitPromptError') {
			// User pressed Ctrl+C
			console.log(chalk.dim('\n\nGoodbye! 👋\n'));
			process.exit(0);
		}
		throw error;
	}
}

main();
