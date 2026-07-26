/**
 * Mission Control — Shared Utilities
 * ---------------------------------------------------------------------------
 * Small, typed, dependency-free helpers used across server and client code.
 */

/** Conditionally join class names — the project's `cx` primitive. */
export function cx(
  ...classes: ReadonlyArray<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

/** Clamp `value` into [min, max]; NaN collapses to min. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** Map a pack voltage onto a 0–100 charge estimate. */
export function voltageToPercent(
  voltage: number,
  minV = 9.6,
  maxV = 12.6
): number {
  const pct = ((clamp(voltage, minV, maxV) - minV) / (maxV - minV)) * 100;
  return Math.round(pct);
}

/** Format elapsed seconds as HH:MM:SS (tabular-safe for Orbitron). */
export function formatUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Short, collision-safe id for client-side records. */
export function uid(prefix = "mc"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}
