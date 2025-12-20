/**
 * Main TUI Application
 */
import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useApp, useStdout } from "ink";
import Header from "./components/Header";
import Sidebar, { Screen, menuItems } from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import Servers from "./screens/Servers";
import Projects from "./screens/Projects";
import Deployments from "./screens/Deployments";
import Cloudflare from "./screens/Cloudflare";
import DigitalOcean from "./screens/DigitalOcean";
import Logs from "./screens/Logs";
import Settings from "./screens/Settings";
import { useServers } from "./hooks/useServers";
import { useDeployments } from "./hooks/useDeployments";
import { colors } from "./utils/theme";
import { formatRelativeTime } from "./utils/format";

type Focus = "sidebar" | "content";

export default function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [screen, setScreen] = useState<Screen>("servers");
  const [focus, setFocus] = useState<Focus>("content");
  const [sidebarIndex, setSidebarIndex] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  const { onlineCount, totalCount } = useServers();
  const { deployments } = useDeployments();

  // Calculate terminal dimensions
  const [dimensions, setDimensions] = useState({
    width: stdout?.columns || 80,
    height: stdout?.rows || 24,
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: stdout?.columns || 80,
        height: stdout?.rows || 24,
      });
    };

    stdout?.on("resize", handleResize);
    return () => {
      stdout?.off("resize", handleResize);
    };
  }, [stdout]);

  // Global key bindings
  useInput((input, key) => {
    // Quit
    if (input === "q" && !showHelp) {
      exit();
      return;
    }

    // Help toggle
    if (input === "?") {
      setShowHelp(!showHelp);
      return;
    }

    if (showHelp) {
      if (key.escape || key.return) {
        setShowHelp(false);
      }
      return;
    }

    // Quick screen switch with numbers
    if (input >= "1" && input <= "7") {
      const idx = parseInt(input) - 1;
      if (idx < menuItems.length) {
        setScreen(menuItems[idx].id);
        setSidebarIndex(idx);
      }
      return;
    }

    // Focus switching
    if (input === "h" || key.leftArrow) {
      if (focus === "content") {
        setFocus("sidebar");
      }
    } else if (input === "l" || key.rightArrow) {
      if (focus === "sidebar") {
        setFocus("content");
      }
    }

    // Tab to switch focus
    if (key.tab) {
      setFocus(focus === "sidebar" ? "content" : "sidebar");
    }

    // Sidebar navigation when focused
    if (focus === "sidebar") {
      if (input === "j" || key.downArrow) {
        setSidebarIndex((i) => Math.min(i + 1, menuItems.length - 1));
      } else if (input === "k" || key.upArrow) {
        setSidebarIndex((i) => Math.max(i - 1, 0));
      } else if (key.return) {
        setScreen(menuItems[sidebarIndex].id);
        setFocus("content");
      }
    }
  });

  const lastDeploy =
    deployments.length > 0
      ? {
          project: deployments[0].projectName || "Unknown",
          time: formatRelativeTime(deployments[0].started_at),
        }
      : null;

  if (showHelp) {
    return (
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor={colors.primary}
        padding={1}
      >
        <Text bold color={colors.primary}>
          Keyboard Shortcuts
        </Text>
        <Box marginY={1} flexDirection="column">
          <Text bold>Navigation:</Text>
          <Text> j/k or arrows Navigate up/down</Text>
          <Text> h/l or arrows Switch panels</Text>
          <Text> Tab Toggle sidebar/content focus</Text>
          <Text> Enter Select item</Text>
          <Text> Esc/Backspace Go back</Text>
          <Text> 1-7 Quick switch screens</Text>
          <Text />
          <Text bold>Actions:</Text>
          <Text> a Add new item</Text>
          <Text> e Edit selected item</Text>
          <Text> d Delete selected item</Text>
          <Text> r Refresh</Text>
          <Text> D Deploy (Projects)</Text>
          <Text> L View logs (Deployments)</Text>
          <Text />
          <Text bold>Global:</Text>
          <Text> ? Toggle help</Text>
          <Text> q Quit</Text>
        </Box>
        <Text color={colors.muted}>Press Enter or Esc to close</Text>
      </Box>
    );
  }

  const contentHeight = dimensions.height - 6; // Header + StatusBar + borders

  return (
    <Box
      flexDirection="column"
      width={dimensions.width}
      height={dimensions.height}
    >
      <Header />

      <Box flexGrow={1} height={contentHeight}>
        <Sidebar
          activeScreen={screen}
          onNavigate={setScreen}
          selectedIndex={sidebarIndex}
          focused={focus === "sidebar"}
        />

        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="single"
          borderColor={focus === "content" ? colors.primary : colors.border}
          paddingX={1}
        >
          {screen === "servers" && <Servers focused={focus === "content"} />}
          {screen === "projects" && <Projects focused={focus === "content"} />}
          {screen === "deployments" && (
            <Deployments focused={focus === "content"} />
          )}
          {screen === "cloudflare" && (
            <Cloudflare focused={focus === "content"} />
          )}
          {screen === "digitalocean" && (
            <DigitalOcean focused={focus === "content"} />
          )}
          {screen === "logs" && <Logs focused={focus === "content"} />}
          {screen === "settings" && <Settings focused={focus === "content"} />}
        </Box>
      </Box>

      <StatusBar
        serverCount={{ online: onlineCount, total: totalCount }}
        lastDeploy={lastDeploy}
      />
    </Box>
  );
}
