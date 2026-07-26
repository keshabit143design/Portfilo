/* ==========================================================================
   MISSION CONTROL — SMART SURVEY ROBOT — modules/dashboard.js
   --------------------------------------------------------------------------
   Main Dashboard Controller
   --------------------------------------------------------------------------
   Responsibilities
     1. Manage the startup (boot) sequence
     2. Build & manage the loading (boot) screen
     3. Initialize feature modules from the module registry (lazy imports)
     4. Load the dashboard view (clock, page meta, card grid)
     5. Manage page transitions between navigation targets

   Out of scope (by design)
     - ESP32 / WebSocket / Bluetooth connectivity (connection module, Part 7+)
     - Command dispatch (command manager, later part)
     - URL routing ownership (router.js will call navigateTo() later)

   Module convention for future feature modules
     export default { init(context) {}, destroy() {} }
     — or a named factory:  export function createXModule() { ... }
     dashboard.js detects either shape automatically.
   ========================================================================== */

import { CONFIG, validateConfig } from "../config.js";
import {
    EVENT,
    ELEMENT_ID,
    CSS_CLASS,
    ANIMATION_CLASS,
    BREAKPOINT,
} from "../constants.js";
import {
    Logger,
    is,
    query,
    queryAll,
    getElementByID,
    addClass,
    removeClass,
    toggleClass,
    hasClass,
    setText,
    attr,
    createElement,
    removeElement,
    setStyles,
    on,
    emit,
    debounce,
    getCurrentDate,
    getCurrentTime,
} from "../utils.js";

const TAG = "Dashboard";

/* ==========================================================================
   BOOT STAGES — displayed by the loading screen
   ========================================================================== */

const BOOT_STAGES = [
    { label: "Validating configuration" },
    { label: "Initializing core systems" },
    { label: "Loading modules" },
    { label: "Preparing dashboard" },
    { label: "Mission control ready" },
];

/* ==========================================================================
   PAGE REGISTRY — metadata for every navigation target
   --------------------------------------------------------------------------
   Titles, subtitles and icons match the sidebar in index.html.
   router.js (Part 7+) consumes this registry for URL routing.
   ========================================================================== */

const PAGE_REGISTRY = [
    {
        id: "dashboard",
        title: "Mission Control",
        subtitle: "Live overview of the SARATHI smart survey robot — control modes, telemetry and mission tools.",
        icon: "fa-gauge-high",
    },
    {
        id: "manual-control",
        title: "Manual Control",
        subtitle: "On-screen directional controls for precise hand-driven operation.",
        icon: "fa-gamepad",
        placeholder: "The manual control pad will render here — forward, backward, left, right and emergency stop.",
    },
    {
        id: "keyboard-control",
        title: "Arrow Key Control",
        subtitle: "Drive the robot with arrow keys and WASD.",
        icon: "fa-keyboard",
        placeholder: "The keyboard control surface will bind here with live key-press feedback.",
    },
    {
        id: "gesture-control",
        title: "Gesture Control",
        subtitle: "Steer the robot with hand gestures tracked live by your laptop webcam.",
        icon: "fa-hand",
        placeholder: "The gesture engine will initialize here once the module ships.",
    },
    {
        id: "voice-control",
        title: "Voice Control",
        subtitle: "Command the robot with natural spoken instructions.",
        icon: "fa-microphone-lines",
        placeholder: "The voice recognition console will appear here once the module ships.",
    },
    {
        id: "draw-line",
        title: "Draw Line",
        subtitle: "Plot waypoint segments and send precise paths to the robot.",
        icon: "fa-pen-ruler",
        placeholder: "The line drawing canvas will mount here for waypoint planning.",
    },
    {
        id: "free-draw",
        title: "Free Draw",
        subtitle: "Sketch freehand curves for the robot to trace.",
        icon: "fa-signature",
        placeholder: "The free-draw canvas will mount here for freehand paths.",
    },
    {
        id: "auto-mode",
        title: "Auto Mode",
        subtitle: "Replay saved survey paths with progress tracking.",
        icon: "fa-route",
        placeholder: "The autonomous playback console will load here with saved missions.",
    },
    {
        id: "telemetry",
        title: "Telemetry",
        subtitle: "Live battery, motor, signal and latency streams.",
        icon: "fa-wave-square",
        placeholder: "Telemetry charts will stream here in real time.",
    },
    {
        id: "robot-map",
        title: "Robot Map",
        subtitle: "Track position and traveled route on the mission map.",
        icon: "fa-map-location-dot",
        placeholder: "The live mission map will render here with the robot's track.",
    },
    {
        id: "history",
        title: "Command History",
        subtitle: "Chronological log of every command sent to the robot.",
        icon: "fa-clock-rotate-left",
        placeholder: "The command history log will populate here.",
    },
    {
        id: "settings",
        title: "Settings",
        subtitle: "Connection, appearance and robot preferences.",
        icon: "fa-sliders",
        placeholder: "The settings panel will render here — themes, links and robot tuning.",
    },
    {
        id: "about",
        title: "About",
        subtitle: "Project details, hardware and version information.",
        icon: "fa-circle-info",
        placeholder: "Project information, hardware specs and credits will appear here.",
    },
    {
        id: "help",
        title: "Help",
        subtitle: "Guides, shortcuts and troubleshooting.",
        icon: "fa-circle-question",
        placeholder: "The help center will load here with guides and shortcuts.",
    },
];

/* ==========================================================================
   MODULE REGISTRY — lazy-loaded feature modules
   --------------------------------------------------------------------------
   Paths are relative to this file (js/modules/).
   `featureKey` maps to CONFIG.FEATURES — disabled features never load.
   dashboard.js itself is the controller, so it is not registered.
   ========================================================================== */

const MODULE_REGISTRY = [
    { id: "connection",       name: "Connection",       path: "./connection.js",       elementId: ELEMENT_ID.CARD_CONNECTION,       featureKey: null },
    { id: "manual-control",   name: "Manual Control",   path: "./manual-control.js",   elementId: ELEMENT_ID.CARD_MANUAL_CONTROL,   featureKey: "MANUAL_CONTROL" },
    { id: "keyboard-control", name: "Arrow Key Control",path: "./keyboard-control.js", elementId: ELEMENT_ID.CARD_KEYBOARD_CONTROL, featureKey: "KEYBOARD_CONTROL" },
    { id: "gesture-control",  name: "Gesture Control",  path: "./gesture-control.js",  elementId: ELEMENT_ID.CARD_GESTURE_CONTROL,  featureKey: "GESTURE_CONTROL" },
    { id: "voice-control",    name: "Voice Control",    path: "./voice-control.js",    elementId: ELEMENT_ID.CARD_VOICE_CONTROL,    featureKey: "VOICE_CONTROL" },
    { id: "draw-line",        name: "Draw Line",        path: "./draw-line.js",        elementId: ELEMENT_ID.CARD_DRAW_LINE,        featureKey: "DRAW_LINE" },
    { id: "free-draw",        name: "Free Draw",        path: "./free-draw.js",        elementId: ELEMENT_ID.CARD_FREE_DRAW,        featureKey: "FREE_DRAW" },
    { id: "auto-mode",        name: "Auto Mode",        path: "./auto-mode.js",        elementId: ELEMENT_ID.CARD_AUTO_MODE,        featureKey: "AUTO_MODE" },
    { id: "telemetry",        name: "Telemetry",        path: "./telemetry.js",        elementId: ELEMENT_ID.CARD_TELEMETRY,        featureKey: "TELEMETRY_CHARTS" },
    { id: "robot-map",        name: "Robot Map",        path: "./robot-map.js",        elementId: ELEMENT_ID.CARD_ROBOT_MAP,        featureKey: "ROBOT_MAP" },
    { id: "notifications",    name: "Notifications",    path: "./notifications.js",    elementId: ELEMENT_ID.CARD_NOTIFICATIONS,    featureKey: "NOTIFICATIONS" },
    { id: "history",          name: "Command History",  path: "./history.js",          elementId: ELEMENT_ID.CARD_HISTORY,          featureKey: "COMMAND_HISTORY" },
    { id: "settings",         name: "Settings",         path: "./settings.js",         elementId: null,                             featureKey: "SETTINGS_PANEL" },
];

/* ==========================================================================
   INTERNAL HELPERS
   ========================================================================== */

/**
 * Promise-based delay.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ==========================================================================
   BOOT SCREEN — dynamically built loading screen
   --------------------------------------------------------------------------
   Constructed entirely in JS (no HTML changes required) and styled
   through CSS variables so it follows every theme automatically.
   ========================================================================== */

class BootScreen {
    /**
     * @param {Array<{label: string}>} stages
     */
    constructor(stages) {
        this.stages = stages;
        this.root = null;
        this.statusEl = null;
        this.fillEl = null;
        this.countEl = null;
    }

    /** Build and mount the boot screen. */
    show() {
        this.root = createElement("div", "boot-screen");
        setStyles(this.root, {
            position: "fixed",
            inset: "0",
            zIndex: "200",
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            padding: "var(--sp-5)",
            background: "var(--clr-bg-abyss)",
            backgroundImage: "var(--grad-page)",
            fontFamily: "var(--font-heading)",
        });

        /* Logo tile */
        const logo = createElement("div", "boot-logo");
        setStyles(logo, {
            width: "84px",
            height: "84px",
            margin: "0 auto var(--sp-5)",
            display: "grid",
            placeItems: "center",
            fontSize: "2.2rem",
            color: "var(--clr-cyan)",
            background: "var(--grad-accent-soft)",
            border: "1px solid var(--clr-border-cyan)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--glow-cyan)",
        });
        const logoIcon = createElement("i");
        logoIcon.className = "fa-solid fa-robot";
        logoIcon.setAttribute("aria-hidden", "true");
        logo.appendChild(logoIcon);
        addClass(logo, ANIMATION_CLASS.GLOW_CYAN, ANIMATION_CLASS.POP_IN);

        /* Wordmark */
        const wordmark = createElement("h1", "boot-wordmark");
        setText(wordmark, "MISSION CONTROL");
        setStyles(wordmark, {
            fontFamily: "var(--font-display)",
            fontSize: "clamp(1.6rem, 5vw, 2.4rem)",
            fontWeight: "700",
            letterSpacing: "var(--ls-wider)",
            color: "var(--clr-text-primary)",
            textShadow: "var(--glow-text-cyan)",
            margin: "0",
        });

        const tagline = createElement("p", "boot-tagline");
        setText(tagline, "Smart Survey Robot · ESP32 Platform");
        setStyles(tagline, {
            fontSize: "var(--fs-sm)",
            letterSpacing: "var(--ls-wider)",
            textTransform: "uppercase",
            color: "var(--clr-text-muted)",
            marginTop: "var(--sp-2)",
        });

        /* Progress track (determinate fill) */
        const track = createElement("div", "boot-progress-track");
        setStyles(track, {
            width: "min(420px, 80vw)",
            height: "4px",
            margin: "var(--sp-6) auto 0",
            overflow: "hidden",
            borderRadius: "var(--radius-pill)",
            background: "var(--clr-bg-elevated)",
            border: "1px solid var(--clr-border)",
        });

        this.fillEl = createElement("div", "boot-progress-fill");
        setStyles(this.fillEl, {
            height: "100%",
            width: "0%",
            borderRadius: "var(--radius-pill)",
            background: "var(--grad-accent)",
            boxShadow: "var(--glow-cyan)",
            transition: "width var(--dur-slow) var(--ease-smooth)",
        });
        track.appendChild(this.fillEl);

        /* Status line + stage counter */
        this.statusEl = createElement("p", "boot-status");
        this.statusEl.setAttribute("role", "status");
        this.statusEl.setAttribute("aria-live", "polite");
        setStyles(this.statusEl, {
            fontSize: "var(--fs-sm)",
            color: "var(--clr-cyan)",
            marginTop: "var(--sp-4)",
            minHeight: "1.4em",
        });

        this.countEl = createElement("p", "boot-stage-count");
        setStyles(this.countEl, {
            fontSize: "var(--fs-xs)",
            letterSpacing: "var(--ls-wide)",
            color: "var(--clr-text-muted)",
            marginTop: "var(--sp-1)",
        });

        /* Version footer */
        const version = createElement("p", "boot-version");
        setText(version, `v${CONFIG.APP.VERSION} · ${CONFIG.APP.ENVIRONMENT}`);
        setStyles(version, {
            position: "absolute",
            bottom: "var(--sp-5)",
            left: "0",
            right: "0",
            fontSize: "var(--fs-xs)",
            letterSpacing: "var(--ls-wide)",
            color: "var(--clr-text-disabled)",
        });

        const frame = createElement("div", "boot-frame");
        frame.setAttribute("role", "alertdialog");
        frame.setAttribute("aria-label", "Dashboard is loading");
        frame.append(logo, wordmark, tagline, track, this.statusEl, this.countEl);

        this.root.append(frame, version);
        document.body.appendChild(this.root);
        addClass(this.root, ANIMATION_CLASS.FADE_IN);
    }

    /**
     * Advance to a boot stage: updates progress fill, counter and label.
     * @param {number} index - stage index (0-based)
     */
    advance(index) {
        if (!this.root) return;
        const stage = this.stages[index];
        const percent = Math.round((index / (this.stages.length - 1)) * 100);
        this.fillEl.style.width = `${percent}%`;
        setText(this.statusEl, stage.label);
        setText(this.countEl, `Stage ${index + 1} / ${this.stages.length}`);
    }

    /**
     * Update only the status label (e.g., per-module progress).
     * @param {string} text
     */
    status(text) {
        if (this.statusEl) setText(this.statusEl, text);
    }

    /** Fade out and remove the boot screen. */
    async hide() {
        if (!this.root) return;
        addClass(this.root, ANIMATION_CLASS.FADE_OUT);
        await wait(CONFIG.UI.ANIMATION_NORMAL_MS + 60);
        removeElement(this.root);
        this.root = null;
    }

    /**
     * Show a fatal boot error with a recovery action.
     * @param {Error} error
     */
    fail(error) {
        if (!this.root) return;
        setStyles(this.statusEl, { color: "var(--clr-danger)" });
        setText(this.statusEl, `Boot failed — ${error.message || "unknown error"}`);
        if (this.countEl) setText(this.countEl, "The dashboard could not start.");
        this.fillEl.style.background = "var(--clr-danger)";

        const retry = createElement("button", "boot-retry", "btn", "btn-danger");
        setText(retry, "Reload Dashboard");
        setStyles(retry, { marginTop: "var(--sp-5)" });
        on(retry, "click", () => window.location.reload());
        this.statusEl.insertAdjacentElement("afterend", retry);
    }
}

/* ==========================================================================
   DASHBOARD CONTROLLER
   ========================================================================== */

class DashboardController {
    constructor() {
        /** @type {boolean} true once boot() completes successfully */
        this.isBooted = false;

        /** @type {boolean} guards concurrent page transitions */
        this.isTransitioning = false;

        /** @type {string} currently active page id */
        this.activePageId = "dashboard";

        /** @type {HTMLElement|null} the live card grid (detached on sub-pages) */
        this.gridEl = null;

        /** @type {HTMLElement|null} generated placeholder page panel */
        this.placeholderEl = null;

        /** @type {BootScreen} */
        this.bootScreen = new BootScreen(BOOT_STAGES);

        /** @type {number|null} clock interval handle */
        this.clockIntervalId = null;

        /** @type {Function[]} event unsubscriber functions */
        this.unsubscribers = [];

        /** @type {Array<{id: string, status: string}>} module init results */
        this.moduleResults = [];

        /** @type {Object<string, HTMLElement|null>} cached DOM nodes */
        this.elements = {};
    }

    /* ======================================================================
       STARTUP / BOOT SEQUENCE
       ====================================================================== */

    /**
     * Main entry point — runs the full boot sequence behind the
     * loading screen. Safe to call multiple times (no-op after boot).
     */
    async boot() {
        if (this.isBooted) return;

        this.cacheElements();
        this.bootScreen.show();

        try {
            await this.runStage(0, () => this.validateConfiguration());
            await this.runStage(1, () => this.initCoreSystems());
            await this.runStage(2, () => this.initModules());
            await this.runStage(3, () => this.loadDashboard());

            /* Final stage: let the "ready" state paint, then dismiss */
            this.bootScreen.advance(4);
            await wait(CONFIG.UI.ANIMATION_SLOW_MS);
            await this.bootScreen.hide();

            this.isBooted = true;
            Logger.info(TAG, `Mission Control ready — v${CONFIG.APP.VERSION}`);
            this.focusMainContent();
        } catch (error) {
            Logger.error(TAG, "Boot sequence failed:", error);
            this.bootScreen.fail(error);
        }
    }

    /**
     * Runs one boot stage: advances the loading screen, then executes.
     * @param {number} index
     * @param {Function} task
     */
    async runStage(index, task) {
        this.bootScreen.advance(index);
        /* Yield a frame so the boot screen paints before sync work */
        await wait(80);
        await task.call(this);
    }

    /** Stage 1 — verify configuration integrity. */
    validateConfiguration() {
        const valid = validateConfig();
        if (!valid) {
            throw new Error("application configuration is incomplete");
        }
        Logger.info(TAG, `Environment: ${CONFIG.APP.ENVIRONMENT} · build ${CONFIG.APP.BUILD_DATE}`);
    }

    /** Stage 2 — clock, sidebar, navigation, system event wiring. */
    initCoreSystems() {
        this.startClock();
        this.initSidebarToggle();
        this.initPageTransitions();
        this.subscribeToSystemEvents();
        Logger.debug(TAG, "Core systems initialized");
    }

    /** Cache frequently used DOM nodes once. */
    cacheElements() {
        this.elements = {
            headerDate: getElementByID(ELEMENT_ID.HEADER_DATE),
            headerTime: getElementByID(ELEMENT_ID.HEADER_TIME),
            statusRobot: getElementByID(ELEMENT_ID.STATUS_ROBOT),
            statusRobotValue: getElementByID(ELEMENT_ID.STATUS_ROBOT_VALUE),
            statusWifi: getElementByID(ELEMENT_ID.STATUS_WIFI),
            statusWifiValue: getElementByID(ELEMENT_ID.STATUS_WIFI_VALUE),
            statusBluetooth: getElementByID(ELEMENT_ID.STATUS_BLUETOOTH),
            statusBluetoothValue: getElementByID(ELEMENT_ID.STATUS_BLUETOOTH_VALUE),
            connectionIndicator: getElementByID(ELEMENT_ID.CONNECTION_INDICATOR),
            connectionText: getElementByID(ELEMENT_ID.CONNECTION_TEXT),
            mainContent: getElementByID(ELEMENT_ID.MAIN_CONTENT),
            pageTitle: getElementByID(ELEMENT_ID.PAGE_TITLE),
            pageSubtitle: getElementByID(ELEMENT_ID.PAGE_SUBTITLE),
            sidebar: getElementByID(ELEMENT_ID.APP_SIDEBAR),
            sidebarToggle: getElementByID(ELEMENT_ID.SIDEBAR_TOGGLE),
            brandLogo: query(".brand-logo"),
        };
    }

    /* ======================================================================
       MODULE INITIALIZATION
       ====================================================================== */

    /**
     * Stage 3 — lazily import and initialize every registered module.
     * Failures are isolated per module so one broken module never
     * blocks the dashboard.
     */
    async initModules() {
        const total = MODULE_REGISTRY.length;

        for (let i = 0; i < total; i++) {
            const descriptor = MODULE_REGISTRY[i];
            this.bootScreen.status(`Loading modules — ${descriptor.name} (${i + 1}/${total})`);
            this.moduleResults.push(await this.initModule(descriptor));
            await wait(40); /* let the boot screen repaint between modules */
        }

        this.logModuleSummary();
    }

    /**
     * Initialize a single module from its descriptor.
     * @param {Object} descriptor - MODULE_REGISTRY entry
     * @returns {Promise<{id: string, status: string}>}
     */
    async initModule(descriptor) {
        /* Feature-flag gate */
        if (descriptor.featureKey && !CONFIG.FEATURES[descriptor.featureKey]) {
            Logger.debug(TAG, `Module disabled by feature flag: ${descriptor.id}`);
            return { id: descriptor.id, status: "disabled" };
        }

        try {
            const namespace = await import(descriptor.path);
            const instance = this.resolveModuleInstance(namespace);

            /* Placeholder modules export nothing yet — they stay on standby */
            if (!instance) {
                return { id: descriptor.id, status: "standby" };
            }

            if (is.function(instance.init)) {
                await instance.init({ config: CONFIG, events: document, page: descriptor.id });
            }
            Logger.info(TAG, `Module ready: ${descriptor.id}`);
            return { id: descriptor.id, status: "ready" };
        } catch (error) {
            Logger.error(TAG, `Module failed to initialize: ${descriptor.id}`, error);
            return { id: descriptor.id, status: "error" };
        }
    }

    /**
     * Detect the module shape inside an imported namespace.
     * Supports: default object · named create* factory · named init().
     * @param {Object} namespace - dynamic import result
     * @returns {Object|null}
     */
    resolveModuleInstance(namespace) {
        if (namespace.default && is.object(namespace.default)) {
            return namespace.default;
        }

        const factoryName = Object.keys(namespace).find(
            (key) => key.startsWith("create") && is.function(namespace[key])
        );
        if (factoryName) {
            return namespace[factoryName]();
        }

        if (is.function(namespace.init)) {
            return { init: namespace.init };
        }

        return null;
    }

    /** Log an aggregate of module initialization results. */
    logModuleSummary() {
        const summary = this.moduleResults.reduce(
            (acc, result) => {
                acc[result.status] = (acc[result.status] || 0) + 1;
                return acc;
            },
            { ready: 0, standby: 0, disabled: 0, error: 0 }
        );

        Logger.info(
            TAG,
            `Modules — ready: ${summary.ready} · standby: ${summary.standby} · ` +
            `disabled: ${summary.disabled} · failed: ${summary.error}`
        );
    }

    /* ======================================================================
       DASHBOARD LOAD
       ====================================================================== */

    /** Stage 4 — first paint of the dashboard view. */
    loadDashboard() {
        this.tickClock();

        this.gridEl = getElementByID(ELEMENT_ID.CARD_GRID);
        this.applyPageMeta(PAGE_REGISTRY[0], { animate: false });

        emit(document, EVENT["page:loaded"], { pageId: "dashboard" });
        Logger.debug(TAG, "Dashboard view loaded");
    }

    /* ======================================================================
       CLOCK
       ====================================================================== */

    /** Start the header clock (1s tick). */
    startClock() {
        this.tickClock();
        this.clockIntervalId = setInterval(() => this.tickClock(), 1000);
    }

    /** Paint current date & time into the header. */
    tickClock() {
        setText(this.elements.headerTime, getCurrentTime());
        setText(this.elements.headerDate, getCurrentDate());
        attr(this.elements.headerTime, "datetime", new Date().toISOString());
    }

    /* ======================================================================
       SIDEBAR (mobile drawer + toggle button)
       ====================================================================== */

    /** Wire the Escape key and resize auto-close.
     *  NOTE: hamburger click ownership moved to app.js (Instagram-style
     *  drawer + scrim + desktop rail). Binding it here too caused a
     *  double-toggle that cancelled itself out — the "dead hamburger" bug. */
    initSidebarToggle() {
        if (!this.elements.sidebarToggle || !this.elements.sidebar) return;

        this.unsubscribers.push(
            on(document, "keydown", (event) => {
                if (event.key === "Escape") this.closeSidebar();
            })
        );

        this.unsubscribers.push(
            on(window, "resize", debounce(() => {
                if (window.innerWidth > BREAKPOINT.MOBILE) this.closeSidebar();
            }, CONFIG.UI.RESIZE_DEBOUNCE_MS))
        );
    }

    /** Toggle the off-canvas drawer (mobile breakpoints). */
    toggleSidebar() {
        const open = !hasClass(this.elements.sidebar, CSS_CLASS.SIDEBAR_OPEN);
        toggleClass(this.elements.sidebar, CSS_CLASS.SIDEBAR_OPEN, open);
        attr(this.elements.sidebarToggle, "aria-expanded", String(open));
    }

    /** Close the drawer if open. */
    closeSidebar() {
        if (!this.elements.sidebar) return;
        toggleClass(this.elements.sidebar, CSS_CLASS.SIDEBAR_OPEN, false);
        if (this.elements.sidebarToggle) {
            attr(this.elements.sidebarToggle, "aria-expanded", "false");
        }
    }

    /* ======================================================================
       PAGE TRANSITIONS
       ====================================================================== */

    /** Bind navigation links to the transition pipeline. */
    initPageTransitions() {
        const links = queryAll(".nav-link");
        links.forEach((link) => {
            this.unsubscribers.push(
                on(link, "click", (event) => {
                    event.preventDefault();
                    const pageId = link.dataset.page;
                    if (pageId) this.navigateTo(pageId);
                })
            );
        });
    }

    /**
     * Animated navigation between pages.
     * router.js (later part) may also invoke this method.
     * @param {string} pageId - id from PAGE_REGISTRY
     * @param {{animate?: boolean}} options
     */
    async navigateTo(pageId, { animate = true } = {}) {
        const meta = PAGE_REGISTRY.find((page) => page.id === pageId);
        if (!meta) {
            Logger.warn(TAG, `Unknown navigation target: ${pageId}`);
            return;
        }

        /* Same page → just scroll home */
        if (pageId === this.activePageId) {
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
        }

        if (this.isTransitioning) return;
        this.isTransitioning = true;
        this.elements.mainContent.setAttribute("aria-busy", "true");

        const swap = () => {
            this.activePageId = pageId;
            document.body.dataset.activePage = pageId;
            this.updateNavState(pageId);
            this.applyPageMeta(meta, { animate: true });
            this.renderPageContent(meta);
            history.replaceState(null, "", `#page-${pageId}`);
        };

        if (!animate) {
            swap();
            this.finishTransition();
            return;
        }

        /* Out → swap → in */
        addClass(this.elements.mainContent, ANIMATION_CLASS.FADE_OUT);
        await wait(CONFIG.UI.ANIMATION_NORMAL_MS);

        swap();
        removeClass(this.elements.mainContent, ANIMATION_CLASS.FADE_OUT);
        addClass(this.elements.mainContent, ANIMATION_CLASS.FADE_IN_UP);
        window.scrollTo({ top: 0 });

        await wait(CONFIG.UI.ANIMATION_SLOW_MS);
        removeClass(this.elements.mainContent, ANIMATION_CLASS.FADE_IN_UP);

        this.finishTransition();
        emit(document, EVENT["page:change"], { pageId });
    }

    /** Reset transition guards and ARIA state. */
    finishTransition() {
        this.isTransitioning = false;
        this.elements.mainContent.removeAttribute("aria-busy");
    }

    /**
     * Move the active state between nav links.
     * @param {string} pageId
     */
    updateNavState(pageId) {
        queryAll(".nav-link").forEach((link) => {
            const active = link.dataset.page === pageId;
            toggleClass(link, CSS_CLASS.NAV_ACTIVE, active);
            if (active) {
                link.setAttribute("aria-current", "page");
            } else {
                link.removeAttribute("aria-current");
            }
        });
        this.closeSidebar();
    }

    /**
     * Update page title, subtitle and document title.
     * @param {Object} meta - PAGE_REGISTRY entry
     * @param {{animate?: boolean}} options
     */
    applyPageMeta(meta, { animate = true } = {}) {
        if (animate) {
            this.animateElement(this.elements.pageTitle, ANIMATION_CLASS.FADE_IN_UP);
            this.animateElement(this.elements.pageSubtitle, ANIMATION_CLASS.FADE_IN_UP);
        }
        setText(this.elements.pageTitle, meta.title);
        setText(this.elements.pageSubtitle, meta.subtitle);
        document.title = `${meta.title} | Mission Control`;
    }

    /**
     * Swap main content: card grid on dashboard, generated
     * placeholder panel on every other page (until modules ship).
     * The grid node is detached — never destroyed — so module state
     * inside cards survives navigation.
     * @param {Object} meta - PAGE_REGISTRY entry
     */
    renderPageContent(meta) {
        if (meta.id === "dashboard") {
            if (this.placeholderEl) {
                removeElement(this.placeholderEl);
                this.placeholderEl = null;
            }
            if (this.gridEl && !this.gridEl.isConnected) {
                this.elements.mainContent.appendChild(this.gridEl);
            }
            this.clearCardFocus();
            return;
        }

        /* Shipped modules render their real card in a focused view. */
        if (this.isModuleReady(meta.id)) {
            if (this.placeholderEl) {
                removeElement(this.placeholderEl);
                this.placeholderEl = null;
            }
            if (this.gridEl && !this.gridEl.isConnected) {
                this.elements.mainContent.appendChild(this.gridEl);
            }
            this.applyCardFocus(meta.id);
            return;
        }

        if (this.gridEl && this.gridEl.isConnected) {
            this.gridEl.remove();
        }
        if (this.placeholderEl) {
            this.placeholderEl.remove();
        }
        this.placeholderEl = this.buildPlaceholderPage(meta);
        this.elements.mainContent.appendChild(this.placeholderEl);
    }

    /**
     * True when the module for a page initialized successfully this boot.
     * @param {string} pageId
     * @returns {boolean}
     */
    isModuleReady(pageId) {
        return this.moduleResults.some(
            (result) => result.id === pageId && result.status === "ready"
        );
    }

    /**
     * Single-card focused view: keep the grid mounted (so module state,
     * e.g. a running webcam, survives) and reveal only the target card.
     * @param {string} pageId
     */
    applyCardFocus(pageId) {
        const entry = MODULE_REGISTRY.find((mod) => mod.id === pageId);
        const card = entry && entry.elementId ? getElementByID(entry.elementId) : null;
        if (!card) return;

        this.elements.mainContent.setAttribute("data-focus-page", pageId);
        queryAll(".card", this.gridEl).forEach((node) => {
            toggleClass(node, CSS_CLASS.CARD_FOCUSED, node === card);
        });
    }

    /** Restore the full grid when returning to the dashboard. */
    clearCardFocus() {
        this.elements.mainContent.removeAttribute("data-focus-page");
        queryAll(".card", this.gridEl).forEach((node) => {
            toggleClass(node, CSS_CLASS.CARD_FOCUSED, false);
        });
    }

    /**
     * Build the "module pending" panel for pages whose feature
     * module has not shipped yet. Reuses card styles from style.css.
     * @param {Object} meta - PAGE_REGISTRY entry
     * @returns {HTMLElement}
     */
    buildPlaceholderPage(meta) {
        const panel = createElement("section", `placeholder-page-${meta.id}`, "card");
        panel.setAttribute("aria-labelledby", `placeholder-title-${meta.id}`);
        setStyles(panel, { maxWidth: "680px", margin: "0 auto" });

        /* Header */
        const header = createElement("header", undefined, "card-header");
        const title = createElement("h2", `placeholder-title-${meta.id}`, "card-title");
        const icon = createElement("i", undefined, "card-icon", meta.icon, "fa-solid");
        icon.setAttribute("aria-hidden", "true");
        title.appendChild(icon);
        title.appendChild(document.createTextNode(meta.title));
        const badge = createElement("span", undefined, "card-badge", "badge-neutral");
        setText(badge, "Phase Pending");
        header.append(title, badge);

        /* Body */
        const body = createElement("div", undefined, "card-body");
        const description = createElement("p", undefined, "card-description");
        setText(description, meta.placeholder || "This module activates in a later build phase.");

        const dots = createElement("span", undefined, "loader-dots");
        dots.setAttribute("aria-hidden", "true");
        for (let i = 0; i < 3; i++) dots.appendChild(createElement("i"));

        const back = createElement("button", undefined, "btn", "btn-ghost");
        setText(back, "Return to Dashboard");
        setStyles(back, { alignSelf: "flex-start" });
        on(back, "click", () => this.navigateTo("dashboard"));

        body.append(description, dots, back);

        /* Footer */
        const footer = createElement("footer", undefined, "card-footer");
        const footerMeta = createElement("span", undefined, "card-meta");
        setText(footerMeta, `Module ${meta.id}.js · scheduled for a future build phase`);
        footer.appendChild(footerMeta);

        panel.append(header, body, footer);
        addClass(panel, ANIMATION_CLASS.SCALE_IN);
        return panel;
    }

    /**
     * Restart a CSS animation on an element (reflow trick).
     * @param {HTMLElement} el
     * @param {string} className - ANIMATION_CLASS value
     */
    animateElement(el, className) {
        if (!is.element(el)) return;
        removeClass(el, className);
        void el.offsetWidth; /* force reflow to restart the animation */
        addClass(el, className);
        setTimeout(() => removeClass(el, className), CONFIG.UI.ANIMATION_SLOW_MS + 100);
    }

    /* ======================================================================
       SYSTEM EVENT SUBSCRIPTIONS (UI only — no connectivity logic)
       ====================================================================== */

    /**
     * Listen for system events emitted by future services/managers
     * and reflect them in the header status cluster.
     */
    subscribeToSystemEvents() {
        const listen = (name, handler) => {
            this.unsubscribers.push(on(document, name, handler));
        };

        listen(EVENT["connection:connected"], () => {
            this.setStatusPill("statusWifi", "online", "Connected", "WiFi");
            this.setConnectionIndicator(true);
        });

        listen(EVENT["connection:disconnected"], () => {
            this.setStatusPill("statusWifi", "offline", "Disconnected", "WiFi");
            this.setConnectionIndicator(false);
        });

        listen(EVENT["connection:bluetooth:paired"], () => {
            this.setStatusPill("statusBluetooth", "online", "Paired", "Bluetooth");
        });

        listen(EVENT["connection:bluetooth:lost"], () => {
            this.setStatusPill("statusBluetooth", "offline", "Disconnected", "Bluetooth");
        });

        listen(EVENT["robot:online"], () => {
            this.setStatusPill("statusRobot", "online", "Online", "Robot");
            this.animateElement(this.elements.statusRobot, ANIMATION_CLASS.ROBOT_ONLINE);
            this.animateElement(this.elements.brandLogo, ANIMATION_CLASS.ROBOT_WAKE);
        });

        listen(EVENT["robot:offline"], () => {
            this.setStatusPill("statusRobot", "offline", "Offline", "Robot");
        });

        listen(EVENT["robot:battery:low"], () => {
            this.setStatusPill("statusRobot", "warning", "Low Battery", "Robot");
        });
    }

    /**
     * Update one header status pill.
     * @param {"statusRobot"|"statusWifi"|"statusBluetooth"} pillKey
     * @param {"online"|"offline"|"warning"} state
     * @param {string} valueText
     * @param {string} label - human label for ARIA
     */
    setStatusPill(pillKey, state, valueText, label) {
        const pill = this.elements[pillKey];
        const valueEl = this.elements[`${pillKey}Value`];
        if (!pill || !valueEl) return;

        removeClass(pill, CSS_CLASS.STATUS_ONLINE, CSS_CLASS.STATUS_OFFLINE, CSS_CLASS.STATUS_WARNING);
        addClass(pill, CSS_CLASS[`STATUS_${state.toUpperCase()}`]);
        setText(valueEl, valueText);
        pill.setAttribute("aria-label", `${label} status: ${valueText}`);
    }

    /**
     * Update the master connection indicator.
     * @param {boolean} connected
     */
    setConnectionIndicator(connected) {
        const indicator = this.elements.connectionIndicator;
        if (!indicator) return;

        toggleClass(indicator, CSS_CLASS.CONNECTION_CONNECTED, connected);
        toggleClass(indicator, CSS_CLASS.CONNECTION_DISCONNECTED, !connected);
        setText(this.elements.connectionText, connected ? "Link Active" : "No Link");
        indicator.setAttribute(
            "aria-label",
            connected ? "Overall connection: link active" : "Overall connection: no active link"
        );
    }

    /* ======================================================================
       ACCESSIBILITY & TEARDOWN
       ====================================================================== */

    /** Move keyboard focus into the main region after boot. */
    focusMainContent() {
        if (!this.elements.mainContent) return;
        this.elements.mainContent.tabIndex = -1;
        this.elements.mainContent.focus({ preventScroll: true });
    }

    /** Full teardown — stops timers and detaches every listener. */
    destroy() {
        if (this.clockIntervalId) {
            clearInterval(this.clockIntervalId);
            this.clockIntervalId = null;
        }
        this.unsubscribers.forEach((unlisten) => unlisten());
        this.unsubscribers = [];
        if (this.bootScreen.root) this.bootScreen.hide();
        this.isBooted = false;
        Logger.info(TAG, "Dashboard controller destroyed");
    }
}

/* ==========================================================================
   SINGLETON & AUTO-BOOT
   ========================================================================== */

const dashboardController = new DashboardController();

/** Boot as soon as the DOM is available (modules are already deferred). */
function bootWhenReady() {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => dashboardController.boot(), { once: true });
    } else {
        dashboardController.boot();
    }
}

bootWhenReady();

/* Public API for router.js / app.js (Part 7+) */
export default dashboardController;
export { DashboardController, PAGE_REGISTRY, MODULE_REGISTRY, BOOT_STAGES };
