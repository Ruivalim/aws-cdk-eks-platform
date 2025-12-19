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
import * as SSH from './lib/ssh';
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
			{ name: '🖥️  Servers', value: 'servers', description: 'Setup and manage servers' },
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
		case 'servers':
			await serversMenu();
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
			{ name: '📊  Server Status', value: 'status', description: 'Check server status and info' },
			{ name: '🆕  Setup Master Server', value: 'master', description: 'Configure new Coolify master' },
			{ name: '➕  Setup Adjacent Server', value: 'adjacent', description: 'Add server to cluster' },
			{ name: '🐳  Docker Containers', value: 'containers', description: 'View running containers' },
			{ name: '←   Back', value: 'back' },
		],
	});

	switch (choice) {
		case 'status':
			await showServerStatus();
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
