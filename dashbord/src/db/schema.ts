/**
 * Mission Control — Persistence Schema
 * ---------------------------------------------------------------------------
 * Declarative Drizzle tables that prepare the backend for ESP32 integration:
 * command audit log, telemetry snapshots and stored survey paths.
 *
 * Apply with:  npx drizzle-kit push
 * (Purely additive — no runtime code depends on these yet.)
 */

import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Every command dispatched toward (or received from) the robot. */
export const commandLog = pgTable(
  "command_log",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    direction: text("direction"),
    source: text("source").notNull().default("system"),
    status: text("status").notNull().default("sent"),
    reason: text("reason"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("command_log_created_idx").on(table.createdAt),
    index("command_log_type_idx").on(table.type),
  ]
);

/** Periodic robot telemetry frames for charting and post-mission review. */
export const telemetrySnapshot = pgTable(
  "telemetry_snapshot",
  {
    id: text("id").primaryKey(),
    batteryVoltage: real("battery_voltage").notNull(),
    batteryPercent: integer("battery_percent").notNull(),
    wifiRssi: integer("wifi_rssi"),
    bluetoothRssi: integer("bluetooth_rssi"),
    speed: real("speed").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("telemetry_created_idx").on(table.createdAt)]
);

/** Operator-drawn survey routes (draw-line / free-draw exports). */
export const savedPath = pgTable(
  "saved_path",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    points: jsonb("points").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("saved_path_kind_idx").on(table.kind)]
);

export type CommandLogRow = typeof commandLog.$inferSelect;
export type NewCommandLogRow = typeof commandLog.$inferInsert;
export type TelemetrySnapshotRow = typeof telemetrySnapshot.$inferSelect;
export type SavedPathRow = typeof savedPath.$inferSelect;
