/**
 * Hook for managing settings
 */
import { useState, useEffect, useCallback } from "react";
import * as DB from "../../lib/db";

export interface SettingDefinition {
  key: string;
  label: string;
  description: string;
  defaultValue: string;
  type: "string" | "number" | "boolean";
}

export const SETTINGS_DEFINITIONS: SettingDefinition[] = [
  {
    key: "acme_email",
    label: "ACME Email",
    description: "Email for Let's Encrypt certificates",
    defaultValue: "ruivalim@pm.me",
    type: "string",
  },
  {
    key: "health_check_timeout",
    label: "Health Check Timeout",
    description: "Timeout for health checks in milliseconds",
    defaultValue: "30000",
    type: "number",
  },
];

export function useSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dbSettings = DB.getAllSettings();
      // Merge with defaults
      const merged: Record<string, string> = {};
      for (const def of SETTINGS_DEFINITIONS) {
        merged[def.key] = dbSettings[def.key] ?? def.defaultValue;
      }
      // Include any extra settings not in definitions
      for (const [key, value] of Object.entries(dbSettings)) {
        if (!(key in merged)) {
          merged[key] = value;
        }
      }
      setSettings(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const getSetting = useCallback(
    (key: string): string | null => {
      return settings[key] ?? null;
    },
    [settings],
  );

  const setSetting = useCallback(async (key: string, value: string) => {
    try {
      DB.setSetting(key, value);
      setSettings((prev) => ({ ...prev, [key]: value }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const deleteSetting = useCallback(
    async (key: string) => {
      try {
        DB.deleteSetting(key);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    settings,
    loading,
    error,
    refresh,
    getSetting,
    setSetting,
    deleteSetting,
    definitions: SETTINGS_DEFINITIONS,
  };
}
