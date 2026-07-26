/* ==========================================================================
   MISSION CONTROL — SMART SURVEY ROBOT — constants.js
   --------------------------------------------------------------------------
   Application enums & constants · Command types · Event names
   Status codes · Error codes · Magic numbers
   All immutable values that modules need to reference.

   USAGE
       import { COMMAND_TYPE, EVENT, STATUS } from './constants.js';
       if (status === STATUS.ROBOT.ONLINE) { ... }
   ========================================================================== */

/* ==========================================================================
   COMMAND TYPES — sent to the robot or received from it
   ========================================================================== */

export const COMMAND_TYPE = {
    /* Motor control */
    MOTOR_FORWARD: "motor:forward",
    MOTOR_BACKWARD: "motor:backward",
    MOTOR_TURN_LEFT: "motor:turn_left",
    MOTOR_TURN_RIGHT: "motor:turn_right",
    MOTOR_STOP: "motor:stop",

    /* Speed control */
    SET_SPEED: "speed:set",
    INCREASE_SPEED: "speed:up",
    DECREASE_SPEED: "speed:down",

    /* Path execution */
    PATH_PLAY: "path:play",
    PATH_PAUSE: "path:pause",
    PATH_STOP: "path:stop",
    PATH_REVERSE: "path:reverse",
    PATH_UPLOAD: "path:upload",
    PATH_CLEAR: "path:clear",

    /* Robot system */
    ROBOT_PING: "robot:ping",
    ROBOT_CALIBRATE: "robot:calibrate",
    ROBOT_SHUTDOWN: "robot:shutdown",
    ROBOT_FACTORY_RESET: "robot:factory_reset",

    /* Telemetry */
    TELEMETRY_START: "telemetry:start",
    TELEMETRY_STOP: "telemetry:stop",
    TELEMETRY_RESET: "telemetry:reset",

    /* Configuration */
    CONFIG_GET: "config:get",
    CONFIG_SET: "config:set",

    /* Firmware */
    FIRMWARE_CHECK: "firmware:check",
    FIRMWARE_UPDATE: "firmware:update",
};

/* ==========================================================================
   ROBOT STATUS CODES
   ========================================================================== */

export const STATUS = {
    /* Connection status */
    CONNECTION: {
        DISCONNECTED: "disconnected",
        CONNECTING: "connecting",
        CONNECTED: "connected",
        RECONNECTING: "reconnecting",
        ERROR: "error",
        OFFLINE_MODE: "offline",
    },

    /* Robot power & initialization */
    ROBOT: {
        OFFLINE: "offline",
        BOOTING: "booting",
        ONLINE: "online",
        IDLE: "idle",
        EXECUTING: "executing",
        PAUSED: "paused",
        ERROR: "error",
        LOW_BATTERY: "low_battery",
        CRITICAL_BATTERY: "critical_battery",
    },

    /* Control mode status */
    MODE: {
        MANUAL: "manual",
        KEYBOARD: "keyboard",
        GESTURE: "gesture",
        VOICE: "voice",
        AUTO_PATH: "auto_path",
        IDLE: "idle",
    },

    /* Path execution */
    PATH: {
        IDLE: "idle",
        PLAYING: "playing",
        PAUSED: "paused",
        COMPLETED: "completed",
        CANCELLED: "cancelled",
        ERROR: "error",
    },

    /* Command execution */
    COMMAND: {
        PENDING: "pending",
        SENT: "sent",
        ACKNOWLEDGED: "acked",
        EXECUTING: "executing",
        COMPLETED: "completed",
        FAILED: "failed",
        TIMEOUT: "timeout",
    },

    /* Telemetry stream */
    TELEMETRY: {
        IDLE: "idle",
        STREAMING: "streaming",
        PAUSED: "paused",
        ERROR: "error",
    },
};

/* ==========================================================================
   EVENT NAMES — emitted by managers and modules
   ========================================================================== */

export const EVENT = {
    /* Connection lifecycle */
    "connection:connecting": "connection:connecting",
    "connection:connected": "connection:connected",
    "connection:disconnected": "connection:disconnected",
    "connection:reconnecting": "connection:reconnecting",
    "connection:error": "connection:error",
    "connection:websocket:open": "connection:websocket:open",
    "connection:websocket:close": "connection:websocket:close",
    "connection:websocket:error": "connection:websocket:error",
    "connection:bluetooth:paired": "connection:bluetooth:paired",
    "connection:bluetooth:lost": "connection:bluetooth:lost",

    /* Robot lifecycle */
    "robot:online": "robot:online",
    "robot:offline": "robot:offline",
    "robot:error": "robot:error",
    "robot:battery:low": "robot:battery:low",
    "robot:battery:critical": "robot:battery:critical",
    "robot:shutdown": "robot:shutdown",

    /* Command flow */
    "command:sent": "command:sent",
    "command:acked": "command:acked",
    "command:completed": "command:completed",
    "command:failed": "command:failed",
    "command:timeout": "command:timeout",

    /* Telemetry */
    "telemetry:sample": "telemetry:sample",
    "telemetry:update": "telemetry:update",
    "telemetry:stream:start": "telemetry:stream:start",
    "telemetry:stream:stop": "telemetry:stream:stop",
    "telemetry:error": "telemetry:error",

    /* Path execution */
    "path:play:start": "path:play:start",
    "path:play:progress": "path:play:progress",
    "path:play:pause": "path:play:pause",
    "path:play:resume": "path:play:resume",
    "path:play:stop": "path:play:stop",
    "path:play:complete": "path:play:complete",
    "path:play:error": "path:play:error",

    /* UI module lifecycle */
    "module:load": "module:load",
    "module:unload": "module:unload",
    "module:error": "module:error",

    /* Settings & preferences */
    "settings:changed": "settings:changed",
    "theme:changed": "theme:changed",

    /* Notifications */
    "notification:add": "notification:add",
    "notification:remove": "notification:remove",
    "notification:clear": "notification:clear",

    /* Voice recognition lifecycle */
    "voice:listening:start": "voice:listening:start",
    "voice:listening:stop": "voice:listening:stop",
    "voice:recognized": "voice:recognized",
    "voice:error": "voice:error",

    /* Gesture recognition lifecycle */
    "gesture:started": "gesture:started",
    "gesture:stopped": "gesture:stopped",
    "gesture:detected": "gesture:detected",
    "gesture:error": "gesture:error",

    /* Page navigation */
    "page:change": "page:change",
    "page:loaded": "page:loaded",
};

/* ==========================================================================
   ERROR CODES — returned by command manager & services
   ========================================================================== */

export const ERROR_CODE = {
    /* Connection errors */
    WEBSOCKET_CONNECT_FAILED: "WS_CONNECT_FAILED",
    WEBSOCKET_TIMEOUT: "WS_TIMEOUT",
    WEBSOCKET_CLOSED: "WS_CLOSED",
    WEBSOCKET_PROTOCOL_ERROR: "WS_PROTOCOL_ERROR",
    BLUETOOTH_NOT_SUPPORTED: "BT_NOT_SUPPORTED",
    BLUETOOTH_PERMISSION_DENIED: "BT_PERMISSION_DENIED",
    BLUETOOTH_DEVICE_NOT_FOUND: "BT_DEVICE_NOT_FOUND",
    BLUETOOTH_PAIRING_FAILED: "BT_PAIRING_FAILED",

    /* Command errors */
    COMMAND_INVALID: "CMD_INVALID",
    COMMAND_UNKNOWN: "CMD_UNKNOWN",
    COMMAND_NOT_ALLOWED: "CMD_NOT_ALLOWED",
    COMMAND_TIMEOUT: "CMD_TIMEOUT",
    COMMAND_REJECTED: "CMD_REJECTED",

    /* Robot errors */
    ROBOT_OFFLINE: "ROBOT_OFFLINE",
    ROBOT_ERROR: "ROBOT_ERROR",
    ROBOT_MOTOR_FAULT: "ROBOT_MOTOR_FAULT",
    ROBOT_SENSOR_FAULT: "ROBOT_SENSOR_FAULT",
    ROBOT_LOW_BATTERY: "ROBOT_LOW_BATTERY",
    ROBOT_CRITICAL_BATTERY: "ROBOT_CRITICAL_BATTERY",
    ROBOT_OVERHEATING: "ROBOT_OVERHEATING",

    /* API errors */
    API_TIMEOUT: "API_TIMEOUT",
    API_INVALID_RESPONSE: "API_INVALID_RESPONSE",
    API_NOT_FOUND: "API_NOT_FOUND",
    API_UNAUTHORIZED: "API_UNAUTHORIZED",
    API_FORBIDDEN: "API_FORBIDDEN",
    API_SERVER_ERROR: "API_SERVER_ERROR",

    /* Validation errors */
    VALIDATION_FAILED: "VALIDATION_FAILED",
    INVALID_PAYLOAD: "INVALID_PAYLOAD",

    /* General */
    UNKNOWN: "UNKNOWN_ERROR",
    NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
};

/* ==========================================================================
   NOTIFICATION SEVERITY LEVELS
   ========================================================================== */

export const NOTIFICATION_LEVEL = {
    INFO: "info",
    SUCCESS: "success",
    WARNING: "warning",
    ERROR: "error",
    CRITICAL: "critical",
};

/* ==========================================================================
   CONTROL MODE IDENTIFIERS
   ========================================================================== */

export const CONTROL_MODE = {
    IDLE: "idle",
    MANUAL: "manual",
    KEYBOARD: "keyboard",
    GESTURE: "gesture",
    VOICE: "voice",
    AUTO_PATH: "auto_path",
};

/* ==========================================================================
   THEME IDENTIFIERS
   ========================================================================== */

export const THEME = {
    DARK: "dark",
    LIGHT: "light",
    CYBERPUNK: "cyberpunk",
};

/* ==========================================================================
   MOTOR DIRECTIONS — for clarity in control modules
   ========================================================================== */

export const DIRECTION = {
    FORWARD: "forward",
    BACKWARD: "backward",
    LEFT: "left",
    RIGHT: "right",
    STOP: "stop",
};

/* ==========================================================================
   SPEED LEVELS — discrete or continuous
   ========================================================================== */

export const SPEED = {
    MIN: 0,
    LOW: 25,
    MEDIUM: 50,
    HIGH: 75,
    MAX: 100,
};

/* ==========================================================================
   KEYBOARD KEY BINDINGS
   Used by keyboard-control module for consistency.
   ========================================================================== */

export const KEY_BINDING = {
    FORWARD: ["ArrowUp", "w", "W"],
    BACKWARD: ["ArrowDown", "s", "S"],
    LEFT: ["ArrowLeft", "a", "A"],
    RIGHT: ["ArrowRight", "d", "D"],
    STOP: [" ", "Escape"],
    SPEED_UP: ["+", "=", "]"],
    SPEED_DOWN: ["-", "["],
    EMERGENCY_STOP: ["Escape", "q", "Q"],
    TOGGLE_SIDEBAR: ["m", "M"],
};

/* ==========================================================================
   HTTP STATUS CODES — for REST API error handling
   ========================================================================== */

export const HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INTERNAL_SERVER_ERROR: 500,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
};

/* ==========================================================================
   TELEMETRY FIELD NAMES — consistency across data streams
   ========================================================================== */

export const TELEMETRY_FIELD = {
    TIMESTAMP: "timestamp",
    BATTERY_VOLTAGE: "battery_voltage",
    BATTERY_PERCENTAGE: "battery_percent",
    MOTOR_SPEED: "motor_speed",
    MOTOR_LOAD: "motor_load",
    TEMPERATURE: "temperature",
    SIGNAL_STRENGTH: "signal_strength",
    LATENCY: "latency",
    POSITION_X: "pos_x",
    POSITION_Y: "pos_y",
    HEADING: "heading",
    DISTANCE_TRAVELED: "distance",
};

/* ==========================================================================
   STORAGE LIMITS & QUOTAS
   ========================================================================== */

export const STORAGE_LIMIT = {
    COMMAND_HISTORY_MAX: 200,
    PATH_HISTORY_MAX: 50,
    TELEMETRY_BUFFER_SIZE: 240,
    NOTIFICATION_MAX: 100,
    LOCALSTORAGE_QUOTA_KB: 5000,
};

/* ==========================================================================
   ANIMATION CLASS NAMES — must match css/animations.css
   ========================================================================== */

export const ANIMATION_CLASS = {
    /* Entrance */
    FADE_IN: "anim-fade-in",
    FADE_IN_UP: "anim-fade-in-up",
    FADE_IN_DOWN: "anim-fade-in-down",
    SLIDE_IN_LEFT: "anim-slide-in-left",
    SLIDE_IN_RIGHT: "anim-slide-in-right",
    SLIDE_IN_UP: "anim-slide-in-up",
    SLIDE_OUT_RIGHT: "anim-slide-out-right",
    SCALE_IN: "anim-scale-in",
    POP_IN: "anim-pop-in",

    /* Status feedback */
    PULSE: "anim-pulse",
    BREATHE: "anim-breathe",
    SHAKE: "anim-shake",
    BLINK: "anim-blink",
    FLICKER: "anim-flicker",

    /* Glow loops */
    GLOW_CYAN: "anim-glow-cyan",
    GLOW_PRIMARY: "anim-glow-primary",
    GLOW_DANGER: "anim-glow-danger",
    GLOW_TEXT: "anim-glow-text",

    /* Robot-specific */
    ROBOT_ONLINE: "anim-robot-online",
    ROBOT_ONLINE_RING: "anim-robot-online-ring",
    ROBOT_WAKE: "anim-robot-wake",

    /* Notifications */
    BELL_RING: "anim-bell-ring",
    BADGE_POP: "anim-badge-pop",
    TOAST_IN: "anim-toast-in",
    TOAST_OUT: "anim-toast-out",
    PANEL_IN: "anim-panel-in",

    /* Loading */
    SPIN: "anim-spin",
};

/* ==========================================================================
   ELEMENT IDs — must match index.html
   For safe queries, modules use these constants instead of hardcoding.
   ========================================================================== */

export const ELEMENT_ID = {
    /* Page container */
    APP_SHELL: "app-shell",
    APP_BODY: "app-body",
    MAIN_CONTENT: "main-content",

    /* Header */
    APP_HEADER: "app-header",
    HEADER_DATE: "header-date",
    HEADER_TIME: "header-time",
    NOTIFICATION_BELL: "notification-bell-btn",
    NOTIFICATION_BADGE: "notification-badge",
    USER_PROFILE: "user-profile-btn",
    CONNECTION_INDICATOR: "connection-indicator",
    CONNECTION_TEXT: "connection-indicator-text",

    /* Status pills */
    STATUS_ROBOT: "status-robot",
    STATUS_ROBOT_VALUE: "status-robot-value",
    STATUS_WIFI: "status-wifi",
    STATUS_WIFI_VALUE: "status-wifi-value",
    STATUS_BLUETOOTH: "status-bluetooth",
    STATUS_BLUETOOTH_VALUE: "status-bluetooth-value",

    /* Sidebar */
    APP_SIDEBAR: "app-sidebar",
    SIDEBAR_NAV: "sidebar-nav",
    SIDEBAR_TOGGLE: "sidebar-toggle-btn",

    /* Main page intro */
    PAGE_TITLE: "page-title",
    PAGE_SUBTITLE: "page-subtitle",

    /* Card grid */
    CARD_GRID: "dashboard-grid",

    /* Cards (by module) */
    CARD_ROBOT_OVERVIEW: "card-robot-overview",
    CARD_CONNECTION: "card-connection",
    CARD_MANUAL_CONTROL: "card-manual-control",
    CARD_KEYBOARD_CONTROL: "card-keyboard-control",
    CARD_GESTURE_CONTROL: "card-gesture-control",
    CARD_VOICE_CONTROL: "card-voice-control",
    CARD_DRAW_LINE: "card-draw-line",
    CARD_FREE_DRAW: "card-free-draw",
    CARD_AUTO_MODE: "card-auto-mode",
    CARD_TELEMETRY: "card-telemetry",
    CARD_ROBOT_MAP: "card-robot-map",
    CARD_NOTIFICATIONS: "card-notifications",
    CARD_HISTORY: "card-history",

    /* Overlay panels */
    NOTIFICATION_PANEL: "notification-panel",
    NOTIFICATION_PANEL_LIST: "notification-panel-list",
    TOAST_CONTAINER: "toast-container",

    /* Footer */
    APP_FOOTER: "app-footer",
};

/* ==========================================================================
   CSS CLASS NAMES — must match style.css / responsive.css
   Used by modules to toggle states without string typos.
   ========================================================================== */

export const CSS_CLASS = {
    /* Theme */
    THEME_DARK: "theme-dark",
    THEME_LIGHT: "theme-light",
    THEME_CYBERPUNK: "theme-cyberpunk",
    THEME_SWITCHING: "theme-switching",

    /* Sidebar state */
    SIDEBAR_OPEN: "is-open",
    SIDEBAR_COLLAPSED: "is-collapsed",

    /* Navigation */
    NAV_ACTIVE: "is-active",

    /* Focused single-card page view */
    CARD_FOCUSED: "is-focused",

    /* Status */
    STATUS_ONLINE: "status-online",
    STATUS_OFFLINE: "status-offline",
    STATUS_WARNING: "status-warning",
    CONNECTION_CONNECTED: "is-connected",
    CONNECTION_DISCONNECTED: "is-disconnected",

    /* Card badges */
    BADGE_NEUTRAL: "badge-neutral",
    BADGE_SUCCESS: "badge-success",
    BADGE_WARNING: "badge-warning",
    BADGE_DANGER: "badge-danger",

    /* Visibility */
    HIDDEN: "hidden",
    INVISIBLE: "invisible",

    /* Interactive states */
    DISABLED: "disabled",
    LOADING: "loading",
    ACTIVE: "active",
};

/* ==========================================================================
   BREAKPOINTS — for feature detection in JavaScript
   Must match responsive.css @media breakpoints
   ========================================================================== */

export const BREAKPOINT = {
    ULTRA_WIDE: 1920,   /* ≥ 1920px */
    LAPTOP: 1440,       /* ≤ 1440px */
    SMALL_LAPTOP: 1200, /* ≤ 1200px */
    TABLET: 1024,       /* ≤ 1024px */
    MOBILE: 768,        /* ≤ 768px */
    PORTRAIT_PHONE: 480, /* ≤ 480px */
    COMPACT_PHONE: 360, /* ≤ 360px */
};

/* ==========================================================================
   VERSION CONSTRAINTS — for compatibility checking
   ========================================================================== */

export const VERSION_CONSTRAINT = {
    MIN_NODE_VERSION: "14.0.0",
    MIN_BROWSER_VERSION: {
        CHROME: 90,
        FIREFOX: 88,
        SAFARI: 14,
        EDGE: 90,
    },
};
