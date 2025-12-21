#!/usr/bin/env bun
/**
 * Test script for CloudBeaver deployment with auto domain setup
 */

import * as DB from "../src/lib/db";
import * as Compose from "../src/lib/compose";

async function main() {
  console.log("=== CloudBeaver Deploy Test ===\n");

  // 1. Get worker server
  const servers = DB.listServers();
  const workers = servers.filter((s) => s.role === "worker");

  if (workers.length === 0) {
    console.error("No worker servers found!");
    process.exit(1);
  }

  const worker = workers[0];
  console.log(`Worker: ${worker.name} (${worker.tailscale_ip})`);

  // Check gateway server
  const gateway = DB.getGatewayServer();
  if (!gateway) {
    console.error("No gateway server found!");
    process.exit(1);
  }
  console.log(`Gateway: ${gateway.name} (${gateway.public_ip})\n`);

  // 2. Create or get project
  const projectName = "cloudbeaver";
  const domain = "db.ruivalim.com.br";
  let project = DB.getProjectByName(projectName);

  if (project) {
    console.log(`Project "${projectName}" already exists`);
    // Update domain if needed
    if (project.domain !== domain) {
      DB.updateProject(project.id, { domain });
      project = DB.getProject(project.id)!;
      console.log(`Updated domain to: ${domain}`);
    }
  } else {
    console.log(`Creating project "${projectName}"...`);
    project = DB.createProject({
      name: projectName,
      repo_url: "git@github.com:ruivalim/coolify-infra.git",
      repo_branch: "ruilify",
      compose_path: "cloudbeaver/docker-compose.yaml",
      target_server: worker.id,
      deploy_type: "compose",
      port: 8978,
      domain,
      env_vars: {
        CB_ADMIN_NAME: "admin",
        CB_ADMIN_PASSWORD: "admin123",
      },
    });
    console.log(`Created project: ${project.id}`);
  }

  console.log(`Domain: ${domain}`);
  console.log(`Port: ${project.port}\n`);

  // 3. Deploy
  console.log("=== Starting Deploy ===\n");

  const result = await Compose.deployCompose({
    projectId: project.id,
    onProgress: (step, message) => {
      console.log(`[${step}] ${message}`);
    },
  });

  if (result.success) {
    console.log("\n=== Deploy Successful! ===");
    console.log(`Commit: ${result.commit}`);
    console.log(`\nAccess URLs:`);
    console.log(`  Internal: http://${worker.tailscale_ip}:8978`);
    console.log(`  Public:   https://${domain}`);
  } else {
    console.error("\n=== Deploy Failed! ===");
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

main().catch(console.error);
