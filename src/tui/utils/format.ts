/**
 * Formatting utilities for TUI
 */

/**
 * Format a date string to a relative time (e.g., "2h ago")
 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

/**
 * Truncate a string to a max length
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

/**
 * Pad a string to a fixed width
 */
export function pad(
  str: string,
  width: number,
  align: "left" | "right" = "left",
): string {
  if (str.length >= width) return str.slice(0, width);
  const padding = " ".repeat(width - str.length);
  return align === "left" ? str + padding : padding + str;
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

/**
 * Format server role for display
 */
export function formatRole(role: string): string {
  const roles: Record<string, string> = {
    gateway: "Gateway",
    build: "Build",
    worker: "Worker",
    master: "Master",
  };
  return roles[role] || role;
}

/**
 * Format deployment state for display
 */
export function formatDeployState(state: string): string {
  const states: Record<string, string> = {
    pending: "Pending",
    cloning: "Cloning",
    building: "Building",
    pushing: "Pushing",
    deploying: "Deploying",
    health_checking: "Health Check",
    switching_traffic: "Switching",
    cleaning_up: "Cleanup",
    completed: "Completed",
    failed: "Failed",
    rolled_back: "Rolled Back",
  };
  return states[state] || state;
}
