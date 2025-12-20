/**
 * GitHub/Git Utilities
 *
 * Git operations via SSH + GitHub API for repo listing.
 * The deploy key is generated per server and configured manually in GitHub.
 */

import { ssh, sshOrFail } from './ssh';

// ============ GitHub API ============

const GITHUB_API_URL = 'https://api.github.com';

/**
 * Check if GitHub token is configured
 */
export function hasGitHubToken(): boolean {
	return Boolean(process.env.GITHUB_TOKEN);
}

/**
 * Get GitHub token
 */
function getToken(): string {
	const token = process.env.GITHUB_TOKEN;
	if (!token) throw new Error('GITHUB_TOKEN not configured');
	return token;
}

/**
 * Make authenticated GitHub API request
 */
async function githubFetch<T>(endpoint: string): Promise<T> {
	const token = getToken();
	const response = await fetch(`${GITHUB_API_URL}${endpoint}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
		},
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`GitHub API error: ${response.status} - ${error}`);
	}

	return response.json() as Promise<T>;
}

// ============ Repository Types ============

export interface GitHubRepo {
	id: number;
	name: string;
	full_name: string;
	private: boolean;
	html_url: string;
	clone_url: string;
	ssh_url: string;
	default_branch: string;
	description: string | null;
	updated_at: string;
	language: string | null;
}

export interface GitHubUser {
	login: string;
	name: string | null;
	avatar_url: string;
}

export interface GitHubOrg {
	login: string;
	description: string | null;
}

// ============ API Functions ============

/**
 * Get current authenticated user
 */
export async function getCurrentUser(): Promise<GitHubUser> {
	return githubFetch<GitHubUser>('/user');
}

/**
 * List user's organizations
 */
export async function listOrganizations(): Promise<GitHubOrg[]> {
	return githubFetch<GitHubOrg[]>('/user/orgs');
}

/**
 * List repositories for authenticated user
 */
export async function listUserRepos(
	sort: 'updated' | 'created' | 'pushed' | 'full_name' = 'updated',
	perPage: number = 50
): Promise<GitHubRepo[]> {
	return githubFetch<GitHubRepo[]>(`/user/repos?sort=${sort}&per_page=${perPage}&affiliation=owner,collaborator`);
}

/**
 * List repositories for an organization
 */
export async function listOrgRepos(org: string, perPage: number = 50): Promise<GitHubRepo[]> {
	return githubFetch<GitHubRepo[]>(`/orgs/${org}/repos?sort=updated&per_page=${perPage}`);
}

/**
 * Get a specific repository
 */
export async function getRepo(owner: string, repo: string): Promise<GitHubRepo> {
	return githubFetch<GitHubRepo>(`/repos/${owner}/${repo}`);
}

/**
 * List branches for a repository
 */
export async function listBranches(owner: string, repo: string): Promise<{ name: string; protected: boolean }[]> {
	return githubFetch<{ name: string; protected: boolean }[]>(`/repos/${owner}/${repo}/branches`);
}

// ============ Git Clone/Pull ============

/**
 * Clone a repository on a remote server
 */
export async function cloneRepo(
	host: string,
	repoUrl: string,
	targetDir: string,
	branch: string = 'main'
): Promise<{ success: boolean; output: string }> {
	// Ensure target directory doesn't exist or is empty
	await ssh(host, `rm -rf ${targetDir}`);

	const result = await ssh(host, `git clone --depth 1 --branch ${branch} ${repoUrl} ${targetDir}`);

	return {
		success: result.exitCode === 0,
		output: result.stdout || result.stderr,
	};
}

/**
 * Pull latest changes on a remote server
 */
export async function pullRepo(
	host: string,
	repoDir: string,
	branch: string = 'main'
): Promise<{ success: boolean; output: string; commitSha: string }> {
	// Fetch and reset to origin
	const fetchResult = await ssh(host, `cd ${repoDir} && git fetch origin ${branch}`);
	if (fetchResult.exitCode !== 0) {
		return { success: false, output: fetchResult.stderr, commitSha: '' };
	}

	const resetResult = await ssh(host, `cd ${repoDir} && git reset --hard origin/${branch}`);
	if (resetResult.exitCode !== 0) {
		return { success: false, output: resetResult.stderr, commitSha: '' };
	}

	// Get current commit SHA
	const shaResult = await ssh(host, `cd ${repoDir} && git rev-parse HEAD`);
	const commitSha = shaResult.stdout.trim().substring(0, 12);

	return {
		success: true,
		output: resetResult.stdout,
		commitSha,
	};
}

/**
 * Get the current commit info
 */
export async function getCommitInfo(
	host: string,
	repoDir: string
): Promise<{ sha: string; shortSha: string; message: string; author: string; date: string }> {
	const format = '%H|%h|%s|%an|%ci';
	const result = await sshOrFail(host, `cd ${repoDir} && git log -1 --format="${format}"`);
	const [sha, shortSha, message, author, date] = result.split('|');

	return { sha, shortSha, message, author, date };
}

/**
 * Check if a directory is a git repository
 */
export async function isGitRepo(host: string, dir: string): Promise<boolean> {
	const result = await ssh(host, `cd ${dir} && git rev-parse --is-inside-work-tree 2>/dev/null`);
	return result.exitCode === 0 && result.stdout.trim() === 'true';
}

/**
 * Get the remote URL of a repository
 */
export async function getRemoteUrl(host: string, repoDir: string): Promise<string | null> {
	const result = await ssh(host, `cd ${repoDir} && git remote get-url origin 2>/dev/null`);
	return result.exitCode === 0 ? result.stdout.trim() : null;
}

// ============ SSH Key Management ============

/**
 * Generate an SSH key pair on a server for GitHub access
 */
export async function generateDeployKey(
	host: string,
	keyName: string = 'github_deploy'
): Promise<{ privateKeyPath: string; publicKey: string }> {
	const keyPath = `/root/.ssh/${keyName}`;

	// Generate key if it doesn't exist
	const checkResult = await ssh(host, `test -f ${keyPath} && echo "exists"`);
	if (!checkResult.stdout.includes('exists')) {
		await sshOrFail(
			host,
			`ssh-keygen -t ed25519 -f ${keyPath} -N "" -C "deploy@${host}"`
		);
	}

	// Get public key
	const pubKey = await sshOrFail(host, `cat ${keyPath}.pub`);

	// Configure SSH to use this key for GitHub
	const sshConfig = `
Host github.com
  HostName github.com
  User git
  IdentityFile ${keyPath}
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
`;

	await sshOrFail(
		host,
		`mkdir -p /root/.ssh && echo '${sshConfig}' >> /root/.ssh/config && chmod 600 /root/.ssh/config`
	);

	return {
		privateKeyPath: keyPath,
		publicKey: pubKey.trim(),
	};
}

/**
 * Get the deploy key public key if it exists
 */
export async function getDeployKey(host: string, keyName: string = 'github_deploy'): Promise<string | null> {
	const keyPath = `/root/.ssh/${keyName}.pub`;
	const result = await ssh(host, `cat ${keyPath} 2>/dev/null`);
	return result.exitCode === 0 ? result.stdout.trim() : null;
}

/**
 * Test GitHub SSH connectivity
 */
export async function testGitHubConnection(host: string): Promise<boolean> {
	const result = await ssh(host, 'ssh -T git@github.com 2>&1 || true');
	// GitHub returns "successfully authenticated" even with exit code 1
	return result.stdout.includes('successfully authenticated') || result.stderr.includes('successfully authenticated');
}

// ============ URL Helpers ============

/**
 * Parse a GitHub URL and extract owner/repo
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string; isSSH: boolean } | null {
	// SSH format: git@github.com:owner/repo.git
	const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^.]+)(\.git)?$/);
	if (sshMatch) {
		return { owner: sshMatch[1], repo: sshMatch[2], isSSH: true };
	}

	// HTTPS format: https://github.com/owner/repo.git
	const httpsMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/);
	if (httpsMatch) {
		return { owner: httpsMatch[1], repo: httpsMatch[2], isSSH: false };
	}

	return null;
}

/**
 * Convert HTTPS URL to SSH URL
 */
export function toSSHUrl(url: string): string {
	const parsed = parseGitHubUrl(url);
	if (!parsed) return url;
	return `git@github.com:${parsed.owner}/${parsed.repo}.git`;
}

/**
 * Convert SSH URL to HTTPS URL
 */
export function toHTTPSUrl(url: string): string {
	const parsed = parseGitHubUrl(url);
	if (!parsed) return url;
	return `https://github.com/${parsed.owner}/${parsed.repo}.git`;
}

// ============ Build Directory ============

/**
 * Get the build workspace path for a project
 */
export function getBuildPath(projectName: string): string {
	return `/opt/builds/${projectName}`;
}

/**
 * Clean up old builds
 */
export async function cleanupBuilds(host: string, keepLast: number = 5): Promise<void> {
	// List build directories sorted by modification time
	const result = await ssh(host, 'ls -t /opt/builds 2>/dev/null || echo ""');
	const dirs = result.stdout.split('\n').filter(Boolean);

	// Remove older directories
	if (dirs.length > keepLast) {
		const toRemove = dirs.slice(keepLast);
		for (const dir of toRemove) {
			await ssh(host, `rm -rf /opt/builds/${dir}`);
		}
	}
}
