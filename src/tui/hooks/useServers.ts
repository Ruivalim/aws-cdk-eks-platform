/**
 * Hook for managing server data
 */
import { useState, useEffect, useCallback } from "react";
import * as DB from "../../lib/db";
import * as ServerInfo from "../../lib/server-info";

export interface ServerWithStatus extends DB.Server {
  isOnline?: boolean;
  lastChecked?: Date;
}

export function useServers() {
  const [servers, setServers] = useState<ServerWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dbServers = DB.listServers();
      setServers(dbServers.map((s) => ({ ...s, isOnline: undefined })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const checkStatus = useCallback(
    async (serverId: string) => {
      const server = servers.find((s) => s.id === serverId);
      if (!server) return;

      try {
        const isOnline = await ServerInfo.checkConnectivity(
          server.tailscale_ip,
        );
        setServers((prev) =>
          prev.map((s) =>
            s.id === serverId ? { ...s, isOnline, lastChecked: new Date() } : s,
          ),
        );
        if (isOnline) {
          DB.updateServerHealthCheck(serverId);
        }
      } catch {
        setServers((prev) =>
          prev.map((s) =>
            s.id === serverId
              ? { ...s, isOnline: false, lastChecked: new Date() }
              : s,
          ),
        );
      }
    },
    [servers],
  );

  const checkAllStatus = useCallback(async () => {
    for (const server of servers) {
      await checkStatus(server.id);
    }
  }, [servers, checkStatus]);

  const addServer = useCallback(
    async (input: DB.CreateServerInput) => {
      try {
        DB.createServer(input);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const deleteServer = useCallback(
    async (id: string) => {
      try {
        DB.deleteServer(id);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const updateServer = useCallback(
    async (
      id: string,
      updates: Partial<Omit<DB.Server, "id" | "created_at">>,
    ) => {
      try {
        DB.updateServer(id, updates);
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

  const onlineCount = servers.filter((s) => s.isOnline === true).length;
  const totalCount = servers.length;

  return {
    servers,
    loading,
    error,
    refresh,
    checkStatus,
    checkAllStatus,
    addServer,
    deleteServer,
    updateServer,
    onlineCount,
    totalCount,
  };
}
