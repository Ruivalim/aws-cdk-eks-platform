/**
 * SSH utilities for remote server management
 */

export interface SSHResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export async function ssh(host: string, command: string): Promise<SSHResult> {
	const proc = Bun.spawn(['ssh', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new', host, command], {
		stdout: 'pipe',
		stderr: 'pipe',
	});

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

export async function sshOrFail(host: string, command: string): Promise<string> {
	const result = await ssh(host, command);
	if (result.exitCode !== 0) {
		throw new Error(`Command failed: ${command}\n${result.stderr}`);
	}
	return result.stdout;
}

export async function testConnection(host: string): Promise<boolean> {
	const result = await ssh(host, 'echo "OK"');
	return result.exitCode === 0 && result.stdout.includes('OK');
}

export async function getServerInfo(host: string): Promise<{
	hostname: string;
	os: string;
	kernel: string;
	uptime: string;
	memory: { total: string; used: string; free: string };
	disk: { total: string; used: string; free: string; percent: string };
	docker: boolean;
	tailscale: { installed: boolean; ip: string | null };
	coolify: boolean;
}> {
	const [hostnameRes, osRes, kernelRes, uptimeRes, memRes, diskRes, dockerRes, tailscaleRes, coolifyRes] =
		await Promise.all([
			ssh(host, 'hostname'),
			ssh(host, 'cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\''),
			ssh(host, 'uname -r'),
			ssh(host, 'uptime -p'),
			ssh(host, "free -h | awk '/^Mem:/ {print $2\"|\"$3\"|\"$4}'"),
			ssh(host, "df -h / | awk 'NR==2 {print $2\"|\"$3\"|\"$4\"|\"$5}'"),
			ssh(host, 'docker --version'),
			ssh(host, 'tailscale ip -4'),
			ssh(host, 'docker ps --format "{{.Names}}" | grep -E "^coolify$"'),
		]);

	const memParts = memRes.stdout.split('|');
	const diskParts = diskRes.stdout.split('|');

	return {
		hostname: hostnameRes.stdout || 'unknown',
		os: osRes.stdout || 'unknown',
		kernel: kernelRes.stdout || 'unknown',
		uptime: uptimeRes.stdout?.replace('up ', '') || 'unknown',
		memory: {
			total: memParts[0] || '?',
			used: memParts[1] || '?',
			free: memParts[2] || '?',
		},
		disk: {
			total: diskParts[0] || '?',
			used: diskParts[1] || '?',
			free: diskParts[2] || '?',
			percent: diskParts[3] || '?',
		},
		docker: dockerRes.exitCode === 0,
		tailscale: {
			installed: tailscaleRes.exitCode === 0,
			ip: tailscaleRes.exitCode === 0 ? tailscaleRes.stdout : null,
		},
		coolify: coolifyRes.exitCode === 0 && coolifyRes.stdout.includes('coolify'),
	};
}

export async function getDockerContainers(
	host: string
): Promise<Array<{ name: string; image: string; status: string; ports: string }>> {
	const result = await ssh(host, 'docker ps --format "{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}"');
	if (result.exitCode !== 0) return [];

	return result.stdout
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [name, image, status, ports] = line.split('|');
			return { name, image, status, ports: ports || '' };
		});
}

export async function getDockerStats(host: string): Promise<Array<{ name: string; cpu: string; memory: string }>> {
	const result = await ssh(host, 'docker stats --no-stream --format "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}"');
	if (result.exitCode !== 0) return [];

	return result.stdout
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [name, cpu, memory] = line.split('|');
			return { name, cpu, memory };
		});
}
