/**
 * Build Orchestration
 *
 * Manages the build process on the build server:
 * - Clone/pull repository
 * - Run optional build script
 * - Build Docker image
 * - Push to private registry
 */

import { ssh, sshOrFail } from './ssh';
import * as GitHub from './github';
import * as Registry from './registry';
import { getBuildServer, addDeploymentLog } from './db';
import type { Project, LogStatus } from './db';

/**
 * Get the build server host from DB or environment
 */
export function getBuildServerHost(): string {
	// Try environment first
	const envHost = process.env.BUILD_SERVER_HOST;
	if (envHost) return envHost;

	// Try database
	const server = getBuildServer();
	if (server) return server.tailscale_ip;

	throw new Error('No build server configured. Set BUILD_SERVER_HOST or run setup-build-server.ts');
}

/**
 * Build configuration
 */
export interface BuildConfig {
	project: Project;
	commitSha: string;
	deploymentId?: string;
}

/**
 * Build result
 */
export interface BuildResult {
	success: boolean;
	imageUrl: string;
	imageTag: string;
	commitSha: string;
	logs: string[];
	error?: string;
}

/**
 * Log helper for build process
 */
function createLogger(deploymentId?: string) {
	const logs: string[] = [];

	return {
		log: (step: string, status: LogStatus, message?: string) => {
			const logLine = `[${status.toUpperCase()}] ${step}${message ? ': ' + message : ''}`;
			logs.push(logLine);
			console.log(logLine);

			if (deploymentId) {
				addDeploymentLog(deploymentId, step, status, message);
			}
		},
		getLogs: () => logs,
	};
}

/**
 * Run a complete build for a project
 */
export async function runBuild(config: BuildConfig): Promise<BuildResult> {
	const { project, commitSha, deploymentId } = config;
	const logger = createLogger(deploymentId);

	const buildServerHost = getBuildServerHost();
	const buildPath = GitHub.getBuildPath(project.name);
	const registryUrl = Registry.getRegistryUrl();
	const imageTag = commitSha.substring(0, 12);
	const imageUrl = `${registryUrl}/${project.name}:${imageTag}`;

	try {
		// Step 1: Clone or pull repository
		logger.log('Clone repository', 'running');

		const repoExists = await GitHub.isGitRepo(buildServerHost, buildPath);

		if (repoExists) {
			// Check if same repo
			const remoteUrl = await GitHub.getRemoteUrl(buildServerHost, buildPath);
			if (remoteUrl !== project.repo_url) {
				// Different repo, clean and clone
				await ssh(buildServerHost, `rm -rf ${buildPath}`);
				const clone = await GitHub.cloneRepo(
					buildServerHost,
					project.repo_url,
					buildPath,
					project.repo_branch
				);
				if (!clone.success) {
					throw new Error(`Clone failed: ${clone.output}`);
				}
			} else {
				// Same repo, pull
				const pull = await GitHub.pullRepo(buildServerHost, buildPath, project.repo_branch);
				if (!pull.success) {
					throw new Error(`Pull failed: ${pull.output}`);
				}
			}
		} else {
			// Clone new
			const clone = await GitHub.cloneRepo(
				buildServerHost,
				project.repo_url,
				buildPath,
				project.repo_branch
			);
			if (!clone.success) {
				throw new Error(`Clone failed: ${clone.output}`);
			}
		}

		logger.log('Clone repository', 'done', 'Repository ready');

		// Step 2: Run build script if configured
		if (project.build_script) {
			logger.log('Run build script', 'running', project.build_script);

			const scriptPath = project.build_script.startsWith('/')
				? project.build_script
				: `${buildPath}/${project.build_script}`;

			// Make executable and run
			const result = await ssh(
				buildServerHost,
				`cd ${buildPath} && chmod +x ${scriptPath} && ${scriptPath}`
			);

			if (result.exitCode !== 0) {
				throw new Error(`Build script failed: ${result.stderr || result.stdout}`);
			}

			logger.log('Run build script', 'done');
		}

		// Step 3: Build Docker image
		logger.log('Build Docker image', 'running');

		const dockerfilePath = project.dockerfile || 'Dockerfile';
		const buildContext = project.build_context || '.';

		const buildCmd = `cd ${buildPath}/${buildContext} && docker build -f ${dockerfilePath} -t ${imageUrl} .`;
		const buildResult = await ssh(buildServerHost, buildCmd);

		if (buildResult.exitCode !== 0) {
			throw new Error(`Docker build failed: ${buildResult.stderr || buildResult.stdout}`);
		}

		logger.log('Build Docker image', 'done', `Built ${imageUrl}`);

		// Step 4: Push to registry
		logger.log('Push to registry', 'running');

		const pushResult = await Registry.pushImage(buildServerHost, imageUrl);
		if (!pushResult.success) {
			throw new Error(`Push failed: ${pushResult.output}`);
		}

		logger.log('Push to registry', 'done', imageUrl);

		// Success
		return {
			success: true,
			imageUrl,
			imageTag,
			commitSha,
			logs: logger.getLogs(),
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		logger.log('Build failed', 'error', errorMsg);

		return {
			success: false,
			imageUrl: '',
			imageTag: '',
			commitSha,
			logs: logger.getLogs(),
			error: errorMsg,
		};
	}
}

/**
 * Get the current commit SHA for a project on build server
 */
export async function getCurrentCommit(project: Project): Promise<string | null> {
	const buildServerHost = getBuildServerHost();
	const buildPath = GitHub.getBuildPath(project.name);

	try {
		const isRepo = await GitHub.isGitRepo(buildServerHost, buildPath);
		if (!isRepo) return null;

		const commitInfo = await GitHub.getCommitInfo(buildServerHost, buildPath);
		return commitInfo.shortSha;
	} catch {
		return null;
	}
}

/**
 * Check if build server is ready
 */
export async function checkBuildServer(): Promise<{
	ready: boolean;
	docker: boolean;
	registry: boolean;
	git: boolean;
	error?: string;
}> {
	try {
		const host = getBuildServerHost();

		// Check Docker
		const dockerResult = await ssh(host, 'docker --version');
		const docker = dockerResult.exitCode === 0;

		// Check Registry
		const registry = await Registry.checkRegistry(host);

		// Check Git
		const gitResult = await ssh(host, 'git --version');
		const git = gitResult.exitCode === 0;

		return {
			ready: docker && registry && git,
			docker,
			registry,
			git,
		};
	} catch (error) {
		return {
			ready: false,
			docker: false,
			registry: false,
			git: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Get build server stats
 */
export async function getBuildServerStats(): Promise<{
	diskUsage: string;
	registrySize: string;
	imagesCount: number;
	dockerInfo: string;
}> {
	const host = getBuildServerHost();

	const [diskResult, dockerResult] = await Promise.all([
		ssh(host, "df -h / | awk 'NR==2 {print $3\"/\"$2\" (\"$5\" used)\"}'"),
		ssh(host, 'docker info --format "{{.Containers}} containers, {{.Images}} images"'),
	]);

	const registrySize = await Registry.getRegistryDiskUsage(host);
	const images = await Registry.listImages(host);

	return {
		diskUsage: diskResult.stdout.trim() || 'Unknown',
		registrySize,
		imagesCount: images.length,
		dockerInfo: dockerResult.stdout.trim() || 'Unknown',
	};
}

/**
 * Clean up old builds on the build server
 */
export async function cleanupBuilds(keepLast: number = 5): Promise<void> {
	const host = getBuildServerHost();
	await GitHub.cleanupBuilds(host, keepLast);
	await Registry.cleanupOldImages(host, keepLast);
}
