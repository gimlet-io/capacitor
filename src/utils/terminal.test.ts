// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

/// <reference lib="deno.ns" />
import { assertEquals } from "@std/assert";
import { createTerminalNewlineState, normalizeTerminalNewlines } from "./terminal.ts";

Deno.test("normalizeTerminalNewlines - converts standalone CR to CRLF", () => {
  const state = createTerminalNewlineState();
  const out = normalizeTerminalNewlines("hello\rworld", state);
  assertEquals(out, "hello\r\nworld");
  assertEquals(state.pendingCR, false);
});

Deno.test("normalizeTerminalNewlines - preserves CRLF", () => {
  const state = createTerminalNewlineState();
  const out = normalizeTerminalNewlines("hello\r\nworld", state);
  assertEquals(out, "hello\r\nworld");
  assertEquals(state.pendingCR, false);
});

Deno.test("normalizeTerminalNewlines - handles CRLF split across chunks", () => {
  const state = createTerminalNewlineState();

  const out1 = normalizeTerminalNewlines("hello\r", state);
  assertEquals(out1, "hello");
  assertEquals(state.pendingCR, true);

  const out2 = normalizeTerminalNewlines("\nworld", state);
  assertEquals(out2, "\r\nworld");
  assertEquals(state.pendingCR, false);
});

Deno.test("normalizeTerminalNewlines - handles trailing CR not followed by LF", () => {
  const state = createTerminalNewlineState();

  const out1 = normalizeTerminalNewlines("hello\r", state);
  assertEquals(out1, "hello");
  assertEquals(state.pendingCR, true);

  const out2 = normalizeTerminalNewlines("world", state);
  assertEquals(out2, "\r\nworld");
  assertEquals(state.pendingCR, false);
});
