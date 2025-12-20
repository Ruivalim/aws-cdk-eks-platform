/**
 * TUI Theme - Colors and styling
 */

export const colors = {
  primary: "#3b82f6", // blue-500
  success: "#22c55e", // green-500
  warning: "#eab308", // yellow-500
  error: "#ef4444", // red-500
  muted: "#6b7280", // gray-500
  text: "#f3f4f6", // gray-100
  border: "#374151", // gray-700
  bg: "#111827", // gray-900
  bgAlt: "#1f2937", // gray-800
} as const;

export const icons = {
  server: "●",
  serverOffline: "○",
  project: "◆",
  arrow: "▸",
  arrowDown: "▾",
  check: "✓",
  cross: "✗",
  warning: "⚠",
  info: "ℹ",
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  box: {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    horizontal: "─",
    vertical: "│",
    cross: "┼",
    teeLeft: "├",
    teeRight: "┤",
    teeTop: "┬",
    teeBottom: "┴",
  },
} as const;

export const keybindings = {
  quit: "q",
  help: "?",
  search: "/",
  up: ["k", "up"],
  down: ["j", "down"],
  left: ["h", "left"],
  right: ["l", "right"],
  select: "return",
  back: ["escape", "backspace"],
  add: "a",
  edit: "e",
  delete: "d",
  refresh: "r",
  ssh: "s",
  deploy: "D",
  rollback: "R",
  logs: "L",
} as const;
