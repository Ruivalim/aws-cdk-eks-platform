#!/usr/bin/env bun
/**
 * Coolify Infrastructure Web Dashboard
 *
 * Usage: bun src/web/server.ts
 * Open: http://localhost:3456
 */

import * as DO from '../lib/digitalocean';
import * as SSH from '../lib/ssh';
import { SERVICES } from '../lib/services';
import { homedir } from 'os';
import { join } from 'path';

const SSH_DIR = join(homedir(), '.ssh');
const SSH_CONFIG_PATH = join(SSH_DIR, 'config');

const PORT = 3456;

// Import HTML file
import indexHtml from './index.html';

Bun.serve({
	port: PORT,
	routes: {
		// Serve the main dashboard
		'/': indexHtml,

		// ============ API Routes ============

		// Health check
		'/api/health': () => Response.json({ status: 'ok', timestamp: new Date().toISOString() }),

		// ============ Digital Ocean ============

		'/api/do/account': {
			GET: async () => {
				try {
					const account = await DO.getAccount();
					return Response.json(account);
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		'/api/do/balance': {
			GET: async () => {
				try {
					const balance = await DO.getBalance();
					return Response.json(balance);
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		'/api/do/droplets': {
			GET: async () => {
				try {
					const droplets = await DO.listDroplets();
					return Response.json(droplets);
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
			POST: async (req) => {
				try {
					const body = await req.json();
					const droplet = await DO.createDroplet(body);
					return Response.json(droplet, { status: 201 });
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		'/api/do/droplets/:id': {
			GET: async (req) => {
				try {
					const droplet = await DO.getDroplet(Number(req.params.id));
					return Response.json(droplet);
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
			DELETE: async (req) => {
				try {
					await DO.deleteDroplet(Number(req.params.id));
					return Response.json({ success: true });
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		'/api/do/droplets/:id/reboot': {
			POST: async (req) => {
				try {
					await DO.rebootDroplet(Number(req.params.id));
					return Response.json({ success: true });
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		'/api/do/ssh-keys': {
			GET: async () => {
				try {
					const keys = await DO.listSSHKeys();
					return Response.json(keys);
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
			POST: async (req) => {
				try {
					const { name, public_key } = await req.json();
					const key = await DO.createSSHKey(name, public_key);
					return Response.json(key, { status: 201 });
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		'/api/do/regions': {
			GET: async () => {
				try {
					const regions = await DO.listRegions();
					return Response.json(regions);
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		'/api/do/sizes': {
			GET: async () => {
				try {
					const sizes = await DO.listSizes();
					return Response.json(sizes);
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		'/api/do/images': {
			GET: async () => {
				try {
					const images = await DO.listImages('distribution');
					return Response.json(images);
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		// ============ SSH / Servers ============

		'/api/servers/:host/status': {
			GET: async (req) => {
				try {
					const info = await SSH.getServerInfo(req.params.host);
					return Response.json(info);
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		'/api/servers/:host/containers': {
			GET: async (req) => {
				try {
					const containers = await SSH.getDockerContainers(req.params.host);
					return Response.json(containers);
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		'/api/servers/:host/test': {
			GET: async (req) => {
				try {
					const connected = await SSH.testConnection(req.params.host);
					return Response.json({ connected });
				} catch (error) {
					return Response.json({ connected: false, error: String(error) });
				}
			},
		},

		// ============ Services ============

		'/api/services': {
			GET: () => Response.json(SERVICES),
		},

		// ============ Config ============

		'/api/config': {
			GET: () =>
				Response.json({
					hasDoToken: !!(process.env.DIGITALOCEAN_TOKEN || process.env.DO_TOKEN),
					recommendedSizes: DO.RECOMMENDED_SIZES,
					recommendedRegions: DO.RECOMMENDED_REGIONS,
					recommendedImages: DO.RECOMMENDED_IMAGES,
				}),
		},

		// ============ Provisioning ============

		'/api/provision/:id/status': {
			GET: async (req) => {
				try {
					const droplet = await DO.getDroplet(Number(req.params.id));
					const publicIP = DO.getPublicIP(droplet);
					return Response.json({
						id: droplet.id,
						name: droplet.name,
						status: droplet.status,
						publicIP,
						ready: droplet.status === 'active' && !!publicIP,
					});
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		'/api/provision/:id/setup': {
			POST: async (req) => {
				try {
					const droplet = await DO.getDroplet(Number(req.params.id));
					const publicIP = DO.getPublicIP(droplet);
					if (!publicIP) {
						return Response.json({ error: 'Droplet does not have a public IP yet' }, { status: 400 });
					}

					const sshHost = `root@${publicIP}`;
					const masterTailscaleIp = '100.77.201.55';

					// Run setup commands step by step
					const steps: { name: string; command: string }[] = [
						{ name: 'Test SSH connection', command: 'echo "Connected"' },
						{ name: 'Update packages', command: 'apt-get update -qq' },
						{ name: 'Check Docker', command: 'docker --version || (curl -fsSL https://get.docker.com | sh)' },
						{
							name: 'Check Tailscale',
							command:
								'tailscale ip -4 2>/dev/null || (curl -fsSL https://tailscale.com/install.sh | sh && echo "NEEDS_AUTH")',
						},
					];

					const results: { step: string; success: boolean; output: string }[] = [];

					for (const step of steps) {
						try {
							const result = await SSH.ssh(sshHost, step.command);
							results.push({
								step: step.name,
								success: result.exitCode === 0,
								output: result.stdout || result.stderr,
							});
							if (result.exitCode !== 0) break;
						} catch (err) {
							results.push({
								step: step.name,
								success: false,
								output: String(err),
							});
							break;
						}
					}

					// Get Tailscale IP if available
					let tailscaleIp = '';
					try {
						const tsResult = await SSH.ssh(sshHost, 'tailscale ip -4 2>/dev/null');
						if (tsResult.exitCode === 0) {
							tailscaleIp = tsResult.stdout.trim();
						}
					} catch {}

					return Response.json({
						dropletId: droplet.id,
						publicIP,
						tailscaleIp,
						masterTailscaleIp,
						results,
						needsTailscaleAuth: results.some((r) => r.output.includes('NEEDS_AUTH')),
					});
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		// ============ Databases ============

		'/api/databases': {
			GET: async () => {
				try {
					const urls = process.env.POSTGRES_URLS?.split(',') || [];
					if (urls.length === 0) {
						return Response.json({ error: 'POSTGRES_URLS not configured in .env' }, { status: 500 });
					}

					const results = [];

					for (const url of urls) {
						try {
							const sql = new Bun.sql(url.trim());

							// Get databases
							const databases = await sql`
								SELECT datname as name,
									   pg_size_pretty(pg_database_size(datname)) as size,
									   datcollate as collation
								FROM pg_database
								WHERE datistemplate = false
								ORDER BY datname
							`;

							// Get users/roles
							const users = await sql`
								SELECT rolname as name,
									   rolsuper as is_superuser,
									   rolcreatedb as can_create_db,
									   rolcreaterole as can_create_role
								FROM pg_roles
								WHERE rolname NOT LIKE 'pg_%'
								ORDER BY rolname
							`;

							// Parse connection info from URL
							const urlObj = new URL(url.trim());

							results.push({
								host: urlObj.hostname,
								port: urlObj.port || '5432',
								user: urlObj.username,
								databases: databases,
								users: users,
							});

							sql.close();
						} catch (err) {
							results.push({
								host: url.split('@')[1]?.split('/')[0] || url,
								error: String(err),
							});
						}
					}

					return Response.json(results);
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		'/api/databases/create': {
			POST: async (req) => {
				try {
					const { dbName, userName, password, postgresUrl } = await req.json();

					if (!dbName) {
						return Response.json({ error: 'dbName is required' }, { status: 400 });
					}

					const url = postgresUrl || process.env.POSTGRES_URLS?.split(',')[0];
					if (!url) {
						return Response.json({ error: 'No Postgres URL available' }, { status: 500 });
					}

					const sql = new Bun.sql(url.trim());

					// Create database
					await sql.unsafe(`CREATE DATABASE "${dbName}"`);

					// Create user if provided
					if (userName && password) {
						await sql.unsafe(`CREATE USER "${userName}" WITH PASSWORD '${password}'`);
						await sql.unsafe(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${userName}"`);

						// Connect to new database to grant schema permissions
						const urlObj = new URL(url.trim());
						urlObj.pathname = `/${dbName}`;
						const dbSql = new Bun.sql(urlObj.toString());
						await dbSql.unsafe(`GRANT ALL ON SCHEMA public TO "${userName}"`);
						dbSql.close();
					}

					sql.close();

					// Build connection strings
					const urlObj = new URL(url.trim());
					const host = urlObj.hostname;
					const port = urlObj.port || '5432';
					const finalUser = userName || urlObj.username;
					const finalPass = password || urlObj.password;

					return Response.json({
						success: true,
						database: dbName,
						user: userName || null,
						connectionStrings: {
							standard: `postgresql://${finalUser}:${finalPass}@${host}:${port}/${dbName}`,
							jdbc: `jdbc:postgresql://${host}:${port}/${dbName}?user=${finalUser}&password=${finalPass}`,
							dotenv: `DATABASE_URL=postgresql://${finalUser}:${finalPass}@${host}:${port}/${dbName}`,
						},
					});
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		'/api/databases/drop': {
			POST: async (req) => {
				try {
					const { dbName, postgresUrl } = await req.json();

					if (!dbName) {
						return Response.json({ error: 'dbName is required' }, { status: 400 });
					}

					if (['postgres', 'template0', 'template1'].includes(dbName)) {
						return Response.json({ error: 'Cannot drop system database' }, { status: 400 });
					}

					const url = postgresUrl || process.env.POSTGRES_URLS?.split(',')[0];
					if (!url) {
						return Response.json({ error: 'No Postgres URL available' }, { status: 500 });
					}

					const sql = new Bun.sql(url.trim());

					// Terminate connections to the database
					await sql.unsafe(`
						SELECT pg_terminate_backend(pg_stat_activity.pid)
						FROM pg_stat_activity
						WHERE pg_stat_activity.datname = '${dbName}'
						AND pid <> pg_backend_pid()
					`);

					// Drop database
					await sql.unsafe(`DROP DATABASE "${dbName}"`);

					sql.close();

					return Response.json({ success: true, dropped: dbName });
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		// ============ Tailscale ============

		'/api/tailscale/status': {
			GET: async () => {
				try {
					// Find tailscale binary (different locations on macOS vs Linux)
					const tailscalePaths = [
						'tailscale', // Linux / in PATH
						'/Applications/Tailscale.app/Contents/MacOS/Tailscale', // macOS app
						'/usr/local/bin/tailscale',
						'/opt/homebrew/bin/tailscale',
					];

					let stdout = '';
					let success = false;

					for (const tsPath of tailscalePaths) {
						try {
							const proc = Bun.spawn([tsPath, 'status', '--json'], {
								stdout: 'pipe',
								stderr: 'pipe',
							});
							stdout = await new Response(proc.stdout).text();
							const exitCode = await proc.exited;
							if (exitCode === 0) {
								success = true;
								break;
							}
						} catch {
							continue;
						}
					}

					if (!success) {
						return Response.json({ error: 'Tailscale not running or not installed' }, { status: 500 });
					}

					const status = JSON.parse(stdout);

					// Parse into friendly format
					const self = status.Self;
					const peers = Object.values(status.Peer || {}) as any[];

					return Response.json({
						self: {
							name: self.HostName,
							dnsName: self.DNSName?.replace(/\.$/, '') || '',
							tailscaleIP: self.TailscaleIPs?.[0] || '',
							os: self.OS,
							online: self.Online,
							active: self.Active,
						},
						peers: peers.map((p: any) => ({
							name: p.HostName,
							dnsName: p.DNSName?.replace(/\.$/, '') || '',
							tailscaleIP: p.TailscaleIPs?.[0] || '',
							os: p.OS,
							online: p.Online,
							active: p.Active,
							lastSeen: p.LastSeen,
							exitNode: p.ExitNode || false,
						})),
						tailnetName: self.DNSName?.split('.').slice(1, -2).join('.') || '',
					});
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		'/api/tailscale/status/:host': {
			GET: async (req) => {
				try {
					const host = req.params.host;
					const result = await SSH.ssh(host, 'tailscale status --json');

					if (result.exitCode !== 0) {
						return Response.json({ error: 'Failed to get Tailscale status' }, { status: 500 });
					}

					const status = JSON.parse(result.stdout);
					const self = status.Self;

					return Response.json({
						name: self.HostName,
						dnsName: self.DNSName?.replace(/\.$/, '') || '',
						tailscaleIP: self.TailscaleIPs?.[0] || '',
						os: self.OS,
						online: self.Online,
					});
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		// ============ Local SSH Management ============

		'/api/local/ssh-keys': {
			GET: async () => {
				try {
					const glob = new Bun.Glob('*.pub');
					const keys: { name: string; path: string; content: string }[] = [];

					for await (const file of glob.scan(SSH_DIR)) {
						const path = join(SSH_DIR, file);
						const content = await Bun.file(path).text();
						keys.push({
							name: file.replace('.pub', ''),
							path,
							content: content.trim(),
						});
					}

					return Response.json(keys);
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		'/api/local/ssh-config': {
			GET: async () => {
				try {
					const file = Bun.file(SSH_CONFIG_PATH);
					const exists = await file.exists();
					if (!exists) {
						return Response.json({ hosts: [], raw: '' });
					}

					const content = await file.text();
					interface SSHHost {
						name: string;
						hostname: string;
						user: string;
						port: string;
						identityFile: string;
						identitiesOnly: boolean;
						addKeysToAgent: boolean;
						useKeychain: boolean;
						isWildcard: boolean;
						comment: string;
						raw: string[];
					}

					const hosts: SSHHost[] = [];
					let currentHost: SSHHost | null = null;

					for (const line of content.split('\n')) {
						const trimmed = line.trim();

						// Skip comments at top level
						if (!currentHost && trimmed.startsWith('#')) continue;

						if (trimmed.toLowerCase().startsWith('host ')) {
							if (currentHost) hosts.push(currentHost);
							const hostName = trimmed.slice(5).trim();
							currentHost = {
								name: hostName,
								hostname: '',
								user: '',
								port: '',
								identityFile: '',
								identitiesOnly: false,
								addKeysToAgent: false,
								useKeychain: false,
								isWildcard: hostName.includes('*'),
								comment: '',
								raw: [line],
							};
						} else if (currentHost) {
							currentHost.raw.push(line);
							const lower = trimmed.toLowerCase();

							// Parse comment
							if (trimmed.startsWith('#')) {
								if (!currentHost.comment) currentHost.comment = trimmed.slice(1).trim();
							}
							// Parse fields
							else if (lower.startsWith('hostname ')) currentHost.hostname = trimmed.slice(9).trim();
							else if (lower.startsWith('user ')) currentHost.user = trimmed.slice(5).trim();
							else if (lower.startsWith('port ')) currentHost.port = trimmed.slice(5).trim();
							else if (lower.startsWith('identityfile ')) currentHost.identityFile = trimmed.slice(13).trim();
							else if (lower.startsWith('identitiesonly ')) currentHost.identitiesOnly = lower.includes('yes');
							else if (lower.startsWith('addkeystoagent ')) currentHost.addKeysToAgent = lower.includes('yes');
							else if (lower.startsWith('usekeychain ')) currentHost.useKeychain = lower.includes('yes');
						}
					}
					if (currentHost) hosts.push(currentHost);

					return Response.json({ hosts, raw: content });
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
			POST: async (req) => {
				try {
					const body = await req.json();
					const {
						name,
						hostname,
						user = 'root',
						port = '',
						identityFile = '',
						identitiesOnly = false,
					} = body;

					if (!name) {
						return Response.json({ error: 'name is required' }, { status: 400 });
					}

					const file = Bun.file(SSH_CONFIG_PATH);
					let content = (await file.exists()) ? await file.text() : '';

					// Check if host already exists
					const regex = new RegExp(`^Host\\s+${name}\\s*$`, 'im');
					if (regex.test(content)) {
						return Response.json({ error: `Host "${name}" already exists` }, { status: 400 });
					}

					// Build new entry
					let newEntry = `\nHost ${name}\n`;
					if (hostname) newEntry += `  HostName ${hostname}\n`;
					if (user) newEntry += `  User ${user}\n`;
					if (port && port !== '22') newEntry += `  Port ${port}\n`;
					if (identityFile) newEntry += `  IdentityFile ${identityFile}\n`;
					if (identitiesOnly) newEntry += `  IdentitiesOnly yes\n`;

					content = content.trimEnd() + '\n' + newEntry;
					await Bun.write(SSH_CONFIG_PATH, content);

					return Response.json({ success: true, message: `Added host "${name}"` });
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
			PUT: async (req) => {
				try {
					const { raw } = await req.json();
					if (typeof raw !== 'string') {
						return Response.json({ error: 'raw content is required' }, { status: 400 });
					}
					await Bun.write(SSH_CONFIG_PATH, raw);
					return Response.json({ success: true });
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		'/api/local/ssh-config/:name': {
			DELETE: async (req) => {
				try {
					const name = req.params.name;
					const file = Bun.file(SSH_CONFIG_PATH);
					if (!(await file.exists())) {
						return Response.json({ error: 'SSH config not found' }, { status: 404 });
					}

					const content = await file.text();
					const lines = content.split('\n');
					const newLines: string[] = [];
					let skip = false;

					for (const line of lines) {
						const trimmed = line.trim().toLowerCase();
						if (trimmed.startsWith('host ')) {
							skip = trimmed === `host ${name.toLowerCase()}`;
						}
						if (!skip) newLines.push(line);
					}

					await Bun.write(SSH_CONFIG_PATH, newLines.join('\n'));
					return Response.json({ success: true });
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},

		// ============ Full Setup with SSE ============

		'/api/provision/full-setup-stream': {
			POST: async (req) => {
				const { sshHost } = await req.json();
				if (!sshHost) {
					return Response.json({ error: 'sshHost is required' }, { status: 400 });
				}

				const masterTailscaleIp = '100.77.201.55';

				const stream = new ReadableStream({
					async start(controller) {
						const send = (data: object) => {
							controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
						};

						const runStep = async (name: string, command: string) => {
							send({ type: 'step', step: name, status: 'running' });
							try {
								const result = await SSH.ssh(sshHost, command);
								const success = result.exitCode === 0;
								send({
									type: 'step',
									step: name,
									status: success ? 'done' : 'error',
									output: (result.stdout || result.stderr).slice(0, 500),
								});
								return { success, stdout: result.stdout, stderr: result.stderr };
							} catch (err) {
								send({ type: 'step', step: name, status: 'error', output: String(err) });
								return { success: false, stdout: '', stderr: String(err) };
							}
						};

						// Run setup steps
						const sshTest = await runStep('Test SSH connection', 'echo "OK"');
						if (!sshTest.success) {
							send({ type: 'done', success: false, error: 'SSH connection failed' });
							controller.close();
							return;
						}

						// Docker
						const dockerCheck = await SSH.ssh(sshHost, 'docker --version');
						if (dockerCheck.exitCode !== 0) {
							await runStep('Install Docker', 'curl -fsSL https://get.docker.com | sh');
							await runStep('Start Docker', 'systemctl enable docker && systemctl start docker');
						} else {
							send({ type: 'step', step: 'Docker already installed', status: 'skipped', output: dockerCheck.stdout });
						}

						// Tailscale
						const tsCheck = await SSH.ssh(sshHost, 'tailscale ip -4 2>/dev/null');
						let tailscaleIp = '';
						let needsAuth = false;

						if (tsCheck.exitCode !== 0) {
							await runStep('Install Tailscale', 'curl -fsSL https://tailscale.com/install.sh | sh');
							const tsUp = await SSH.ssh(sshHost, 'tailscale up --timeout=5s 2>&1 || true');
							if (tsUp.stdout.includes('https://')) {
								needsAuth = true;
								const urlMatch = tsUp.stdout.match(/(https:\/\/login\.tailscale\.com\/[^\s]+)/);
								send({ type: 'auth', url: urlMatch ? urlMatch[1] : 'Check tailscale up' });
							}
						} else {
							tailscaleIp = tsCheck.stdout.trim();
							send({ type: 'step', step: 'Tailscale configured', status: 'skipped', output: tailscaleIp });
						}

						// iptables-persistent
						await runStep('Install iptables-persistent', 'DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent');

						// Get interface
						const ifaceResult = await SSH.ssh(sshHost, "ip route | grep default | awk '{print $5}' | head -1");
						const iface = ifaceResult.stdout.trim() || 'eth0';
						send({ type: 'step', step: 'Detect interface', status: 'done', output: iface });

						// Docker daemon
						const daemonJson = JSON.stringify({ 'userland-proxy': false, 'log-driver': 'json-file', 'log-opts': { 'max-size': '10m', 'max-file': '3' } }, null, 2);
						await runStep('Configure Docker daemon', `echo '${daemonJson.replace(/'/g, "'\\''")}' > /etc/docker/daemon.json`);

						// iptables
						const ipt = [
							'iptables -F DOCKER-USER 2>/dev/null || true',
							'iptables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
							'iptables -A DOCKER-USER -i lo -j ACCEPT',
							'iptables -A DOCKER-USER -s 100.64.0.0/10 -j ACCEPT',
							'iptables -A DOCKER-USER -i br-+ -j ACCEPT',
							'iptables -A DOCKER-USER -p tcp -m conntrack --ctorigdstport 80 -j ACCEPT',
							'iptables -A DOCKER-USER -p tcp -m conntrack --ctorigdstport 443 -j ACCEPT',
							'iptables -A DOCKER-USER -p udp -m conntrack --ctorigdstport 443 -j ACCEPT',
							`iptables -A DOCKER-USER -i ${iface} -j DROP`,
							'iptables -A DOCKER-USER -j RETURN',
						];
						await runStep('Configure iptables', ipt.join(' && '));

						const ip6t = [
							'ip6tables -F DOCKER-USER 2>/dev/null || true',
							'ip6tables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
							'ip6tables -A DOCKER-USER -i lo -j ACCEPT',
							'ip6tables -A DOCKER-USER -s fd7a:115c:a1e0::/48 -j ACCEPT',
							'ip6tables -A DOCKER-USER -i br-+ -j ACCEPT',
							'ip6tables -A DOCKER-USER -p tcp --dport 80 -j ACCEPT',
							'ip6tables -A DOCKER-USER -p tcp --dport 443 -j ACCEPT',
							'ip6tables -A DOCKER-USER -p udp --dport 443 -j ACCEPT',
							`ip6tables -A DOCKER-USER -i ${iface} -j DROP`,
							'ip6tables -A DOCKER-USER -j RETURN',
						];
						await runStep('Configure ip6tables', ip6t.join(' && '));

						await runStep('Save iptables', 'netfilter-persistent save');
						await runStep('Create restore script', `echo '#!/bin/bash\niptables -F DOCKER-USER\niptables -A DOCKER-USER -j RETURN\nip6tables -F DOCKER-USER\nip6tables -A DOCKER-USER -j RETURN' > /root/restore-iptables.sh && chmod +x /root/restore-iptables.sh`);
						await runStep('Restart Docker', 'systemctl restart docker');

						// Get final Tailscale IP
						if (!tailscaleIp && !needsAuth) {
							const final = await SSH.ssh(sshHost, 'tailscale ip -4 2>/dev/null');
							if (final.exitCode === 0) tailscaleIp = final.stdout.trim();
						}

						send({
							type: 'done',
							success: true,
							tailscaleIp,
							masterTailscaleIp,
							needsAuth,
						});
						controller.close();
					},
				});

				return new Response(stream, {
					headers: {
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-cache',
						Connection: 'keep-alive',
					},
				});
			},
		},

		'/api/provision/full-setup': {
			POST: async (req) => {
				try {
					const { sshHost } = await req.json();
					if (!sshHost) {
						return Response.json({ error: 'sshHost is required (e.g., root@1.2.3.4)' }, { status: 400 });
					}

					const masterTailscaleIp = '100.77.201.55';
					const results: { step: string; success: boolean; output: string; skipped?: boolean }[] = [];

					const runStep = async (name: string, command: string, allowFail = false) => {
						try {
							const result = await SSH.ssh(sshHost, command);
							const success = result.exitCode === 0;
							results.push({
								step: name,
								success: success || allowFail,
								output: (result.stdout || result.stderr).slice(0, 500),
							});
							return { success, stdout: result.stdout, stderr: result.stderr };
						} catch (err) {
							results.push({ step: name, success: allowFail, output: String(err).slice(0, 500) });
							return { success: false, stdout: '', stderr: String(err) };
						}
					};

					// 1. Test SSH
					const sshTest = await runStep('Test SSH connection', 'echo "OK"');
					if (!sshTest.success) {
						return Response.json({ success: false, results, error: 'SSH connection failed' });
					}

					// 2. Check/Install Docker
					const dockerCheck = await SSH.ssh(sshHost, 'docker --version');
					if (dockerCheck.exitCode !== 0) {
						await runStep('Install Docker', 'curl -fsSL https://get.docker.com | sh');
						await runStep('Start Docker', 'systemctl enable docker && systemctl start docker');
					} else {
						results.push({ step: 'Docker already installed', success: true, output: dockerCheck.stdout, skipped: true });
					}

					// 3. Check/Install Tailscale
					const tsCheck = await SSH.ssh(sshHost, 'tailscale ip -4 2>/dev/null');
					let tailscaleIp = '';
					let needsTailscaleAuth = false;

					if (tsCheck.exitCode !== 0) {
						await runStep('Install Tailscale', 'curl -fsSL https://tailscale.com/install.sh | sh');
						const tsUp = await SSH.ssh(sshHost, 'tailscale up --timeout=5s 2>&1 || true');
						if (tsUp.stdout.includes('https://')) {
							needsTailscaleAuth = true;
							const urlMatch = tsUp.stdout.match(/(https:\/\/login\.tailscale\.com\/[^\s]+)/);
							results.push({
								step: 'Tailscale needs auth',
								success: true,
								output: urlMatch ? urlMatch[1] : 'Check tailscale up output',
							});
						}
					} else {
						tailscaleIp = tsCheck.stdout.trim();
						results.push({ step: 'Tailscale already configured', success: true, output: tailscaleIp, skipped: true });
					}

					// 4. Install iptables-persistent
					await runStep(
						'Install iptables-persistent',
						'DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent'
					);

					// 5. Get public interface
					const ifaceResult = await SSH.ssh(sshHost, "ip route | grep default | awk '{print $5}' | head -1");
					const publicInterface = ifaceResult.stdout.trim() || 'eth0';
					results.push({ step: 'Detect public interface', success: true, output: publicInterface });

					// 6. Configure Docker daemon.json
					const daemonJson = JSON.stringify(
						{
							'userland-proxy': false,
							'log-driver': 'json-file',
							'log-opts': { 'max-size': '10m', 'max-file': '3' },
						},
						null,
						2
					);
					await runStep(
						'Configure Docker daemon',
						`echo '${daemonJson.replace(/'/g, "'\\''")}' > /etc/docker/daemon.json`
					);

					// 7. Configure iptables
					const iptablesCommands = [
						'iptables -F DOCKER-USER 2>/dev/null || true',
						'iptables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
						'iptables -A DOCKER-USER -i lo -j ACCEPT',
						'iptables -A DOCKER-USER -s 100.64.0.0/10 -j ACCEPT',
						'iptables -A DOCKER-USER -i br-+ -j ACCEPT',
						'iptables -A DOCKER-USER -p tcp -m conntrack --ctorigdstport 80 -j ACCEPT',
						'iptables -A DOCKER-USER -p tcp -m conntrack --ctorigdstport 443 -j ACCEPT',
						'iptables -A DOCKER-USER -p udp -m conntrack --ctorigdstport 443 -j ACCEPT',
						`iptables -A DOCKER-USER -i ${publicInterface} -j DROP`,
						'iptables -A DOCKER-USER -j RETURN',
					];
					await runStep('Configure iptables', iptablesCommands.join(' && '));

					// 8. Configure ip6tables
					const ip6tablesCommands = [
						'ip6tables -F DOCKER-USER 2>/dev/null || true',
						'ip6tables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
						'ip6tables -A DOCKER-USER -i lo -j ACCEPT',
						'ip6tables -A DOCKER-USER -s fd7a:115c:a1e0::/48 -j ACCEPT',
						'ip6tables -A DOCKER-USER -i br-+ -j ACCEPT',
						'ip6tables -A DOCKER-USER -p tcp --dport 80 -j ACCEPT',
						'ip6tables -A DOCKER-USER -p tcp --dport 443 -j ACCEPT',
						'ip6tables -A DOCKER-USER -p udp --dport 443 -j ACCEPT',
						`ip6tables -A DOCKER-USER -i ${publicInterface} -j DROP`,
						'ip6tables -A DOCKER-USER -j RETURN',
					];
					await runStep('Configure ip6tables', ip6tablesCommands.join(' && '));

					// 9. Save iptables rules
					await runStep('Save iptables rules', 'netfilter-persistent save');

					// 10. Create restore script
					const restoreScript = `#!/bin/bash
iptables -F DOCKER-USER
iptables -A DOCKER-USER -j RETURN
ip6tables -F DOCKER-USER
ip6tables -A DOCKER-USER -j RETURN
echo "DOCKER-USER reset to allow all"`;
					await runStep(
						'Create restore script',
						`echo '${restoreScript.replace(/'/g, "'\\''")}' > /root/restore-iptables.sh && chmod +x /root/restore-iptables.sh`
					);

					// 11. Restart Docker
					await runStep('Restart Docker', 'systemctl restart docker');

					// 12. Get final Tailscale IP
					if (!tailscaleIp && !needsTailscaleAuth) {
						const finalTs = await SSH.ssh(sshHost, 'tailscale ip -4 2>/dev/null');
						if (finalTs.exitCode === 0) {
							tailscaleIp = finalTs.stdout.trim();
						}
					}

					return Response.json({
						success: true,
						sshHost,
						tailscaleIp,
						masterTailscaleIp,
						needsTailscaleAuth,
						results,
						nextSteps: needsTailscaleAuth
							? ['Authenticate Tailscale using the URL above', 'Run setup again after auth']
							: [
									`Add server in Coolify using IP: ${tailscaleIp || 'Get from tailscale ip -4'}`,
									'User: root, Port: 22',
								],
					});
				} catch (error) {
					return Response.json({ error: String(error) }, { status: 500 });
				}
			},
		},
	},

	// Development features
	development: {
		hmr: true,
		console: true,
	},
});

console.log(`
╔═══════════════════════════════════════════════════════════╗
║         🚀 Coolify Infrastructure Dashboard               ║
║                                                           ║
║   Running on: http://localhost:${PORT}                      ║
║                                                           ║
║   Press Ctrl+C to stop                                    ║
╚═══════════════════════════════════════════════════════════╝
`);
