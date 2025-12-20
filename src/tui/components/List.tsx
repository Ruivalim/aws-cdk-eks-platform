/**
 * Navigable list component
 */
import React from "react";
import { Box, Text } from "ink";
import { colors, icons } from "../utils/theme";

interface ListItem {
  id: string;
  label: string;
  status?: "online" | "offline" | "pending" | "error";
  meta?: string;
}

interface ListProps {
  items: ListItem[];
  selectedIndex: number;
  focused: boolean;
  emptyMessage?: string;
  onSelect?: (item: ListItem) => void;
}

export default function List({
  items,
  selectedIndex,
  focused,
  emptyMessage = "No items",
}: ListProps) {
  if (items.length === 0) {
    return (
      <Box paddingY={1}>
        <Text color={colors.muted}>{emptyMessage}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {items.map((item, index) => {
        const isSelected = index === selectedIndex && focused;
        const statusIcon =
          item.status === "online"
            ? icons.server
            : item.status === "offline"
              ? icons.serverOffline
              : item.status === "error"
                ? icons.cross
                : item.status === "pending"
                  ? icons.warning
                  : "";

        const statusColor =
          item.status === "online"
            ? colors.success
            : item.status === "offline"
              ? colors.muted
              : item.status === "error"
                ? colors.error
                : item.status === "pending"
                  ? colors.warning
                  : colors.text;

        return (
          <Box key={item.id}>
            <Text
              inverse={isSelected}
              color={isSelected ? colors.text : undefined}
            >
              {statusIcon && <Text color={statusColor}>{statusIcon} </Text>}
              <Text bold={isSelected}>{item.label}</Text>
              {item.meta && <Text color={colors.muted}> {item.meta}</Text>}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export type { ListItem };
