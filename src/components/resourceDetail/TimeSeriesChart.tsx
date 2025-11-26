import { createMemo } from "solid-js";

type Props = {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  areaFill?: string;
  yUnit?: string; // e.g., "mCPU", "MiB"
  yTicks?: number; // count
  sampleIntervalSec?: number; // spacing for x labels
  class?: string;
  title?: string;
  referenceLines?: Array<{
    value: number;
    color?: string;
    dash?: string;
    label?: string;
  }>;
};

function niceStep(rawStep: number): number {
  // Round steps to 1, 2, 5 * 10^n
  const power = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const scaled = rawStep / power;
  let niceScaled = 1;
  if (scaled <= 1) niceScaled = 1;
  else if (scaled <= 2) niceScaled = 2;
  else if (scaled <= 5) niceScaled = 5;
  else niceScaled = 10;
  return niceScaled * power;
}

function formatNumber(n: number): string {
  // Compact but precise up to one decimal when needed
  if (Math.abs(n) >= 100) return Math.round(n).toString();
  if (Math.abs(n) >= 10) return n.toFixed(1).replace(/\.0$/, "");
  return n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export function TimeSeriesChart(props: Props) {
  const width = () => props.width ?? 480;
  const height = () => props.height ?? 140;
  const stroke = () => props.stroke ?? "#4f7cff";
  const areaFill = () => props.areaFill ?? "rgba(79,124,255,0.12)";
  const yTicks = () => Math.max(2, props.yTicks ?? 4);
  const sampleIntervalSec = () => Math.max(1, props.sampleIntervalSec ?? 5);

  // Layout paddings for axes and labels
  const PAD_LEFT = 44;
  const PAD_RIGHT = 12;
  const PAD_TOP = 8;
  const PAD_BOTTOM = 24;

  const innerW = () => width() - PAD_LEFT - PAD_RIGHT;
  const innerH = () => height() - PAD_TOP - PAD_BOTTOM;

  const stats = createMemo(() => {
    const values = props.data ?? [];
    if (values.length === 0) return { min: 0, max: 1, values };
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      // Expand a flat line range a bit
      const pad = Math.max(1, max || 1) * 0.1;
      min = Math.max(0, min - pad);
      max = max + pad;
    } else {
      // Add 10% headroom
      const range = max - min;
      min = Math.max(0, min - range * 0.05);
      max = max + range * 0.1;
    }
    return { min, max, values };
  });

  const yScale = (v: number) => {
    const s = stats();
    return PAD_TOP + innerH() * (1 - (v - s.min) / (s.max - s.min));
  };
  const xScale = (i: number) => {
    const valuesLen = stats().values.length;
    // For a single data point, treat it as spanning the full width so we can draw a full-width line.
    const n = valuesLen <= 1 ? 1 : valuesLen - 1;
    return PAD_LEFT + (i / n) * innerW();
  };

  const yTicksComputed = createMemo(() => {
    const s = stats();
    const rawStep = (s.max - s.min) / (yTicks() - 1);
    const step = niceStep(rawStep);
    const first = Math.ceil(s.min / step) * step;
    const ticks: number[] = [];
    for (let v = first; v <= s.max + 1e-9; v += step) {
      ticks.push(Number(v.toFixed(12)));
      if (ticks.length > 12) break;
    }
    // Ensure we include min and max visually
    if (ticks.length === 0) ticks.push(s.min, s.max);
    return ticks;
  });

  const pathLine = createMemo(() => {
    const { values } = stats();
    if (values.length === 0) return "";
    // When there is only a single point, render a horizontal line that spans the full chart width.
    if (values.length === 1) {
      const y = yScale(values[0]);
      const xStart = PAD_LEFT;
      const xEnd = width() - PAD_RIGHT;
      return `M ${xStart} ${y} L ${xEnd} ${y}`;
    }
    let d = `M ${xScale(0)} ${yScale(values[0])}`;
    for (let i = 1; i < values.length; i++) {
      d += ` L ${xScale(i)} ${yScale(values[i])}`;
    }
    return d;
  });

  const pathArea = createMemo(() => {
    const { values, min } = stats();
    if (values.length === 0) return "";
    let d = `M ${xScale(0)} ${yScale(values[0])}`;
    for (let i = 1; i < values.length; i++) {
      d += ` L ${xScale(i)} ${yScale(values[i])}`;
    }
    // Close to baseline
    d += ` L ${xScale(values.length - 1)} ${yScale(min)}`;
    d += ` L ${xScale(0)} ${yScale(min)} Z`;
    return d;
  });

  // X-axis labels: show now, and 2-3 earlier marks
  const xLabels = createMemo(() => {
    const n = stats().values.length;
    if (n <= 1) {
      // Place "now" at the right edge for a single sample so it aligns with the most recent time.
      return [{ x: width() - PAD_RIGHT, text: "now" }];
    }
    const durationSec = (n - 1) * sampleIntervalSec();
    const marks = 3;
    const labels: { x: number; text: string }[] = [];
    for (let i = marks; i >= 1; i--) {
      const t = Math.round((durationSec * i) / (marks + 1));
      const idx = Math.max(0, Math.min(n - 1, Math.round(((n - 1) * i) / (marks + 1))));
      const label =
        t >= 3600
          ? `${Math.round(t / 3600)}h`
          : t >= 60
          ? `${Math.round(t / 60)}m`
          : `${t}s`;
      labels.push({ x: xScale(idx), text: `-${label}` });
    }
    labels.push({ x: xScale(n - 1), text: "now" });
    return labels;
  });

  return (
    <svg
      class={props.class}
      width={width()}
      height={height()}
      viewBox={`0 0 ${width()} ${height()}`}
      aria-label={props.title || "chart"}
    >
      {/* Background */}
      <rect x="0" y="0" width={width()} height={height()} fill="transparent" />
      {/* Grid + Y axis */}
      {yTicksComputed().map((v) => {
        const y = yScale(v);
        return (
          <g>
            <line x1={PAD_LEFT} y1={y} x2={width() - PAD_RIGHT} y2={y} stroke="#e6e8f0" stroke-width="1" />
            <text x={PAD_LEFT - 6} y={y} text-anchor="end" dominant-baseline="central" fill="#6b7280" font-size="10">
              {formatNumber(v)}{props.yUnit ? ` ${props.yUnit}` : ""}
            </text>
          </g>
        );
      })}
      {/* X axis */}
      <line
        x1={PAD_LEFT}
        y1={height() - PAD_BOTTOM}
        x2={width() - PAD_RIGHT}
        y2={height() - PAD_BOTTOM}
        stroke="#ccd1dd"
        stroke-width="1"
      />
      {xLabels().map((l) => (
        <text x={l.x} y={height() - PAD_BOTTOM + 14} text-anchor="middle" fill="#6b7280" font-size="10">
          {l.text}
        </text>
      ))}
      {/* Area + Line */}
      <path d={pathArea()} fill={areaFill()} />
      <path d={pathLine()} stroke={stroke()} stroke-width="2" fill="none" />
      {/* Reference lines (e.g., requests/limits) */}
      {(props.referenceLines || []).map((rl) => {
        const y = yScale(rl.value);
        const color = rl.color || "#ef4444";
        const dash = rl.dash || "4,3";
        return (
          <g>
            <line
              x1={PAD_LEFT}
              y1={y}
              x2={width() - PAD_RIGHT}
              y2={y}
              stroke={color}
              stroke-width="1.5"
              stroke-dasharray={dash}
            />
            {rl.label ? (
              <text x={width() - PAD_RIGHT - 2} y={y - 4} text-anchor="end" fill={color} font-size="10">
                {rl.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {/* Single point visibility */}
      {stats().values.length === 1 ? (
        <circle cx={xScale(0)} cy={yScale(stats().values[0])} r="3" fill={stroke()} />
      ) : null}
    </svg>
  );
}


