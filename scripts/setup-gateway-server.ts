#!/usr/bin/env bun
/**
 * Setup Gateway Server (CLI)
 *
 * Configures a server as the main gateway/reverse proxy:
 * - Docker
 * - Tailscale
 * - Caddy (reverse proxy with automatic HTTPS)
 * - iptables rules for security
 *
 * Usage:
 *   bun scripts/setup-gateway-server.ts --host <ssh-host>
 *   bun scripts/setup-gateway-server.ts --create  # Create new droplet first
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
║            🌐  Gateway Server Setup (Caddy)               ║
╚═══════════════════════════════════════════════════════════╝
`),
  );

  // Parse arguments
  const args = process.argv.slice(2);
  let sshHost = "";

  if (args.includes("--create")) {
    sshHost = await createGatewayDroplet();
  } else if (args.includes("--host")) {
    const hostIndex = args.indexOf("--host");
    sshHost = args[hostIndex + 1];
  } else {
    // Interactive mode
    const choice = await select({
      message: "How do you want to setup the gateway server?",
      choices: [
        { name: "Create new droplet", value: "create" },
        { name: "Use existing server (SSH host)", value: "existing" },
      ],
    });

    if (choice === "create") {
      sshHost = await createGatewayDroplet();
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
  await setupGatewayServer(sshHost);
}

async function createGatewayDroplet(): Promise<string> {
  log.step("Creating new gateway server droplet...");

  const name = await input({
    message: "Droplet name:",
    default: "gateway-server",
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
      tags: ["gateway-server"],
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

async function setupGatewayServer(sshHost: string): Promise<void> {
  log.info(`Setting up gateway server: ${sshHost}`);

  // Run setup
  let result = await Setup.setupGatewayServer(sshHost, undefined, onProgress);

  // Handle Tailscale auth if needed
  if (result.error === "TAILSCALE_AUTH_NEEDED") {
    console.log(chalk.bold("\nOpen the URL above to authenticate Tailscale"));
    console.log();

    await input({ message: "Press Enter after authenticating..." });

    // Continue setup after auth
    result = await Setup.continueAfterTailscaleAuth(
      sshHost,
      "gateway",
      onProgress,
    );
  }

  if (!result.success) {
    log.error(result.error || "Setup failed");
    process.exit(1);
  }

  // Summary
  console.log(
    chalk.bold.green(`
╔═══════════════════════════════════════════════════════════╗
║            ✓ Gateway Server Ready!                        ║
╚═══════════════════════════════════════════════════════════╝
`),
  );

  console.log(chalk.bold("Server Info:"));
  console.log(`  Hostname:     ${result.hostname}`);
  console.log(`  Public IP:    ${result.publicIp || "Unknown"}`);
  console.log(`  Tailscale IP: ${result.tailscaleIp || "Not configured"}`);
  console.log(`  Caddy:        Installed and running`);
  console.log();

  console.log(chalk.bold("Ports Open:"));
  console.log("  - 22 (SSH)");
  console.log("  - 80 (HTTP)");
  console.log("  - 443 (HTTPS)");
  console.log("  - Tailscale (all ports)");
  console.log();

  console.log(chalk.bold("Next Steps:"));
  console.log(`  1. Point your domain's DNS to: ${result.publicIp}`);
  console.log("  2. Add a project in CLI: Projects & Deploy → Add Project");
  console.log("  3. Deploy your app - Caddy will auto-configure HTTPS");
  console.log();

  console.log(chalk.bold("DNS Example:"));
  console.log(`  A record: app.yourdomain.com → ${result.publicIp}`);
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
