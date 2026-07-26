/* ==========================================================================
   MISSION CONTROL — SMART SURVEY ROBOT — compat-globals.js
   --------------------------------------------------------------------------
   Global compatibility bridge + module bootstrap
   --------------------------------------------------------------------------
   WHY THIS EXISTS

   The dashboard grew two module styles:

     A) ES modules  (config/constants/utils, dashboard, connection,
                     manual-control, keyboard-control, gesture-control,
                     voice-control)  → `import` / `export`

     B) IIFE modules (draw-line, free-draw, auto-mode, telemetry,
                      robot-map, notifications, history, settings)
                    → read `window.Sarathi.{Config,Constants,Utils}`

   Nothing ever created `window.Sarathi`, so in group (B) every
   `Utils.byId(...)`, `Utils.on(...)` and `Utils.createElement(...)` was
   `undefined` — those eight modules silently rendered nothing and none of
   their controls worked.

   This file publishes an adapter with the exact API group (B) expects,
   backed by the real ES-module utilities, then initializes every
   registered module once the DOM is ready.

   It MUST be the first module script in index.html so the globals exist
   before the IIFE modules capture them.
   ========================================================================== */

import { CONFIG } from "./config.js";
import { EVENT, COMMAND_TYPE, CSS_CLASS, ELEMENT_ID, STATUS } from "./constants.js";
import {
    Logger,
    query,
    queryAll,
    getElementByID,
    on as onEvent,
    emit as emitEvent,
    debounce,
    throttle,
} from "./utils.js";

/* utils.js has no clamp/escapeHTML — define them here so the bridge
   stays self-sufficient rather than importing symbols that don't exist. */
const clampNum = (value, min, max) => {
    const n = Number(value);
    if (Number.isNaN(n)) return min;
    return Math.min(Math.max(n, min), max);
};

const escapeHtmlStr = (str) =>
    typeof str !== "string"
        ? ""
        : str
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");

const TAG = "Compat";

const Sarathi = (window.Sarathi = window.Sarathi || {});
Sarathi.Modules = Sarathi.Modules || {};

/* ==========================================================================
   CONFIG ADAPTER — lowercase shape used by the IIFE modules
   ========================================================================== */

Sarathi.Config = {
    app: {
        name: CONFIG.APP.NAME,
        version: CONFIG.APP.VERSION,
        environment: CONFIG.APP.ENVIRONMENT,
        debug: CONFIG.DEBUG.ENABLED,
        team: "Mission Control Robotics Team",
        website: "https://sarathi-robot.example.com",
        github: "https://github.com/sarathi-robotics/sarathi-dashboard",
        supportEmail: "support@sarathi-robotics.example.com",
    },
    network: {
        wifi: {
            defaultHost: "192.168.4.1",
            defaultPort: 81,
            reconnectDelayMs: CONFIG.API.WEBSOCKET.RECONNECT_DELAY_MS,
        },
        bluetooth: { devicePrefix: "SARATHI_" },
    },
    telemetry: {
        batteryMaxVoltage: 12.6,
        batteryMinVoltage: 9.6,
        batteryWarningThreshold: CONFIG.TELEMETRY.BATTERY_LOW_THRESHOLD,
    },
    ui: {
        clockUpdateIntervalMs: 1000,
        toastDurationMs: CONFIG.UI.TOAST_DURATION_MS,
        toastMaxVisible: 4,
        sidebarTouchBreakpointPx: 768,
    },
    storage: {
        namespace: CONFIG.STORAGE.NS,
        keys: {
            theme: CONFIG.STORAGE.KEYS.THEME,
            savedPaths: CONFIG.STORAGE.KEYS.SAVED_PATHS,
            commandHistory: CONFIG.STORAGE.KEYS.COMMAND_HISTORY,
            settings: "sarathi_settings",
        },
        maxSavedPaths: 30,
        maxCommandHistoryEntries: 200,
    },
    notificationMaxHistory: 50,
};

/* ==========================================================================
   CONSTANTS ADAPTER — event names map to the SAME strings the ES modules
   emit, so both halves interoperate on one bus.
   ========================================================================== */

Sarathi.Constants = {
    MODULES: {
        DASHBOARD: "dashboard",
        DRAW_LINE: "draw-line",
        FREE_DRAW: "free-draw",
        AUTO_MODE: "auto-mode",
        TELEMETRY: "telemetry",
        ROBOT_MAP: "robot-map",
        NOTIFICATIONS: "notifications",
        HISTORY: "history",
        SETTINGS: "settings",
    },
    EVENTS: {
        COMMAND_SENT: EVENT["command:sent"],
        COMMAND_FAILED: EVENT["command:failed"],
        MODE_CHANGED: EVENT["settings:changed"],
        CONNECTION_LINK_CHANGE: EVENT["connection:connected"],
        ROBOT_ONLINE: EVENT["robot:online"],
        ROBOT_OFFLINE: EVENT["robot:offline"],
        PAGE_NAVIGATED: EVENT["page:change"],
        APP_SHUTDOWN: "app:shutdown",
    },
    THEMES: {
        DARK: CSS_CLASS.THEME_DARK,
        LIGHT: CSS_CLASS.THEME_LIGHT,
        CYBERPUNK: CSS_CLASS.THEME_CYBERPUNK,
    },
    CLASSES: {
        ACTIVE: CSS_CLASS.NAV_ACTIVE,
        OPEN: CSS_CLASS.SIDEBAR_OPEN,
    },
    CONNECTION_STATES: STATUS.CONNECTION,
    /* STATUS.MODE has no STANDBY member — add it so telemetry's default
       mode resolves to a real constant instead of a fallback string. */
    CONTROL_MODES: { ...STATUS.MODE, STANDBY: "standby" },
    COMMAND_TYPE,
    DOM_IDS: ELEMENT_ID,
};

/* ==========================================================================
   UTILS ADAPTER
   Signature note: the IIFE modules call
       createElement(tag, { classes, attributes, dataset, text, html })
   while the ES helper is createElement(tag, id, ...classes) — so this
   adapter implements the options-object form directly.
   ========================================================================== */

Sarathi.Utils = {
    byId: (id) => getElementByID(id),
    $: (selector, parent) => (parent ? parent.querySelector(selector) : query(selector)),
    $$: (selector, parent) => queryAll(selector, parent),

    createElement(tag, options = {}) {
        const el = document.createElement(tag);

        if (options.classes) {
            const list = Array.isArray(options.classes)
                ? options.classes
                : String(options.classes).split(" ");
            list.filter(Boolean).forEach((cls) => el.classList.add(cls));
        }

        if (options.attributes) {
            Object.entries(options.attributes).forEach(([key, value]) => {
                if (value === null || value === undefined) return;
                /* `disabled: "true"` must become a real boolean property */
                if (key === "disabled") el.disabled = value !== false && value !== "false";
                else if (key === "hidden") el.hidden = value !== false && value !== "false";
                else el.setAttribute(key, String(value));
            });
        }

        if (options.dataset) {
            Object.entries(options.dataset).forEach(([key, value]) => {
                el.dataset[key] = String(value);
            });
        }

        if (options.text !== undefined) el.textContent = options.text;
        else if (options.html !== undefined) el.innerHTML = options.html;

        return el;
    },

    on: (el, event, handler, options) => onEvent(el, event, handler, options),

    /** IIFE modules dispatch by name only — always target `window`. */
    dispatch(eventName, detail = {}, target = window) {
        emitEvent(target, eventName, detail);
        return true;
    },

    clamp: (value, min, max) => clampNum(value, min, max),

    mapRange(value, inMin, inMax, outMin, outMax) {
        if (inMax - inMin === 0) return outMin;
        return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
    },

    debounce,
    throttle,
    escapeHTML: escapeHtmlStr,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),

    generateUUID() {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    },

    /* Logger shim: the ES Logger takes (tag, message, data); the IIFE
       modules call logger.info(message, data). */
    logger: {
        debug: (msg, data) => Logger.debug("Module", msg, data),
        info: (msg, data) => Logger.info("Module", msg, data),
        warn: (msg, data) => Logger.warn("Module", msg, data),
        error: (msg, data) => Logger.error("Module", msg, data),
    },
};

/* ==========================================================================
   MODULE BOOTSTRAP
   The ES-module dashboard pipeline resolves `export default` only, so it
   cannot see IIFE registrations. Initialize them here instead — each
   module guards against double-init, so this is safe alongside any
   self-bootstrap already present.
   ========================================================================== */

function bootModules() {
    const entries = Object.entries(Sarathi.Modules);
    let ready = 0;

    entries.forEach(([id, mod]) => {
        if (!mod || typeof mod.init !== "function") return;
        try {
            const result = mod.init();
            if (result && typeof result.catch === "function") {
                result.catch((err) => Logger.error(TAG, `Module "${id}" init rejected`, err));
            }
            ready++;
        } catch (error) {
            Logger.error(TAG, `Module "${id}" failed to initialize`, error);
        }
    });

    Logger.info(TAG, `Global bridge ready — initialized ${ready}/${entries.length} legacy module(s).`);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootModules, { once: true });
} else {
    bootModules();
}
