#!/usr/bin/env bun
/**
 * Setup Build Server (CLI)
 *
 * Configures a dedicated droplet as a build server with:
 * - Docker
 * - Docker Registry (for storing built images)
 * - Git
 * - SSH key for GitHub access
 * - Tailscale
 *
 * Usage:
 *   bun scripts/setup-build-server.ts --host <ssh-host>
 *   bun scripts/setup-build-server.ts --create  # Create new droplet first
 */

import { select, input } from "@inquirer/prompts";
import chalk from "chalk";
import * as DO from "../src/lib/digitalocean";
import * as Setup from "../src/lib/setup";

const log = {
  info: (msg: string) => console.log(chalk.blue("ℹ"), msg),
  success: (msg: string) => console.log(chalk.green("✓"), msg),
  error: (msg: string) => console.log(chalk.red("✗"), msg),
  step: (msg: string) => console.log(chalk.yellow("→"), msg),
  warn: (msg: string) => console.log(chalk.yellow("⚠"), msg),
};

// Progress callback for CLI output
const onProgress: Setup.ProgressCallback = (progress) => {
  switch (progress.status) {
    case "running":
      log.step(progress.message || progress.step);
      break;
    case "done":
      log.success(progress.message || progress.step);
      break;
    case "error":
      log.error(progress.message || progress.step);
      break;
    case "waiting":
      log.warn(progress.message || "Waiting for input...");
      break;
  }
};

async function main() {
  console.log(
    chalk.bold.blue(`
╔═══════════════════════════════════════════════════════════╗
║            🔧 Build Server Setup                          ║
╚═══════════════════════════════════════════════════════════╝
`),
  );

  // Parse arguments
  const args = process.argv.slice(2);
  let sshHost = "";

  if (args.includes("--create")) {
    sshHost = await createBuildDroplet();
  } else if (args.includes("--host")) {
    const hostIndex = args.indexOf("--host");
    sshHost = args[hostIndex + 1];
  } else {
    // Interactive mode
    const choice = await select({
      message: "How do you want to setup the build server?",
      choices: [
        { name: "Create new droplet", value: "create" },
        { name: "Use existing server (SSH host)", value: "existing" },
      ],
    });

    if (choice === "create") {
      sshHost = await createBuildDroplet();
    } else {
      sshHost = await input({
        message: "SSH host (e.g., root@1.2.3.4 or hostname):",
        validate: (v) => v.length > 0 || "Required",
      });
    }
  }

  if (!sshHost) {
    log.error("No SSH host provided");
    process.exit(1);
  }

  // Run setup
  await setupBuildServer(sshHost);
}

async function createBuildDroplet(): Promise<string> {
  log.step("Creating new build server droplet...");

  const name = await input({
    message: "Droplet name:",
    default: "build-server",
  });

  const region = await select({
    message: "Region:",
    choices: DO.RECOMMENDED_REGIONS.map((r) => ({
      name: r.name,
      value: r.slug,
    })),
  });

  const size = await select({
    message: "Size:",
    choices: DO.RECOMMENDED_SIZES.map((s) => ({
      name: `${s.name} - $${s.price}/mo`,
      value: s.slug,
    })),
  });

  const sshKeys = await DO.listSSHKeys();
  const selectedKey = await select({
    message: "SSH key to use:",
    choices: sshKeys.map((k) => ({ name: k.name, value: k.id.toString() })),
  });

  const result = await Setup.createDroplet(
    {
      name,
      region,
      size,
      sshKeyId: selectedKey,
      tags: ["build-server"],
    },
    onProgress,
  );

  if (!result.success || !result.sshHost) {
    log.error(result.error || "Failed to create droplet");
    process.exit(1);
  }

  log.success(`Droplet created with IP: ${result.publicIp}`);
  return result.sshHost;
}

async function setupBuildServer(sshHost: string): Promise<void> {
  log.info(`Setting up build server: ${sshHost}`);

  // Run setup
  let result = await Setup.setupBuildServer(sshHost, onProgress);

  // Handle Tailscale auth if needed
  if (result.error === "TAILSCALE_AUTH_NEEDED") {
    console.log(chalk.bold("\nOpen the URL above to authenticate Tailscale"));
    console.log();

    await input({ message: "Press Enter after authenticating..." });

    // Continue setup after auth
    result = await Setup.continueAfterTailscaleAuth(
      sshHost,
      "build",
      onProgress,
    );
    // Preserve deploy key from partial result
    if (!result.deployKey) {
      // Re-fetch if needed
      const keyResult = await Setup.generateGitHubDeployKey(
        sshHost,
        onProgress,
      );
      result.deployKey = keyResult || undefined;
    }
  }

  if (!result.success) {
    log.error(result.error || "Setup failed");
    process.exit(1);
  }

  // Summary
  console.log(
    chalk.bold.green(`
╔═══════════════════════════════════════════════════════════╗
║            ✓ Build Server Ready!                          ║
╚═══════════════════════════════════════════════════════════╝
`),
  );

  console.log(chalk.bold("Server Info:"));
  console.log(`  Hostname:     ${result.hostname}`);
  console.log(`  Tailscale IP: ${result.tailscaleIp || "Not configured"}`);
  console.log();

  console.log(chalk.bold("Docker Registry:"));
  console.log(`  URL: ${result.registryUrl}`);
  console.log(`  Example: docker push ${result.registryUrl}/myapp:latest`);
  console.log();

  if (result.deployKey) {
    console.log(chalk.bold("GitHub Deploy Key (add to your repos):"));
    console.log(chalk.dim("─".repeat(60)));
    console.log(chalk.cyan(result.deployKey));
    console.log(chalk.dim("─".repeat(60)));
    console.log();
    console.log(
      chalk.dim(
        "Add this key at: https://github.com/<owner>/<repo>/settings/keys",
      ),
    );
    console.log();
  }

  if (result.tailscaleIp) {
    console.log(chalk.bold("Add to your .env:"));
    console.log(
      chalk.cyan(
        `BUILD_SERVER_HOST=${sshHost.includes("@") ? sshHost : `root@${result.tailscaleIp}`}`,
      ),
    );
    console.log(chalk.cyan(`REGISTRY_URL=${result.registryUrl}`));
  }
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
