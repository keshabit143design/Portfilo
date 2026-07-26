/**
 * Mission Control — Robot Domain Types
 * ---------------------------------------------------------------------------
 * Single source of truth for the TypeScript contract between the Next.js
 * layer and the (future) ESP32 telemetry/command stream. Mirrors the enums
 * used by the static dashboard so both sides speak the same vocabulary.
 */

/** Transport the robot is reachable over. */
export type RobotTransport = "wifi" | "bluetooth";

/** Lifecycle of a single robot link. */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

/** High-level power/mission state reported by the robot. */
export type RobotStatus =
  | "offline"
  | "booting"
  | "online"
  | "idle"
  | "executing"
  | "paused"
  | "error"
  | "low_battery"
  | "critical_battery";

/** Active control surface driving the motors. */
export type ControlMode =
  | "standby"
  | "manual"
  | "keyboard"
  | "gesture"
  | "voice"
  | "auto_path";

/** Motor direction commands accepted by the L9110S driver. */
export type MotorDirection = "forward" | "backward" | "left" | "right" | "stop";

/** A single decoded telemetry frame. */
export interface TelemetrySample {
  /** Milliseconds since epoch. */
  timestamp: number;
  /** Pack voltage across the 3-cell stack. */
  batteryVoltage: number;
  /** Derived 0–100 charge estimate. */
  batteryPercent: number;
  /** WiFi RSSI in dBm (null when over Bluetooth). */
  wifiRssi: number | null;
  /** Bluetooth RSSI in dBm (null when over WiFi). */
  bluetoothRssi: number | null;
  /** Ground speed, m/s. */
  speed: number;
  /** Round-trip command latency, ms. */
  latencyMs: number;
}

/** Immutable record of one operator/system command. */
export interface CommandRecord {
  id: string;
  type: string;
  direction?: MotorDirection;
  source: ControlMode | "system" | "auto";
  status: "sent" | "received" | "completed" | "failed";
  reason?: string;
  timestamp: number;
}

/** A stored survey route (draw-line / free-draw export). */
export interface SavedPath {
  id: string;
  name: string;
  kind: "draw-line" | "free-draw" | "auto";
  points: ReadonlyArray<Readonly<{ x: number; y: number; nx?: number; ny?: number }>>;
  createdAt: string;
}

/** Severity for the notification center. */
export type NotificationLevel = "info" | "success" | "warning" | "error";

export interface NotificationRecord {
  id: string;
  level: NotificationLevel;
  title?: string;
  message: string;
  read: boolean;
  timestamp: number;
}

/** Payload returned by GET /api/health. */
export interface HealthResponse {
  ok: boolean;
  service: string;
  database: "up" | "down";
  latencyMs: number;
  timestamp: string;
  error?: string;
}
