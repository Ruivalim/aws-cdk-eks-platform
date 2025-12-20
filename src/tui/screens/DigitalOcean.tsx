/**
 * Digital Ocean screen
 */
import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import Spinner from "../components/Spinner";
import ActionBar from "../components/ActionBar";
import List, { ListItem } from "../components/List";
import Modal from "../components/Modal";
import { colors } from "../utils/theme";
import { formatRelativeTime } from "../utils/format";
import * as DO from "../../lib/digitalocean";

type Mode =
  | "menu"
  | "droplets"
  | "create"
  | "delete"
  | "sshkeys"
  | "billing"
  | "creating";

interface DigitalOceanProps {
  focused: boolean;
}

interface Droplet {
  id: number;
  name: string;
  status: string;
  memory: number;
  vcpus: number;
  disk: number;
  region: { name: string; slug: string };
  size: { price_monthly: number };
  networks: { v4: Array<{ ip_address: string; type: string }> };
  tags: string[];
}

interface SSHKey {
  id: number;
  name: string;
  fingerprint: string;
}

export default function DigitalOcean({ focused }: DigitalOceanProps) {
  const [mode, setMode] = useState<Mode>("menu");
  const [droplets, setDroplets] = useState<Droplet[]>([]);
  const [sshKeys, setSSHKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  const [balance, setBalance] = useState<{
    month_to_date_usage: string;
    account_balance: string;
  } | null>(null);

  // Create droplet form
  const [createStep, setCreateStep] = useState(0);
  const [createForm, setCreateForm] = useState({
    name: "",
    region: "",
    size: "",
    image: "ubuntu-24-04-x64",
    ssh_keys: [] as string[],
  });
  const [createStatus, setCreateStatus] = useState("");

  const hasToken = !!(process.env.DIGITALOCEAN_TOKEN || process.env.DO_TOKEN);

  const menuItems = [
    { label: "List Droplets", value: "droplets" },
    { label: "Create Droplet", value: "create" },
    { label: "SSH Keys", value: "sshkeys" },
    { label: "Billing", value: "billing" },
  ];

  const loadDroplets = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await DO.listDroplets();
      setDroplets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadSSHKeys = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await DO.listSSHKeys();
      setSSHKeys(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadBilling = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await DO.getBalance();
      setBalance(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const createDroplet = async () => {
    setMode("creating");
    setCreateStatus("Creating droplet...");
    try {
      const droplet = await DO.createDroplet({
        name: createForm.name,
        region: createForm.region,
        size: createForm.size,
        image: createForm.image,
        ssh_keys: createForm.ssh_keys,
        monitoring: true,
      });
      setCreateStatus(`Droplet "${droplet.name}" created! Waiting for IP...`);

      // Wait for IP
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const updated = await DO.getDroplet(droplet.id);
        const ip = DO.getPublicIP(updated);
        if (ip) {
          setCreateStatus(`Done! IP: ${ip}`);
          break;
        }
      }

      await loadDroplets();
      setTimeout(() => setMode("droplets"), 2000);
    } catch (err) {
      setCreateStatus(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      setTimeout(() => setMode("menu"), 3000);
    }
  };

  const deleteDroplet = async (id: number) => {
    setLoading(true);
    try {
      await DO.deleteDroplet(id);
      await loadDroplets();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useInput(
    (input, key) => {
      if (!focused) return;

      if (key.escape) {
        if (mode === "menu") return;
        setMode("menu");
        setSelectedIndex(0);
        setCreateStep(0);
        return;
      }

      if (mode === "menu") {
        if (input === "j" || key.downArrow) {
          setMenuIndex((i) => Math.min(i + 1, menuItems.length - 1));
        } else if (input === "k" || key.upArrow) {
          setMenuIndex((i) => Math.max(i - 1, 0));
        } else if (key.return) {
          const selected = menuItems[menuIndex].value as Mode;
          setMode(selected);
          if (selected === "droplets") loadDroplets();
          if (selected === "sshkeys") loadSSHKeys();
          if (selected === "billing") loadBilling();
          if (selected === "create") {
            loadSSHKeys();
            setCreateStep(0);
            setCreateForm({
              name: "",
              region: "",
              size: "",
              image: "ubuntu-24-04-x64",
              ssh_keys: [],
            });
          }
        }
      } else if (mode === "droplets") {
        if (input === "j" || key.downArrow) {
          setSelectedIndex((i) => Math.min(i + 1, droplets.length - 1));
        } else if (input === "k" || key.upArrow) {
          setSelectedIndex((i) => Math.max(i - 1, 0));
        } else if (input === "d" && droplets[selectedIndex]) {
          setMode("delete");
        } else if (input === "r") {
          loadDroplets();
        }
      } else if (mode === "sshkeys") {
        if (input === "r") loadSSHKeys();
      }
    },
    { isActive: focused && mode !== "create" && mode !== "creating" },
  );

  if (!hasToken) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={colors.error}>DIGITALOCEAN_TOKEN not set</Text>
        <Text color={colors.muted}>
          Add to your .env file: DIGITALOCEAN_TOKEN=your_token
        </Text>
      </Box>
    );
  }

  if (mode === "creating") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Creating Droplet
        </Text>
        <Box marginY={1}>
          <Spinner label={createStatus} />
        </Box>
      </Box>
    );
  }

  if (mode === "delete" && droplets[selectedIndex]) {
    const droplet = droplets[selectedIndex];
    return (
      <Modal
        title="Delete Droplet"
        message={`Delete "${droplet.name}"? This cannot be undone!`}
        type="confirm"
        onConfirm={() => {
          deleteDroplet(droplet.id);
          setMode("droplets");
          setSelectedIndex(Math.max(0, selectedIndex - 1));
        }}
        onCancel={() => setMode("droplets")}
      />
    );
  }

  if (mode === "create") {
    const regionOptions = DO.RECOMMENDED_REGIONS.map((r) => ({
      label: r.name,
      value: r.slug,
    }));
    const sizeOptions = DO.RECOMMENDED_SIZES.map((s) => ({
      label: `${s.name} - $${s.price}/mo`,
      value: s.slug,
    }));
    const keyOptions = sshKeys.map((k) => ({
      label: k.name,
      value: k.id.toString(),
    }));

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Create Droplet
        </Text>
        <Box marginY={1} flexDirection="column">
          {createStep === 0 && (
            <Box>
              <Text>Name: </Text>
              <TextInput
                value={createForm.name}
                onChange={(v) => setCreateForm({ ...createForm, name: v })}
                onSubmit={() => setCreateStep(1)}
              />
            </Box>
          )}
          {createStep === 1 && (
            <Box flexDirection="column">
              <Text>Region:</Text>
              <SelectInput
                items={regionOptions}
                onSelect={(item) => {
                  setCreateForm({ ...createForm, region: item.value });
                  setCreateStep(2);
                }}
              />
            </Box>
          )}
          {createStep === 2 && (
            <Box flexDirection="column">
              <Text>Size:</Text>
              <SelectInput
                items={sizeOptions}
                onSelect={(item) => {
                  setCreateForm({ ...createForm, size: item.value });
                  setCreateStep(3);
                }}
              />
            </Box>
          )}
          {createStep === 3 && (
            <Box flexDirection="column">
              <Text>SSH Key:</Text>
              {keyOptions.length > 0 ? (
                <SelectInput
                  items={keyOptions}
                  onSelect={(item) => {
                    setCreateForm({ ...createForm, ssh_keys: [item.value] });
                    createDroplet();
                  }}
                />
              ) : (
                <Text color={colors.error}>
                  No SSH keys found. Add one in Digital Ocean first.
                </Text>
              )}
            </Box>
          )}
        </Box>
        <Text color={colors.muted}>Press Esc to cancel</Text>
      </Box>
    );
  }

  if (mode === "billing") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Billing
        </Text>
        {loading ? (
          <Spinner label="Loading..." />
        ) : error ? (
          <Text color={colors.error}>{error}</Text>
        ) : balance ? (
          <Box marginY={1} flexDirection="column">
            <Text>
              <Text color={colors.muted}>Month to Date:</Text> $
              {balance.month_to_date_usage}
            </Text>
            <Text>
              <Text color={colors.muted}>Account Balance:</Text> $
              {balance.account_balance}
            </Text>
          </Box>
        ) : null}
        <Text color={colors.muted}>Press Esc to go back</Text>
      </Box>
    );
  }

  if (mode === "sshkeys") {
    const keyItems: ListItem[] = sshKeys.map((k) => ({
      id: k.id.toString(),
      label: k.name,
      meta: k.fingerprint.slice(0, 20) + "...",
    }));

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          SSH Keys ({sshKeys.length})
        </Text>
        {loading ? (
          <Spinner label="Loading..." />
        ) : error ? (
          <Text color={colors.error}>{error}</Text>
        ) : (
          <Box marginY={1}>
            <List
              items={keyItems}
              selectedIndex={0}
              focused={false}
              emptyMessage="No SSH keys found"
            />
          </Box>
        )}
        <ActionBar
          actions={[
            { key: "r", label: "Refresh" },
            { key: "Esc", label: "Back" },
          ]}
        />
      </Box>
    );
  }

  if (mode === "droplets") {
    const dropletItems: ListItem[] = droplets.map((d) => ({
      id: d.id.toString(),
      label: d.name,
      status: d.status === "active" ? "online" : "offline",
      meta: `${DO.getPublicIP(d) || "No IP"} | ${d.region.name} | $${d.size.price_monthly}/mo`,
    }));

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Droplets ({droplets.length})
        </Text>
        {loading ? (
          <Spinner label="Loading..." />
        ) : error ? (
          <Text color={colors.error}>{error}</Text>
        ) : (
          <Box marginY={1}>
            <List
              items={dropletItems}
              selectedIndex={selectedIndex}
              focused={focused}
              emptyMessage="No droplets found"
            />
          </Box>
        )}
        <ActionBar
          actions={[
            { key: "d", label: "Delete", disabled: droplets.length === 0 },
            { key: "r", label: "Refresh" },
            { key: "Esc", label: "Back" },
          ]}
        />
      </Box>
    );
  }

  // Menu mode
  const menuListItems: ListItem[] = menuItems.map((m) => ({
    id: m.value,
    label: m.label,
  }));

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={colors.primary}>
          Digital Ocean
        </Text>
      </Box>
      <List items={menuListItems} selectedIndex={menuIndex} focused={focused} />
      <ActionBar actions={[{ key: "Enter", label: "Select" }]} />
    </Box>
  );
}
