/**
 * Sidebar navigation component
 */
import React from "react";
import { Box, Text } from "ink";
import { colors, icons } from "../utils/theme";

export type Screen =
  | "servers"
  | "projects"
  | "deployments"
  | "cloudflare"
  | "digitalocean"
  | "logs"
  | "settings";

interface MenuItem {
  id: Screen;
  label: string;
  shortcut?: string;
}

const menuItems: MenuItem[] = [
  { id: "servers", label: "Servers", shortcut: "1" },
  { id: "projects", label: "Projects", shortcut: "2" },
  { id: "deployments", label: "Deployments", shortcut: "3" },
  { id: "cloudflare", label: "Cloudflare", shortcut: "4" },
  { id: "digitalocean", label: "DigitalOcean", shortcut: "5" },
  { id: "logs", label: "Logs", shortcut: "6" },
  { id: "settings", label: "Settings", shortcut: "7" },
];

interface SidebarProps {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
  selectedIndex: number;
  focused: boolean;
}

export default function Sidebar({
  activeScreen,
  selectedIndex,
  focused,
}: SidebarProps) {
  return (
    <Box
      flexDirection="column"
      width={18}
      borderStyle="single"
      borderColor={focused ? colors.primary : colors.border}
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color={colors.primary}>
          Menu
        </Text>
      </Box>

      {menuItems.map((item, index) => {
        const isActive = item.id === activeScreen;
        const isSelected = index === selectedIndex && focused;

        return (
          <Box key={item.id}>
            <Text
              color={
                isActive
                  ? colors.primary
                  : isSelected
                    ? colors.text
                    : colors.muted
              }
              bold={isActive}
              inverse={isSelected}
            >
              {isActive ? icons.arrow : " "} {item.label}
            </Text>
          </Box>
        );
      })}

      <Box marginTop={1} flexDirection="column">
        <Text color={colors.muted} dimColor>
          j/k navigate
        </Text>
        <Text color={colors.muted} dimColor>
          Enter select
        </Text>
        <Text color={colors.muted} dimColor>
          q quit
        </Text>
      </Box>
    </Box>
  );
}

export { menuItems };
export type { MenuItem };
