import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// ============ Types ============

interface Droplet {
	id: number;
	name: string;
	status: string;
	memory: number;
	vcpus: number;
	disk: number;
	created_at: string;
	region: { slug: string; name: string };
	image: { slug: string; name: string; distribution: string };
	size: { slug: string; price_monthly: number };
	networks: {
		v4: Array<{ ip_address: string; type: string }>;
	};
	tags: string[];
}

interface Balance {
	month_to_date_balance: string;
	account_balance: string;
	month_to_date_usage: string;
}

interface SSHKey {
	id: number;
	name: string;
	fingerprint: string;
}

interface ServiceConfig {
	name: string;
	displayName: string;
	description: string;
	needsPostgres: boolean;
	needsRedis: boolean;
	redisDb: number;
	ports: number[];
	docs: string;
}

interface Domain {
	name: string;
	ttl: number;
	zone_file: string;
}

interface DnsRecord {
	id: number;
	type: string;
	name: string;
	data: string;
	priority: number | null;
	port: number | null;
	ttl: number;
	weight: number | null;
	flags: number | null;
	tag: string | null;
}

interface DnsConfig {
	recordTypes: string[];
	recordDescriptions: Record<string, string>;
	defaultTtl: number;
}

interface ServerInfo {
	hostname: string;
	os: string;
	kernel: string;
	uptime: string;
	loadAvg: string;
	memTotal: string;
	memUsed: string;
	diskTotal: string;
	diskUsed: string;
}

interface Container {
	id: string;
	name: string;
	image: string;
	status: string;
	ports: string;
}

interface Config {
	hasDoToken: boolean;
	recommendedSizes: Array<{ slug: string; name: string; price: number }>;
	recommendedRegions: Array<{ slug: string; name: string }>;
	recommendedImages: Array<{ slug: string; name: string }>;
}

// ============ API Helpers ============

async function api<T>(endpoint: string, options?: RequestInit): Promise<T> {
	const response = await fetch(`/api${endpoint}`, {
		...options,
		headers: {
			'Content-Type': 'application/json',
			...options?.headers,
		},
	});
	if (!response.ok) {
		const error = await response.json();
		throw new Error(error.error || 'API Error');
	}
	return response.json();
}

// ============ Components ============

function StatusBadge({ status }: { status: string }) {
	const colors: Record<string, string> = {
		active: 'badge-success',
		new: 'badge-warning',
		off: 'badge-error',
		archive: 'badge-error',
		running: 'badge-success',
		exited: 'badge-error',
	};
	return <span className={`badge ${colors[status] || 'badge-default'}`}>{status}</span>;
}

function Card({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
	return (
		<div className="card">
			<div className="card-header">
				<h3>{title}</h3>
				{actions && <div className="card-actions">{actions}</div>}
			</div>
			<div className="card-body">{children}</div>
		</div>
	);
}

function Stat({ label, value, subtext }: { label: string; value: string | number; subtext?: string }) {
	return (
		<div className="stat">
			<div className="stat-label">{label}</div>
			<div className="stat-value">{value}</div>
			{subtext && <div className="stat-subtext">{subtext}</div>}
		</div>
	);
}

function LoadingSpinner() {
	return <div className="spinner"></div>;
}

// ============ Pages ============

function Overview({
	balance,
	droplets,
	loading,
}: {
	balance: Balance | null;
	droplets: Droplet[];
	loading: boolean;
}) {
	const totalMonthly = droplets.reduce((sum, d) => sum + d.size.price_monthly, 0);
	const activeDroplets = droplets.filter((d) => d.status === 'active').length;

	return (
		<div className="page">
			<h2>Overview</h2>
			{loading ? (
				<LoadingSpinner />
			) : (
				<div className="stats-grid">
					<Stat
						label="Month to Date"
						value={balance ? `$${parseFloat(balance.month_to_date_usage).toFixed(2)}` : '-'}
						subtext="Current usage"
					/>
					<Stat
						label="Account Balance"
						value={balance ? `$${parseFloat(balance.account_balance).toFixed(2)}` : '-'}
						subtext="Credits available"
					/>
					<Stat label="Droplets" value={droplets.length} subtext={`${activeDroplets} active`} />
					<Stat label="Est. Monthly" value={`$${totalMonthly.toFixed(2)}`} subtext="Based on current droplets" />
				</div>
			)}
		</div>
	);
}

function DropletsPage({
	droplets,
	sshKeys,
	config,
	loading,
	onRefresh,
}: {
	droplets: Droplet[];
	sshKeys: SSHKey[];
	config: Config | null;
	loading: boolean;
	onRefresh: () => void;
}) {
	const [showCreate, setShowCreate] = useState(false);
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState('');
	const [provisioning, setProvisioning] = useState<number | null>(null);
	const [provisionLog, setProvisionLog] = useState<string[]>([]);

	const [form, setForm] = useState({
		name: '',
		region: 'nyc1',
		size: 's-1vcpu-2gb',
		image: 'ubuntu-24-04-x64',
		ssh_keys: [] as number[],
		monitoring: true,
		ipv6: true,
	});

	const handleCreate = async () => {
		if (!form.name) {
			setError('Name is required');
			return;
		}
		setError('');
		setCreating(true);
		try {
			const droplet = await api<Droplet>('/do/droplets', {
				method: 'POST',
				body: JSON.stringify(form),
			});
			setShowCreate(false);
			setForm({ ...form, name: '' });
			onRefresh();

			// Start provisioning flow
			setProvisioning(droplet.id);
			setProvisionLog(['Droplet created, waiting for IP...']);
			pollForIP(droplet.id);
		} catch (err) {
			setError(String(err));
		} finally {
			setCreating(false);
		}
	};

	const pollForIP = async (dropletId: number) => {
		let attempts = 0;
		const maxAttempts = 60; // 5 minutes

		const poll = async () => {
			attempts++;
			try {
				const droplet = await api<Droplet>(`/do/droplets/${dropletId}`);
				const publicIP = droplet.networks.v4.find((n) => n.type === 'public')?.ip_address;

				if (publicIP) {
					setProvisionLog((prev) => [...prev, `Got IP: ${publicIP}`, 'Ready for setup!']);
					setTimeout(() => {
						setProvisioning(null);
						onRefresh();
					}, 3000);
				} else if (attempts < maxAttempts) {
					setProvisionLog((prev) => [...prev, `Waiting for IP... (${attempts}/${maxAttempts})`]);
					setTimeout(poll, 5000);
				} else {
					setProvisionLog((prev) => [...prev, 'Timeout waiting for IP']);
					setProvisioning(null);
				}
			} catch (err) {
				setProvisionLog((prev) => [...prev, `Error: ${err}`]);
				setProvisioning(null);
			}
		};

		poll();
	};

	const handleDelete = async (id: number, name: string) => {
		if (!confirm(`Delete droplet "${name}"? This cannot be undone.`)) return;
		try {
			await api(`/do/droplets/${id}`, { method: 'DELETE' });
			onRefresh();
		} catch (err) {
			alert(`Failed to delete: ${err}`);
		}
	};

	const handleReboot = async (id: number) => {
		try {
			await api(`/do/droplets/${id}/reboot`, { method: 'POST' });
			onRefresh();
		} catch (err) {
			alert(`Failed to reboot: ${err}`);
		}
	};

	const getPublicIP = (d: Droplet) => d.networks.v4.find((n) => n.type === 'public')?.ip_address || '-';

	return (
		<div className="page">
			<div className="page-header">
				<h2>Droplets</h2>
				<div className="page-actions">
					<button onClick={onRefresh} className="btn btn-secondary">
						Refresh
					</button>
					<button onClick={() => setShowCreate(true)} className="btn btn-primary">
						Create Droplet
					</button>
				</div>
			</div>

			{provisioning && (
				<div className="provision-log">
					<h4>Provisioning Droplet...</h4>
					{provisionLog.map((log, i) => (
						<div key={i} className="log-line">
							{log}
						</div>
					))}
				</div>
			)}

			{showCreate && (
				<Card title="Create Droplet">
					{error && <div className="error">{error}</div>}
					<div className="form-grid">
						<div className="form-group">
							<label>Name</label>
							<input
								type="text"
								value={form.name}
								onChange={(e) => setForm({ ...form, name: e.target.value })}
								placeholder="my-droplet"
							/>
						</div>
						<div className="form-group">
							<label>Region</label>
							<select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>
								{config?.recommendedRegions.map((r) => (
									<option key={r.slug} value={r.slug}>
										{r.name}
									</option>
								))}
							</select>
						</div>
						<div className="form-group">
							<label>Size</label>
							<select value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })}>
								{config?.recommendedSizes.map((s) => (
									<option key={s.slug} value={s.slug}>
										{s.name} (${s.price}/mo)
									</option>
								))}
							</select>
						</div>
						<div className="form-group">
							<label>Image</label>
							<select value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })}>
								{config?.recommendedImages.map((i) => (
									<option key={i.slug} value={i.slug}>
										{i.name}
									</option>
								))}
							</select>
						</div>
						<div className="form-group full-width">
							<label>SSH Keys {sshKeys.length === 0 && <span className="text-muted">(loading...)</span>}</label>
							<div className="checkbox-group">
								{sshKeys.length === 0 && <span className="text-muted">No SSH keys found</span>}
								{sshKeys.map((key) => (
									<label key={key.id} className="checkbox-label">
										<input
											type="checkbox"
											checked={form.ssh_keys.includes(key.id)}
											onChange={(e) => {
												if (e.target.checked) {
													setForm({ ...form, ssh_keys: [...form.ssh_keys, key.id] });
												} else {
													setForm({ ...form, ssh_keys: form.ssh_keys.filter((k) => k !== key.id) });
												}
											}}
										/>
										{key.name}
									</label>
								))}
							</div>
							{sshKeys.length > 0 && form.ssh_keys.length === 0 && (
								<button
									type="button"
									className="btn btn-sm btn-secondary"
									style={{ marginTop: '0.5rem' }}
									onClick={() => setForm({ ...form, ssh_keys: sshKeys.map((k) => k.id) })}
								>
									Select All
								</button>
							)}
						</div>
					</div>
					<div className="form-actions">
						<button onClick={() => setShowCreate(false)} className="btn btn-secondary">
							Cancel
						</button>
						<button onClick={handleCreate} className="btn btn-primary" disabled={creating}>
							{creating ? 'Creating...' : 'Create'}
						</button>
					</div>
				</Card>
			)}

			{loading ? (
				<LoadingSpinner />
			) : (
				<div className="table-container">
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>Status</th>
								<th>IP</th>
								<th>Region</th>
								<th>Size</th>
								<th>Price</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{droplets.map((d) => (
								<tr key={d.id}>
									<td>
										<strong>{d.name}</strong>
										<div className="text-muted">{d.image.distribution}</div>
									</td>
									<td>
										<StatusBadge status={d.status} />
									</td>
									<td className="mono">{getPublicIP(d)}</td>
									<td>{d.region.name}</td>
									<td>
										{d.vcpus}vCPU / {d.memory >= 1024 ? `${d.memory / 1024}GB` : `${d.memory}MB`}
									</td>
									<td>${d.size.price_monthly}/mo</td>
									<td>
										<div className="action-buttons">
											<button onClick={() => handleReboot(d.id)} className="btn btn-sm btn-secondary">
												Reboot
											</button>
											<button onClick={() => handleDelete(d.id, d.name)} className="btn btn-sm btn-danger">
												Delete
											</button>
										</div>
									</td>
								</tr>
							))}
							{droplets.length === 0 && (
								<tr>
									<td colSpan={7} className="text-center text-muted">
										No droplets found
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

function ServersPage() {
	const [host, setHost] = useState('doserver');
	const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
	const [containers, setContainers] = useState<Container[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');

	const fetchServerData = async () => {
		setLoading(true);
		setError('');
		try {
			const [info, conts] = await Promise.all([
				api<ServerInfo>(`/servers/${host}/status`),
				api<Container[]>(`/servers/${host}/containers`),
			]);
			setServerInfo(info);
			setContainers(conts);
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="page">
			<h2>Servers</h2>

			<div className="server-selector">
				<input
					type="text"
					value={host}
					onChange={(e) => setHost(e.target.value)}
					placeholder="SSH host (e.g., doserver)"
				/>
				<button onClick={fetchServerData} className="btn btn-primary" disabled={loading}>
					{loading ? 'Connecting...' : 'Connect'}
				</button>
			</div>

			{error && <div className="error">{error}</div>}

			{serverInfo && (
				<Card title={`Server: ${serverInfo.hostname}`}>
					<div className="stats-grid">
						<Stat label="OS" value={serverInfo.os} />
						<Stat label="Kernel" value={serverInfo.kernel} />
						<Stat label="Uptime" value={serverInfo.uptime} />
						<Stat label="Load" value={serverInfo.loadAvg} />
						<Stat label="Memory" value={`${serverInfo.memUsed} / ${serverInfo.memTotal}`} />
						<Stat label="Disk" value={`${serverInfo.diskUsed} / ${serverInfo.diskTotal}`} />
					</div>
				</Card>
			)}

			{containers.length > 0 && (
				<Card title="Docker Containers">
					<div className="table-container">
						<table>
							<thead>
								<tr>
									<th>Name</th>
									<th>Image</th>
									<th>Status</th>
									<th>Ports</th>
								</tr>
							</thead>
							<tbody>
								{containers.map((c) => (
									<tr key={c.id}>
										<td>
											<strong>{c.name}</strong>
										</td>
										<td className="text-muted">{c.image}</td>
										<td>
											<StatusBadge status={c.status.includes('Up') ? 'running' : 'exited'} />
										</td>
										<td className="mono">{c.ports || '-'}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</Card>
			)}
		</div>
	);
}

function ServicesPage({ services }: { services: Record<string, ServiceConfig> }) {
	return (
		<div className="page">
			<h2>Available Services</h2>
			<p className="text-muted">Services that can be deployed via Coolify with central databases</p>

			<div className="services-grid">
				{Object.values(services).map((service) => (
					<div key={service.name} className="service-card">
						<div className="service-header">
							<h3>{service.displayName}</h3>
							<div className="service-badges">
								{service.needsPostgres && <span className="badge badge-info">Postgres</span>}
								{service.needsRedis && (
									<span className="badge badge-warning">Redis DB{service.redisDb}</span>
								)}
							</div>
						</div>
						<p>{service.description}</p>
						<div className="service-footer">
							<span className="text-muted">Ports: {service.ports.join(', ')}</span>
							<a href={service.docs} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-link">
								Docs
							</a>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function SSHKeysPage({
	sshKeys,
	loading,
	onRefresh,
}: {
	sshKeys: SSHKey[];
	loading: boolean;
	onRefresh: () => void;
}) {
	const [showAdd, setShowAdd] = useState(false);
	const [name, setName] = useState('');
	const [publicKey, setPublicKey] = useState('');
	const [adding, setAdding] = useState(false);

	const handleAdd = async () => {
		if (!name || !publicKey) return;
		setAdding(true);
		try {
			await api('/do/ssh-keys', {
				method: 'POST',
				body: JSON.stringify({ name, public_key: publicKey }),
			});
			setShowAdd(false);
			setName('');
			setPublicKey('');
			onRefresh();
		} catch (err) {
			alert(`Failed to add key: ${err}`);
		} finally {
			setAdding(false);
		}
	};

	return (
		<div className="page">
			<div className="page-header">
				<h2>SSH Keys</h2>
				<button onClick={() => setShowAdd(true)} className="btn btn-primary">
					Add SSH Key
				</button>
			</div>

			{showAdd && (
				<Card title="Add SSH Key">
					<div className="form-group">
						<label>Name</label>
						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="my-key"
						/>
					</div>
					<div className="form-group">
						<label>Public Key</label>
						<textarea
							value={publicKey}
							onChange={(e) => setPublicKey(e.target.value)}
							placeholder="ssh-rsa AAAA..."
							rows={4}
						/>
					</div>
					<div className="form-actions">
						<button onClick={() => setShowAdd(false)} className="btn btn-secondary">
							Cancel
						</button>
						<button onClick={handleAdd} className="btn btn-primary" disabled={adding}>
							{adding ? 'Adding...' : 'Add Key'}
						</button>
					</div>
				</Card>
			)}

			{loading ? (
				<LoadingSpinner />
			) : (
				<div className="table-container">
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>Fingerprint</th>
							</tr>
						</thead>
						<tbody>
							{sshKeys.map((key) => (
								<tr key={key.id}>
									<td>
										<strong>{key.name}</strong>
									</td>
									<td className="mono">{key.fingerprint}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

interface SetupResult {
	step: string;
	success: boolean;
	output: string;
	skipped?: boolean;
}

interface SetupResponse {
	success: boolean;
	sshHost: string;
	tailscaleIp: string;
	masterTailscaleIp: string;
	needsTailscaleAuth: boolean;
	results: SetupResult[];
	nextSteps: string[];
	error?: string;
}

interface StreamStep {
	step: string;
	status: 'running' | 'done' | 'error' | 'skipped';
	output?: string;
}

function SetupPage({ droplets }: { droplets: Droplet[] }) {
	const [sshHost, setSshHost] = useState('');
	const [running, setRunning] = useState(false);
	const [steps, setSteps] = useState<StreamStep[]>([]);
	const [result, setResult] = useState<{ tailscaleIp: string; needsAuth: boolean; authUrl?: string } | null>(null);
	const [error, setError] = useState('');

	const getPublicIP = (d: Droplet) => d.networks.v4.find((n) => n.type === 'public')?.ip_address || '';

	const handleSetup = async () => {
		if (!sshHost) {
			setError('SSH host is required');
			return;
		}
		setError('');
		setResult(null);
		setSteps([]);
		setRunning(true);

		try {
			const response = await fetch('/api/provision/full-setup-stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sshHost }),
			});

			const reader = response.body?.getReader();
			if (!reader) throw new Error('No reader');

			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const data = JSON.parse(line.slice(6));

						if (data.type === 'step') {
							setSteps((prev) => {
								const existing = prev.findIndex((s) => s.step === data.step);
								if (existing >= 0) {
									const updated = [...prev];
									updated[existing] = data;
									return updated;
								}
								return [...prev, data];
							});
						} else if (data.type === 'auth') {
							setResult((prev) => ({ ...prev, needsAuth: true, authUrl: data.url, tailscaleIp: '' }));
						} else if (data.type === 'done') {
							setResult({ tailscaleIp: data.tailscaleIp, needsAuth: data.needsAuth });
						}
					}
				}
			}
		} catch (err) {
			setError(String(err));
		} finally {
			setRunning(false);
		}
	};

	return (
		<div className="page">
			<h2>Coolify Server Setup</h2>
			<p className="text-muted" style={{ marginBottom: '1.5rem' }}>
				Configure a new server for Coolify cluster (Docker, Tailscale, iptables)
			</p>

			<Card title="Setup New Server">
				{error && <div className="error">{error}</div>}

				<div className="form-group">
					<label>SSH Host</label>
					<div style={{ display: 'flex', gap: '0.5rem' }}>
						<input
							type="text"
							value={sshHost}
							onChange={(e) => setSshHost(e.target.value)}
							placeholder="root@1.2.3.4"
							style={{ flex: 1 }}
						/>
						{droplets.length > 0 && (
							<select
								onChange={(e) => {
									if (e.target.value) setSshHost(`root@${e.target.value}`);
								}}
								style={{ width: 'auto' }}
							>
								<option value="">Select droplet...</option>
								{droplets.map((d) => {
									const ip = getPublicIP(d);
									return ip ? (
										<option key={d.id} value={ip}>
											{d.name} ({ip})
										</option>
									) : null;
								})}
							</select>
						)}
					</div>
				</div>

				<div className="form-actions">
					<button onClick={handleSetup} className="btn btn-primary" disabled={running}>
						{running ? 'Running Setup...' : 'Run Full Setup'}
					</button>
				</div>
			</Card>

			{(running || steps.length > 0) && (
				<Card title={running ? 'Running Setup...' : 'Setup Steps'}>
					<div className="table-container">
						<table>
							<thead>
								<tr>
									<th>Step</th>
									<th>Status</th>
									<th>Output</th>
								</tr>
							</thead>
							<tbody>
								{steps.map((s, i) => (
									<tr key={i}>
										<td>
											<strong>{s.step}</strong>
										</td>
										<td>
											{s.status === 'running' && <span className="badge badge-warning">running</span>}
											{s.status === 'done' && <span className="badge badge-success">done</span>}
											{s.status === 'error' && <span className="badge badge-error">error</span>}
											{s.status === 'skipped' && <span className="badge badge-default">skipped</span>}
										</td>
										<td className="mono" style={{ fontSize: '0.75rem', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
											{s.output?.includes('https://') ? (
												<a href={s.output} target="_blank" rel="noopener noreferrer" style={{ color: '#58a6ff' }}>
													{s.output}
												</a>
											) : (
												s.output || '-'
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</Card>
			)}

			{result?.authUrl && (
				<Card title="Tailscale Authentication Required">
					<p>Click the link below to authenticate Tailscale:</p>
					<a href={result.authUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ marginTop: '0.5rem' }}>
						Open Tailscale Auth
					</a>
					<p className="text-muted" style={{ marginTop: '1rem' }}>After authenticating, run setup again to complete configuration.</p>
				</Card>
			)}

			{result && !running && result.tailscaleIp && (
				<Card title="Setup Complete">
					<div className="stats-grid">
						<Stat label="Tailscale IP" value={result.tailscaleIp} />
						<Stat label="Master IP" value="100.77.201.55" />
					</div>
					<div style={{ marginTop: '1rem' }}>
						<strong>Next Steps:</strong>
						<ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem' }}>
							<li>Add server in Coolify using IP: <code>{result.tailscaleIp}</code></li>
							<li>User: root, Port: 22</li>
						</ul>
					</div>
				</Card>
			)}
		</div>
	);
}

// ============ SSH Config Page ============

interface LocalSSHKey {
	name: string;
	path: string;
	content: string;
}

interface SSHConfigHost {
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

function SSHConfigPage() {
	const [hosts, setHosts] = useState<SSHConfigHost[]>([]);
	const [localKeys, setLocalKeys] = useState<LocalSSHKey[]>([]);
	const [rawConfig, setRawConfig] = useState('');
	const [loading, setLoading] = useState(true);
	const [showAdd, setShowAdd] = useState(false);
	const [showEdit, setShowEdit] = useState(false);
	const [editingRaw, setEditingRaw] = useState('');
	const [form, setForm] = useState({
		name: '',
		hostname: '',
		user: 'root',
		port: '',
		identityFile: '',
		identitiesOnly: false,
	});
	const [error, setError] = useState('');
	const [filter, setFilter] = useState('');

	const fetchData = async () => {
		setLoading(true);
		try {
			const [configRes, keysRes] = await Promise.all([
				api<{ hosts: SSHConfigHost[]; raw: string }>('/local/ssh-config'),
				api<LocalSSHKey[]>('/local/ssh-keys'),
			]);
			setHosts(configRes.hosts);
			setRawConfig(configRes.raw);
			setLocalKeys(keysRes);
		} catch (err) {
			console.error(err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchData();
	}, []);

	const handleAdd = async () => {
		if (!form.name) {
			setError('Host alias is required');
			return;
		}
		setError('');
		try {
			await api('/local/ssh-config', {
				method: 'POST',
				body: JSON.stringify(form),
			});
			setShowAdd(false);
			setForm({ name: '', hostname: '', user: 'root', port: '', identityFile: '', identitiesOnly: false });
			fetchData();
		} catch (err) {
			setError(String(err));
		}
	};

	const handleSaveRaw = async () => {
		try {
			await api('/local/ssh-config', {
				method: 'PUT',
				body: JSON.stringify({ raw: editingRaw }),
			});
			setShowEdit(false);
			fetchData();
		} catch (err) {
			alert(`Failed to save: ${err}`);
		}
	};

	const handleDelete = async (name: string) => {
		if (!confirm(`Remove host "${name}" from SSH config?`)) return;
		try {
			await api(`/local/ssh-config/${name}`, { method: 'DELETE' });
			fetchData();
		} catch (err) {
			alert(`Failed: ${err}`);
		}
	};

	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text);
	};

	const filteredHosts = hosts.filter((h) => {
		if (!filter) return true;
		const search = filter.toLowerCase();
		return (
			h.name.toLowerCase().includes(search) ||
			h.hostname.toLowerCase().includes(search) ||
			h.user.toLowerCase().includes(search) ||
			h.comment.toLowerCase().includes(search)
		);
	});

	const serverHosts = filteredHosts.filter((h) => !h.isWildcard && !['github.com', 'bitbucket.org', 'ssh.dev.azure.com'].includes(h.name));
	const gitHosts = filteredHosts.filter((h) => ['github.com', 'bitbucket.org', 'ssh.dev.azure.com'].includes(h.name));
	const wildcardHosts = filteredHosts.filter((h) => h.isWildcard);

	return (
		<div className="page">
			<div className="page-header">
				<h2>SSH Config</h2>
				<div className="page-actions">
					<button onClick={() => { setEditingRaw(rawConfig); setShowEdit(true); }} className="btn btn-secondary">
						Edit Raw
					</button>
					<button onClick={() => setShowAdd(true)} className="btn btn-primary">
						Add Host
					</button>
				</div>
			</div>

			<div style={{ marginBottom: '1rem' }}>
				<input
					type="text"
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					placeholder="Filter hosts..."
					style={{ width: '100%', maxWidth: '300px' }}
				/>
			</div>

			{showEdit && (
				<Card title="Edit SSH Config">
					<textarea
						value={editingRaw}
						onChange={(e) => setEditingRaw(e.target.value)}
						style={{ width: '100%', minHeight: '400px', fontFamily: 'monospace', fontSize: '0.875rem' }}
					/>
					<div className="form-actions">
						<button onClick={() => setShowEdit(false)} className="btn btn-secondary">Cancel</button>
						<button onClick={handleSaveRaw} className="btn btn-primary">Save</button>
					</div>
				</Card>
			)}

			{showAdd && (
				<Card title="Add SSH Host">
					{error && <div className="error">{error}</div>}
					<div className="form-grid">
						<div className="form-group">
							<label>Host Alias *</label>
							<input
								type="text"
								value={form.name}
								onChange={(e) => setForm({ ...form, name: e.target.value })}
								placeholder="worker1"
							/>
						</div>
						<div className="form-group">
							<label>HostName (IP or domain)</label>
							<input
								type="text"
								value={form.hostname}
								onChange={(e) => setForm({ ...form, hostname: e.target.value })}
								placeholder="100.x.x.x"
							/>
						</div>
						<div className="form-group">
							<label>User</label>
							<input
								type="text"
								value={form.user}
								onChange={(e) => setForm({ ...form, user: e.target.value })}
								placeholder="root"
							/>
						</div>
						<div className="form-group">
							<label>Port</label>
							<input
								type="text"
								value={form.port}
								onChange={(e) => setForm({ ...form, port: e.target.value })}
								placeholder="22 (default)"
							/>
						</div>
						<div className="form-group">
							<label>Identity File</label>
							<select
								value={form.identityFile}
								onChange={(e) => setForm({ ...form, identityFile: e.target.value })}
							>
								<option value="">Default</option>
								{localKeys.map((k) => (
									<option key={k.path} value={k.path.replace('.pub', '')}>
										{k.name}
									</option>
								))}
							</select>
						</div>
						<div className="form-group">
							<label className="checkbox-label" style={{ marginTop: '1.5rem' }}>
								<input
									type="checkbox"
									checked={form.identitiesOnly}
									onChange={(e) => setForm({ ...form, identitiesOnly: e.target.checked })}
								/>
								IdentitiesOnly
							</label>
						</div>
					</div>
					<div className="form-actions">
						<button onClick={() => setShowAdd(false)} className="btn btn-secondary">Cancel</button>
						<button onClick={handleAdd} className="btn btn-primary">Add</button>
					</div>
				</Card>
			)}

			{loading ? (
				<LoadingSpinner />
			) : (
				<>
					{serverHosts.length > 0 && (
						<Card title={`Servers (${serverHosts.length})`}>
							<div className="table-container">
								<table>
									<thead>
										<tr>
											<th>Alias</th>
											<th>HostName</th>
											<th>User</th>
											<th>Port</th>
											<th>Key</th>
											<th>Actions</th>
										</tr>
									</thead>
									<tbody>
										{serverHosts.map((h) => (
											<tr key={h.name}>
												<td>
													<strong>{h.name}</strong>
													{h.comment && <div className="text-muted" style={{ fontSize: '0.75rem' }}>{h.comment}</div>}
												</td>
												<td className="mono">{h.hostname || '-'}</td>
												<td>{h.user || '-'}</td>
												<td>{h.port || '22'}</td>
												<td className="mono" style={{ fontSize: '0.75rem' }}>
													{h.identityFile ? h.identityFile.split('/').pop() : '-'}
													{h.identitiesOnly && <span className="badge badge-info" style={{ marginLeft: '0.25rem' }}>only</span>}
												</td>
												<td>
													<div className="action-buttons">
														<button
															onClick={() => copyToClipboard(`ssh ${h.name}`)}
															className="btn btn-sm btn-secondary"
															title="Copy SSH command"
														>
															Copy
														</button>
														<button
															onClick={() => handleDelete(h.name)}
															className="btn btn-sm btn-danger"
														>
															Del
														</button>
													</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</Card>
					)}

					{gitHosts.length > 0 && (
						<Card title={`Git Services (${gitHosts.length})`}>
							<div className="table-container">
								<table>
									<thead>
										<tr>
											<th>Host</th>
											<th>Key</th>
											<th>Options</th>
										</tr>
									</thead>
									<tbody>
										{gitHosts.map((h) => (
											<tr key={h.name}>
												<td><strong>{h.name}</strong></td>
												<td className="mono" style={{ fontSize: '0.75rem' }}>
													{h.identityFile ? h.identityFile.split('/').pop() : 'default'}
												</td>
												<td>
													{h.addKeysToAgent && <span className="badge badge-default">AddKeysToAgent</span>}
													{h.useKeychain && <span className="badge badge-default">UseKeychain</span>}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</Card>
					)}

					{wildcardHosts.length > 0 && (
						<Card title="Global Settings">
							{wildcardHosts.map((h) => (
								<div key={h.name} style={{ marginBottom: '0.5rem' }}>
									<code style={{ fontSize: '0.875rem' }}>{h.raw.join('\n')}</code>
								</div>
							))}
						</Card>
					)}

					<Card title={`Local SSH Keys (${localKeys.length})`}>
						{localKeys.length === 0 ? (
							<p className="text-muted">No SSH keys found in ~/.ssh/</p>
						) : (
							<div className="table-container">
								<table>
									<thead>
										<tr>
											<th>Name</th>
											<th>Type</th>
											<th>Public Key</th>
											<th>Actions</th>
										</tr>
									</thead>
									<tbody>
										{localKeys.map((k) => {
											const keyType = k.content.split(' ')[0] || 'unknown';
											return (
												<tr key={k.name}>
													<td><strong>{k.name}</strong></td>
													<td><span className="badge badge-default">{keyType.replace('ssh-', '')}</span></td>
													<td className="mono" style={{ fontSize: '0.75rem', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
														{k.content.slice(0, 50)}...
													</td>
													<td>
														<button
															onClick={() => copyToClipboard(k.content)}
															className="btn btn-sm btn-secondary"
														>
															Copy
														</button>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
					</Card>
				</>
			)}
		</div>
	);
}

// ============ Databases Page ============

interface PostgresServer {
	host: string;
	port: string;
	user: string;
	databases: Array<{ name: string; size: string; collation: string }>;
	users: Array<{ name: string; is_superuser: boolean; can_create_db: boolean }>;
	error?: string;
}

interface CreateDbResult {
	success: boolean;
	database: string;
	user: string | null;
	connectionStrings: {
		standard: string;
		jdbc: string;
		dotenv: string;
	};
}

function DatabasesPage() {
	const [servers, setServers] = useState<PostgresServer[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [showCreate, setShowCreate] = useState(false);
	const [createResult, setCreateResult] = useState<CreateDbResult | null>(null);
	const [form, setForm] = useState({
		dbName: '',
		userName: '',
		password: '',
	});

	const fetchData = async () => {
		setLoading(true);
		setError('');
		try {
			const res = await api<PostgresServer[]>('/databases');
			setServers(res);
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchData();
	}, []);

	const generatePassword = () => {
		const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
		let result = '';
		for (let i = 0; i < 24; i++) {
			result += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		setForm({ ...form, password: result });
	};

	const handleCreate = async () => {
		if (!form.dbName) {
			setError('Database name is required');
			return;
		}
		setError('');
		try {
			const res = await api<CreateDbResult>('/databases/create', {
				method: 'POST',
				body: JSON.stringify(form),
			});
			setCreateResult(res);
			setShowCreate(false);
			setForm({ dbName: '', userName: '', password: '' });
			fetchData();
		} catch (err) {
			setError(String(err));
		}
	};

	const handleDrop = async (dbName: string) => {
		if (!confirm(`DROP DATABASE "${dbName}"? This cannot be undone!`)) return;
		try {
			await api('/databases/drop', {
				method: 'POST',
				body: JSON.stringify({ dbName }),
			});
			fetchData();
		} catch (err) {
			alert(`Failed: ${err}`);
		}
	};

	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text);
	};

	return (
		<div className="page">
			<div className="page-header">
				<h2>Databases</h2>
				<button onClick={() => setShowCreate(true)} className="btn btn-primary">
					Create Database
				</button>
			</div>

			{error && <div className="error">{error}</div>}

			{createResult && (
				<Card title="Database Created!">
					<div className="stats-grid">
						<Stat label="Database" value={createResult.database} />
						<Stat label="User" value={createResult.user || 'Using default'} />
					</div>
					<div style={{ marginTop: '1rem' }}>
						<strong>Connection Strings:</strong>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
							<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
								<code style={{ flex: 1, fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
									{createResult.connectionStrings.dotenv}
								</code>
								<button onClick={() => copyToClipboard(createResult.connectionStrings.dotenv)} className="btn btn-sm btn-secondary">
									Copy
								</button>
							</div>
							<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
								<code style={{ flex: 1, fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
									{createResult.connectionStrings.jdbc}
								</code>
								<button onClick={() => copyToClipboard(createResult.connectionStrings.jdbc)} className="btn btn-sm btn-secondary">
									JDBC
								</button>
							</div>
						</div>
					</div>
					<div className="form-actions">
						<button onClick={() => setCreateResult(null)} className="btn btn-secondary">
							Dismiss
						</button>
					</div>
				</Card>
			)}

			{showCreate && (
				<Card title="Create Database">
					<div className="form-grid">
						<div className="form-group">
							<label>Database Name *</label>
							<input
								type="text"
								value={form.dbName}
								onChange={(e) => setForm({ ...form, dbName: e.target.value })}
								placeholder="my_app_db"
							/>
						</div>
						<div className="form-group">
							<label>User Name (optional)</label>
							<input
								type="text"
								value={form.userName}
								onChange={(e) => setForm({ ...form, userName: e.target.value })}
								placeholder="my_app_user"
							/>
						</div>
						<div className="form-group full-width">
							<label>Password (required if user provided)</label>
							<div style={{ display: 'flex', gap: '0.5rem' }}>
								<input
									type="text"
									value={form.password}
									onChange={(e) => setForm({ ...form, password: e.target.value })}
									placeholder="secure_password"
									style={{ flex: 1 }}
								/>
								<button onClick={generatePassword} className="btn btn-secondary">
									Generate
								</button>
							</div>
						</div>
					</div>
					<div className="form-actions">
						<button onClick={() => setShowCreate(false)} className="btn btn-secondary">Cancel</button>
						<button onClick={handleCreate} className="btn btn-primary">Create</button>
					</div>
				</Card>
			)}

			{loading ? (
				<LoadingSpinner />
			) : (
				servers.map((server, idx) => (
					<Card key={idx} title={`${server.host}:${server.port}`}>
						{server.error ? (
							<div className="error">{server.error}</div>
						) : (
							<>
								<h4 style={{ marginBottom: '0.5rem' }}>Databases ({server.databases.length})</h4>
								<div className="table-container">
									<table>
										<thead>
											<tr>
												<th>Name</th>
												<th>Size</th>
												<th>Actions</th>
											</tr>
										</thead>
										<tbody>
											{server.databases.map((db) => (
												<tr key={db.name}>
													<td><strong>{db.name}</strong></td>
													<td>{db.size}</td>
													<td>
														<div className="action-buttons">
															<button
																onClick={() => copyToClipboard(`postgresql://${server.user}:PASSWORD@${server.host}:${server.port}/${db.name}`)}
																className="btn btn-sm btn-secondary"
															>
																Copy URL
															</button>
															{!['postgres', 'template0', 'template1'].includes(db.name) && (
																<button
																	onClick={() => handleDrop(db.name)}
																	className="btn btn-sm btn-danger"
																>
																	Drop
																</button>
															)}
														</div>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>

								<h4 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>Users ({server.users.length})</h4>
								<div className="table-container">
									<table>
										<thead>
											<tr>
												<th>Name</th>
												<th>Roles</th>
											</tr>
										</thead>
										<tbody>
											{server.users.map((user) => (
												<tr key={user.name}>
													<td><strong>{user.name}</strong></td>
													<td>
														{user.is_superuser && <span className="badge badge-error">superuser</span>}
														{user.can_create_db && <span className="badge badge-info">createdb</span>}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</>
						)}
					</Card>
				))
			)}
		</div>
	);
}

// ============ Tailscale Page ============

interface TailscalePeer {
	name: string;
	dnsName: string;
	tailscaleIP: string;
	os: string;
	online: boolean;
	active: boolean;
	lastSeen?: string;
	exitNode?: boolean;
}

interface TailscaleStatus {
	self: TailscalePeer;
	peers: TailscalePeer[];
	tailnetName: string;
}

function TailscalePage() {
	const [status, setStatus] = useState<TailscaleStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	const fetchStatus = async () => {
		setLoading(true);
		setError('');
		try {
			const res = await api<TailscaleStatus>('/tailscale/status');
			setStatus(res);
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchStatus();
	}, []);

	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text);
	};

	const formatLastSeen = (lastSeen?: string) => {
		if (!lastSeen) return '-';
		const date = new Date(lastSeen);
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		return `${days}d ago`;
	};

	const serverPeers = status?.peers.filter(p =>
		p.os === 'linux' && !p.name.includes('phone') && !p.name.includes('iphone')
	) || [];

	const otherPeers = status?.peers.filter(p =>
		p.os !== 'linux' || p.name.includes('phone') || p.name.includes('iphone')
	) || [];

	return (
		<div className="page">
			<div className="page-header">
				<h2>Tailscale Network</h2>
				<button onClick={fetchStatus} className="btn btn-secondary" disabled={loading}>
					{loading ? 'Loading...' : 'Refresh'}
				</button>
			</div>

			{error && <div className="error">{error}</div>}

			{loading && !status ? (
				<LoadingSpinner />
			) : status ? (
				<>
					<Card title="This Machine">
						<div className="stats-grid">
							<Stat label="Hostname" value={status.self.name} />
							<Stat label="Tailscale IP" value={status.self.tailscaleIP} />
							<Stat label="MagicDNS" value={status.self.dnsName} />
							<Stat label="Tailnet" value={status.tailnetName} />
						</div>
						<div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
							<button
								onClick={() => copyToClipboard(status.self.tailscaleIP)}
								className="btn btn-sm btn-secondary"
							>
								Copy IP
							</button>
							<button
								onClick={() => copyToClipboard(status.self.dnsName)}
								className="btn btn-sm btn-secondary"
							>
								Copy DNS
							</button>
						</div>
					</Card>

					{serverPeers.length > 0 && (
						<Card title={`Servers (${serverPeers.length})`}>
							<div className="table-container">
								<table>
									<thead>
										<tr>
											<th>Name</th>
											<th>Tailscale IP</th>
											<th>MagicDNS</th>
											<th>Status</th>
											<th>Actions</th>
										</tr>
									</thead>
									<tbody>
										{serverPeers.map((peer) => (
											<tr key={peer.tailscaleIP}>
												<td>
													<strong>{peer.name}</strong>
													<div className="text-muted" style={{ fontSize: '0.75rem' }}>{peer.os}</div>
												</td>
												<td className="mono">{peer.tailscaleIP}</td>
												<td className="mono" style={{ fontSize: '0.875rem' }}>{peer.dnsName}</td>
												<td>
													{peer.online ? (
														<span className="badge badge-success">online</span>
													) : (
														<span className="badge badge-error">offline</span>
													)}
													{peer.active && <span className="badge badge-info" style={{ marginLeft: '0.25rem' }}>active</span>}
												</td>
												<td>
													<div className="action-buttons">
														<button
															onClick={() => copyToClipboard(peer.tailscaleIP)}
															className="btn btn-sm btn-secondary"
															title="Copy IP"
														>
															IP
														</button>
														<button
															onClick={() => copyToClipboard(peer.dnsName)}
															className="btn btn-sm btn-secondary"
															title="Copy DNS"
														>
															DNS
														</button>
														<button
															onClick={() => copyToClipboard(`ssh root@${peer.tailscaleIP}`)}
															className="btn btn-sm btn-secondary"
															title="Copy SSH command"
														>
															SSH
														</button>
													</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</Card>
					)}

					{otherPeers.length > 0 && (
						<Card title={`Other Devices (${otherPeers.length})`}>
							<div className="table-container">
								<table>
									<thead>
										<tr>
											<th>Name</th>
											<th>OS</th>
											<th>Tailscale IP</th>
											<th>Status</th>
											<th>Last Seen</th>
										</tr>
									</thead>
									<tbody>
										{otherPeers.map((peer) => (
											<tr key={peer.tailscaleIP}>
												<td><strong>{peer.name}</strong></td>
												<td>{peer.os}</td>
												<td className="mono">{peer.tailscaleIP}</td>
												<td>
													{peer.online ? (
														<span className="badge badge-success">online</span>
													) : (
														<span className="badge badge-default">offline</span>
													)}
												</td>
												<td className="text-muted">{formatLastSeen(peer.lastSeen)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</Card>
					)}

					<Card title="Quick Reference">
						<p className="text-muted" style={{ marginBottom: '1rem' }}>
							Use these URLs in your Coolify deployments to connect to services:
						</p>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
							{serverPeers.filter(p => p.online).map((peer) => (
								<div key={peer.tailscaleIP} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
									<strong style={{ minWidth: '150px' }}>{peer.name}</strong>
									<code style={{ flex: 1 }}>{peer.dnsName}</code>
									<button
										onClick={() => copyToClipboard(peer.dnsName)}
										className="btn btn-sm btn-secondary"
									>
										Copy
									</button>
								</div>
							))}
						</div>
					</Card>
				</>
			) : null}
		</div>
	);
}

// ============ DNS Page ============

function DNSPage({ droplets }: { droplets: Droplet[] }) {
	const [domains, setDomains] = useState<Domain[]>([]);
	const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
	const [records, setRecords] = useState<DnsRecord[]>([]);
	const [dnsConfig, setDnsConfig] = useState<DnsConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadingRecords, setLoadingRecords] = useState(false);
	const [error, setError] = useState('');
	const [showAddDomain, setShowAddDomain] = useState(false);
	const [showAddRecord, setShowAddRecord] = useState(false);
	const [showEditRecord, setShowEditRecord] = useState<DnsRecord | null>(null);
	const [filter, setFilter] = useState('');

	const [domainForm, setDomainForm] = useState({ name: '', ip_address: '' });
	const [recordForm, setRecordForm] = useState({
		type: 'A',
		name: '@',
		data: '',
		ttl: 1800,
		priority: 10,
		port: 0,
		weight: 100,
		flags: 0,
		tag: 'issue',
	});

	const fetchDomains = async () => {
		setLoading(true);
		try {
			const [domainsData, configData] = await Promise.all([
				api<Domain[]>('/do/domains'),
				api<DnsConfig>('/do/dns-config'),
			]);
			setDomains(domainsData);
			setDnsConfig(configData);
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	};

	const fetchRecords = async (domain: string) => {
		setLoadingRecords(true);
		try {
			const recordsData = await api<DnsRecord[]>(`/do/domains/${domain}/records`);
			setRecords(recordsData);
		} catch (err) {
			setError(String(err));
		} finally {
			setLoadingRecords(false);
		}
	};

	useEffect(() => {
		fetchDomains();
	}, []);

	useEffect(() => {
		if (selectedDomain) {
			fetchRecords(selectedDomain);
		}
	}, [selectedDomain]);

	const handleAddDomain = async () => {
		if (!domainForm.name) {
			setError('Domain name is required');
			return;
		}
		setError('');
		try {
			await api('/do/domains', {
				method: 'POST',
				body: JSON.stringify(domainForm),
			});
			setShowAddDomain(false);
			setDomainForm({ name: '', ip_address: '' });
			fetchDomains();
		} catch (err) {
			setError(String(err));
		}
	};

	const handleDeleteDomain = async (name: string) => {
		if (!confirm(`Delete domain "${name}" and ALL its records? This cannot be undone!`)) return;
		try {
			await api(`/do/domains/${name}`, { method: 'DELETE' });
			if (selectedDomain === name) {
				setSelectedDomain(null);
				setRecords([]);
			}
			fetchDomains();
		} catch (err) {
			alert(`Failed to delete: ${err}`);
		}
	};

	const handleAddRecord = async () => {
		if (!recordForm.data) {
			setError('Data/value is required');
			return;
		}
		setError('');
		try {
			const payload: any = {
				type: recordForm.type,
				name: recordForm.name,
				data: recordForm.data,
				ttl: recordForm.ttl,
			};
			if (['MX', 'SRV'].includes(recordForm.type)) payload.priority = recordForm.priority;
			if (recordForm.type === 'SRV') {
				payload.port = recordForm.port;
				payload.weight = recordForm.weight;
			}
			if (recordForm.type === 'CAA') {
				payload.flags = recordForm.flags;
				payload.tag = recordForm.tag;
			}

			await api(`/do/domains/${selectedDomain}/records`, {
				method: 'POST',
				body: JSON.stringify(payload),
			});
			setShowAddRecord(false);
			setRecordForm({ ...recordForm, name: '@', data: '' });
			fetchRecords(selectedDomain!);
		} catch (err) {
			setError(String(err));
		}
	};

	const handleUpdateRecord = async () => {
		if (!showEditRecord) return;
		setError('');
		try {
			await api(`/do/domains/${selectedDomain}/records/${showEditRecord.id}`, {
				method: 'PATCH',
				body: JSON.stringify({
					name: recordForm.name,
					data: recordForm.data,
					ttl: recordForm.ttl,
				}),
			});
			setShowEditRecord(null);
			fetchRecords(selectedDomain!);
		} catch (err) {
			setError(String(err));
		}
	};

	const handleDeleteRecord = async (id: number) => {
		if (!confirm('Delete this DNS record?')) return;
		try {
			await api(`/do/domains/${selectedDomain}/records/${id}`, { method: 'DELETE' });
			fetchRecords(selectedDomain!);
		} catch (err) {
			alert(`Failed to delete: ${err}`);
		}
	};

	const startEditRecord = (record: DnsRecord) => {
		setRecordForm({
			type: record.type,
			name: record.name,
			data: record.data,
			ttl: record.ttl,
			priority: record.priority || 10,
			port: record.port || 0,
			weight: record.weight || 100,
			flags: record.flags || 0,
			tag: record.tag || 'issue',
		});
		setShowEditRecord(record);
	};

	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text);
	};

	const getPublicIP = (d: Droplet) => d.networks.v4.find((n) => n.type === 'public')?.ip_address || '';

	const filteredRecords = records.filter((r) => {
		if (!filter) return true;
		const search = filter.toLowerCase();
		return (
			r.type.toLowerCase().includes(search) ||
			r.name.toLowerCase().includes(search) ||
			r.data.toLowerCase().includes(search)
		);
	});

	const groupedRecords: Record<string, DnsRecord[]> = {};
	for (const r of filteredRecords) {
		if (!groupedRecords[r.type]) groupedRecords[r.type] = [];
		groupedRecords[r.type].push(r);
	}

	return (
		<div className="page">
			<div className="page-header">
				<h2>DNS Management</h2>
				<div className="page-actions">
					<button onClick={fetchDomains} className="btn btn-secondary">
						Refresh
					</button>
					<button onClick={() => setShowAddDomain(true)} className="btn btn-primary">
						Add Domain
					</button>
				</div>
			</div>

			{error && <div className="error">{error}</div>}

			{showAddDomain && (
				<Card title="Add Domain">
					<div className="form-grid">
						<div className="form-group">
							<label>Domain Name *</label>
							<input
								type="text"
								value={domainForm.name}
								onChange={(e) => setDomainForm({ ...domainForm, name: e.target.value })}
								placeholder="example.com"
							/>
						</div>
						<div className="form-group">
							<label>Initial IP (optional A record)</label>
							<div style={{ display: 'flex', gap: '0.5rem' }}>
								<input
									type="text"
									value={domainForm.ip_address}
									onChange={(e) => setDomainForm({ ...domainForm, ip_address: e.target.value })}
									placeholder="1.2.3.4"
									style={{ flex: 1 }}
								/>
								{droplets.length > 0 && (
									<select
										onChange={(e) => setDomainForm({ ...domainForm, ip_address: e.target.value })}
										style={{ width: 'auto' }}
									>
										<option value="">From droplet...</option>
										{droplets.map((d) => {
											const ip = getPublicIP(d);
											return ip ? (
												<option key={d.id} value={ip}>
													{d.name}
												</option>
											) : null;
										})}
									</select>
								)}
							</div>
						</div>
					</div>
					<p className="text-muted" style={{ margin: '1rem 0' }}>
						After adding, update your registrar's nameservers to:<br />
						<code>ns1.digitalocean.com</code>, <code>ns2.digitalocean.com</code>, <code>ns3.digitalocean.com</code>
					</p>
					<div className="form-actions">
						<button onClick={() => setShowAddDomain(false)} className="btn btn-secondary">
							Cancel
						</button>
						<button onClick={handleAddDomain} className="btn btn-primary">
							Add Domain
						</button>
					</div>
				</Card>
			)}

			{loading ? (
				<LoadingSpinner />
			) : (
				<div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
					{/* Domains List */}
					<Card title={`Domains (${domains.length})`}>
						{domains.length === 0 ? (
							<p className="text-muted">No domains found. Add a domain to get started.</p>
						) : (
							<div className="table-container">
								<table>
									<thead>
										<tr>
											<th>Domain</th>
											<th>TTL</th>
											<th>Actions</th>
										</tr>
									</thead>
									<tbody>
										{domains.map((d) => (
											<tr key={d.name} className={selectedDomain === d.name ? 'selected' : ''}>
												<td>
													<button
														onClick={() => setSelectedDomain(d.name)}
														className="btn btn-link"
														style={{ padding: 0, textAlign: 'left' }}
													>
														<strong>{d.name}</strong>
													</button>
												</td>
												<td>{d.ttl}s</td>
												<td>
													<div className="action-buttons">
														<button
															onClick={() => setSelectedDomain(d.name)}
															className="btn btn-sm btn-secondary"
														>
															Records
														</button>
														<button
															onClick={() => handleDeleteDomain(d.name)}
															className="btn btn-sm btn-danger"
														>
															Delete
														</button>
													</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</Card>

					{/* Records Panel */}
					{selectedDomain && (
						<div style={{ flex: 1, minWidth: '500px' }}>
							<Card
								title={`Records: ${selectedDomain}`}
								actions={
									<button onClick={() => setShowAddRecord(true)} className="btn btn-sm btn-primary">
										Add Record
									</button>
								}
							>
								<div style={{ marginBottom: '1rem' }}>
									<input
										type="text"
										value={filter}
										onChange={(e) => setFilter(e.target.value)}
										placeholder="Filter records..."
										style={{ width: '100%', maxWidth: '300px' }}
									/>
								</div>

								{showAddRecord && (
									<div style={{ background: '#1a1a2e', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
										<h4 style={{ marginBottom: '1rem' }}>Add Record</h4>
										<div className="form-grid">
											<div className="form-group">
												<label>Type</label>
												<select
													value={recordForm.type}
													onChange={(e) => setRecordForm({ ...recordForm, type: e.target.value })}
												>
													{dnsConfig?.recordTypes.map((t) => (
														<option key={t} value={t}>
															{t} - {dnsConfig.recordDescriptions[t]}
														</option>
													))}
												</select>
											</div>
											<div className="form-group">
												<label>Name</label>
												<input
													type="text"
													value={recordForm.name}
													onChange={(e) => setRecordForm({ ...recordForm, name: e.target.value })}
													placeholder="@ or subdomain"
												/>
											</div>
											<div className="form-group">
												<label>
													{recordForm.type === 'A' ? 'IPv4 Address' :
													 recordForm.type === 'AAAA' ? 'IPv6 Address' :
													 recordForm.type === 'CNAME' ? 'Target hostname' :
													 recordForm.type === 'MX' ? 'Mail server' :
													 recordForm.type === 'TXT' ? 'Text value' :
													 'Data'}
												</label>
												<div style={{ display: 'flex', gap: '0.5rem' }}>
													<input
														type="text"
														value={recordForm.data}
														onChange={(e) => setRecordForm({ ...recordForm, data: e.target.value })}
														placeholder={
															recordForm.type === 'A' ? '1.2.3.4' :
															recordForm.type === 'CNAME' ? 'example.com.' :
															recordForm.type === 'MX' ? 'mail.example.com.' :
															recordForm.type === 'TXT' ? 'v=spf1 ...' :
															''
														}
														style={{ flex: 1 }}
													/>
													{recordForm.type === 'A' && droplets.length > 0 && (
														<select
															onChange={(e) => setRecordForm({ ...recordForm, data: e.target.value })}
															style={{ width: 'auto' }}
														>
															<option value="">Droplet...</option>
															{droplets.map((d) => {
																const ip = getPublicIP(d);
																return ip ? (
																	<option key={d.id} value={ip}>
																		{d.name}
																	</option>
																) : null;
															})}
														</select>
													)}
												</div>
											</div>
											<div className="form-group">
												<label>TTL (seconds)</label>
												<input
													type="number"
													value={recordForm.ttl}
													onChange={(e) => setRecordForm({ ...recordForm, ttl: parseInt(e.target.value) })}
												/>
											</div>
											{['MX', 'SRV'].includes(recordForm.type) && (
												<div className="form-group">
													<label>Priority</label>
													<input
														type="number"
														value={recordForm.priority}
														onChange={(e) => setRecordForm({ ...recordForm, priority: parseInt(e.target.value) })}
													/>
												</div>
											)}
											{recordForm.type === 'SRV' && (
												<>
													<div className="form-group">
														<label>Port</label>
														<input
															type="number"
															value={recordForm.port}
															onChange={(e) => setRecordForm({ ...recordForm, port: parseInt(e.target.value) })}
														/>
													</div>
													<div className="form-group">
														<label>Weight</label>
														<input
															type="number"
															value={recordForm.weight}
															onChange={(e) => setRecordForm({ ...recordForm, weight: parseInt(e.target.value) })}
														/>
													</div>
												</>
											)}
											{recordForm.type === 'CAA' && (
												<>
													<div className="form-group">
														<label>Flags</label>
														<select
															value={recordForm.flags}
															onChange={(e) => setRecordForm({ ...recordForm, flags: parseInt(e.target.value) })}
														>
															<option value={0}>0 - Non-critical</option>
															<option value={128}>128 - Critical</option>
														</select>
													</div>
													<div className="form-group">
														<label>Tag</label>
														<select
															value={recordForm.tag}
															onChange={(e) => setRecordForm({ ...recordForm, tag: e.target.value })}
														>
															<option value="issue">issue</option>
															<option value="issuewild">issuewild</option>
															<option value="iodef">iodef</option>
														</select>
													</div>
												</>
											)}
										</div>
										<div className="form-actions">
											<button onClick={() => setShowAddRecord(false)} className="btn btn-secondary">
												Cancel
											</button>
											<button onClick={handleAddRecord} className="btn btn-primary">
												Add Record
											</button>
										</div>
									</div>
								)}

								{showEditRecord && (
									<div style={{ background: '#1a1a2e', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
										<h4 style={{ marginBottom: '1rem' }}>Edit Record (ID: {showEditRecord.id})</h4>
										<div className="form-grid">
											<div className="form-group">
												<label>Type</label>
												<input type="text" value={showEditRecord.type} disabled />
											</div>
											<div className="form-group">
												<label>Name</label>
												<input
													type="text"
													value={recordForm.name}
													onChange={(e) => setRecordForm({ ...recordForm, name: e.target.value })}
												/>
											</div>
											<div className="form-group">
												<label>Data</label>
												<input
													type="text"
													value={recordForm.data}
													onChange={(e) => setRecordForm({ ...recordForm, data: e.target.value })}
												/>
											</div>
											<div className="form-group">
												<label>TTL</label>
												<input
													type="number"
													value={recordForm.ttl}
													onChange={(e) => setRecordForm({ ...recordForm, ttl: parseInt(e.target.value) })}
												/>
											</div>
										</div>
										<div className="form-actions">
											<button onClick={() => setShowEditRecord(null)} className="btn btn-secondary">
												Cancel
											</button>
											<button onClick={handleUpdateRecord} className="btn btn-primary">
												Update
											</button>
										</div>
									</div>
								)}

								{loadingRecords ? (
									<LoadingSpinner />
								) : (
									<div>
										{Object.keys(groupedRecords).sort().map((type) => (
											<div key={type} style={{ marginBottom: '1.5rem' }}>
												<h4 style={{ color: '#58a6ff', marginBottom: '0.5rem' }}>
													{type} Records ({groupedRecords[type].length})
												</h4>
												<div className="table-container">
													<table>
														<thead>
															<tr>
																<th>Name</th>
																<th>Value</th>
																<th>TTL</th>
																{type === 'MX' && <th>Priority</th>}
																<th>Actions</th>
															</tr>
														</thead>
														<tbody>
															{groupedRecords[type].map((r) => (
																<tr key={r.id}>
																	<td>
																		<strong>{r.name === '@' ? selectedDomain : `${r.name}.${selectedDomain}`}</strong>
																	</td>
																	<td className="mono" style={{ fontSize: '0.875rem', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
																		{r.data}
																	</td>
																	<td>{r.ttl}s</td>
																	{type === 'MX' && <td>{r.priority}</td>}
																	<td>
																		<div className="action-buttons">
																			<button
																				onClick={() => copyToClipboard(r.data)}
																				className="btn btn-sm btn-secondary"
																				title="Copy value"
																			>
																				Copy
																			</button>
																			{!['NS', 'SOA'].includes(r.type) && (
																				<>
																					<button
																						onClick={() => startEditRecord(r)}
																						className="btn btn-sm btn-secondary"
																					>
																						Edit
																					</button>
																					<button
																						onClick={() => handleDeleteRecord(r.id)}
																						className="btn btn-sm btn-danger"
																					>
																						Del
																					</button>
																				</>
																			)}
																		</div>
																	</td>
																</tr>
															))}
														</tbody>
													</table>
												</div>
											</div>
										))}
										{Object.keys(groupedRecords).length === 0 && (
											<p className="text-muted">No records found. Add a record to get started.</p>
										)}
									</div>
								)}
							</Card>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ============ Main App ============

type Page = 'overview' | 'droplets' | 'services' | 'ssh-keys' | 'setup' | 'ssh-config' | 'tailscale' | 'databases' | 'dns';

function App() {
	const [page, setPage] = useState<Page>('overview');
	const [balance, setBalance] = useState<Balance | null>(null);
	const [droplets, setDroplets] = useState<Droplet[]>([]);
	const [sshKeys, setSSHKeys] = useState<SSHKey[]>([]);
	const [services, setServices] = useState<Record<string, ServiceConfig>>({});
	const [config, setConfig] = useState<Config | null>(null);
	const [loading, setLoading] = useState(true);

	const fetchData = useCallback(async () => {
		setLoading(true);
		try {
			const [balanceData, dropletsData, keysData, servicesData, configData] = await Promise.all([
				api<Balance>('/do/balance').catch(() => null),
				api<Droplet[]>('/do/droplets').catch(() => []),
				api<SSHKey[]>('/do/ssh-keys').catch(() => []),
				api<Record<string, ServiceConfig>>('/services'),
				api<Config>('/config'),
			]);
			setBalance(balanceData);
			setDroplets(dropletsData);
			setSSHKeys(keysData);
			setServices(servicesData);
			setConfig(configData);
		} catch (err) {
			console.error('Failed to fetch data:', err);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const navItems: { id: Page; label: string }[] = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'droplets', label: 'Droplets' },
		{ id: 'dns', label: 'DNS' },
		{ id: 'setup', label: 'Setup' },
		{ id: 'tailscale', label: 'Tailscale' },
		{ id: 'databases', label: 'Databases' },
		{ id: 'ssh-config', label: 'SSH Config' },
		{ id: 'services', label: 'Services' },
		{ id: 'ssh-keys', label: 'DO Keys' },
	];

	return (
		<div className="app">
			<header className="header">
				<div className="logo">Coolify Infra</div>
				<nav className="nav">
					{navItems.map((item) => (
						<button
							key={item.id}
							className={`nav-item ${page === item.id ? 'active' : ''}`}
							onClick={() => setPage(item.id)}
						>
							{item.label}
						</button>
					))}
				</nav>
			</header>

			<main className="main">
				{page === 'overview' && <Overview balance={balance} droplets={droplets} loading={loading} />}
				{page === 'droplets' && (
					<DropletsPage
						droplets={droplets}
						sshKeys={sshKeys}
						config={config}
						loading={loading}
						onRefresh={fetchData}
					/>
				)}
				{page === 'dns' && <DNSPage droplets={droplets} />}
				{page === 'setup' && <SetupPage droplets={droplets} />}
				{page === 'tailscale' && <TailscalePage />}
				{page === 'databases' && <DatabasesPage />}
				{page === 'ssh-config' && <SSHConfigPage />}
				{page === 'services' && <ServicesPage services={services} />}
				{page === 'ssh-keys' && <SSHKeysPage sshKeys={sshKeys} loading={loading} onRefresh={fetchData} />}
			</main>
		</div>
	);
}

// ============ Mount ============

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
