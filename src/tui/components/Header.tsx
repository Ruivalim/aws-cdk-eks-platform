/**
 * Header component
 */
import React from "react";
import { Box, Text } from "ink";
import { colors } from "../utils/theme";

interface HeaderProps {
  title?: string;
}

export default function Header({ title = "Ruilify" }: HeaderProps) {
  return (
    <Box
      borderStyle="single"
      borderColor={colors.border}
      paddingX={1}
      justifyContent="space-between"
    >
      <Text bold color={colors.primary}>
        {title}
      </Text>
      <Text color={colors.muted}>
        <Text color={colors.primary}>[?]</Text> Help
        {"  "}
        <Text color={colors.primary}>[Q]</Text> Quit
      </Text>
    </Box>
  );
}
