/**
 * File logger for TUI - writes to logs/tui.log
 */
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "tui.log");

// Ensure data directory exists
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

export type LogLevel = "INFO" | "SUCCESS" | "ERROR" | "WARN" | "DEBUG";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source?: string;
  message: string;
  raw: string;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function writeLog(level: LogLevel, message: string, source?: string): void {
  const timestamp = formatTimestamp();
  const srcPart = source ? `[${source}]` : "";
  const line = `${timestamp} ${level.padEnd(7)} ${srcPart} ${message}\n`;

  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // Ignore write errors
  }
}

export const logger = {
  info: (msg: string, src?: string) => writeLog("INFO", msg, src),
  success: (msg: string, src?: string) => writeLog("SUCCESS", msg, src),
  error: (msg: string, src?: string) => writeLog("ERROR", msg, src),
  warn: (msg: string, src?: string) => writeLog("WARN", msg, src),
  debug: (msg: string, src?: string) => writeLog("DEBUG", msg, src),
};

/**
 * Clear log file
 */
export function clearLog(): void {
  try {
    Bun.write(LOG_FILE, `=== TUI Log Cleared ${formatTimestamp()} ===\n`);
  } catch {
    // Ignore
  }
}

/**
 * Read all log entries
 */
export function readLogs(limit: number = 100): LogEntry[] {
  try {
    if (!existsSync(LOG_FILE)) {
      return [];
    }

    const content = readFileSync(LOG_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    // Parse log lines and take last N entries
    const entries: LogEntry[] = [];
    for (const line of lines.slice(-limit)) {
      const parsed = parseLogLine(line);
      if (parsed) {
        entries.push(parsed);
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Parse a log line into structured entry
 */
function parseLogLine(line: string): LogEntry | null {
  // Format: 2024-01-01T00:00:00.000Z INFO    [source] message
  const match = line.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s+(INFO|SUCCESS|ERROR|WARN|DEBUG)\s+(?:\[([^\]]+)\])?\s*(.*)$/,
  );

  if (!match) {
    // Return as raw entry if can't parse
    return {
      timestamp: "",
      level: "INFO",
      message: line,
      raw: line,
    };
  }

  return {
    timestamp: match[1],
    level: match[2] as LogLevel,
    source: match[3] || undefined,
    message: match[4],
    raw: line,
  };
}

/**
 * Get log file path
 */
export function getLogFilePath(): string {
  return LOG_FILE;
}
