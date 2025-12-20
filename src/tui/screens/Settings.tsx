/**
 * Settings screen
 */
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useSettings, SETTINGS_DEFINITIONS } from "../hooks/useSettings";
import List, { ListItem } from "../components/List";
import ActionBar from "../components/ActionBar";
import Spinner from "../components/Spinner";
import { colors } from "../utils/theme";

type Mode = "list" | "edit";

interface SettingsProps {
  focused: boolean;
}

export default function Settings({ focused }: SettingsProps) {
  const { settings, loading, error, setSetting, refresh } = useSettings();

  const [mode, setMode] = useState<Mode>("list");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editValue, setEditValue] = useState("");

  const settingsList = SETTINGS_DEFINITIONS.map((def) => ({
    key: def.key,
    label: def.label,
    description: def.description,
    value: settings[def.key] ?? def.defaultValue,
    defaultValue: def.defaultValue,
  }));

  const selectedSetting = settingsList[selectedIndex];

  useInput(
    (input, key) => {
      if (!focused || mode !== "list") return;

      if (input === "j" || key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, settingsList.length - 1));
      } else if (input === "k" || key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if ((input === "e" || key.return) && selectedSetting) {
        setEditValue(selectedSetting.value);
        setMode("edit");
      } else if (input === "r") {
        refresh();
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
    { isActive: mode === "edit" },
  );

  const listItems: ListItem[] = settingsList.map((s) => ({
    id: s.key,
    label: s.label,
    meta: s.value === s.defaultValue ? `${s.value} (default)` : s.value,
  }));

  const actions = [
    { key: "e", label: "Edit", disabled: !selectedSetting },
    { key: "r", label: "Refresh" },
  ];

  if (loading) {
    return <Spinner label="Loading settings..." />;
  }

  if (error) {
    return <Text color={colors.error}>Error: {error}</Text>;
  }

  if (mode === "edit" && selectedSetting) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Edit {selectedSetting.label}
        </Text>
        <Box marginY={1} flexDirection="column">
          <Text color={colors.muted}>{selectedSetting.description}</Text>
          <Box marginTop={1}>
            <Text>Value: </Text>
            <TextInput
              value={editValue}
              onChange={setEditValue}
              onSubmit={() => {
                setSetting(selectedSetting.key, editValue);
                setMode("list");
              }}
            />
          </Box>
          <Text color={colors.muted} dimColor>
            Default: {selectedSetting.defaultValue}
          </Text>
        </Box>
        <Text color={colors.muted}>Press Enter to save, Esc to cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={colors.primary}>
          Settings
        </Text>
      </Box>

      <List
        items={listItems}
        selectedIndex={selectedIndex}
        focused={focused}
        emptyMessage="No settings available."
      />

      <Box marginTop={1}>
        <Text color={colors.muted} dimColor>
          Settings are stored in SQLite. Tokens remain in .env file.
        </Text>
      </Box>

      <ActionBar actions={actions} />
    </Box>
  );
}
