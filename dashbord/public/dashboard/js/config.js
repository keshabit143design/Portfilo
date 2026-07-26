/* ==========================================================================
   MISSION CONTROL — SMART SURVEY ROBOT — config.js
   --------------------------------------------------------------------------
   Global application configuration · Environment variables · Feature flags
   Single source of truth for all tunable parameters.
   Loaded FIRST in the script chain so all modules can import it.

   USAGE
       import { CONFIG } from './config.js';
       const apiUrl = CONFIG.API.WEBSOCKET.URL;

   STRUCTURE
   - APP          namespace for app metadata
   - API          connection endpoints (WebSocket, Bluetooth)
   - TELEMETRY    data update intervals
   - UI           animation durations, transition timings
   - FEATURES     feature flag toggles
   - DEBUG        development & logging controls
   - STORAGE      localStorage keys namespace
   ========================================================================== */

/* ======================================================================
   SAFE ENVIRONMENT ACCESS
   `process.env` only exists in Node/bundler contexts — the dashboard
   runs as plain browser ES modules, so guard against its absence.
   ====================================================================== */
const env =
    typeof process !== "undefined" && process.env ? process.env : {};

export const CONFIG = {
    /* ====================================================================
       APP — Metadata & versioning
       ==================================================================== */
    APP: {
        NAME: "Mission Control",
        VERSION: "1.0.0",
        ENVIRONMENT: "production",
        BUILD_DATE: new Date().toISOString().split("T")[0],
        RELEASE: "stable",
    },

    /* ====================================================================
       API — Connection endpoints & retry logic
       ==================================================================== */
    API: {
        /* --- WebSocket (primary, real-time command/telemetry) --- */
        WEBSOCKET: {
            ENABLED: true,
            URL: env.NEXT_PUBLIC_ROBOT_WS_URL || "ws://192.168.1.100:8080",
            PROTOCOL: "sarathi-v1",
            RECONNECT_DELAY_MS: 2000,
            RECONNECT_MAX_ATTEMPTS: 12,
            RECONNECT_BACKOFF_FACTOR: 1.5,
            PING_INTERVAL_MS: 28000,
            PING_TIMEOUT_MS: 5000,
            MESSAGE_TIMEOUT_MS: 8000,
        },

        /* --- Web Bluetooth (secondary, fallback pairing) --- */
        BLUETOOTH: {
            ENABLED: true,
            SERVICE_UUID: "9f7b4a6c-8d2e-11eb-8dcd-0242ac110002",
            RX_CHAR_UUID: "a1b2c3d4-8d2e-11eb-8dcd-0242ac110002",
            TX_CHAR_UUID: "e5f6g7h8-8d2e-11eb-8dcd-0242ac110002",
            SCAN_TIMEOUT_MS: 10000,
            WRITE_TIMEOUT_MS: 3000,
        },

        /* --- REST API (metadata, settings, history) --- */
        REST: {
            BASE_URL: env.NEXT_PUBLIC_API_BASE_URL || "http://192.168.1.100:8000/api",
            TIMEOUT_MS: 12000,
            RETRY_ATTEMPTS: 3,
        },
    },

    /* ====================================================================
       TELEMETRY — Data stream intervals & buffer sizes
       ==================================================================== */
    TELEMETRY: {
        /* Update frequency for live sensor data */
        SAMPLE_INTERVAL_MS: 250,          /* 4 Hz → 250ms */
        CHART_HISTORY_SECONDS: 60,        /* keep 1 minute in memory */
        CHART_UPDATE_INTERVAL_MS: 1000,   /* redraw 1x per second */

        /* Motor telemetry */
        MOTOR_BUFFER_SIZE: 240,           /* 60s @ 4 Hz */

        /* Battery monitoring */
        BATTERY_LOW_THRESHOLD: 25,        /* % */
        BATTERY_CRITICAL_THRESHOLD: 10,   /* % */

        /* Signal strength thresholds */
        SIGNAL_GOOD_THRESHOLD: -60,       /* dBm */
        SIGNAL_POOR_THRESHOLD: -80,       /* dBm */

        /* Latency measurement */
        LATENCY_WARNING_MS: 400,
        LATENCY_CRITICAL_MS: 800,
    },

    /* ====================================================================
       UI — Animation & interaction timings
       ==================================================================== */
    UI: {
        /* Duration constants matching CSS var(--dur-*) */
        ANIMATION_FAST_MS: 140,
        ANIMATION_NORMAL_MS: 240,
        ANIMATION_SLOW_MS: 420,

        /* Interaction feedback */
        TOAST_DURATION_MS: 4000,
        TOAST_CLOSE_ANIMATION_MS: 240,
        NOTIFICATION_PANEL_ANIMATION_MS: 300,
        SIDEBAR_TOGGLE_ANIMATION_MS: 420,

        /* Debounce / throttle */
        RESIZE_DEBOUNCE_MS: 180,
        SCROLL_THROTTLE_MS: 80,
        INPUT_DEBOUNCE_MS: 300,
        SEARCH_DEBOUNCE_MS: 400,

        /* Keyboard navigation */
        REPEAT_DELAY_MS: 500,
        REPEAT_RATE_MS: 60,

        /* Timeouts */
        MODAL_DIALOG_TIMEOUT_MS: 150,
        DROPDOWN_SHOW_DELAY_MS: 0,
        DROPDOWN_HIDE_DELAY_MS: 80,
    },

    /* ====================================================================
       FEATURES — Feature flags & experimental toggles
       ==================================================================== */
    FEATURES: {
        /* Control modes */
        MANUAL_CONTROL: true,
        KEYBOARD_CONTROL: true,
        GESTURE_CONTROL: true,           /* laptop-webcam gesture driving */
        VOICE_CONTROL: true,             /* live — tap the mic and speak a command */

        /* Path planning */
        DRAW_LINE: true,
        FREE_DRAW: true,
        AUTO_MODE: true,

        /* Monitoring */
        TELEMETRY_CHARTS: true,
        ROBOT_MAP: true,
        /* NOTE: the robot has no onboard camera — camera streaming was
           removed. Operator vision features live in GESTURE_CONTROL,
           which uses the local laptop webcam instead. */

        /* System */
        COMMAND_HISTORY: true,
        NOTIFICATIONS: true,
        SETTINGS_PANEL: true,
        ABOUT_PAGE: true,
        HELP_SYSTEM: true,

        /* Advanced */
        OFFLINE_MODE: true,              /* buffer commands while disconnected */
        DARK_MODE: true,
        LIGHT_MODE: true,
        CYBERPUNK_MODE: true,
        ANALYTICS: false,                /* privacy-first: disabled by default */
    },

    /* ====================================================================
       DEBUG — Development & logging controls
       ==================================================================== */
    DEBUG: {
        ENABLED: false,                  /* set true for verbose logging */
        LOG_LEVEL: "warn",               /* "silent" | "error" | "warn" | "info" | "debug" */
        LOG_WEBSOCKET: false,
        LOG_BLUETOOTH: false,
        LOG_TELEMETRY: false,
        LOG_COMMANDS: false,
        MOCK_ROBOT_ONLINE: false,        /* fake a connected robot */
        MOCK_TELEMETRY: false,           /* stream fake sensor data */
        PERFORMANCE_MARKS: false,        /* User Timing API marks */
    },

    /* ====================================================================
       STORAGE — localStorage key namespace
       ==================================================================== */
    STORAGE: {
        NS: "sarathi_",                  /* prefix all keys to avoid collision */

        KEYS: {
            /* User settings */
            THEME: "sarathi_theme",
            LANGUAGE: "sarathi_language",
            VOLUME: "sarathi_volume",

            /* Connection state */
            LAST_ROBOT_IP: "sarathi_last_robot_ip",
            ROBOT_ALIAS: "sarathi_robot_alias",
            WEBSOCKET_ENABLED: "sarathi_websocket_enabled",
            BLUETOOTH_ENABLED: "sarathi_bluetooth_enabled",

            /* Path history */
            SAVED_PATHS: "sarathi_saved_paths",
            PATH_HISTORY: "sarathi_path_history",

            /* Command log */
            COMMAND_HISTORY: "sarathi_command_history",

            /* Telemetry snapshots */
            TELEMETRY_SNAPSHOT: "sarathi_telemetry_snapshot",

            /* Session state */
            ACTIVE_MODULE: "sarathi_active_module",
            SIDEBAR_COLLAPSED: "sarathi_sidebar_collapsed",
        },
    },

    /* ====================================================================
       CONSTANTS — Static, immutable application values
       (moved here from constants.js for reference; see constants.js)
       ==================================================================== */
    // Command types, event types, status values, etc. are in constants.js
};

/* ======================================================================
   CONFIGURATION VALIDATION & DEFAULTS
   Verify critical values exist and provide fallbacks.
   ====================================================================== */

/**
 * Validates that the configuration is safe at startup.
 * Logs warnings to console if any critical keys are missing.
 * @returns {boolean} true if config is valid
 */
export function validateConfig() {
    const criticalPaths = [
        ["API", "WEBSOCKET", "URL"],
        ["API", "BLUETOOTH", "SERVICE_UUID"],
        ["TELEMETRY", "SAMPLE_INTERVAL_MS"],
    ];

    let valid = true;

    criticalPaths.forEach((path) => {
        let value = CONFIG;
        try {
            path.forEach((key) => {
                value = value[key];
            });
            if (value === undefined || value === null) {
                console.warn(`CONFIG: Missing critical path [${path.join(".")}]`);
                valid = false;
            }
        } catch (e) {
            console.warn(`CONFIG: Invalid path [${path.join(".")}]`);
            valid = false;
        }
    });

    if (valid && CONFIG.DEBUG.ENABLED) {
        console.info("[CONFIG] Configuration validated successfully");
    }

    return valid;
}

/**
 * Returns a deeply nested config value using dot notation.
 * Safe getter that returns a default if path doesn't exist.
 * @param {string} path - dot-separated path, e.g. "API.WEBSOCKET.URL"
 * @param {*} fallback - value to return if path not found
 * @returns {*}
 */
export function getConfig(path, fallback = undefined) {
    const keys = path.split(".");
    let value = CONFIG;

    try {
        keys.forEach((key) => {
            value = value[key];
        });
        return value !== undefined ? value : fallback;
    } catch (e) {
        return fallback;
    }
}

/**
 * Overrides a config value at runtime (e.g., after loading settings from storage).
 * Use sparingly — prefer static CONFIG for production stability.
 * @param {string} path - dot-separated path
 * @param {*} newValue - new value
 */
export function setConfig(path, newValue) {
    const keys = path.split(".");
    const lastKey = keys.pop();
    let target = CONFIG;

    try {
        keys.forEach((key) => {
            if (!(key in target)) {
                target[key] = {};
            }
            target = target[key];
        });
        target[lastKey] = newValue;

        if (CONFIG.DEBUG.ENABLED) {
            console.info(`[CONFIG] Updated ${path} =`, newValue);
        }
    } catch (e) {
        console.error(`[CONFIG] Failed to set ${path}:`, e);
    }
}
