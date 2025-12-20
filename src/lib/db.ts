/**
 * SQLite Database Layer
 *
 * Local database for managing projects, deployments, and servers.
 * Uses Bun's built-in SQLite support with migrations.
 */

import { Database } from "bun:sqlite";
import { join } from "path";
import { randomUUID } from "crypto";

const DB_PATH = join(import.meta.dir, "../../data/deployments.db");

let _db: Database | null = null;

// ============ Database Connection ============

export function getDb(): Database {
  if (!_db) {
    _db = new Database(DB_PATH, { create: true });
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");
    initializeDatabase(_db);
    runMigrations(_db);
  }
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ============ Migrations ============

interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    up: (db) => {
      // Base tables already created in initializeDatabase
    },
  },
  {
    version: 2,
    name: "add_settings_table",
    up: (db) => {
      db.exec(`
				CREATE TABLE IF NOT EXISTS settings (
					key TEXT PRIMARY KEY,
					value TEXT,
					updated_at TEXT DEFAULT (datetime('now'))
				);
			`);
    },
  },
  {
    version: 3,
    name: "add_project_deploy_fields",
    up: (db) => {
      // Add new columns for compose-based deployments
      db.exec(`
				ALTER TABLE projects ADD COLUMN compose_path TEXT DEFAULT 'docker-compose.yml';
				ALTER TABLE projects ADD COLUMN has_build INTEGER DEFAULT 0;
				ALTER TABLE projects ADD COLUMN build_service TEXT;
				ALTER TABLE projects ADD COLUMN port INTEGER DEFAULT 3000;
				ALTER TABLE projects ADD COLUMN port_mappings TEXT DEFAULT '{}';
				ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'pending';
				ALTER TABLE projects ADD COLUMN current_commit TEXT;
			`);
    },
  },
];

function runMigrations(db: Database): void {
  // Create migrations table if not exists
  db.exec(`
		CREATE TABLE IF NOT EXISTS _migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TEXT DEFAULT (datetime('now'))
		);
	`);

  // Get current version
  const result = db
    .prepare("SELECT MAX(version) as version FROM _migrations")
    .get() as { version: number | null };
  const currentVersion = result?.version || 0;

  // Run pending migrations
  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      try {
        migration.up(db);
        db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(
          migration.version,
          migration.name,
        );
        console.log(
          `Migration ${migration.version}: ${migration.name} applied`,
        );
      } catch (err) {
        console.error(`Migration ${migration.version} failed:`, err);
        throw err;
      }
    }
  }
}

export function getMigrationVersion(): number {
  const db = getDb();
  const result = db
    .prepare("SELECT MAX(version) as version FROM _migrations")
    .get() as { version: number | null };
  return result?.version || 0;
}

function initializeDatabase(db: Database): void {
  db.exec(`
		-- Projects table
		CREATE TABLE IF NOT EXISTS projects (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			repo_url TEXT NOT NULL,
			repo_branch TEXT NOT NULL DEFAULT 'main',
			is_private INTEGER NOT NULL DEFAULT 0,
			deploy_type TEXT NOT NULL DEFAULT 'dockerfile' CHECK(deploy_type IN ('dockerfile', 'compose')),
			build_context TEXT NOT NULL DEFAULT '.',
			dockerfile TEXT NOT NULL DEFAULT 'Dockerfile',
			build_script TEXT,
			target_server TEXT NOT NULL,
			domain TEXT,
			health_check_path TEXT NOT NULL DEFAULT '/health',
			env_vars TEXT NOT NULL DEFAULT '{}',
			current_slot TEXT CHECK(current_slot IN ('blue', 'green')),
			current_image_tag TEXT,
			webhook_secret TEXT NOT NULL,
			created_at TEXT DEFAULT (datetime('now')),
			updated_at TEXT DEFAULT (datetime('now'))
		);

		-- Deployments table
		CREATE TABLE IF NOT EXISTS deployments (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			commit_sha TEXT NOT NULL,
			commit_message TEXT,
			state TEXT NOT NULL DEFAULT 'pending',
			slot TEXT CHECK(slot IN ('blue', 'green')),
			image_tag TEXT,
			triggered_by TEXT NOT NULL DEFAULT 'manual' CHECK(triggered_by IN ('webhook', 'manual', 'rollback')),
			started_at TEXT DEFAULT (datetime('now')),
			finished_at TEXT,
			error TEXT,
			FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
		);

		-- Deployment logs table
		CREATE TABLE IF NOT EXISTS deployment_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			deployment_id TEXT NOT NULL,
			step TEXT NOT NULL,
			status TEXT NOT NULL CHECK(status IN ('running', 'done', 'error', 'skipped')),
			message TEXT,
			timestamp TEXT DEFAULT (datetime('now')),
			FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE
		);

		-- Servers table
		CREATE TABLE IF NOT EXISTS servers (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			tailscale_ip TEXT NOT NULL UNIQUE,
			public_ip TEXT,
			role TEXT NOT NULL CHECK(role IN ('master', 'worker', 'build', 'gateway')),
			tunnel_id TEXT,
			status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
			last_health_check TEXT,
			created_at TEXT DEFAULT (datetime('now'))
		);

		-- Settings table (key-value store for configuration)
		CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT,
			updated_at TEXT DEFAULT (datetime('now'))
		);

		-- Indexes
		CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id);
		CREATE INDEX IF NOT EXISTS idx_deployments_state ON deployments(state);
		CREATE INDEX IF NOT EXISTS idx_deployment_logs_deployment ON deployment_logs(deployment_id);
		CREATE INDEX IF NOT EXISTS idx_servers_role ON servers(role);
	`);
}

// ============ Types ============

export type DeployType = "dockerfile" | "compose";
export type ProjectStatus =
  | "pending"
  | "deploying"
  | "running"
  | "failed"
  | "stopped";

export interface PortMapping {
  internal: number;
  external: number;
}

export interface Project {
  id: string;
  name: string;
  repo_url: string;
  repo_branch: string;
  is_private: boolean;
  deploy_type: DeployType;
  build_context: string;
  dockerfile: string;
  build_script: string | null;
  target_server: string;
  domain: string | null;
  health_check_path: string;
  env_vars: Record<string, string>;
  current_slot: "blue" | "green" | null;
  current_image_tag: string | null;
  webhook_secret: string;
  created_at: string;
  updated_at: string;
  // New fields for compose deployments
  compose_path: string;
  has_build: boolean;
  build_service: string | null;
  port: number;
  port_mappings: Record<string, PortMapping>;
  status: ProjectStatus;
  current_commit: string | null;
}

export type DeploymentState =
  | "pending"
  | "cloning"
  | "building"
  | "pushing"
  | "deploying"
  | "health_checking"
  | "switching_traffic"
  | "cleaning_up"
  | "completed"
  | "failed"
  | "rolled_back";

export type TriggeredBy = "webhook" | "manual" | "rollback";

export interface Deployment {
  id: string;
  project_id: string;
  commit_sha: string;
  commit_message: string | null;
  state: DeploymentState;
  slot: "blue" | "green" | null;
  image_tag: string | null;
  triggered_by: TriggeredBy;
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

export type LogStatus = "running" | "done" | "error" | "skipped";

export interface DeploymentLog {
  id: number;
  deployment_id: string;
  step: string;
  status: LogStatus;
  message: string | null;
  timestamp: string;
}

export type ServerRole = "master" | "worker" | "build" | "gateway";

export interface Server {
  id: string;
  name: string;
  tailscale_ip: string;
  public_ip: string | null;
  role: ServerRole;
  tunnel_id: string | null;
  status: "active" | "inactive";
  last_health_check: string | null;
  created_at: string;
}

// ============ Project Operations ============

export interface CreateProjectInput {
  name: string;
  repo_url: string;
  repo_branch?: string;
  is_private?: boolean;
  deploy_type?: DeployType;
  build_context?: string;
  dockerfile?: string;
  build_script?: string | null;
  target_server: string;
  domain?: string | null;
  health_check_path?: string;
  env_vars?: Record<string, string>;
  // New fields
  compose_path?: string;
  has_build?: boolean;
  build_service?: string | null;
  port?: number;
  port_mappings?: Record<string, PortMapping>;
}

export function createProject(input: CreateProjectInput): Project {
  const db = getDb();
  const id = randomUUID();
  const webhook_secret = randomUUID().replace(/-/g, "");

  const stmt = db.prepare(`
		INSERT INTO projects (
			id, name, repo_url, repo_branch, is_private, deploy_type, build_context,
			dockerfile, build_script, target_server, domain, health_check_path,
			env_vars, webhook_secret, compose_path, has_build, build_service, port, port_mappings
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

  stmt.run(
    id,
    input.name,
    input.repo_url,
    input.repo_branch || "main",
    input.is_private ? 1 : 0,
    input.deploy_type || "compose",
    input.build_context || ".",
    input.dockerfile || "Dockerfile",
    input.build_script || null,
    input.target_server,
    input.domain || null,
    input.health_check_path || "/health",
    JSON.stringify(input.env_vars || {}),
    webhook_secret,
    input.compose_path || "docker-compose.yml",
    input.has_build ? 1 : 0,
    input.build_service || null,
    input.port || 3000,
    JSON.stringify(input.port_mappings || {}),
  );

  return getProject(id)!;
}

export function getProject(id: string): Project | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as any;
  return row ? rowToProject(row) : null;
}

export function getProjectByName(name: string): Project | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM projects WHERE name = ?")
    .get(name) as any;
  return row ? rowToProject(row) : null;
}

export function getProjectByDomain(domain: string): Project | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM projects WHERE domain = ?")
    .get(domain) as any;
  return row ? rowToProject(row) : null;
}

export function listProjects(): Project[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM projects ORDER BY name")
    .all() as any[];
  return rows.map(rowToProject);
}

export interface UpdateProjectInput extends Partial<CreateProjectInput> {
  current_slot?: "blue" | "green" | null;
  current_image_tag?: string | null;
  status?: ProjectStatus;
  current_commit?: string | null;
}

export function updateProject(id: string, updates: UpdateProjectInput): void {
  const db = getDb();
  const current = getProject(id);
  if (!current) throw new Error(`Project ${id} not found`);

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push("name = ?");
    values.push(updates.name);
  }
  if (updates.repo_url !== undefined) {
    fields.push("repo_url = ?");
    values.push(updates.repo_url);
  }
  if (updates.repo_branch !== undefined) {
    fields.push("repo_branch = ?");
    values.push(updates.repo_branch);
  }
  if (updates.is_private !== undefined) {
    fields.push("is_private = ?");
    values.push(updates.is_private ? 1 : 0);
  }
  if (updates.build_context !== undefined) {
    fields.push("build_context = ?");
    values.push(updates.build_context);
  }
  if (updates.dockerfile !== undefined) {
    fields.push("dockerfile = ?");
    values.push(updates.dockerfile);
  }
  if (updates.build_script !== undefined) {
    fields.push("build_script = ?");
    values.push(updates.build_script);
  }
  if (updates.target_server !== undefined) {
    fields.push("target_server = ?");
    values.push(updates.target_server);
  }
  if (updates.domain !== undefined) {
    fields.push("domain = ?");
    values.push(updates.domain);
  }
  if (updates.health_check_path !== undefined) {
    fields.push("health_check_path = ?");
    values.push(updates.health_check_path);
  }
  if (updates.env_vars !== undefined) {
    fields.push("env_vars = ?");
    values.push(JSON.stringify(updates.env_vars));
  }
  if (updates.current_slot !== undefined) {
    fields.push("current_slot = ?");
    values.push(updates.current_slot);
  }
  if (updates.current_image_tag !== undefined) {
    fields.push("current_image_tag = ?");
    values.push(updates.current_image_tag);
  }
  // New fields
  if (updates.compose_path !== undefined) {
    fields.push("compose_path = ?");
    values.push(updates.compose_path);
  }
  if (updates.has_build !== undefined) {
    fields.push("has_build = ?");
    values.push(updates.has_build ? 1 : 0);
  }
  if (updates.build_service !== undefined) {
    fields.push("build_service = ?");
    values.push(updates.build_service);
  }
  if (updates.port !== undefined) {
    fields.push("port = ?");
    values.push(updates.port);
  }
  if (updates.port_mappings !== undefined) {
    fields.push("port_mappings = ?");
    values.push(JSON.stringify(updates.port_mappings));
  }
  if (updates.status !== undefined) {
    fields.push("status = ?");
    values.push(updates.status);
  }
  if (updates.current_commit !== undefined) {
    fields.push("current_commit = ?");
    values.push(updates.current_commit);
  }

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(
      ...values,
    );
  }
}

/**
 * Update project status
 */
export function updateProjectStatus(
  id: string,
  status: ProjectStatus,
  commit?: string,
): void {
  updateProject(id, { status, current_commit: commit });
}

export function deleteProject(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

function rowToProject(row: any): Project {
  return {
    ...row,
    is_private: Boolean(row.is_private),
    has_build: Boolean(row.has_build),
    env_vars: JSON.parse(row.env_vars || "{}"),
    port_mappings: JSON.parse(row.port_mappings || "{}"),
    compose_path: row.compose_path || "docker-compose.yml",
    port: row.port || 3000,
    status: row.status || "pending",
  };
}

// ============ Deployment Operations ============

export interface CreateDeploymentInput {
  project_id: string;
  commit_sha: string;
  commit_message?: string;
  triggered_by?: TriggeredBy;
}

export function createDeployment(input: CreateDeploymentInput): Deployment {
  const db = getDb();
  const id = randomUUID();

  db.prepare(
    `
		INSERT INTO deployments (id, project_id, commit_sha, commit_message, triggered_by)
		VALUES (?, ?, ?, ?, ?)
	`,
  ).run(
    id,
    input.project_id,
    input.commit_sha,
    input.commit_message || null,
    input.triggered_by || "manual",
  );

  return getDeployment(id)!;
}

export function getDeployment(id: string): Deployment | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM deployments WHERE id = ?")
    .get(id) as any;
  return row || null;
}

export function getLatestDeployment(projectId: string): Deployment | null {
  const db = getDb();
  const row = db
    .prepare(
      `
		SELECT * FROM deployments
		WHERE project_id = ?
		ORDER BY started_at DESC
		LIMIT 1
	`,
    )
    .get(projectId) as any;
  return row || null;
}

export function getLatestSuccessfulDeployment(
  projectId: string,
): Deployment | null {
  const db = getDb();
  const row = db
    .prepare(
      `
		SELECT * FROM deployments
		WHERE project_id = ? AND state = 'completed'
		ORDER BY started_at DESC
		LIMIT 1
	`,
    )
    .get(projectId) as any;
  return row || null;
}

export function listDeployments(
  projectId: string,
  limit: number = 20,
): Deployment[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
		SELECT * FROM deployments
		WHERE project_id = ?
		ORDER BY started_at DESC
		LIMIT ?
	`,
    )
    .all(projectId, limit) as any[];
  return rows;
}

export function updateDeployment(
  id: string,
  updates: Partial<Omit<Deployment, "id" | "project_id" | "started_at">>,
): void {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.state !== undefined) {
    fields.push("state = ?");
    values.push(updates.state);
  }
  if (updates.slot !== undefined) {
    fields.push("slot = ?");
    values.push(updates.slot);
  }
  if (updates.image_tag !== undefined) {
    fields.push("image_tag = ?");
    values.push(updates.image_tag);
  }
  if (updates.finished_at !== undefined) {
    fields.push("finished_at = ?");
    values.push(updates.finished_at);
  }
  if (updates.error !== undefined) {
    fields.push("error = ?");
    values.push(updates.error);
  }

  if (fields.length > 0) {
    values.push(id);
    db.prepare(`UPDATE deployments SET ${fields.join(", ")} WHERE id = ?`).run(
      ...values,
    );
  }
}

export function markDeploymentCompleted(id: string): void {
  updateDeployment(id, {
    state: "completed",
    finished_at: new Date().toISOString(),
  });
}

export function markDeploymentFailed(id: string, error: string): void {
  updateDeployment(id, {
    state: "failed",
    finished_at: new Date().toISOString(),
    error,
  });
}

// ============ Deployment Log Operations ============

export function addDeploymentLog(
  deploymentId: string,
  step: string,
  status: LogStatus,
  message?: string,
): number {
  const db = getDb();
  const result = db
    .prepare(
      `
		INSERT INTO deployment_logs (deployment_id, step, status, message)
		VALUES (?, ?, ?, ?)
	`,
    )
    .run(deploymentId, step, status, message || null);

  return Number(result.lastInsertRowid);
}

export function updateDeploymentLog(
  id: number,
  status: LogStatus,
  message?: string,
): void {
  const db = getDb();
  db.prepare(
    `
		UPDATE deployment_logs SET status = ?, message = ? WHERE id = ?
	`,
  ).run(status, message || null, id);
}

export function getDeploymentLogs(deploymentId: string): DeploymentLog[] {
  const db = getDb();
  return db
    .prepare(
      `
		SELECT * FROM deployment_logs
		WHERE deployment_id = ?
		ORDER BY timestamp ASC
	`,
    )
    .all(deploymentId) as DeploymentLog[];
}

// ============ Server Operations ============

export interface CreateServerInput {
  name: string;
  tailscale_ip: string;
  public_ip?: string;
  role: ServerRole;
  tunnel_id?: string;
}

export function createServer(input: CreateServerInput): Server {
  const db = getDb();
  const id = randomUUID();

  db.prepare(
    `
		INSERT INTO servers (id, name, tailscale_ip, public_ip, role, tunnel_id)
		VALUES (?, ?, ?, ?, ?, ?)
	`,
  ).run(
    id,
    input.name,
    input.tailscale_ip,
    input.public_ip || null,
    input.role,
    input.tunnel_id || null,
  );

  return getServer(id)!;
}

export function getServer(id: string): Server | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM servers WHERE id = ?").get(id) as any;
  return row || null;
}

export function getServerByName(name: string): Server | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM servers WHERE name = ?")
    .get(name) as any;
  return row || null;
}

export function getServerByTailscaleIp(ip: string): Server | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM servers WHERE tailscale_ip = ?")
    .get(ip) as any;
  return row || null;
}

export function getBuildServer(): Server | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM servers WHERE role = 'build' AND status = 'active' LIMIT 1",
    )
    .get() as any;
  return row || null;
}

export function getGatewayServer(): Server | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM servers WHERE role = 'gateway' AND status = 'active' LIMIT 1",
    )
    .get() as any;
  return row || null;
}

export function listServers(role?: ServerRole): Server[] {
  const db = getDb();
  if (role) {
    return db
      .prepare("SELECT * FROM servers WHERE role = ? ORDER BY name")
      .all(role) as Server[];
  }
  return db
    .prepare("SELECT * FROM servers ORDER BY role, name")
    .all() as Server[];
}

export function listActiveServers(role?: ServerRole): Server[] {
  const db = getDb();
  if (role) {
    return db
      .prepare(
        "SELECT * FROM servers WHERE role = ? AND status = 'active' ORDER BY name",
      )
      .all(role) as Server[];
  }
  return db
    .prepare(
      "SELECT * FROM servers WHERE status = 'active' ORDER BY role, name",
    )
    .all() as Server[];
}

export function updateServer(
  id: string,
  updates: Partial<Omit<Server, "id" | "created_at">>,
): void {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push("name = ?");
    values.push(updates.name);
  }
  if (updates.tailscale_ip !== undefined) {
    fields.push("tailscale_ip = ?");
    values.push(updates.tailscale_ip);
  }
  if (updates.public_ip !== undefined) {
    fields.push("public_ip = ?");
    values.push(updates.public_ip);
  }
  if (updates.role !== undefined) {
    fields.push("role = ?");
    values.push(updates.role);
  }
  if (updates.tunnel_id !== undefined) {
    fields.push("tunnel_id = ?");
    values.push(updates.tunnel_id);
  }
  if (updates.status !== undefined) {
    fields.push("status = ?");
    values.push(updates.status);
  }
  if (updates.last_health_check !== undefined) {
    fields.push("last_health_check = ?");
    values.push(updates.last_health_check);
  }

  if (fields.length > 0) {
    values.push(id);
    db.prepare(`UPDATE servers SET ${fields.join(", ")} WHERE id = ?`).run(
      ...values,
    );
  }
}

export function deleteServer(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM servers WHERE id = ?").run(id);
}

export function updateServerHealthCheck(id: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE servers SET last_health_check = datetime('now') WHERE id = ?",
  ).run(id);
}

// ============ Settings Operations ============

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

/**
 * Get a setting value by key
 */
export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Get a setting with a default value
 */
export function getSettingOrDefault(key: string, defaultValue: string): string {
  return getSetting(key) ?? defaultValue;
}

/**
 * Set a setting value
 */
export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    `
		INSERT INTO settings (key, value, updated_at)
		VALUES (?, ?, datetime('now'))
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = datetime('now')
	`,
  ).run(key, value);
}

/**
 * Delete a setting
 */
export function deleteSetting(key: string): void {
  const db = getDb();
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}

/**
 * Get all settings as a record
 */
export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM settings ORDER BY key")
    .all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

/**
 * List all settings with metadata
 */
export function listSettings(): Setting[] {
  const db = getDb();
  return db.prepare("SELECT * FROM settings ORDER BY key").all() as Setting[];
}

// Default settings keys
export const SETTING_KEYS = {
  ACME_EMAIL: "acme_email",
  HEALTH_CHECK_TIMEOUT: "health_check_timeout",
} as const;
