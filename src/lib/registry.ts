/**
 * Docker Registry Utilities
 *
 * Manages interaction with the private Docker registry on the build server.
 */

import { ssh } from './ssh';

/**
 * Get the registry URL from environment or default
 */
export function getRegistryUrl(): string {
	const url = process.env.REGISTRY_URL;
	if (!url) {
		throw new Error('REGISTRY_URL environment variable is required');
	}
	return url;
}

/**
 * Check if the registry is reachable
 */
export async function checkRegistry(buildServerHost: string): Promise<boolean> {
	const result = await ssh(buildServerHost, 'curl -s http://localhost:5000/v2/ 2>/dev/null');
	return result.exitCode === 0 && result.stdout.includes('{}');
}

/**
 * Build an image name with registry prefix
 */
export function buildImageName(projectName: string, tag: string): string {
	const registry = getRegistryUrl();
	return `${registry}/${projectName}:${tag}`;
}

/**
 * List images in the registry
 */
export async function listImages(buildServerHost: string): Promise<string[]> {
	const result = await ssh(
		buildServerHost,
		'curl -s http://localhost:5000/v2/_catalog 2>/dev/null'
	);

	if (result.exitCode !== 0) {
		return [];
	}

	try {
		const data = JSON.parse(result.stdout);
		return data.repositories || [];
	} catch {
		return [];
	}
}

/**
 * List tags for an image
 */
export async function listTags(buildServerHost: string, imageName: string): Promise<string[]> {
	const result = await ssh(
		buildServerHost,
		`curl -s http://localhost:5000/v2/${imageName}/tags/list 2>/dev/null`
	);

	if (result.exitCode !== 0) {
		return [];
	}

	try {
		const data = JSON.parse(result.stdout);
		return data.tags || [];
	} catch {
		return [];
	}
}

/**
 * Check if a specific image:tag exists
 */
export async function imageExists(
	buildServerHost: string,
	imageName: string,
	tag: string
): Promise<boolean> {
	const tags = await listTags(buildServerHost, imageName);
	return tags.includes(tag);
}

/**
 * Delete an image tag from the registry
 * Note: This marks for garbage collection, doesn't immediately free space
 */
export async function deleteImage(
	buildServerHost: string,
	imageName: string,
	tag: string
): Promise<boolean> {
	// Get the digest for the tag
	const digestResult = await ssh(
		buildServerHost,
		`curl -s -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
		-I http://localhost:5000/v2/${imageName}/manifests/${tag} 2>/dev/null | \
		grep -i docker-content-digest | cut -d' ' -f2 | tr -d '\\r'`
	);

	if (digestResult.exitCode !== 0 || !digestResult.stdout.trim()) {
		return false;
	}

	const digest = digestResult.stdout.trim();

	// Delete by digest
	const deleteResult = await ssh(
		buildServerHost,
		`curl -s -X DELETE http://localhost:5000/v2/${imageName}/manifests/${digest}`
	);

	return deleteResult.exitCode === 0;
}

/**
 * Run garbage collection on the registry to free up space
 */
export async function runGarbageCollection(buildServerHost: string): Promise<{ success: boolean; output: string }> {
	const result = await ssh(
		buildServerHost,
		'docker exec registry bin/registry garbage-collect /etc/docker/registry/config.yml 2>&1'
	);

	return {
		success: result.exitCode === 0,
		output: result.stdout || result.stderr,
	};
}

/**
 * Get registry disk usage
 */
export async function getRegistryDiskUsage(buildServerHost: string): Promise<string> {
	const result = await ssh(buildServerHost, 'du -sh /opt/registry 2>/dev/null');
	if (result.exitCode !== 0) {
		return 'Unknown';
	}
	return result.stdout.split('\t')[0] || 'Unknown';
}

/**
 * Configure Docker on a target server to trust the insecure registry
 */
export async function configureDockerForRegistry(
	targetHost: string,
	registryUrl: string
): Promise<void> {
	const daemonJson = JSON.stringify(
		{
			'insecure-registries': [registryUrl],
		},
		null,
		2
	);

	await ssh(
		targetHost,
		`mkdir -p /etc/docker && echo '${daemonJson}' > /etc/docker/daemon.json && systemctl restart docker`
	);
}

/**
 * Pull an image on a target server
 */
export async function pullImage(
	targetHost: string,
	imageUrl: string
): Promise<{ success: boolean; output: string }> {
	const result = await ssh(targetHost, `docker pull ${imageUrl}`);
	return {
		success: result.exitCode === 0,
		output: result.stdout || result.stderr,
	};
}

/**
 * Push an image from build server to registry
 */
export async function pushImage(
	buildServerHost: string,
	imageUrl: string
): Promise<{ success: boolean; output: string }> {
	const result = await ssh(buildServerHost, `docker push ${imageUrl}`);
	return {
		success: result.exitCode === 0,
		output: result.stdout || result.stderr,
	};
}

/**
 * Tag an image for the registry
 */
export async function tagImage(
	host: string,
	sourceImage: string,
	targetImage: string
): Promise<boolean> {
	const result = await ssh(host, `docker tag ${sourceImage} ${targetImage}`);
	return result.exitCode === 0;
}

/**
 * Clean up old images on build server (keep last N tags per image)
 */
export async function cleanupOldImages(
	buildServerHost: string,
	keepLast: number = 5
): Promise<{ cleaned: number; images: string[] }> {
	const images = await listImages(buildServerHost);
	const cleaned: string[] = [];

	for (const image of images) {
		const tags = await listTags(buildServerHost, image);

		// Sort tags by creation (assuming tags are timestamp-based or semver)
		// Keep the last N
		if (tags.length > keepLast) {
			const toDelete = tags.slice(0, tags.length - keepLast);
			for (const tag of toDelete) {
				const deleted = await deleteImage(buildServerHost, image, tag);
				if (deleted) {
					cleaned.push(`${image}:${tag}`);
				}
			}
		}
	}

	// Run garbage collection if we deleted anything
	if (cleaned.length > 0) {
		await runGarbageCollection(buildServerHost);
	}

	return {
		cleaned: cleaned.length,
		images: cleaned,
	};
}
