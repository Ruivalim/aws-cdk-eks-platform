/**
 * Action bar showing available actions for current context
 */
import React from "react";
import { Box, Text } from "ink";
import { colors } from "../utils/theme";

interface Action {
  key: string;
  label: string;
  disabled?: boolean;
}

interface ActionBarProps {
  actions: Action[];
}

export default function ActionBar({ actions }: ActionBarProps) {
  return (
    <Box marginTop={1} gap={2}>
      {actions.map((action) => (
        <Box key={action.key}>
          <Text color={action.disabled ? colors.muted : colors.text}>
            <Text color={action.disabled ? colors.muted : colors.primary} bold>
              [{action.key}]
            </Text>{" "}
            {action.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export type { Action };
