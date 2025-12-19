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
