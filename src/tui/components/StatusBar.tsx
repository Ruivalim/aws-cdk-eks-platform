/**
 * Status bar at the bottom of the screen
 */
import React from "react";
import { Box, Text } from "ink";
import { colors } from "../utils/theme";

interface StatusBarProps {
  serverCount: { online: number; total: number };
  lastDeploy?: { project: string; time: string } | null;
  message?: string;
}

export default function StatusBar({
  serverCount,
  lastDeploy,
  message,
}: StatusBarProps) {
  return (
    <Box
      borderStyle="single"
      borderColor={colors.border}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box>
        <Text color={colors.muted}>
          Servers:{" "}
          <Text color={serverCount.online > 0 ? colors.success : colors.error}>
            {serverCount.online}/{serverCount.total}
          </Text>
          {" online"}
        </Text>
      </Box>

      <Box>
        {message ? (
          <Text color={colors.warning}>{message}</Text>
        ) : lastDeploy ? (
          <Text color={colors.muted}>
            Last deploy: <Text color={colors.text}>{lastDeploy.project}</Text> (
            {lastDeploy.time})
          </Text>
        ) : (
          <Text color={colors.muted}>No recent deploys</Text>
        )}
      </Box>

      <Box>
        <Text color={colors.muted}>
          <Text color={colors.primary}>?</Text> Help
          {"  "}
          <Text color={colors.primary}>q</Text> Quit
        </Text>
      </Box>
    </Box>
  );
}
