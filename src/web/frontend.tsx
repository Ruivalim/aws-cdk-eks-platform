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
							<label>SSH Keys</label>
							<div className="checkbox-group">
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

// ============ Main App ============

type Page = 'overview' | 'droplets' | 'servers' | 'services' | 'ssh-keys';

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
		{ id: 'servers', label: 'Servers' },
		{ id: 'services', label: 'Services' },
		{ id: 'ssh-keys', label: 'SSH Keys' },
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
				{page === 'servers' && <ServersPage />}
				{page === 'services' && <ServicesPage services={services} />}
				{page === 'ssh-keys' && <SSHKeysPage sshKeys={sshKeys} loading={loading} onRefresh={fetchData} />}
			</main>
		</div>
	);
}

// ============ Mount ============

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
