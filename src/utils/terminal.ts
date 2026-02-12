// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

export type TerminalNewlineState = {
  /**
   * True when the previous chunk ended with a '\r' and we need to decide whether it was part
   * of a CRLF sequence ("\r\n") or a standalone carriage return.
   */
  pendingCR: boolean;
};

export function createTerminalNewlineState(): TerminalNewlineState {
  return { pendingCR: false };
}

/**
 * Normalizes terminal output chunks so environments that emit "\r" as a line separator
 * still render correctly in xterm.js.
 *
 * - Preserves CRLF ("\r\n") sequences.
 * - Converts standalone CR ("\r") to CRLF ("\r\n").
 * - Handles CRLF split across websocket frames by keeping a small amount of state.
 */
export function normalizeTerminalNewlines(chunk: string, state: TerminalNewlineState): string {
  let s = chunk;
  let out = "";

  // Resolve a pending CR from the previous chunk.
  if (state.pendingCR) {
    if (s.startsWith("\n")) {
      // Previous chunk ended with "\r" and this chunk starts with "\n" => CRLF split.
      out += "\r\n";
      s = s.slice(1);
    } else {
      // Previous chunk ended with a standalone "\r"; treat it as a newline.
      out += "\r\n";
    }
    state.pendingCR = false;
  }

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (ch !== "\r") {
      out += ch;
      continue;
    }

    // ch === "\r"
    if (i === s.length - 1) {
      // Defer decision until we see the next chunk (could be a split CRLF).
      state.pendingCR = true;
      continue;
    }

    const next = s[i + 1];
    if (next === "\n") {
      // Preserve CRLF.
      out += "\r\n";
      i++; // consume '\n'
      continue;
    }

    // Standalone CR => treat as newline.
    out += "\r\n";
  }

  return out;
}
