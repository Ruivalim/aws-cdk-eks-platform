/**
 * Logs screen - View and manage TUI logs
 */
import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { colors } from "../utils/theme";
import {
  readLogs,
  clearLog,
  getLogFilePath,
  type LogEntry,
  type LogLevel,
} from "../utils/logger";
import Modal from "../components/Modal";

interface LogsProps {
  focused: boolean;
}

type FilterLevel = LogLevel | "ALL";

export default function Logs({ focused }: LogsProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<FilterLevel>("ALL");
  const [scrollOffset, setScrollOffset] = useState(0);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const maxVisible = 20;

  // Load logs
  const loadLogs = useCallback(() => {
    const entries = readLogs(500);
    setLogs(entries);
  }, []);

  // Initial load and auto-refresh
  useEffect(() => {
    loadLogs();

    if (autoRefresh) {
      const interval = setInterval(loadLogs, 2000);
      return () => clearInterval(interval);
    }
  }, [loadLogs, autoRefresh]);

  // Filter logs
  const filteredLogs =
    filter === "ALL" ? logs : logs.filter((l) => l.level === filter);

  // Handle scrolling and actions
  useInput(
    (input, key) => {
      if (showClearConfirm) return;

      if (input === "j" || key.downArrow) {
        setScrollOffset((o) =>
          Math.min(o + 1, Math.max(0, filteredLogs.length - maxVisible)),
        );
      } else if (input === "k" || key.upArrow) {
        setScrollOffset((o) => Math.max(o - 1, 0));
      } else if (input === "g") {
        // Go to top
        setScrollOffset(0);
      } else if (input === "G") {
        // Go to bottom
        setScrollOffset(Math.max(0, filteredLogs.length - maxVisible));
      } else if (input === "r") {
        // Refresh
        loadLogs();
      } else if (input === "c") {
        // Clear logs
        setShowClearConfirm(true);
      } else if (input === "a") {
        // Toggle auto-refresh
        setAutoRefresh((a) => !a);
      } else if (input === "f") {
        // Cycle filter
        const levels: FilterLevel[] = [
          "ALL",
          "INFO",
          "SUCCESS",
          "ERROR",
          "WARN",
          "DEBUG",
        ];
        const currentIndex = levels.indexOf(filter);
        setFilter(levels[(currentIndex + 1) % levels.length]);
        setScrollOffset(0);
      }
    },
    { isActive: focused && !showClearConfirm },
  );

  // Get color for log level
  const getLevelColor = (level: LogLevel): string => {
    switch (level) {
      case "SUCCESS":
        return colors.success;
      case "ERROR":
        return colors.error;
      case "WARN":
        return colors.warning;
      case "DEBUG":
        return colors.muted;
      default:
        return colors.text;
    }
  };

  // Format timestamp to just time
  const formatTime = (timestamp: string): string => {
    if (!timestamp) return "        ";
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString("en-US", { hour12: false });
    } catch {
      return "        ";
    }
  };

  // Visible logs slice
  const visibleLogs = filteredLogs.slice(
    scrollOffset,
    scrollOffset + maxVisible,
  );

  if (showClearConfirm) {
    return (
      <Modal
        title="Clear Logs"
        message="Are you sure you want to clear all logs?"
        type="confirm"
        onConfirm={() => {
          clearLog();
          loadLogs();
          setShowClearConfirm(false);
          setScrollOffset(0);
        }}
        onCancel={() => setShowClearConfirm(false)}
      />
    );
  }

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color={colors.primary}>
          Logs
        </Text>
        <Text color={colors.muted}>
          {" "}
          ({filteredLogs.length} entries
          {filter !== "ALL" && `, filtered: ${filter}`})
        </Text>
        {autoRefresh && <Text color={colors.success}> [auto-refresh]</Text>}
      </Box>

      {/* Log entries */}
      <Box flexDirection="column" height={maxVisible}>
        {visibleLogs.length === 0 ? (
          <Text color={colors.muted}>No logs to display</Text>
        ) : (
          visibleLogs.map((log, i) => (
            <Box key={scrollOffset + i}>
              <Text color={colors.muted}>{formatTime(log.timestamp)} </Text>
              <Text color={getLevelColor(log.level)}>
                {log.level.padEnd(7)}
              </Text>
              {log.source && (
                <Text color={colors.primary}>[{log.source}] </Text>
              )}
              <Text color={colors.text}>
                {log.message.length > 60
                  ? log.message.substring(0, 57) + "..."
                  : log.message}
              </Text>
            </Box>
          ))
        )}
      </Box>

      {/* Scroll indicator */}
      {filteredLogs.length > maxVisible && (
        <Box marginTop={1}>
          <Text color={colors.muted}>
            Showing {scrollOffset + 1}-
            {Math.min(scrollOffset + maxVisible, filteredLogs.length)} of{" "}
            {filteredLogs.length}
          </Text>
        </Box>
      )}

      {/* Actions */}
      <Box
        marginTop={1}
        borderStyle="single"
        borderColor={colors.muted}
        paddingX={1}
      >
        <Text color={colors.muted}>
          [j/k] Scroll [g/G] Top/Bottom [f] Filter:{" "}
          <Text color={filter === "ALL" ? colors.success : colors.warning}>
            {filter}
          </Text>{" "}
          [a] Auto:{autoRefresh ? "ON" : "OFF"} [r] Refresh [c] Clear
        </Text>
      </Box>

      {/* Log file path */}
      <Box marginTop={1}>
        <Text color={colors.muted}>Log file: {getLogFilePath()}</Text>
      </Box>
    </Box>
  );
}
