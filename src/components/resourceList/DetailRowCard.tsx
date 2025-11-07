// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import type { JSX } from "solid-js";

export function DetailRowCard(props: {
  columnCount: number;
  children: JSX.Element;
  style?: string;
  class?: string;
}) {
  return (
    <td colSpan={props.columnCount}>
      <div class="second-row">
        {props.children}
      </div>
    </td>
  );
}
