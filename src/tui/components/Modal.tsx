/**
 * Modal component for confirmations and inputs
 */
import React from "react";
import { Box, Text, useInput } from "ink";
import { colors } from "../utils/theme";

interface ModalProps {
  title: string;
  message: string;
  type?: "confirm" | "info" | "error";
  onConfirm?: () => void;
  onCancel?: () => void;
}

export default function Modal({
  title,
  message,
  type = "confirm",
  onConfirm,
  onCancel,
}: ModalProps) {
  useInput((input, key) => {
    if (type === "confirm") {
      if (input === "y" || input === "Y") {
        onConfirm?.();
      } else if (input === "n" || input === "N" || key.escape) {
        onCancel?.();
      }
    } else {
      if (key.return || key.escape) {
        onCancel?.();
      }
    }
  });

  const borderColor =
    type === "error"
      ? colors.error
      : type === "confirm"
        ? colors.warning
        : colors.primary;

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={borderColor}
      paddingX={2}
      paddingY={1}
    >
      <Text bold color={borderColor}>
        {title}
      </Text>
      <Box marginY={1}>
        <Text>{message}</Text>
      </Box>
      {type === "confirm" ? (
        <Text color={colors.muted}>
          Press{" "}
          <Text color={colors.success} bold>
            Y
          </Text>{" "}
          to confirm,{" "}
          <Text color={colors.error} bold>
            N
          </Text>{" "}
          to cancel
        </Text>
      ) : (
        <Text color={colors.muted}>Press Enter or Esc to close</Text>
      )}
    </Box>
  );
}
