/**
 * Mission Control — Robot Constants
 * ---------------------------------------------------------------------------
 * Typed, immutable runtime constants. Environment-driven values read
 * NEXT_PUBLIC_* vars so they are safe to import from client components.
 */

import type { ConnectionState, ControlMode, RobotStatus } from "./types";

export const APP_IDENTITY = {
  name: "Mission Control",
  robot: "Smart Survey Robot · ESP32 Platform",
  version: "1.0.0",
} as const;

/** Dashboard destination — the static mission-control shell. */
export const DASHBOARD_URL = "/dashboard/index.html" as const;

export const CONNECTION_STATES = {
  disconnected: "disconnected",
  connecting: "connecting",
  connected: "connected",
  reconnecting: "reconnecting",
  error: "error",
} as const satisfies Record<ConnectionState, ConnectionState>;

export const ROBOT_STATUSES = {
  offline: "offline",
  booting: "booting",
  online: "online",
  idle: "idle",
  executing: "executing",
  paused: "paused",
  error: "error",
  lowBattery: "low_battery",
  criticalBattery: "critical_battery",
} as const satisfies Record<
  "offline" | "booting" | "online" | "idle" | "executing" | "paused" | "error" | "lowBattery" | "criticalBattery",
  RobotStatus
>;

export const CONTROL_MODES = {
  standby: "standby",
  manual: "manual",
  keyboard: "keyboard",
  gesture: "gesture",
  voice: "voice",
  autoPath: "auto_path",
} as const satisfies Record<
  "standby" | "manual" | "keyboard" | "gesture" | "voice" | "autoPath",
  ControlMode
>;

/** 3-cell Li-Po pack math, shared with the static dashboard. */
export const BATTERY = {
  maxVoltage: 12.6,
  minVoltage: 9.6,
  warningPercent: 20,
  criticalPercent: 10,
} as const;

/** Connection endpoints — overridable via env for field deployment. */
export const ENDPOINTS = {
  robotWsUrl: process.env.NEXT_PUBLIC_ROBOT_WS_URL ?? "ws://192.168.4.1:81",
  robotBlePrefix: process.env.NEXT_PUBLIC_ROBOT_BLE_PREFIX ?? "SARATHI_",
} as const;

/** Splash-screen timing (ms). */
export const BOOT_TIMING = {
  redirectDelay: 900,
  radarSweepMs: 2400,
} as const;
