/**
 * Global logging hook for TUI
 */
import { useState, useCallback, useEffect } from "react";

export type LogLevel = "info" | "success" | "error" | "warn" | "debug";

export interface LogEntry {
  id: number;
  timestamp: Date;
  level: LogLevel;
  message: string;
  source?: string;
}

// Global state for logs (shared across components)
let globalLogs: LogEntry[] = [];
let logId = 0;
let listeners: Set<() => void> = new Set();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

/**
 * Add a log entry (can be called from anywhere)
 */
export function log(
  level: LogLevel,
  message: string,
  source?: string,
): LogEntry {
  const entry: LogEntry = {
    id: logId++,
    timestamp: new Date(),
    level,
    message,
    source,
  };

  globalLogs = [...globalLogs.slice(-99), entry]; // Keep last 100 logs
  notifyListeners();
  return entry;
}

// Convenience functions
export const logInfo = (msg: string, src?: string) => log("info", msg, src);
export const logSuccess = (msg: string, src?: string) =>
  log("success", msg, src);
export const logError = (msg: string, src?: string) => log("error", msg, src);
export const logWarn = (msg: string, src?: string) => log("warn", msg, src);
export const logDebug = (msg: string, src?: string) => log("debug", msg, src);

/**
 * Clear all logs
 */
export function clearLogs() {
  globalLogs = [];
  notifyListeners();
}

/**
 * Hook to subscribe to logs
 */
export function useLogs() {
  const [logs, setLogs] = useState<LogEntry[]>(globalLogs);

  useEffect(() => {
    const listener = () => setLogs([...globalLogs]);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const addLog = useCallback(
    (level: LogLevel, message: string, source?: string) => {
      return log(level, message, source);
    },
    [],
  );

  const clear = useCallback(() => {
    clearLogs();
  }, []);

  return {
    logs,
    addLog,
    clear,
    // Convenience methods
    info: (msg: string, src?: string) => addLog("info", msg, src),
    success: (msg: string, src?: string) => addLog("success", msg, src),
    error: (msg: string, src?: string) => addLog("error", msg, src),
    warn: (msg: string, src?: string) => addLog("warn", msg, src),
    debug: (msg: string, src?: string) => addLog("debug", msg, src),
  };
}
