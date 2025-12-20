#!/usr/bin/env bun
/**
 * Ruilify TUI
 *
 * Terminal user interface for managing
 * infrastructure deployments.
 *
 * Usage:
 *   bun src/tui/index.tsx
 */
import React from "react";
import { render } from "ink";
import App from "./App";

// Clear screen and render
console.clear();
render(<App />);
