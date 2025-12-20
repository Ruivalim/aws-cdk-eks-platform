/**
 * Deployments screen
 */
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useDeployments, DeploymentWithProject } from "../hooks/useDeployments";
import List, { ListItem } from "../components/List";
import ActionBar from "../components/ActionBar";
import Spinner from "../components/Spinner";
import { colors } from "../utils/theme";
import {
  formatRelativeTime,
  formatDeployState,
  truncate,
} from "../utils/format";

type Mode = "list" | "details" | "logs";

interface DeploymentsProps {
  focused: boolean;
}

export default function Deployments({ focused }: DeploymentsProps) {
  const { deployments, loading, error, refresh, getDeploymentLogs } =
    useDeployments();

  const [mode, setMode] = useState<Mode>("list");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [logs, setLogs] = useState<
    Array<{ step: string; status: string; message: string | null }>
  >([]);

  const selectedDeployment = deployments[selectedIndex];

  useInput(
    (input, key) => {
      if (!focused || mode !== "list") return;

      if (input === "j" || key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, deployments.length - 1));
      } else if (input === "k" || key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (input === "r") {
        refresh();
      } else if (input === "L" && selectedDeployment) {
        const deploymentLogs = getDeploymentLogs(selectedDeployment.id);
        setLogs(deploymentLogs);
        setMode("logs");
      } else if (key.return && selectedDeployment) {
        setMode("details");
      }
    },
    { isActive: focused && mode === "list" },
  );

  useInput(
    (_, key) => {
      if (key.escape) {
        setMode("list");
      }
    },
    { isActive: mode !== "list" },
  );

  const getStatusType = (
    state: string,
  ): "online" | "offline" | "pending" | "error" => {
    if (state === "completed") return "online";
    if (state === "failed") return "error";
    if (
      [
        "pending",
        "cloning",
        "building",
        "pushing",
        "deploying",
        "health_checking",
        "switching_traffic",
        "cleaning_up",
      ].includes(state)
    )
      return "pending";
    return "offline";
  };

  const listItems: ListItem[] = deployments.map((d) => ({
    id: d.id,
    label: d.projectName || "Unknown",
    status: getStatusType(d.state),
    meta: `${formatDeployState(d.state)} - ${truncate(d.commit_sha, 8)} - ${formatRelativeTime(d.started_at)}`,
  }));

  const actions = [
    { key: "L", label: "Logs", disabled: !selectedDeployment },
    { key: "r", label: "Refresh" },
  ];

  if (loading && deployments.length === 0) {
    return <Spinner label="Loading deployments..." />;
  }

  if (error) {
    return <Text color={colors.error}>Error: {error}</Text>;
  }

  if (mode === "logs") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Deployment Logs - {selectedDeployment?.projectName}
        </Text>
        <Box marginY={1} flexDirection="column" height={15} overflowY="hidden">
          {logs.length === 0 ? (
            <Text color={colors.muted}>No logs available.</Text>
          ) : (
            logs.map((log, i) => (
              <Box key={i}>
                <Text
                  color={
                    log.status === "done"
                      ? colors.success
                      : log.status === "error"
                        ? colors.error
                        : log.status === "running"
                          ? colors.warning
                          : colors.muted
                  }
                >
                  [{log.status}]
                </Text>
                <Text> {log.step}</Text>
                {log.message && (
                  <Text color={colors.muted}>
                    {" "}
                    - {truncate(log.message, 50)}
                  </Text>
                )}
              </Box>
            ))
          )}
        </Box>
        <Text color={colors.muted}>Press Esc to go back</Text>
      </Box>
    );
  }

  if (mode === "details" && selectedDeployment) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Deployment Details
        </Text>
        <Box marginY={1} flexDirection="column">
          <Text>
            <Text color={colors.muted}>Project:</Text>{" "}
            {selectedDeployment.projectName}
          </Text>
          <Text>
            <Text color={colors.muted}>State:</Text>{" "}
            <Text
              color={
                selectedDeployment.state === "completed"
                  ? colors.success
                  : selectedDeployment.state === "failed"
                    ? colors.error
                    : colors.warning
              }
            >
              {formatDeployState(selectedDeployment.state)}
            </Text>
          </Text>
          <Text>
            <Text color={colors.muted}>Commit:</Text>{" "}
            {selectedDeployment.commit_sha}
          </Text>
          {selectedDeployment.commit_message && (
            <Text>
              <Text color={colors.muted}>Message:</Text>{" "}
              {truncate(selectedDeployment.commit_message, 60)}
            </Text>
          )}
          <Text>
            <Text color={colors.muted}>Slot:</Text>{" "}
            {selectedDeployment.slot || "N/A"}
          </Text>
          <Text>
            <Text color={colors.muted}>Triggered:</Text>{" "}
            {selectedDeployment.triggered_by}
          </Text>
          <Text>
            <Text color={colors.muted}>Started:</Text>{" "}
            {formatRelativeTime(selectedDeployment.started_at)}
          </Text>
          {selectedDeployment.finished_at && (
            <Text>
              <Text color={colors.muted}>Finished:</Text>{" "}
              {formatRelativeTime(selectedDeployment.finished_at)}
            </Text>
          )}
          {selectedDeployment.error && (
            <Text>
              <Text color={colors.error}>Error:</Text>{" "}
              {selectedDeployment.error}
            </Text>
          )}
        </Box>
        <Text color={colors.muted}>Press Esc to go back, L for logs</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={colors.primary}>
          Deployments
        </Text>
        <Text color={colors.muted}> ({deployments.length})</Text>
      </Box>

      <List
        items={listItems}
        selectedIndex={selectedIndex}
        focused={focused}
        emptyMessage="No deployments yet."
      />

      <ActionBar actions={actions} />
    </Box>
  );
}
