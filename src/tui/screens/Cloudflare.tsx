/**
 * Cloudflare DNS screen
 */
import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import List, { ListItem } from "../components/List";
import ActionBar from "../components/ActionBar";
import Spinner from "../components/Spinner";
import Modal from "../components/Modal";
import { colors } from "../utils/theme";
import { truncate } from "../utils/format";
import * as CF from "../../lib/cloudflare";
import { logger } from "../utils/logger";

type Mode = "zones" | "records" | "add" | "delete";

interface CloudflareProps {
  focused: boolean;
}

interface Zone {
  id: string;
  name: string;
  status: string;
}

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
}

export default function Cloudflare({ focused }: CloudflareProps) {
  const [mode, setMode] = useState<Mode>("zones");
  const [zones, setZones] = useState<Zone[]>([]);
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add record form
  const [addStep, setAddStep] = useState(0);
  const [addForm, setAddForm] = useState({
    type: "A",
    name: "",
    content: "",
    ttl: 1,
    proxied: true,
  });

  const loadZones = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!CF.hasCloudflareConfig()) {
        setError("Cloudflare not configured. Set CLOUDFLARE_API_TOKEN in .env");
        return;
      }
      const data = await CF.listZones();
      setZones(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadRecords = async (zoneId: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await CF.listDnsRecords(zoneId);
      setRecords(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadZones();
  }, []);

  const selectedRecord = mode === "records" ? records[selectedIndex] : null;

  useInput(
    (input, key) => {
      if (!focused) return;

      if (mode === "zones") {
        if (input === "j" || key.downArrow) {
          setSelectedIndex((i) => Math.min(i + 1, zones.length - 1));
        } else if (input === "k" || key.upArrow) {
          setSelectedIndex((i) => Math.max(i - 1, 0));
        } else if (key.return && zones[selectedIndex]) {
          setSelectedZone(zones[selectedIndex]);
          setSelectedIndex(0);
          setMode("records");
          loadRecords(zones[selectedIndex].id);
        } else if (input === "r") {
          loadZones();
        }
      } else if (mode === "records") {
        if (input === "j" || key.downArrow) {
          setSelectedIndex((i) => Math.min(i + 1, records.length - 1));
        } else if (input === "k" || key.upArrow) {
          setSelectedIndex((i) => Math.max(i - 1, 0));
        } else if (key.escape || key.backspace) {
          setMode("zones");
          setSelectedIndex(0);
          setSelectedZone(null);
        } else if (input === "a") {
          setMode("add");
          setAddStep(0);
          setAddForm({
            type: "A",
            name: "",
            content: "",
            ttl: 1,
            proxied: true,
          });
        } else if (input === "d" && selectedRecord) {
          setMode("delete");
        } else if (input === "r" && selectedZone) {
          loadRecords(selectedZone.id);
        }
      }
    },
    { isActive: focused && (mode === "zones" || mode === "records") },
  );

  useInput(
    (_, key) => {
      if (key.escape && mode !== "zones" && mode !== "records") {
        setMode("records");
      }
    },
    { isActive: mode === "add" || mode === "delete" },
  );

  if (loading && (zones.length === 0 || records.length === 0)) {
    return <Spinner label="Loading..." />;
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color={colors.error}>Error: {error}</Text>
        <Text color={colors.muted}>Press 'r' to retry</Text>
      </Box>
    );
  }

  if (mode === "delete" && selectedRecord && selectedZone) {
    return (
      <Modal
        title="Delete DNS Record"
        message={`Delete ${selectedRecord.type} record "${selectedRecord.name}"?`}
        type="confirm"
        onConfirm={async () => {
          try {
            logger.info(
              `Deleting DNS record: ${selectedRecord.type} ${selectedRecord.name}`,
              "cloudflare",
            );
            await CF.deleteDnsRecord(selectedZone.id, selectedRecord.id);
            logger.success(
              `Deleted DNS record: ${selectedRecord.name}`,
              "cloudflare",
            );
            await loadRecords(selectedZone.id);
            setSelectedIndex(Math.max(0, selectedIndex - 1));
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(
              `Failed to delete DNS record: ${errMsg}`,
              "cloudflare",
            );
            setError(errMsg);
          }
          setMode("records");
        }}
        onCancel={() => setMode("records")}
      />
    );
  }

  if (mode === "add" && selectedZone) {
    const typeOptions = [
      { label: "A", value: "A" },
      { label: "AAAA", value: "AAAA" },
      { label: "CNAME", value: "CNAME" },
      { label: "TXT", value: "TXT" },
      { label: "MX", value: "MX" },
      { label: "NS", value: "NS" },
      { label: "SRV", value: "SRV" },
      { label: "CAA", value: "CAA" },
    ];

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>
          Add DNS Record - {selectedZone.name}
        </Text>
        <Box marginY={1} flexDirection="column">
          {addStep === 0 && (
            <Box flexDirection="column">
              <Text>Type:</Text>
              <SelectInput
                items={typeOptions}
                onSelect={(item) => {
                  setAddForm({ ...addForm, type: item.value });
                  setAddStep(1);
                }}
              />
            </Box>
          )}
          {addStep === 1 && (
            <Box>
              <Text>Name (e.g., www or @): </Text>
              <TextInput
                value={addForm.name}
                onChange={(v) => setAddForm({ ...addForm, name: v })}
                onSubmit={() => setAddStep(2)}
              />
            </Box>
          )}
          {addStep === 2 && (
            <Box>
              <Text>Content (IP or target): </Text>
              <TextInput
                value={addForm.content}
                onChange={(v) => setAddForm({ ...addForm, content: v })}
                onSubmit={async () => {
                  try {
                    logger.info(
                      `Creating DNS record: ${addForm.type} ${addForm.name} -> ${addForm.content}`,
                      "cloudflare",
                    );
                    await CF.createDnsRecord(selectedZone.id, {
                      type: addForm.type as CF.DnsRecordType,
                      name: addForm.name,
                      content: addForm.content,
                      ttl: addForm.ttl,
                      proxied:
                        addForm.proxied &&
                        ["A", "AAAA", "CNAME"].includes(addForm.type),
                    });
                    logger.success(
                      `Created DNS record: ${addForm.name}`,
                      "cloudflare",
                    );
                    await loadRecords(selectedZone.id);
                  } catch (err) {
                    const errMsg =
                      err instanceof Error ? err.message : String(err);
                    logger.error(
                      `Failed to create DNS record: ${errMsg}`,
                      "cloudflare",
                    );
                    setError(errMsg);
                  }
                  setMode("records");
                }}
              />
            </Box>
          )}
        </Box>
        <Text color={colors.muted}>Press Esc to cancel</Text>
      </Box>
    );
  }

  if (mode === "zones") {
    const zoneItems: ListItem[] = zones.map((z) => ({
      id: z.id,
      label: z.name,
      status: z.status === "active" ? "online" : "offline",
    }));

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color={colors.primary}>
            Cloudflare Zones
          </Text>
          <Text color={colors.muted}> ({zones.length})</Text>
        </Box>

        <List
          items={zoneItems}
          selectedIndex={selectedIndex}
          focused={focused}
          emptyMessage="No zones found."
        />

        <ActionBar
          actions={[
            { key: "Enter", label: "View Records" },
            { key: "r", label: "Refresh" },
          ]}
        />
      </Box>
    );
  }

  // Records mode
  const recordItems: ListItem[] = records.map((r) => ({
    id: r.id,
    label: `${r.type} ${truncate(r.name, 30)}`,
    meta: truncate(r.content, 30) + (r.proxied ? " (proxied)" : ""),
  }));

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={colors.primary}>
          DNS Records - {selectedZone?.name}
        </Text>
        <Text color={colors.muted}> ({records.length})</Text>
      </Box>

      <List
        items={recordItems}
        selectedIndex={selectedIndex}
        focused={focused}
        emptyMessage="No records found."
      />

      <ActionBar
        actions={[
          { key: "a", label: "Add" },
          { key: "d", label: "Delete", disabled: !selectedRecord },
          { key: "r", label: "Refresh" },
          { key: "Esc", label: "Back" },
        ]}
      />
    </Box>
  );
}
