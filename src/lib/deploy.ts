/**
 * Deployment Orchestration
 *
 * Manages blue-green deployments:
 * - Pull image on target server
 * - Start new container
 * - Health check
 * - Switch traffic (via Caddy reverse proxy)
 * - Stop old container
 */

import { ssh, sshOrFail } from './ssh';
import * as Registry from './registry';
import * as Build from './build';
import * as Caddy from './caddy';
import * as DB from './db';
import type { Project, Deployment, DeploymentState, LogStatus } from './db';

// ============ Types ============

export type Slot = 'blue' | 'green';

export interface DeployConfig {
	project: Project;
	imageUrl: string;
	imageTag: string;
	commitSha: string;
	commitMessage?: string;
}

export interface DeployResult {
	success: boolean;
	deploymentId: string;
	slot: Slot;
	error?: string;
}

// ============ Slot Management ============

/**
 * Get the container name for a slot
 */
function getContainerName(projectName: string, slot: Slot): string {
	return `${projectName}-${slot}`;
}

/**
 * Get the port for a slot
 */
function getSlotPort(slot: Slot): number {
	return slot === 'blue' ? 3000 : 3001;
}

/**
 * Get the inactive slot
 */
function getInactiveSlot(currentSlot: Slot | null): Slot {
	if (!currentSlot) return 'blue';
	return currentSlot === 'blue' ? 'green' : 'blue';
}

/**
 * Check if a container is running
 */
async function isContainerRunning(host: string, containerName: string): Promise<boolean> {
	const result = await ssh(host, `docker ps --format "{{.Names}}" | grep -q "^${containerName}$"`);
	return result.exitCode === 0;
}

/**
 * Get container info
 */
async function getContainerInfo(
	host: string,
	containerName: string
): Promise<{ running: boolean; image: string; port: number } | null> {
	const result = await ssh(
		host,
		`docker inspect ${containerName} --format '{{.State.Running}}|{{.Config.Image}}|{{range .NetworkSettings.Ports}}{{.}}{{end}}' 2>/dev/null`
	);

	if (result.exitCode !== 0) return null;

	const [running, image, portInfo] = result.stdout.trim().split('|');
	const portMatch = portInfo?.match(/:(\d+)/);

	return {
		running: running === 'true',
		image,
		port: portMatch ? parseInt(portMatch[1], 10) : 0,
	};
}

// ============ Health Checks ============

/**
 * Wait for container to be healthy
 */
export async function waitForHealthy(
	host: string,
	port: number,
	path: string,
	timeoutMs: number = 30000
): Promise<{ healthy: boolean; responseTime?: number; error?: string }> {
	const startTime = Date.now();
	const checkInterval = 2000; // Check every 2 seconds
	const url = `http://localhost:${port}${path}`;

	while (Date.now() - startTime < timeoutMs) {
		const checkStart = Date.now();
		const result = await ssh(host, `curl -sf -o /dev/null -w "%{http_code}" ${url} 2>/dev/null`);

		if (result.exitCode === 0) {
			const statusCode = parseInt(result.stdout.trim(), 10);
			if (statusCode >= 200 && statusCode < 400) {
				return {
					healthy: true,
					responseTime: Date.now() - checkStart,
				};
			}
		}

		await new Promise((r) => setTimeout(r, checkInterval));
	}

	return {
		healthy: false,
		error: `Health check failed after ${timeoutMs}ms`,
	};
}

/**
 * Run a single health check
 */
export async function runHealthCheck(
	host: string,
	port: number,
	path: string
): Promise<{ ok: boolean; status: number; responseTime: number }> {
	const start = Date.now();
	const result = await ssh(
		host,
		`curl -sf -o /dev/null -w "%{http_code}" http://localhost:${port}${path} 2>/dev/null`
	);

	const responseTime = Date.now() - start;
	const status = result.exitCode === 0 ? parseInt(result.stdout.trim(), 10) : 0;

	return {
		ok: status >= 200 && status < 400,
		status,
		responseTime,
	};
}

// ============ Container Operations ============

/**
 * Start a new container
 */
async function startContainer(
	host: string,
	containerName: string,
	imageUrl: string,
	port: number,
	envVars: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
	// Build env var arguments
	const envArgs = Object.entries(envVars)
		.map(([k, v]) => `-e "${k}=${v}"`)
		.join(' ');

	// Stop and remove if exists
	await ssh(host, `docker rm -f ${containerName} 2>/dev/null || true`);

	// Start new container
	const cmd = `docker run -d --name ${containerName} --restart unless-stopped \
		-p ${port}:${port} ${envArgs} ${imageUrl}`;

	const result = await ssh(host, cmd);

	if (result.exitCode !== 0) {
		return {
			success: false,
			error: result.stderr || result.stdout,
		};
	}

	return { success: true };
}

/**
 * Stop a container
 */
async function stopContainer(host: string, containerName: string): Promise<void> {
	await ssh(host, `docker stop ${containerName} 2>/dev/null || true`);
	await ssh(host, `docker rm ${containerName} 2>/dev/null || true`);
}

// ============ Traffic Switching ============

/**
 * Update Caddy reverse proxy to point to new slot
 */
async function switchTraffic(
	project: Project,
	slot: Slot
): Promise<{ success: boolean; error?: string }> {
	try {
		// Check if gateway server is configured
		const gateway = DB.getGatewayServer();
		if (!gateway) {
			// No gateway configured, skip traffic switching
			console.log('  (No gateway server configured, skipping traffic switch)');
			return { success: true };
		}

		// Update Caddy route
		const result = await Caddy.updateRoute(project.domain, project.target_server, slot);
		return result;
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

// ============ Main Deploy Function ============

/**
 * Run a complete deployment
 */
export async function runDeploy(config: DeployConfig): Promise<DeployResult> {
	const { project, imageUrl, imageTag, commitSha, commitMessage } = config;
	const targetHost = project.target_server;

	// Create deployment record
	const deployment = DB.createDeployment({
		project_id: project.id,
		commit_sha: commitSha,
		commit_message: commitMessage,
		triggered_by: 'manual',
	});

	const log = (step: string, status: LogStatus, message?: string) => {
		DB.addDeploymentLog(deployment.id, step, status, message);
		const icon = status === 'done' ? '✓' : status === 'error' ? '✗' : '→';
		console.log(`${icon} ${step}${message ? ': ' + message : ''}`);
	};

	try {
		// Determine slot to deploy to
		const currentSlot = project.current_slot as Slot | null;
		const targetSlot = getInactiveSlot(currentSlot);
		const containerName = getContainerName(project.name, targetSlot);
		const port = getSlotPort(targetSlot);

		DB.updateDeployment(deployment.id, { slot: targetSlot, state: 'deploying' });

		// Step 1: Configure Docker for registry if needed
		log('Configure Docker', 'running');
		const registryUrl = Registry.getRegistryUrl();
		await Registry.configureDockerForRegistry(targetHost, registryUrl);
		log('Configure Docker', 'done');

		// Step 2: Pull image
		log('Pull image', 'running', imageUrl);
		DB.updateDeployment(deployment.id, { state: 'deploying', image_tag: imageTag });

		const pullResult = await Registry.pullImage(targetHost, imageUrl);
		if (!pullResult.success) {
			throw new Error(`Failed to pull image: ${pullResult.output}`);
		}
		log('Pull image', 'done');

		// Step 3: Prepare environment variables
		const envVars = {
			...project.env_vars,
			PORT: port.toString(),
			NODE_ENV: 'production',
		};

		// Step 4: Start new container
		log('Start container', 'running', `${containerName} on port ${port}`);

		const startResult = await startContainer(targetHost, containerName, imageUrl, port, envVars);
		if (!startResult.success) {
			throw new Error(`Failed to start container: ${startResult.error}`);
		}
		log('Start container', 'done');

		// Step 5: Health check
		log('Health check', 'running', project.health_check_path);
		DB.updateDeployment(deployment.id, { state: 'health_checking' });

		const healthTimeout = parseInt(process.env.HEALTH_CHECK_TIMEOUT || '30000', 10);
		const healthResult = await waitForHealthy(
			targetHost,
			port,
			project.health_check_path,
			healthTimeout
		);

		if (!healthResult.healthy) {
			// Rollback: stop the new container
			await stopContainer(targetHost, containerName);
			throw new Error(healthResult.error || 'Health check failed');
		}
		log('Health check', 'done', `Response time: ${healthResult.responseTime}ms`);

		// Step 6: Switch traffic (update Caddy reverse proxy)
		log('Switch traffic', 'running');
		DB.updateDeployment(deployment.id, { state: 'switching_traffic' });

		const switchResult = await switchTraffic(project, targetSlot);
		if (!switchResult.success) {
			console.warn(`Warning: Failed to update Caddy: ${switchResult.error}`);
			// Continue anyway, gateway might not be configured
		}
		log('Switch traffic', 'done');

		// Step 7: Stop old container
		if (currentSlot) {
			log('Stop old container', 'running');
			DB.updateDeployment(deployment.id, { state: 'cleaning_up' });

			const oldContainerName = getContainerName(project.name, currentSlot);
			// Wait a bit for in-flight requests
			await new Promise((r) => setTimeout(r, 5000));
			await stopContainer(targetHost, oldContainerName);

			log('Stop old container', 'done');
		}

		// Success!
		DB.updateProject(project.id, {
			current_slot: targetSlot,
			current_image_tag: imageTag,
		});
		DB.markDeploymentCompleted(deployment.id);

		log('Deployment complete', 'done', `Slot: ${targetSlot}`);

		return {
			success: true,
			deploymentId: deployment.id,
			slot: targetSlot,
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		log('Deployment failed', 'error', errorMsg);
		DB.markDeploymentFailed(deployment.id, errorMsg);

		return {
			success: false,
			deploymentId: deployment.id,
			slot: 'blue',
			error: errorMsg,
		};
	}
}

/**
 * Full deploy pipeline: Build + Deploy
 */
export async function fullDeploy(
	project: Project,
	commitSha?: string
): Promise<{ success: boolean; deploymentId?: string; error?: string }> {
	// Step 1: Build
	console.log('\n=== Building ===\n');

	const buildConfig: Build.BuildConfig = {
		project,
		commitSha: commitSha || 'HEAD',
	};

	const buildResult = await Build.runBuild(buildConfig);

	if (!buildResult.success) {
		return {
			success: false,
			error: `Build failed: ${buildResult.error}`,
		};
	}

	// Step 2: Deploy
	console.log('\n=== Deploying ===\n');

	const deployConfig: DeployConfig = {
		project,
		imageUrl: buildResult.imageUrl,
		imageTag: buildResult.imageTag,
		commitSha: buildResult.commitSha,
	};

	const deployResult = await runDeploy(deployConfig);

	return {
		success: deployResult.success,
		deploymentId: deployResult.deploymentId,
		error: deployResult.error,
	};
}

/**
 * Rollback to a previous deployment
 */
export async function rollback(
	project: Project,
	targetDeployment: Deployment
): Promise<DeployResult> {
	if (!targetDeployment.image_tag) {
		return {
			success: false,
			deploymentId: '',
			slot: 'blue',
			error: 'No image tag in target deployment',
		};
	}

	const registryUrl = Registry.getRegistryUrl();
	const imageUrl = `${registryUrl}/${project.name}:${targetDeployment.image_tag}`;

	// Create rollback deployment
	const deployment = DB.createDeployment({
		project_id: project.id,
		commit_sha: targetDeployment.commit_sha,
		commit_message: `Rollback to ${targetDeployment.commit_sha.substring(0, 8)}`,
		triggered_by: 'rollback',
	});

	const result = await runDeploy({
		project,
		imageUrl,
		imageTag: targetDeployment.image_tag,
		commitSha: targetDeployment.commit_sha,
		commitMessage: `Rollback to ${targetDeployment.commit_sha.substring(0, 8)}`,
	});

	return result;
}

/**
 * Get current deployment status for a project
 */
export async function getDeploymentStatus(project: Project): Promise<{
	blue: { running: boolean; image?: string; port: number };
	green: { running: boolean; image?: string; port: number };
	active: Slot | null;
}> {
	const host = project.target_server;

	const [blueInfo, greenInfo] = await Promise.all([
		getContainerInfo(host, getContainerName(project.name, 'blue')),
		getContainerInfo(host, getContainerName(project.name, 'green')),
	]);

	return {
		blue: {
			running: blueInfo?.running || false,
			image: blueInfo?.image,
			port: getSlotPort('blue'),
		},
		green: {
			running: greenInfo?.running || false,
			image: greenInfo?.image,
			port: getSlotPort('green'),
		},
		active: project.current_slot as Slot | null,
	};
}
