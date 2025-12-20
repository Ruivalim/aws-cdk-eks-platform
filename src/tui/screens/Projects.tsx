/**
 * Projects screen
 */
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import { useProjects } from "../hooks/useProjects";
import { useServers } from "../hooks/useServers";
import * as DB from "../../lib/db";
import List, { ListItem } from "../components/List";
import ActionBar from "../components/ActionBar";
import Spinner from "../components/Spinner";
import Modal from "../components/Modal";
import { colors } from "../utils/theme";
import { formatRelativeTime, truncate } from "../utils/format";
import * as Deploy from "../../lib/deploy";
import * as GitHub from "../../lib/github";
import { logger } from "../utils/logger";

type Mode =
  | "list"
  | "add"
  | "add-source"
  | "add-github-org"
  | "add-github-repo"
  | "add-github-branch"
  | "add-name"
  | "add-details"
  | "edit"
  | "delete"
  | "details"
  | "deploy"
  | "deploying"
  | "rollback"
  | "rolling-back";

interface AddProjectForm {
  name: string;
  repo_url: string;
  repo_branch: string;
  target_server: string;
  domain: string;
  health_check_path: string;
}

interface ProjectsProps {
  focused: boolean;
}

export default function Projects({ focused }: ProjectsProps) {
  const {
    projects,
    loading,
    error,
    refresh,
    addProject,
    deleteProject,
    updateProject,
  } = useProjects();
  const { servers } = useServers();

  const [mode, setMode] = useState<Mode>("list");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [addForm, setAddForm] = useState<AddProjectForm>({
    name: "",
    repo_url: "",
    repo_branch: "main",
    target_server: "",
    domain: "",
    health_check_path: "/health",
  });
  const [addStep, setAddStep] = useState(0);
  const [editForm, setEditForm] = useState({
    repo_branch: "",
    domain: "",
    health_check_path: "",
  });
  const [editStep, setEditStep] = useState(0);
  const [deployStatus, setDeployStatus] = useState<string>("");
  const [rollbackDeployments, setRollbackDeployments] = useState<
    DB.Deployment[]
  >([]);
  const [rollbackIndex, setRollbackIndex] = useState(0);

  // GitHub state
  const [githubOrgs, setGithubOrgs] = useState<
    Array<{ login: string; type: "user" | "org" }>
  >([]);
  const [githubRepos, setGithubRepos] = useState<GitHub.GitHubRepo[]>([]);
  const [githubBranches, setGithubBranches] = useState<string[]>([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [selectedOrg, setSelectedOrg] = useState("");
  const [loadingGithub, setLoadingGithub] = useState(false);

  const selectedProject = projects[selectedIndex];
  const workerServers = servers.filter((s) => s.role === "worker");

  useInput(
    (input, key) => {
      if (!focused || mode !== "list") return;

      if (input === "j" || key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, projects.length - 1));
      } else if (input === "k" || key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (input === "a") {
        setAddForm({
          name: "",
          repo_url: "",
          repo_branch: "main",
          target_server: "",
          domain: "",
          health_check_path: "/health",
        });
        setAddStep(0);
        setRepoSearch("");
        setSelectedOrg("");
        setGithubRepos([]);
        setGithubBranches([]);
        setMode("add-source");
      } else if (input === "d" && selectedProject) {
        setMode("delete");
      } else if (input === "D" && selectedProject) {
        setMode("deploy");
      } else if (input === "e" && selectedProject) {
        setEditForm({
          repo_branch: selectedProject.repo_branch,
          domain: selectedProject.domain || "",
          health_check_path: selectedProject.health_check_path,
        });
        setEditStep(0);
        setMode("edit");
      } else if (input === "R" && selectedProject) {
        const deployments = DB.listDeployments(selectedProject.id);
        const successful = deployments.filter((d) => d.state === "completed");
        setRollbackDeployments(successful);
        setRollbackIndex(0);
        setMode("rollback");
      } else if (input === "r") {
        refresh();
      } else if (key.return && selectedProject) {
        setMode("details");
      }
    },
    { isActive: focused && mode === "list" },
  );

  useInput(
    (_, key) => {
      if (key.escape && mode !== "deploying" && mode !== "rolling-back") {
        setMode("list");
      }
    },
    { isActive: mode !== "list" },
  );

  const listItems: ListItem[] = projects.map((p) => ({
    id: p.id,
    label: p.name,
    status: p.current_slot ? "online" : "pending",
    meta: `[${p.current_slot || "not deployed"}] ${p.domain || "internal"}`,
  }));

  const actions = [
    { key: "a", label: "Add" },
    { key: "D", label: "Deploy", disabled: !selectedProject },
    { key: "e", label: "Edit", disabled: !selectedProject },
    { key: "R", label: "Rollback", disabled: !selectedProject },
    { key: "d", label: "Delete", disabled: !selectedProject },
    { key: "r", label: "Refresh" },
  ];

  if (loading && projects.length === 0) {
    return <Spinner label="Loading projects..." />;
  }

  if (error) {
    return <Text color={colors.error}>Error: {error}</Text>;
  }

  if (mode === "delete" && selectedProject) {
    return (
      <Modal
        title="Delete Project"
        message={`Are you sure you want to delete "${selectedProject.name}"? This will also delete all deployment history.`}
        type="confirm"
        onConfirm={() => {
          logger.info(`Deleting project: ${selectedProject.name}`, "projects");
          deleteProject(selectedProject.id);
          logger.success(
            `Deleted project: ${selectedProject.name}`,
            "projects",
          );
          setMode("list");
          setSelectedIndex(Math.max(0, selectedIndex - 1));
        }}
        onCancel={() => setMode("list")}
      />
    );
  }

  if (mode === "deploy" && selectedProject) {
    return (
      <Modal
        title="Deploy Project"
        message={`Deploy "${selectedProject.name}" to ${selectedProject.target_server}?`}
        type="confirm"
        onConfirm={async () => {
          setMode("deploying");
          setDeployStatus("Starting deployment...");
          logger.info(
            `Starting deploy for ${selectedProject.name}`,
            "projects",
          );
          try {
            await Deploy.fullDeploy(selectedProject);
            logger.success(
              `Deploy completed for ${selectedProject.name}`,
              "projects",
            );
            setDeployStatus("Deployment completed!");
            setTimeout(() => {
              setMode("list");
              refresh();
            }, 2000);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(
              `Deploy failed for ${selectedProject.name}: ${errMsg}`,
              "projects",
            );
            setDeployStatus(`Error: ${errMsg}`);
            setTimeout(() => setMode("list"), 3000);
          }
        }}
        onCancel={() => setMode("list")}
      />
    );
  }

  if (mode === "deploying") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Deploying {selectedProject?.name}
        </Text>
        <Box marginY={1}>
          <Spinner label={deployStatus} />
        </Box>
      </Box>
    );
  }

  // Add Project - Choose source
  if (mode === "add-source") {
    const hasGithub = GitHub.hasGitHubToken();
    const sourceOptions = hasGithub
      ? [
          { label: "Browse GitHub repos", value: "github" },
          { label: "Enter URL manually", value: "manual" },
        ]
      : [{ label: "Enter URL manually", value: "manual" }];

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Add Project
        </Text>
        <Box marginY={1} flexDirection="column">
          {!hasGithub && (
            <Text color={colors.muted}>
              Set GITHUB_TOKEN to browse repos directly.
            </Text>
          )}
          <Text>How do you want to add the repository?</Text>
          <SelectInput
            items={sourceOptions}
            onSelect={async (item) => {
              if (item.value === "github") {
                setLoadingGithub(true);
                try {
                  const user = await GitHub.getCurrentUser();
                  const orgs = await GitHub.listOrganizations();
                  setGithubOrgs([
                    { login: user.login, type: "user" },
                    ...orgs.map((o) => ({
                      login: o.login,
                      type: "org" as const,
                    })),
                  ]);
                  setMode("add-github-org");
                } catch {
                  setGithubOrgs([]);
                }
                setLoadingGithub(false);
              } else {
                setMode("add");
              }
            }}
          />
        </Box>
        <Text color={colors.muted}>Press Esc to cancel</Text>
      </Box>
    );
  }

  // Add Project - Select GitHub org/user
  if (mode === "add-github-org") {
    if (loadingGithub) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color={colors.primary}>
            Add Project
          </Text>
          <Box marginY={1}>
            <Spinner label="Loading GitHub accounts..." />
          </Box>
        </Box>
      );
    }

    const orgOptions = githubOrgs.map((o) => ({
      label: o.type === "user" ? `${o.login} (your account)` : o.login,
      value: o.login,
    }));

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Add Project - Select Account
        </Text>
        <Box marginY={1} flexDirection="column">
          <Text>Select GitHub account or organization:</Text>
          <SelectInput
            items={orgOptions}
            onSelect={async (item) => {
              setSelectedOrg(item.value);
              setLoadingGithub(true);
              try {
                const isUser =
                  githubOrgs.find((o) => o.login === item.value)?.type ===
                  "user";
                const repos = isUser
                  ? await GitHub.listUserRepos()
                  : await GitHub.listOrgRepos(item.value);
                setGithubRepos(repos);
              } catch {
                setGithubRepos([]);
              }
              setLoadingGithub(false);
              setMode("add-github-repo");
            }}
          />
        </Box>
        <Text color={colors.muted}>Press Esc to cancel</Text>
      </Box>
    );
  }

  // Add Project - Search/select GitHub repo
  if (mode === "add-github-repo") {
    if (loadingGithub) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color={colors.primary}>
            Add Project - Select Repository
          </Text>
          <Box marginY={1}>
            <Spinner label="Loading repositories..." />
          </Box>
        </Box>
      );
    }

    const filteredRepos = repoSearch
      ? githubRepos.filter(
          (r) =>
            r.name.toLowerCase().includes(repoSearch.toLowerCase()) ||
            r.description?.toLowerCase().includes(repoSearch.toLowerCase()),
        )
      : githubRepos;

    const repoOptions = filteredRepos.slice(0, 15).map((r) => ({
      label: `${r.name}${r.private ? " 🔒" : ""} ${r.description ? `- ${truncate(r.description, 40)}` : ""}`,
      value: r.name,
    }));

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Add Project - Select Repository
        </Text>
        <Box marginY={1} flexDirection="column">
          <Box>
            <Text>Search: </Text>
            <TextInput
              value={repoSearch}
              onChange={setRepoSearch}
              placeholder="Type to filter..."
            />
          </Box>
          <Text color={colors.muted}>
            {filteredRepos.length} repos
            {repoSearch ? ` matching "${repoSearch}"` : ""}
          </Text>
        </Box>
        {repoOptions.length > 0 ? (
          <SelectInput
            items={repoOptions}
            onSelect={async (item) => {
              const repo = githubRepos.find((r) => r.name === item.value);
              if (repo) {
                setAddForm((prev) => ({
                  ...prev,
                  name: repo.name,
                  repo_url: repo.ssh_url,
                  repo_branch: repo.default_branch,
                }));
                // Load branches
                setLoadingGithub(true);
                try {
                  const parsed = GitHub.parseGitHubUrl(repo.ssh_url);
                  if (parsed) {
                    const branches = await GitHub.listBranches(
                      parsed.owner,
                      parsed.repo,
                    );
                    setGithubBranches(branches.map((b) => b.name));
                  }
                } catch {
                  setGithubBranches([repo.default_branch]);
                }
                setLoadingGithub(false);
                setMode("add-github-branch");
              }
            }}
          />
        ) : (
          <Text color={colors.muted}>No repositories found.</Text>
        )}
        <Text color={colors.muted}>Press Esc to cancel</Text>
      </Box>
    );
  }

  // Add Project - Select branch
  if (mode === "add-github-branch") {
    if (loadingGithub) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color={colors.primary}>
            Add Project - Select Branch
          </Text>
          <Box marginY={1}>
            <Spinner label="Loading branches..." />
          </Box>
        </Box>
      );
    }

    const branchOptions = githubBranches.map((b) => ({
      label: b === addForm.repo_branch ? `${b} (default)` : b,
      value: b,
    }));

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Add Project - Select Branch
        </Text>
        <Box marginY={1} flexDirection="column">
          <Text color={colors.muted}>Repository: {addForm.repo_url}</Text>
        </Box>
        <Box marginY={1} flexDirection="column">
          <Text>Select branch:</Text>
          <SelectInput
            items={branchOptions}
            onSelect={(item) => {
              setAddForm((prev) => ({ ...prev, repo_branch: item.value }));
              setMode("add-name");
            }}
          />
        </Box>
        <Text color={colors.muted}>Press Esc to cancel</Text>
      </Box>
    );
  }

  // Add Project - Edit name (pre-filled from repo)
  if (mode === "add-name") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Add Project - Name
        </Text>
        <Box marginY={1} flexDirection="column">
          <Text color={colors.muted}>Repository: {addForm.repo_url}</Text>
          <Text color={colors.muted}>Branch: {addForm.repo_branch}</Text>
        </Box>
        <Box marginY={1}>
          <Text>Project name: </Text>
          <TextInput
            value={addForm.name}
            onChange={(v) => setAddForm((prev) => ({ ...prev, name: v }))}
            onSubmit={() => setMode("add-details")}
          />
        </Box>
        <Text color={colors.muted}>Press Enter to continue, Esc to cancel</Text>
      </Box>
    );
  }

  // Add Project - Server, domain, health check
  if (mode === "add-details") {
    const serverOptions = workerServers.map((s) => ({
      label: `${s.name} (${s.tailscale_ip})`,
      value: s.tailscale_ip,
    }));

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Add Project - Details
        </Text>
        <Box marginY={1} flexDirection="column">
          <Text color={colors.muted}>
            {addForm.name} ({addForm.repo_branch})
          </Text>
        </Box>
        <Box marginY={1} flexDirection="column">
          {addStep === 0 && (
            <Box flexDirection="column">
              <Text>Target Server:</Text>
              {serverOptions.length > 0 ? (
                <SelectInput
                  items={serverOptions}
                  onSelect={(item) => {
                    setAddForm((prev) => ({
                      ...prev,
                      target_server: item.value,
                    }));
                    setAddStep(1);
                  }}
                />
              ) : (
                <Text color={colors.error}>
                  No worker servers. Add a server first.
                </Text>
              )}
            </Box>
          )}
          {addStep === 1 && (
            <Box>
              <Text>Domain (leave empty for internal): </Text>
              <TextInput
                value={addForm.domain}
                onChange={(v) => setAddForm((prev) => ({ ...prev, domain: v }))}
                onSubmit={() => setAddStep(2)}
              />
            </Box>
          )}
          {addStep === 2 && (
            <Box>
              <Text>Health Check Path: </Text>
              <TextInput
                value={addForm.health_check_path}
                onChange={(v) =>
                  setAddForm((prev) => ({ ...prev, health_check_path: v }))
                }
                onSubmit={() => {
                  logger.info(`Adding project: ${addForm.name}`, "projects");
                  addProject({
                    name: addForm.name,
                    repo_url: addForm.repo_url,
                    repo_branch: addForm.repo_branch,
                    target_server: addForm.target_server,
                    domain: addForm.domain || undefined,
                    health_check_path: addForm.health_check_path,
                  });
                  logger.success(`Added project: ${addForm.name}`, "projects");
                  setMode("list");
                }}
              />
            </Box>
          )}
        </Box>
        <Text color={colors.muted}>Press Esc to cancel</Text>
      </Box>
    );
  }

  // Add Project - Manual URL entry
  if (mode === "add") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Add Project - Manual
        </Text>
        <Box marginY={1} flexDirection="column">
          {addStep === 0 && (
            <Box>
              <Text>Project name: </Text>
              <TextInput
                value={addForm.name}
                onChange={(v) => setAddForm((prev) => ({ ...prev, name: v }))}
                onSubmit={() => setAddStep(1)}
              />
            </Box>
          )}
          {addStep === 1 && (
            <Box>
              <Text>Repository URL (SSH): </Text>
              <TextInput
                value={addForm.repo_url}
                onChange={(v) =>
                  setAddForm((prev) => ({ ...prev, repo_url: v }))
                }
                onSubmit={() => setAddStep(2)}
              />
            </Box>
          )}
          {addStep === 2 && (
            <Box>
              <Text>Branch: </Text>
              <TextInput
                value={addForm.repo_branch}
                onChange={(v) =>
                  setAddForm((prev) => ({ ...prev, repo_branch: v }))
                }
                onSubmit={() => {
                  setAddStep(0);
                  setMode("add-details");
                }}
              />
            </Box>
          )}
        </Box>
        <Text color={colors.muted}>Press Esc to cancel</Text>
      </Box>
    );
  }

  if (mode === "edit" && selectedProject) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Edit Project: {selectedProject.name}
        </Text>
        <Box marginY={1} flexDirection="column">
          {editStep === 0 && (
            <Box>
              <Text>Branch: </Text>
              <TextInput
                value={editForm.repo_branch}
                onChange={(v) => setEditForm({ ...editForm, repo_branch: v })}
                onSubmit={() => setEditStep(1)}
              />
            </Box>
          )}
          {editStep === 1 && (
            <Box>
              <Text>Domain (leave empty for internal): </Text>
              <TextInput
                value={editForm.domain}
                onChange={(v) => setEditForm({ ...editForm, domain: v })}
                onSubmit={() => setEditStep(2)}
              />
            </Box>
          )}
          {editStep === 2 && (
            <Box>
              <Text>Health Check Path: </Text>
              <TextInput
                value={editForm.health_check_path}
                onChange={(v) =>
                  setEditForm({ ...editForm, health_check_path: v })
                }
                onSubmit={() => {
                  updateProject(selectedProject.id, {
                    repo_branch: editForm.repo_branch,
                    domain: editForm.domain || undefined,
                    health_check_path: editForm.health_check_path,
                  });
                  setMode("list");
                }}
              />
            </Box>
          )}
        </Box>
        <Text color={colors.muted}>Press Esc to cancel</Text>
      </Box>
    );
  }

  if (mode === "rollback" && selectedProject) {
    if (rollbackDeployments.length === 0) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color={colors.primary}>
            Rollback: {selectedProject.name}
          </Text>
          <Box marginY={1}>
            <Text color={colors.muted}>
              No successful deployments to rollback to.
            </Text>
          </Box>
          <Text color={colors.muted}>Press Esc to go back</Text>
        </Box>
      );
    }

    const deploymentOptions = rollbackDeployments.map((d) => ({
      label: `${truncate(d.commit_sha, 8)} - ${d.commit_message || "No message"} (${formatRelativeTime(d.started_at)})`,
      value: d.id,
    }));

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Rollback: {selectedProject.name}
        </Text>
        <Box marginY={1} flexDirection="column">
          <Text>Select deployment to rollback to:</Text>
          <SelectInput
            items={deploymentOptions}
            onSelect={async (item) => {
              const deployment = rollbackDeployments.find(
                (d) => d.id === item.value,
              );
              if (!deployment) return;
              setMode("rolling-back");
              setDeployStatus("Rolling back...");
              try {
                await Deploy.rollback(selectedProject, deployment);
                setDeployStatus("Rollback completed!");
                setTimeout(() => {
                  setMode("list");
                  refresh();
                }, 2000);
              } catch (err) {
                setDeployStatus(
                  `Error: ${err instanceof Error ? err.message : String(err)}`,
                );
                setTimeout(() => setMode("list"), 3000);
              }
            }}
          />
        </Box>
        <Text color={colors.muted}>Press Esc to cancel</Text>
      </Box>
    );
  }

  if (mode === "rolling-back") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Rolling back {selectedProject?.name}
        </Text>
        <Box marginY={1}>
          <Spinner label={deployStatus} />
        </Box>
      </Box>
    );
  }

  if (mode === "details" && selectedProject) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          {selectedProject.name}
        </Text>
        <Box marginY={1} flexDirection="column">
          <Text>
            <Text color={colors.muted}>Repository:</Text>{" "}
            {truncate(selectedProject.repo_url, 50)}
          </Text>
          <Text>
            <Text color={colors.muted}>Branch:</Text>{" "}
            {selectedProject.repo_branch}
          </Text>
          <Text>
            <Text color={colors.muted}>Target:</Text>{" "}
            {selectedProject.target_server}
          </Text>
          <Text>
            <Text color={colors.muted}>Domain:</Text>{" "}
            {selectedProject.domain || "internal"}
          </Text>
          <Text>
            <Text color={colors.muted}>Current Slot:</Text>{" "}
            <Text
              color={
                selectedProject.current_slot ? colors.success : colors.muted
              }
            >
              {selectedProject.current_slot || "not deployed"}
            </Text>
          </Text>
          {selectedProject.current_image_tag && (
            <Text>
              <Text color={colors.muted}>Image Tag:</Text>{" "}
              {selectedProject.current_image_tag}
            </Text>
          )}
          <Text>
            <Text color={colors.muted}>Health Check:</Text>{" "}
            {selectedProject.health_check_path}
          </Text>
          <Text>
            <Text color={colors.muted}>Created:</Text>{" "}
            {formatRelativeTime(selectedProject.created_at)}
          </Text>
        </Box>
        <Text color={colors.muted}>Press Esc to go back, D to deploy</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={colors.primary}>
          Projects
        </Text>
        <Text color={colors.muted}> ({projects.length})</Text>
      </Box>

      <List
        items={listItems}
        selectedIndex={selectedIndex}
        focused={focused}
        emptyMessage="No projects. Press 'a' to add one."
      />

      <ActionBar actions={actions} />
    </Box>
  );
}
