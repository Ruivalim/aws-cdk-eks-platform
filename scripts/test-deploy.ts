#!/usr/bin/env bun
/**
 * Test script for compose deployment
 *
 * Usage:
 *   bun scripts/test-deploy.ts
 */

import * as DB from "../src/lib/db";
import * as Compose from "../src/lib/compose";

async function main() {
  console.log("=== Ruilify Deploy Test ===\n");

  // 1. List available servers
  console.log("Available servers:");
  const servers = DB.listServers();
  const workers = servers.filter((s) => s.role === "worker");

  if (workers.length === 0) {
    console.error("No worker servers found! Setup a worker server first.");
    console.log("\nAvailable servers:");
    servers.forEach((s) =>
      console.log(`  - ${s.name} (${s.role}) - ${s.tailscale_ip}`),
    );
    process.exit(1);
  }

  workers.forEach((s, i) =>
    console.log(`  [${i}] ${s.name} - ${s.tailscale_ip}`),
  );

  // Use first worker
  const worker = workers[0];
  console.log(`\nUsing worker: ${worker.name} (${worker.tailscale_ip})`);

  // 2. Create test project
  const projectName = "postgres-test";
  let project = DB.getProjectByName(projectName);

  if (project) {
    console.log(`\nProject "${projectName}" already exists`);
  } else {
    console.log(`\nCreating project "${projectName}"...`);
    project = DB.createProject({
      name: projectName,
      repo_url: "https://github.com/ruivalim/coolify-infra.git",
      repo_branch: "ruilify",
      compose_path: "postgres/docker-compose.yaml",
      target_server: worker.id,
      deploy_type: "compose",
      port: 5432,
      env_vars: {
        POSTGRES_USER: "postgres",
        POSTGRES_PASSWORD: "testpassword123",
        POSTGRES_DB: "testdb",
      },
    });
    console.log(`Created project: ${project.id}`);
  }

  // 3. Deploy
  console.log("\n=== Starting Deploy ===\n");

  const result = await Compose.deployCompose({
    projectId: project.id,
    onProgress: (step, message) => {
      console.log(`[${step}] ${message}`);
    },
  });

  if (result.success) {
    console.log("\n=== Deploy Successful! ===");
    console.log(`Commit: ${result.commit}`);
    console.log(`\nTest connection:`);
    console.log(`  psql -h ${worker.tailscale_ip} -U postgres -d testdb`);
    console.log(`  Password: testpassword123`);
  } else {
    console.error("\n=== Deploy Failed! ===");
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

main().catch(console.error);
