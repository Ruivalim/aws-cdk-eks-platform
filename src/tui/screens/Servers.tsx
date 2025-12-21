/**
 * Servers screen
 */
import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import { useServers } from "../hooks/useServers";
import List, { ListItem } from "../components/List";
import ActionBar from "../components/ActionBar";
import Spinner from "../components/Spinner";
import Modal from "../components/Modal";
import { colors } from "../utils/theme";
import { formatRelativeTime, formatRole } from "../utils/format";
import type { ServerRole } from "../../lib/db";
import * as Setup from "../../lib/setup";
import * as DO from "../../lib/digitalocean";
import * as ServerInfo from "../../lib/server-info";
import type { ServerDetails } from "../../lib/server-info";
import * as GitHub from "../../lib/github";
import * as Cloudflare from "../../lib/cloudflare";
import * as DB from "../../lib/db";
import { logger } from "../utils/logger";

type Mode =
  | "list"
  | "add"
  | "edit"
  | "delete"
  | "delete-running"
  | "details"
  | "details-updating"
  | "setup"
  | "setup-source"
  | "setup-create-droplet"
  | "setup-select-droplet"
  | "setup-host"
  | "setup-running"
  | "setup-tailscale-auth"
  | "setup-done"
  | "setup-github-connect"
  | "github-key"
  | "github-key-action";

type SetupServerType = "gateway" | "build" | "worker";

interface AddServerForm {
  name: string;
  tailscale_ip: string;
  public_ip: string;
  role: ServerRole;
}

interface SetupState {
  serverType: SetupServerType;
  source: "create" | "existing";
  sshHost: string;
  // Droplet creation
  dropletName: string;
  dropletRegion: string;
  dropletSize: string;
  dropletSshKeyId: string;
  createStep: number;
  // Setup progress
  logs: Array<{ message: string; status: Setup.StepStatus }>;
  tailscaleAuthUrl?: string;
  result?: Setup.SetupResult;
}

interface ServersProps {
  focused: boolean;
}

export default function Servers({ focused }: ServersProps) {
  const {
    servers,
    loading,
    error,
    refresh,
    checkStatus,
    checkAllStatus,
    addServer,
    deleteServer,
    updateServer,
  } = useServers();

  const [mode, setMode] = useState<Mode>("list");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [addForm, setAddForm] = useState<AddServerForm>({
    name: "",
    tailscale_ip: "",
    public_ip: "",
    role: "worker",
  });
  const [addStep, setAddStep] = useState(0);
  const [editForm, setEditForm] = useState<AddServerForm>({
    name: "",
    tailscale_ip: "",
    public_ip: "",
    role: "worker",
  });
  const [editStep, setEditStep] = useState(0);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // Setup state
  const [setupState, setSetupState] = useState<SetupState>({
    serverType: "worker",
    source: "existing",
    sshHost: "",
    dropletName: "",
    dropletRegion: "",
    dropletSize: "",
    dropletSshKeyId: "",
    createStep: 0,
    logs: [],
  });
  const [sshKeys, setSshKeys] = useState<DO.SSHKey[]>([]);
  const [existingDroplets, setExistingDroplets] = useState<DO.Droplet[]>([]);
  const [loadingDroplets, setLoadingDroplets] = useState(false);

  // Server details state
  const [serverDetails, setServerDetails] = useState<ServerDetails | null>(
    null,
  );
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsAction, setDetailsAction] = useState<string>("");

  // GitHub SSH key state
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null);
  const [githubKeyAction, setGithubKeyAction] = useState<string>("");

  // Delete server state
  const [deleteOptions, setDeleteOptions] = useState({
    deleteDroplet: false,
    deleteDns: true, // default to true for cleanup
    deleteGithubKey: true,
  });
  const [deleteProgress, setDeleteProgress] = useState<string>("");
  const [deleteSelectedOption, setDeleteSelectedOption] = useState(0);

  // Check status on mount
  useEffect(() => {
    if (servers.length > 0 && !checkingStatus) {
      setCheckingStatus(true);
      checkAllStatus().finally(() => setCheckingStatus(false));
    }
  }, [servers.length]);

  const selectedServer = servers[selectedIndex];

  // Progress callback for setup
  const onProgress: Setup.ProgressCallback = (progress) => {
    if (progress.step === "tailscale-auth" && progress.status === "waiting") {
      setSetupState((prev) => ({
        ...prev,
        tailscaleAuthUrl: progress.message,
      }));
      setMode("setup-tailscale-auth");
      return;
    }

    setSetupState((prev) => ({
      ...prev,
      logs: [
        ...prev.logs,
        { message: progress.message || progress.step, status: progress.status },
      ].slice(-15),
    }));
  };

  // Run the setup process
  const runSetup = async (serverType: SetupServerType, sshHost: string) => {
    setMode("setup-running");
    setSetupState((prev) => ({
      ...prev,
      serverType,
      sshHost,
      logs: [
        {
          message: `Starting ${serverType} server setup...`,
          status: "running",
        },
      ],
    }));

    let result: Setup.SetupResult;

    try {
      switch (serverType) {
        case "worker":
          result = await Setup.setupWorkerServer(sshHost, onProgress);
          break;
        case "build":
          result = await Setup.setupBuildServer(sshHost, onProgress);
          break;
        case "gateway":
          result = await Setup.setupGatewayServer(
            sshHost,
            undefined,
            onProgress,
          );
          break;
      }

      // Check if we need Tailscale auth (handled by onProgress callback)
      if (result.error === "TAILSCALE_AUTH_NEEDED") {
        // Mode was already changed by onProgress, just save partial result
        setSetupState((prev) => ({ ...prev, result }));
        return;
      }

      setSetupState((prev) => ({ ...prev, result }));
      setMode("setup-done");
      refresh();
    } catch (err) {
      setSetupState((prev) => ({
        ...prev,
        logs: [
          ...prev.logs,
          { message: `Error: ${err}`, status: "error" as Setup.StepStatus },
        ],
        result: { success: false, error: String(err) },
      }));
      setMode("setup-done");
    }
  };

  // Continue setup after Tailscale auth
  const continueAfterTailscaleAuth = async () => {
    setMode("setup-running");
    setSetupState((prev) => ({
      ...prev,
      logs: [
        ...prev.logs,
        {
          message: "Continuing setup after Tailscale auth...",
          status: "running",
        },
      ],
      tailscaleAuthUrl: undefined,
    }));

    try {
      const result = await Setup.continueAfterTailscaleAuth(
        setupState.sshHost,
        setupState.serverType,
        onProgress,
      );

      setSetupState((prev) => ({ ...prev, result }));
      setMode("setup-done");
      refresh();
    } catch (err) {
      setSetupState((prev) => ({
        ...prev,
        logs: [
          ...prev.logs,
          { message: `Error: ${err}`, status: "error" as Setup.StepStatus },
        ],
        result: { success: false, error: String(err) },
      }));
      setMode("setup-done");
    }
  };

  useInput(
    (input, key) => {
      if (!focused || mode !== "list") return;

      if (input === "j" || key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, servers.length - 1));
      } else if (input === "k" || key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (input === "a") {
        setMode("add");
        setAddStep(0);
        setAddForm({
          name: "",
          tailscale_ip: "",
          public_ip: "",
          role: "worker",
        });
      } else if (input === "d" && selectedServer) {
        setMode("delete");
      } else if (input === "e" && selectedServer) {
        setEditForm({
          name: selectedServer.name,
          tailscale_ip: selectedServer.tailscale_ip,
          public_ip: selectedServer.public_ip || "",
          role: selectedServer.role,
        });
        setEditStep(0);
        setMode("edit");
      } else if (input === "r") {
        refresh();
      } else if (input === "s" && selectedServer) {
        checkStatus(selectedServer.id);
      } else if (input === "S") {
        setMode("setup");
        setSetupState({
          serverType: "worker",
          source: "existing",
          sshHost: "",
          dropletName: "",
          dropletRegion: "",
          dropletSize: "",
          dropletSshKeyId: "",
          createStep: 0,
          logs: [],
        });
      } else if (key.return && selectedServer) {
        // Load server details when entering details mode
        setMode("details");
        setLoadingDetails(true);
        setServerDetails(null);
        setGithubConnected(null);
        const host = `root@${selectedServer.tailscale_ip}`;
        // Load server details and GitHub status in parallel
        Promise.all([
          ServerInfo.getServerDetails(selectedServer.tailscale_ip),
          GitHub.isServerConnectedToGitHub(host),
        ]).then(([details, connected]) => {
          setServerDetails(details);
          setGithubConnected(connected);
          setLoadingDetails(false);
        });
      }
    },
    { isActive: focused && mode === "list" },
  );

  // Handle input in details mode
  useInput(
    (input) => {
      if (!selectedServer) return;
      const host = `root@${selectedServer.tailscale_ip}`;

      if (input === "r") {
        // Refresh details
        setLoadingDetails(true);
        Promise.all([
          ServerInfo.getServerDetails(selectedServer.tailscale_ip),
          GitHub.isServerConnectedToGitHub(host),
        ]).then(([details, connected]) => {
          setServerDetails(details);
          setGithubConnected(connected);
          setLoadingDetails(false);
        });
      } else if (input === "u") {
        // Check for updates
        setDetailsAction("Checking for updates...");
        ServerInfo.checkUpdates(selectedServer.tailscale_ip).then((updates) => {
          if (updates) {
            setServerDetails((prev) => (prev ? { ...prev, updates } : null));
          }
          setDetailsAction("");
        });
      } else if (input === "U") {
        // Apply updates
        setMode("details-updating");
        setDetailsAction("Applying updates...");
        ServerInfo.applyUpdates(selectedServer.tailscale_ip, (msg) => setDetailsAction(msg)).then(
          () => {
            setDetailsAction("");
            setMode("details");
            // Refresh details after update
            ServerInfo.getServerDetails(selectedServer.tailscale_ip).then((details) => {
              setServerDetails(details);
            });
          },
        );
      } else if (input === "G") {
        // GitHub key management
        setMode("github-key");
      }
    },
    { isActive: mode === "details" && !loadingDetails },
  );

  // Handle escape to go back
  useInput(
    (_, key) => {
      if (
        key.escape &&
        mode !== "setup-running" &&
        mode !== "details-updating"
      ) {
        setMode("list");
        setServerDetails(null);
        setDetailsAction("");
        setSetupState({
          serverType: "worker",
          source: "existing",
          sshHost: "",
          dropletName: "",
          dropletRegion: "",
          dropletSize: "",
          dropletSshKeyId: "",
          createStep: 0,
          logs: [],
        });
      }
    },
    {
      isActive:
        mode !== "list" &&
        mode !== "setup-running" &&
        mode !== "details-updating",
    },
  );

  // Handle Enter during Tailscale auth
  useInput(
    (_, key) => {
      if (key.return) {
        continueAfterTailscaleAuth();
      }
    },
    { isActive: mode === "setup-tailscale-auth" },
  );

  // Handle input in GitHub key mode
  useInput(
    (input) => {
      if (!selectedServer) return;
      const host = `root@${selectedServer.tailscale_ip}`;

      if (input === "c" || input === "C") {
        // Connect to GitHub (generate key and register)
        setMode("github-key-action");
        setGithubKeyAction("Connecting to GitHub...");
        GitHub.connectServerToGitHub(host, selectedServer.name).then((result) => {
          if (result.success) {
            setGithubConnected(true);
            setGithubKeyAction("");
            logger.success(`Connected ${selectedServer.name} to GitHub`, "servers");
          } else {
            setGithubKeyAction(`Error: ${result.message}`);
            logger.error(`Failed to connect to GitHub: ${result.message}`, "servers");
          }
          setMode("github-key");
        });
      } else if (input === "d" || input === "D") {
        // Delete GitHub key
        setMode("github-key-action");
        setGithubKeyAction("Deleting GitHub key...");
        const keyTitle = `ruilify-${selectedServer.name}`;
        GitHub.findGitHubSSHKeyByTitle(keyTitle).then(async (key) => {
          if (key) {
            await GitHub.deleteGitHubSSHKey(key.id);
            setGithubConnected(false);
            setGithubKeyAction("");
            logger.success(`Deleted GitHub key for ${selectedServer.name}`, "servers");
          } else {
            setGithubKeyAction("No GitHub key found");
          }
          setMode("github-key");
        }).catch((err) => {
          setGithubKeyAction(`Error: ${err.message}`);
          setMode("github-key");
        });
      } else if (input === "t" || input === "T") {
        // Test connection
        setGithubKeyAction("Testing connection...");
        GitHub.isServerConnectedToGitHub(host).then((connected) => {
          setGithubConnected(connected);
          setGithubKeyAction(connected ? "Connection OK!" : "Not connected");
          setTimeout(() => setGithubKeyAction(""), 2000);
        });
      }
    },
    { isActive: mode === "github-key" },
  );

  // Handle input in setup-done mode (for GitHub connect option)
  useInput(
    (input) => {
      if (!setupState.result?.success) return;
      if (setupState.serverType === "gateway") return;

      if (input === "g" || input === "G") {
        // Connect to GitHub
        const tailscaleIp = setupState.result.tailscaleIp;
        if (!tailscaleIp) return;

        const host = `root@${tailscaleIp}`;
        const serverName = setupState.result.hostname || setupState.dropletName || "server";

        setMode("setup-github-connect");
        setGithubKeyAction("Connecting to GitHub...");

        GitHub.connectServerToGitHub(host, serverName).then((result) => {
          if (result.success) {
            setGithubConnected(true);
            setGithubKeyAction("Connected to GitHub!");
            logger.success(`Connected ${serverName} to GitHub`, "servers");
          } else {
            setGithubKeyAction(`Error: ${result.message}`);
            logger.error(`Failed to connect to GitHub: ${result.message}`, "servers");
          }
        });
      }
    },
    { isActive: mode === "setup-done" },
  );

  // Handle input in delete mode
  useInput(
    (input, key) => {
      if (!selectedServer) return;

      // Build options list dynamically (same as in render)
      const optionsList: Array<keyof typeof deleteOptions> = [];
      if (selectedServer.public_ip) optionsList.push("deleteDroplet");
      optionsList.push("deleteDns", "deleteGithubKey");

      if (input === "j" || key.downArrow) {
        setDeleteSelectedOption((i) => Math.min(i + 1, optionsList.length - 1));
      } else if (input === "k" || key.upArrow) {
        setDeleteSelectedOption((i) => Math.max(i - 1, 0));
      } else if (input === " ") {
        // Toggle option
        const optionKey = optionsList[deleteSelectedOption];
        setDeleteOptions((prev) => ({ ...prev, [optionKey]: !prev[optionKey] }));
      } else if (key.return) {
        // Execute delete
        executeDelete();
      }
    },
    { isActive: mode === "delete" },
  );

  // Execute delete with all options
  const executeDelete = async () => {
    if (!selectedServer) return;

    setMode("delete-running");
    const serverName = selectedServer.name;

    try {
      // 1. Delete GitHub key
      if (deleteOptions.deleteGithubKey) {
        setDeleteProgress("Deleting GitHub SSH key...");
        const keyTitle = `ruilify-${serverName}`;
        try {
          const key = await GitHub.findGitHubSSHKeyByTitle(keyTitle);
          if (key) {
            await GitHub.deleteGitHubSSHKey(key.id);
            logger.info(`Deleted GitHub key: ${keyTitle}`, "servers");
          }
        } catch {
          // Ignore
        }
      }

      // 2. Delete DNS records and projects on this server
      const projects = DB.listProjects().filter((p) => p.target_server === selectedServer.id);

      if (deleteOptions.deleteDns) {
        setDeleteProgress("Deleting DNS records...");
        for (const project of projects) {
          if (!project.domain) continue;
          try {
            // Extract zone from domain
            const parts = project.domain.split(".");
            const zoneName = parts.length >= 3 && parts[parts.length - 2].length <= 3
              ? parts.slice(-3).join(".")
              : parts.slice(-2).join(".");

            const zone = await Cloudflare.getZoneByName(zoneName);
            if (zone) {
              const records = await Cloudflare.listDnsRecords(zone.id, "A");
              const record = records.find((r) => r.name === project.domain);
              if (record) {
                await Cloudflare.deleteDnsRecord(zone.id, record.id);
                logger.info(`Deleted DNS: ${project.domain}`, "servers");
              }
            }
          } catch {
            // Ignore DNS errors
          }
        }
      }

      // 3. Delete all projects on this server
      setDeleteProgress("Deleting projects...");
      for (const project of projects) {
        DB.deleteProject(project.id);
        logger.info(`Deleted project: ${project.name}`, "servers");
      }

      // 4. Delete droplet from DO
      if (deleteOptions.deleteDroplet && selectedServer.public_ip) {
        setDeleteProgress("Deleting droplet from Digital Ocean...");
        try {
          const droplets = await DO.listDroplets();
          const droplet = droplets.find((d) => DO.getPublicIP(d) === selectedServer.public_ip);
          if (droplet) {
            await DO.deleteDroplet(droplet.id);
            logger.info(`Deleted droplet: ${droplet.name}`, "servers");
          }
        } catch (err) {
          logger.error(`Failed to delete droplet: ${err}`, "servers");
        }
      }

      // 5. Delete server from local DB
      setDeleteProgress("Removing server from database...");
      deleteServer(selectedServer.id);
      logger.success(`Deleted server: ${serverName}`, "servers");

      setMode("list");
      setSelectedIndex(Math.max(0, selectedIndex - 1));
      setDeleteProgress("");
      setDeleteOptions({ deleteDroplet: false, deleteDns: true, deleteGithubKey: true });
      setDeleteSelectedOption(0);
    } catch (err) {
      logger.error(`Delete failed: ${err}`, "servers");
      setDeleteProgress(`Error: ${err}`);
    }
  };

  const listItems: ListItem[] = servers.map((s) => ({
    id: s.id,
    label: s.name,
    status:
      s.isOnline === true
        ? "online"
        : s.isOnline === false
          ? "offline"
          : "pending",
    meta: `[${formatRole(s.role)}] ${s.tailscale_ip}`,
  }));

  const actions = [
    { key: "a", label: "Add" },
    { key: "S", label: "Setup" },
    { key: "e", label: "Edit", disabled: !selectedServer },
    { key: "d", label: "Delete", disabled: !selectedServer },
    { key: "s", label: "Status", disabled: !selectedServer },
    { key: "r", label: "Refresh" },
  ];

  if (loading && servers.length === 0) {
    return <Spinner label="Loading servers..." />;
  }

  if (error) {
    return <Text color={colors.error}>Error: {error}</Text>;
  }

  // Setup - Tailscale Auth needed
  if (mode === "setup-tailscale-auth") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Tailscale Authentication Required
        </Text>
        <Box marginY={1} flexDirection="column">
          <Text color={colors.warning}>
            Open this URL in your browser to authenticate:
          </Text>
          <Text />
          <Text color={colors.success}>{setupState.tailscaleAuthUrl}</Text>
          <Text />
          <Text color={colors.muted}>
            After authenticating, press Enter to continue...
          </Text>
        </Box>
      </Box>
    );
  }

  // Setup - GitHub connect in progress
  if (mode === "setup-github-connect") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Connecting to GitHub
        </Text>
        <Box marginY={1}>
          {githubKeyAction.startsWith("Error") ? (
            <Text color={colors.error}>{githubKeyAction}</Text>
          ) : githubKeyAction === "Connected to GitHub!" ? (
            <Text color={colors.success}>{githubKeyAction}</Text>
          ) : (
            <Spinner label={githubKeyAction} />
          )}
        </Box>
        <Text color={colors.muted}>Press Esc to go back</Text>
      </Box>
    );
  }

  // Setup - Done
  if (mode === "setup-done") {
    const result = setupState.result;
    const showGitHubOption = result?.success && setupState.serverType !== "gateway";

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={result?.success ? colors.success : colors.error}>
          {result?.success ? "Setup Complete!" : "Setup Failed"}
        </Text>
        <Box marginY={1} flexDirection="column">
          {result?.success ? (
            <>
              <Text>
                <Text color={colors.muted}>Hostname:</Text> {result.hostname}
              </Text>
              <Text>
                <Text color={colors.muted}>Tailscale IP:</Text>{" "}
                {result.tailscaleIp || "Not configured"}
              </Text>
              {result.publicIp && (
                <Text>
                  <Text color={colors.muted}>Public IP:</Text> {result.publicIp}
                </Text>
              )}
              {result.registryUrl && (
                <Text>
                  <Text color={colors.muted}>Registry:</Text>{" "}
                  {result.registryUrl}
                </Text>
              )}
              {result.deployKey && (
                <>
                  <Text />
                  <Text color={colors.muted}>GitHub Deploy Key:</Text>
                  <Text color={colors.text}>{result.deployKey}</Text>
                </>
              )}
            </>
          ) : (
            <Text color={colors.error}>{result?.error || "Unknown error"}</Text>
          )}
        </Box>
        {showGitHubOption && (
          <Box marginY={1}>
            <Text color={colors.muted}>
              Press [G] to connect this server to GitHub (generate SSH key)
            </Text>
          </Box>
        )}
        <Text color={colors.muted}>Press Esc to go back</Text>
      </Box>
    );
  }

  // Setup - Running
  if (mode === "setup-running") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Setting up {setupState.serverType} server...
        </Text>
        <Box marginY={1} flexDirection="column" height={16}>
          {setupState.logs.map((log, i) => (
            <Text
              key={i}
              color={
                log.status === "error"
                  ? colors.error
                  : log.status === "done"
                    ? colors.success
                    : log.status === "running"
                      ? colors.primary
                      : colors.text
              }
            >
              {log.status === "done"
                ? "✓"
                : log.status === "error"
                  ? "✗"
                  : log.status === "running"
                    ? "→"
                    : " "}{" "}
              {log.message}
            </Text>
          ))}
        </Box>
        <Spinner label="Running setup..." />
      </Box>
    );
  }

  // Setup - Enter SSH host
  if (mode === "setup-host") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Setup{" "}
          {setupState.serverType.charAt(0).toUpperCase() +
            setupState.serverType.slice(1)}{" "}
          Server
        </Text>
        <Box marginY={1} flexDirection="column">
          <Text color={colors.muted}>
            Enter the SSH host for the server you want to configure.
          </Text>
          <Text color={colors.muted}>Example: root@1.2.3.4 or hostname</Text>
        </Box>
        <Box marginY={1}>
          <Text>SSH Host: </Text>
          <TextInput
            value={setupState.sshHost}
            onChange={(v) => setSetupState((prev) => ({ ...prev, sshHost: v }))}
            onSubmit={() => {
              if (setupState.sshHost.trim()) {
                runSetup(setupState.serverType, setupState.sshHost.trim());
              }
            }}
          />
        </Box>
        <Text color={colors.muted}>Press Esc to cancel</Text>
      </Box>
    );
  }

  // Setup - Select server type
  if (mode === "setup") {
    const setupOptions = [
      {
        label: "Worker Server (Docker + Tailscale only)",
        value: "worker" as const,
      },
      {
        label: "Build Server (Docker + Registry + Git)",
        value: "build" as const,
      },
      {
        label: "Gateway Server (Caddy + Public Access)",
        value: "gateway" as const,
      },
    ];

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Setup New Server
        </Text>
        <Box marginY={1} flexDirection="column">
          <Text color={colors.muted}>
            This will install and configure the server via SSH.
          </Text>
        </Box>
        <Box marginY={1} flexDirection="column">
          <Text>Select server type:</Text>
          <SelectInput
            items={setupOptions}
            onSelect={(item) => {
              setSetupState((prev) => ({ ...prev, serverType: item.value }));
              setMode("setup-source");
            }}
          />
        </Box>
        <Text color={colors.muted}>Press Esc to cancel</Text>
      </Box>
    );
  }

  // Setup - Choose source (create droplet or existing server)
  if (mode === "setup-source") {
    const sourceOptions = [
      {
        label: "Create new droplet (Digital Ocean)",
        value: "create" as const,
      },
      {
        label: "Select existing droplet (Digital Ocean)",
        value: "select" as const,
      },
      {
        label: "Enter SSH host manually",
        value: "existing" as const,
      },
    ];

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Setup{" "}
          {setupState.serverType.charAt(0).toUpperCase() +
            setupState.serverType.slice(1)}{" "}
          Server
        </Text>
        <Box marginY={1} flexDirection="column">
          <Text color={colors.muted}>
            Create a new droplet, select an existing one, or enter SSH manually?
          </Text>
        </Box>
        <Box marginY={1} flexDirection="column">
          <SelectInput
            items={sourceOptions}
            onSelect={async (item) => {
              if (item.value === "create") {
                // Load SSH keys for droplet creation
                try {
                  const keys = await DO.listSSHKeys();
                  setSshKeys(keys);
                } catch {
                  setSshKeys([]);
                }
                setSetupState((prev) => ({
                  ...prev,
                  source: "create",
                  createStep: 0,
                  dropletName:
                    prev.serverType === "gateway"
                      ? "gateway-server"
                      : prev.serverType === "build"
                        ? "build-server"
                        : "app-server-1",
                }));
                setMode("setup-create-droplet");
              } else if (item.value === "select") {
                // Load existing droplets
                setLoadingDroplets(true);
                try {
                  const droplets = await DO.listDroplets();
                  setExistingDroplets(droplets);
                } catch {
                  setExistingDroplets([]);
                }
                setLoadingDroplets(false);
                setMode("setup-select-droplet");
              } else {
                setSetupState((prev) => ({ ...prev, source: "existing" }));
                setMode("setup-host");
              }
            }}
          />
        </Box>
        <Text color={colors.muted}>Press Esc to cancel</Text>
      </Box>
    );
  }

  // Setup - Select existing droplet
  if (mode === "setup-select-droplet") {
    if (loadingDroplets) {
      return <Spinner label="Loading droplets from Digital Ocean..." />;
    }

    const dropletOptions = existingDroplets.map((d) => {
      const ip = DO.getPublicIP(d) || "no IP";
      return {
        label: `${d.name} (${ip}) - ${d.region.slug}`,
        value: d,
      };
    });

    const serverTypeLabel =
      setupState.serverType.charAt(0).toUpperCase() +
      setupState.serverType.slice(1);

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Select Droplet for {serverTypeLabel} Setup
        </Text>
        <Box marginY={1} flexDirection="column">
          {dropletOptions.length > 0 ? (
            <>
              <Text color={colors.muted}>
                Select a droplet to configure as {setupState.serverType} server:
              </Text>
              <SelectInput
                items={dropletOptions}
                onSelect={(item) => {
                  const droplet = item.value;
                  const publicIp = DO.getPublicIP(droplet);
                  if (publicIp) {
                    const sshHost = `root@${publicIp}`;
                    runSetup(setupState.serverType, sshHost);
                  } else {
                    setSetupState((prev) => ({
                      ...prev,
                      logs: [
                        {
                          message: "Droplet has no public IP",
                          status: "error",
                        },
                      ],
                      result: { success: false, error: "No public IP" },
                    }));
                    setMode("setup-done");
                  }
                }}
              />
            </>
          ) : (
            <Text color={colors.warning}>
              No droplets found. Create one first or use SSH manually.
            </Text>
          )}
        </Box>
        <Text color={colors.muted}>Press Esc to cancel</Text>
      </Box>
    );
  }

  // Setup - Create droplet flow
  if (mode === "setup-create-droplet") {
    const regionOptions = DO.RECOMMENDED_REGIONS.map((r) => ({
      label: r.name,
      value: r.slug,
    }));

    const sizeOptions = DO.RECOMMENDED_SIZES.map((s) => ({
      label: `${s.name} - $${s.price}/mo`,
      value: s.slug,
    }));

    const sshKeyOptions = sshKeys.map((k) => ({
      label: k.name,
      value: k.id.toString(),
    }));

    const serverTypeLabel =
      setupState.serverType.charAt(0).toUpperCase() +
      setupState.serverType.slice(1);

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Create {serverTypeLabel} Droplet
        </Text>
        <Box marginY={1} flexDirection="column">
          {setupState.createStep === 0 && (
            <Box>
              <Text>Droplet name: </Text>
              <TextInput
                value={setupState.dropletName}
                onChange={(v) =>
                  setSetupState((prev) => ({ ...prev, dropletName: v }))
                }
                onSubmit={() =>
                  setSetupState((prev) => ({ ...prev, createStep: 1 }))
                }
              />
            </Box>
          )}
          {setupState.createStep === 1 && (
            <Box flexDirection="column">
              <Text>Region:</Text>
              <SelectInput
                items={regionOptions}
                onSelect={(item) =>
                  setSetupState((prev) => ({
                    ...prev,
                    dropletRegion: item.value,
                    createStep: 2,
                  }))
                }
              />
            </Box>
          )}
          {setupState.createStep === 2 && (
            <Box flexDirection="column">
              <Text>Size:</Text>
              <SelectInput
                items={sizeOptions}
                onSelect={(item) =>
                  setSetupState((prev) => ({
                    ...prev,
                    dropletSize: item.value,
                    createStep: 3,
                  }))
                }
              />
            </Box>
          )}
          {setupState.createStep === 3 && (
            <Box flexDirection="column">
              <Text>SSH Key:</Text>
              {sshKeyOptions.length > 0 ? (
                <SelectInput
                  items={sshKeyOptions}
                  onSelect={async (item) => {
                    setSetupState((prev) => ({
                      ...prev,
                      dropletSshKeyId: item.value,
                    }));
                    // Create the droplet
                    setMode("setup-running");
                    setSetupState((prev) => ({
                      ...prev,
                      logs: [
                        { message: "Creating droplet...", status: "running" },
                      ],
                    }));

                    const tagMap = {
                      worker: "target-server",
                      build: "build-server",
                      gateway: "gateway-server",
                    };

                    const result = await Setup.createDroplet(
                      {
                        name: setupState.dropletName,
                        region: setupState.dropletRegion,
                        size: setupState.dropletSize,
                        sshKeyId: item.value,
                        tags: [tagMap[setupState.serverType]],
                      },
                      onProgress,
                    );

                    if (result.success && result.sshHost) {
                      // Continue with setup
                      runSetup(setupState.serverType, result.sshHost);
                    } else {
                      setSetupState((prev) => ({
                        ...prev,
                        logs: [
                          ...prev.logs,
                          {
                            message: result.error || "Failed to create droplet",
                            status: "error",
                          },
                        ],
                        result: { success: false, error: result.error },
                      }));
                      setMode("setup-done");
                    }
                  }}
                />
              ) : (
                <Text color={colors.error}>
                  No SSH keys found. Add one in Digital Ocean first.
                </Text>
              )}
            </Box>
          )}
        </Box>
        <Text color={colors.muted}>Press Esc to cancel</Text>
      </Box>
    );
  }

  // GitHub key management screen
  if ((mode === "github-key" || mode === "github-key-action") && selectedServer) {
    const keyTitle = `ruilify-${selectedServer.name}`;

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          GitHub SSH Key - {selectedServer.name}
        </Text>

        <Box marginY={1} flexDirection="column">
          <Text>
            <Text color={colors.muted}>Key Title: </Text>
            {keyTitle}
          </Text>
          <Text>
            <Text color={colors.muted}>Status: </Text>
            {githubConnected === null ? (
              <Text color={colors.muted}>Checking...</Text>
            ) : githubConnected ? (
              <Text color={colors.success}>● Connected</Text>
            ) : (
              <Text color={colors.warning}>○ Not connected</Text>
            )}
          </Text>
        </Box>

        {githubKeyAction && (
          <Box marginY={1}>
            {mode === "github-key-action" ? (
              <Spinner label={githubKeyAction} />
            ) : (
              <Text color={githubKeyAction.startsWith("Error") ? colors.error : colors.success}>
                {githubKeyAction}
              </Text>
            )}
          </Box>
        )}

        <Box marginY={1} flexDirection="column">
          <Text color={colors.muted}>
            {githubConnected
              ? "Server can clone private repos from GitHub via SSH."
              : "Connect to generate SSH key and register it on GitHub."}
          </Text>
        </Box>

        <Box borderStyle="single" borderColor={colors.muted} paddingX={1}>
          <Text color={colors.muted}>
            {githubConnected ? (
              "[T] Test [C] Regenerate [D] Delete [Esc] Back"
            ) : (
              "[C] Connect to GitHub [Esc] Back"
            )}
          </Text>
        </Box>
      </Box>
    );
  }

  // Delete server - running
  if (mode === "delete-running" && selectedServer) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Deleting {selectedServer.name}...
        </Text>
        <Box marginY={1}>
          <Spinner label={deleteProgress || "Processing..."} />
        </Box>
      </Box>
    );
  }

  // Delete server - options
  if (mode === "delete" && selectedServer) {
    const hasPublicIp = !!selectedServer.public_ip;
    const projectsWithDomain = DB.listProjects().filter(
      (p) => p.target_server === selectedServer.id && p.domain
    );

    // Build options list
    const optionsList: Array<{ key: keyof typeof deleteOptions; label: string; description: string }> = [];

    if (hasPublicIp) {
      optionsList.push({
        key: "deleteDroplet",
        label: "Delete droplet from Digital Ocean",
        description: `IP: ${selectedServer.public_ip}`,
      });
    }

    optionsList.push({
      key: "deleteDns",
      label: "Delete DNS records from Cloudflare",
      description: projectsWithDomain.length > 0
        ? `${projectsWithDomain.length} domain(s): ${projectsWithDomain.map((p) => p.domain).join(", ")}`
        : "No domains configured",
    });

    optionsList.push({
      key: "deleteGithubKey",
      label: "Delete GitHub SSH key",
      description: `ruilify-${selectedServer.name}`,
    });

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.error}>
          Delete Server: {selectedServer.name}
        </Text>

        <Box marginY={1} flexDirection="column">
          <Text color={colors.muted}>Select what to delete (Space to toggle):</Text>
          <Text />
          {optionsList.map((opt, i) => (
            <Box key={opt.key} flexDirection="column">
              <Text>
                <Text color={deleteSelectedOption === i ? colors.primary : colors.text}>
                  {deleteSelectedOption === i ? "▸ " : "  "}
                </Text>
                <Text color={deleteOptions[opt.key] ? colors.success : colors.muted}>
                  [{deleteOptions[opt.key] ? "x" : " "}]
                </Text>
                <Text> {opt.label}</Text>
              </Text>
              <Text color={colors.muted}>      {opt.description}</Text>
            </Box>
          ))}
        </Box>

        {/* Show projects that will be deleted */}
        {DB.listProjects().filter((p) => p.target_server === selectedServer.id).length > 0 && (
          <Box marginY={1} flexDirection="column">
            <Text color={colors.warning}>
              Projects that will be deleted:
            </Text>
            {DB.listProjects()
              .filter((p) => p.target_server === selectedServer.id)
              .map((p) => (
                <Text key={p.id} color={colors.muted}>
                  {"  "}- {p.name} {p.domain ? `(${p.domain})` : ""}
                </Text>
              ))}
          </Box>
        )}

        <Box marginY={1}>
          <Text color={colors.warning}>
            This will permanently remove the server and all its projects.
          </Text>
        </Box>

        <Box borderStyle="single" borderColor={colors.muted} paddingX={1}>
          <Text color={colors.muted}>
            [Space] Toggle  [Enter] Delete  [Esc] Cancel
          </Text>
        </Box>
      </Box>
    );
  }

  if (mode === "add") {
    const roleOptions = [
      { label: "Worker", value: "worker" as ServerRole },
      { label: "Build", value: "build" as ServerRole },
      { label: "Gateway", value: "gateway" as ServerRole },
    ];

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Add Server (Manual Registration)
        </Text>
        <Text color={colors.muted}>
          Use 'S' for Setup to install and configure a server
        </Text>
        <Box marginY={1} flexDirection="column">
          {addStep === 0 && (
            <Box>
              <Text>Name: </Text>
              <TextInput
                value={addForm.name}
                onChange={(v) => setAddForm({ ...addForm, name: v })}
                onSubmit={() => setAddStep(1)}
              />
            </Box>
          )}
          {addStep === 1 && (
            <Box>
              <Text>Tailscale IP: </Text>
              <TextInput
                value={addForm.tailscale_ip}
                onChange={(v) => setAddForm({ ...addForm, tailscale_ip: v })}
                onSubmit={() => setAddStep(2)}
              />
            </Box>
          )}
          {addStep === 2 && (
            <Box>
              <Text>Public IP (optional): </Text>
              <TextInput
                value={addForm.public_ip}
                onChange={(v) => setAddForm({ ...addForm, public_ip: v })}
                onSubmit={() => setAddStep(3)}
              />
            </Box>
          )}
          {addStep === 3 && (
            <Box flexDirection="column">
              <Text>Role:</Text>
              <SelectInput
                items={roleOptions}
                onSelect={(item) => {
                  logger.info(
                    `Adding server: ${addForm.name} (${item.value})`,
                    "servers",
                  );
                  addServer({
                    name: addForm.name,
                    tailscale_ip: addForm.tailscale_ip,
                    public_ip: addForm.public_ip || undefined,
                    role: item.value,
                  });
                  logger.success(`Added server: ${addForm.name}`, "servers");
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

  if (mode === "edit" && selectedServer) {
    const roleOptions = [
      { label: "Worker", value: "worker" as ServerRole },
      { label: "Build", value: "build" as ServerRole },
      { label: "Gateway", value: "gateway" as ServerRole },
    ];

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Edit Server: {selectedServer.name}
        </Text>
        <Box marginY={1} flexDirection="column">
          {editStep === 0 && (
            <Box>
              <Text>Name: </Text>
              <TextInput
                value={editForm.name}
                onChange={(v) => setEditForm({ ...editForm, name: v })}
                onSubmit={() => setEditStep(1)}
              />
            </Box>
          )}
          {editStep === 1 && (
            <Box>
              <Text>Tailscale IP: </Text>
              <TextInput
                value={editForm.tailscale_ip}
                onChange={(v) => setEditForm({ ...editForm, tailscale_ip: v })}
                onSubmit={() => setEditStep(2)}
              />
            </Box>
          )}
          {editStep === 2 && (
            <Box>
              <Text>Public IP (optional): </Text>
              <TextInput
                value={editForm.public_ip}
                onChange={(v) => setEditForm({ ...editForm, public_ip: v })}
                onSubmit={() => setEditStep(3)}
              />
            </Box>
          )}
          {editStep === 3 && (
            <Box flexDirection="column">
              <Text>Role:</Text>
              <SelectInput
                items={roleOptions}
                initialIndex={roleOptions.findIndex(
                  (r) => r.value === editForm.role,
                )}
                onSelect={(item) => {
                  updateServer(selectedServer.id, {
                    name: editForm.name,
                    tailscale_ip: editForm.tailscale_ip,
                    public_ip: editForm.public_ip || undefined,
                    role: item.value,
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

  if ((mode === "details" || mode === "details-updating") && selectedServer) {
    const d = serverDetails;

    // Show loading spinner while fetching details
    if (loadingDetails && !d) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color={colors.primary}>
            {selectedServer.name}
          </Text>
          <Box marginY={1}>
            <Spinner label="Loading server details..." />
          </Box>
        </Box>
      );
    }

    // Progress bar component
    const ProgressBar = ({
      percent,
      width = 20,
    }: {
      percent: number;
      width?: number;
    }) => {
      const filled = Math.round((percent / 100) * width);
      const empty = width - filled;
      const color =
        percent > 80
          ? colors.error
          : percent > 60
            ? colors.warning
            : colors.success;
      return (
        <Text>
          <Text color={color}>{"█".repeat(filled)}</Text>
          <Text color={colors.muted}>{"░".repeat(empty)}</Text>
          <Text color={colors.muted}> {percent}%</Text>
        </Text>
      );
    };

    return (
      <Box flexDirection="column" padding={1}>
        {/* Header */}
        <Box marginBottom={1}>
          <Text bold color={colors.primary}>
            {selectedServer.name}
          </Text>
          <Text color={colors.muted}> - {formatRole(selectedServer.role)}</Text>
          {loadingDetails && <Text color={colors.muted}> (refreshing...)</Text>}
        </Box>

        {/* Action status */}
        {detailsAction && (
          <Box marginBottom={1}>
            <Spinner label={detailsAction} />
          </Box>
        )}

        {/* Main content in two columns */}
        <Box flexDirection="row" marginBottom={1}>
          {/* Left column - Basic info */}
          <Box flexDirection="column" width="50%">
            <Text bold color={colors.text}>
              Network
            </Text>
            <Text>
              <Text color={colors.muted}>Tailscale IP: </Text>
              {selectedServer.tailscale_ip}
            </Text>
            {selectedServer.public_ip && (
              <Text>
                <Text color={colors.muted}>Public IP: </Text>
                {selectedServer.public_ip}
              </Text>
            )}
            {d?.tailscale && (
              <>
                <Text>
                  <Text color={colors.muted}>Magic DNS: </Text>
                  <Text color={colors.success}>{d.tailscale.magicDns}</Text>
                </Text>
                <Text>
                  <Text color={colors.muted}>TS Version: </Text>
                  {d.tailscale.version}
                </Text>
              </>
            )}

            <Text />
            <Text bold color={colors.text}>
              System
            </Text>
            {d ? (
              <>
                <Text>
                  <Text color={colors.muted}>Hostname: </Text>
                  {d.hostname}
                </Text>
                <Text>
                  <Text color={colors.muted}>OS: </Text>
                  {d.os}
                </Text>
                <Text>
                  <Text color={colors.muted}>Kernel: </Text>
                  {d.kernel}
                </Text>
                <Text>
                  <Text color={colors.muted}>Uptime: </Text>
                  {d.uptime}
                </Text>
              </>
            ) : (
              <Text color={colors.muted}>Unable to fetch system info</Text>
            )}
          </Box>

          {/* Right column - Services & Resources */}
          <Box flexDirection="column" width="50%">
            <Text bold color={colors.text}>
              Services
            </Text>
            {d?.docker ? (
              <Text>
                <Text color={colors.success}>● </Text>
                <Text color={colors.muted}>Docker </Text>
                {d.docker.version}
                <Text color={colors.muted}>
                  {" "}
                  ({d.docker.containers} containers)
                </Text>
              </Text>
            ) : (
              <Text>
                <Text color={colors.error}>○ </Text>
                <Text color={colors.muted}>Docker not installed</Text>
              </Text>
            )}
            {d?.caddy ? (
              <Text>
                <Text color={d.caddy.running ? colors.success : colors.warning}>
                  {d.caddy.running ? "● " : "○ "}
                </Text>
                <Text color={colors.muted}>Caddy </Text>
                {d.caddy.version}
                {!d.caddy.running && (
                  <Text color={colors.warning}> (stopped)</Text>
                )}
              </Text>
            ) : selectedServer.role === "gateway" ? (
              <Text>
                <Text color={colors.error}>○ </Text>
                <Text color={colors.muted}>Caddy not installed</Text>
              </Text>
            ) : null}
            {/* GitHub status for worker/build servers */}
            {selectedServer.role !== "gateway" && (
              <Text>
                <Text color={githubConnected ? colors.success : colors.warning}>
                  {githubConnected ? "● " : "○ "}
                </Text>
                <Text color={colors.muted}>GitHub </Text>
                {githubConnected === null
                  ? "checking..."
                  : githubConnected
                    ? "connected"
                    : "not connected"}
              </Text>
            )}

            <Text />
            <Text bold color={colors.text}>
              Resources
            </Text>
            {d ? (
              <>
                <Text>
                  <Text color={colors.muted}>Memory: </Text>
                  {d.memory.used}/{d.memory.total}
                </Text>
                <ProgressBar percent={d.memory.percent} />
                <Text>
                  <Text color={colors.muted}>Disk: </Text>
                  {d.disk.used}/{d.disk.total}
                </Text>
                <ProgressBar percent={d.disk.percent} />
              </>
            ) : (
              <Text color={colors.muted}>Unable to fetch resource info</Text>
            )}

            {d?.updates && (
              <>
                <Text />
                <Text bold color={colors.text}>
                  Updates
                </Text>
                <Text>
                  <Text
                    color={
                      d.updates.available > 0 ? colors.warning : colors.success
                    }
                  >
                    {d.updates.available} available
                  </Text>
                  {d.updates.security > 0 && (
                    <Text color={colors.error}>
                      {" "}
                      ({d.updates.security} security)
                    </Text>
                  )}
                </Text>
              </>
            )}
          </Box>
        </Box>

        {/* Actions */}
        <Box borderStyle="single" borderColor={colors.muted} paddingX={1}>
          <Text color={colors.muted}>
            [r] Refresh [u] Check updates [U] Apply updates{selectedServer.role !== "gateway" ? " [G] GitHub" : ""} [Esc] Back
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={colors.primary}>
          Servers
        </Text>
        <Text color={colors.muted}> ({servers.length})</Text>
        {checkingStatus && (
          <Text color={colors.muted}> - checking status...</Text>
        )}
      </Box>

      <List
        items={listItems}
        selectedIndex={selectedIndex}
        focused={focused}
        emptyMessage="No servers registered. Press 'S' to setup a new server."
      />

      <ActionBar actions={actions} />
    </Box>
  );
}
