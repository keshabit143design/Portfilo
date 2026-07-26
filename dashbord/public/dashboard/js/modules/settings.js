/**
 * ============================================================================
 * MISSION CONTROL — SMART SURVEY ROBOT — modules/settings.js
 * ----------------------------------------------------------------------------
 * Dashboard Settings Module
 *
 * Capabilities
 *   • Theme switching (Dark, Light, Cyberpunk)
 *   • Language selection
 *   • Keyboard shortcuts reference
 *   • Connection settings configuration (WiFi/Bluetooth)
 *   • Developer mode toggle
 *   • Reset dashboard to defaults
 *   • About panel with version info
 *
 * Registered at: window.Sarathi.Modules["settings"]
 * ============================================================================
 */

(function (global) {
    "use strict";

    global.Sarathi = global.Sarathi || {};
    global.Sarathi.Modules = global.Sarathi.Modules || {};

    const Config = global.Sarathi.Config || {};
    const Constants = global.Sarathi.Constants || {};
    const Utils = global.Sarathi.Utils || {};
    const log = Utils.logger || console;

    const MODULE_ID = Constants.MODULES?.SETTINGS || "settings";

    const THEMES = Constants.THEMES || {
        DARK: "theme-dark",
        LIGHT: "theme-light",
        CYBERPUNK: "theme-cyberpunk"
    };

    const LOCAL_EVENTS = {
        THEME_CHANGED: "sarathi:settings:theme-changed",
        RESET: "sarathi:settings:reset"
    };

    /**
     * @class SettingsModule
     * @description Central dashboard configuration and preferences.
     */
    class SettingsModule {
        constructor() {
            this._initialized = false;

            /** @private @type {string} */
            this._activeTheme = THEMES.DARK;

            /** @private @type {string} */
            this._language = "en-US";

            /** @private @type {boolean} */
            this._developerMode = Config.app?.debug || false;

            /** @private @type {Object} */
            this._connectionSettings = {
                wifi: {
                    host: Config.network?.wifi?.defaultHost || "192.168.4.1",
                    port: Config.network?.wifi?.defaultPort || 81,
                    autoReconnect: true,
                    reconnectDelay: Config.network?.wifi?.reconnectDelayMs || 3000
                },
                bluetooth: {
                    autoPair: false,
                    deviceName: Config.network?.bluetooth?.devicePrefix || "SARATHI_"
                }
            };

            /** @private @type {Array<Function>} */
            this._cleanupHandlers = [];

            /** @private */
            this._elements = {
                body: null,
                panel: null,
                btnOpen: null,
                btnClose: null,
                themeSelect: null,
                langSelect: null,
                devToggle: null,
                wifiHostInput: null,
                wifiPortInput: null,
                wifiReconnectToggle: null,
                bleDeviceInput: null,
                bleAutoPairToggle: null,
                btnReset: null,
                aboutPanel: null,
                shortcutsList: null
            };
        }

        /* ==================================================================
         * LIFECYCLE
         * ================================================================== */

        async init() {
            if (this._initialized) return true;

            /* Settings has no dashboard card — it is a modal appended to
               <body> and opened from the header gear. Fall back to a
               detached host so the module still initializes (previously
               it bailed here, leaving the gear button dead). */
            this._elements.body =
                Utils.byId?.("settings-body") || document.createElement("div");
            this._elements.panel = Utils.byId?.("settings-panel");
            this._elements.btnOpen = Utils.byId?.("header-settings-btn");

            log.info("Initializing settings module...");

            try {
                this._loadPreferences();
                this._buildInterface();
                this._buildAboutPanel();
                this._bindEvents();
                this._applyTheme();
                this._syncUI();

                this._initialized = true;
                return true;
            } catch (error) {
                log.error("Settings initialization failed:", error);
                return false;
            }
        }

        dispose() {
            while (this._cleanupHandlers.length > 0) {
                const off = this._cleanupHandlers.pop();
                if (typeof off === "function") {
                    try { off(); } catch (_) { /* noop */ }
                }
            }
            this._savePreferences();
            this._initialized = false;
        }

        /* ==================================================================
         * PUBLIC API
         * ================================================================== */

        /**
         * Open the settings panel.
         */
        open() {
            const panel = this._elements.panel;
            if (panel && panel.hidden) {
                panel.hidden = false;
                this._showTab("general");
            }
        }

        /**
         * Close the settings panel.
         */
        close() {
            const panel = this._elements.panel;
            if (panel && !panel.hidden) {
                panel.hidden = true;
            }
        }

        /**
         * Toggle the settings panel.
         */
        toggle() {
            const panel = this._elements.panel;
            if (!panel) return;

            panel.hidden = !panel.hidden;
            if (!panel.hidden) {
                this._showTab("general");
            }
        }

        /**
         * Set active theme.
         * @param {string} theme - Theme identifier
         */
        setTheme(theme) {
            const validThemes = Object.values(THEMES);
            if (!validThemes.includes(theme)) {
                log.warn(`Invalid theme: ${theme}. Falling back to default.`);
                theme = THEMES.DARK;
            }

            this._activeTheme = theme;
            this._applyTheme();
            this._savePreferences();
            Utils.dispatch?.(LOCAL_EVENTS.THEME_CHANGED, { theme });
            return true;
        }

        /**
         * Get current settings.
         * @returns {Object}
         */
        getSettings() {
            return {
                theme: this._activeTheme,
                language: this._language,
                developerMode: this._developerMode,
                connection: { ...this._connectionSettings }
            };
        }

        /**
         * Reset dashboard to default settings.
         */
        resetDashboard() {
            if (!global.confirm("Reset all dashboard settings to defaults? This cannot be undone.")) {
                return;
            }

            this._activeTheme = THEMES.DARK;
            this._language = "en-US";
            this._developerMode = false;
            this._connectionSettings = {
                wifi: {
                    host: Config.network?.wifi?.defaultHost || "192.168.4.1",
                    port: Config.network?.wifi?.defaultPort || 81,
                    autoReconnect: true,
                    reconnectDelay: 3000
                },
                bluetooth: {
                    autoPair: false,
                    deviceName: Config.network?.bluetooth?.devicePrefix || "SARATHI_"
                }
            };

            this._applyTheme();
            this._savePreferences();
            this._syncUI();
            this._flashStatus("Dashboard reset to defaults.");

            Utils.dispatch?.(LOCAL_EVENTS.RESET, { module: MODULE_ID });
        }

        /* ==================================================================
         * INTERFACE CONSTRUCTION
         * ================================================================== */

        /** @private */
        _buildInterface() {
            const body = this._elements.body;
            const placeholder = body.querySelector('[data-module="settings"]');
            if (placeholder) placeholder.remove();

            /* Create settings panel (modal) */
            const panel = Utils.createElement("div", {
                classes: "settings-panel",
                attributes: { id: "settings-panel", role: "dialog", "aria-modal": "true", hidden: "true" }
            });

            const header = Utils.createElement("div", { classes: "settings-panel-header" });
            const title = Utils.createElement("h3", { classes: "settings-panel-title", text: "Dashboard Settings" });
            const btnClose = Utils.createElement("button", {
                classes: ["btn-icon", "settings-close"],
                attributes: { type: "button", "aria-label": "Close settings" },
                html: '<i class="fa-solid fa-times" aria-hidden="true"></i>'
            });
            header.append(title, btnClose);

            const tabs = Utils.createElement("div", { classes: "settings-tabs" });
            const tabGeneral = this._createTabButton("general", "fa-gear", "General");
            const tabConnection = this._createTabButton("connection", "fa-network-wired", "Connection");
            const tabShortcuts = this._createTabButton("shortcuts", "fa-keyboard", "Shortcuts");
            const tabAbout = this._createTabButton("about", "fa-circle-info", "About");
            tabs.append(tabGeneral, tabConnection, tabShortcuts, tabAbout);

            const content = Utils.createElement("div", { classes: "settings-content" });

            /* General Tab */
            const tabGeneralContent = this._createTabContent("general");
            const themeSection = this._createSection("Theme");
            const themeSelect = this._createSelect("theme", Object.values(THEMES).map((t) => ({
                value: t,
                label: t.replace("theme-", "").replace(/^\w/, (c) => c.toUpperCase())
            })), THEMES.DARK);
            themeSection.querySelector(".settings-section-content").appendChild(themeSelect);

            const langSection = this._createSection("Language");
            const langSelect = this._createSelect("language", [
                { value: "en-US", label: "English (US)" },
                { value: "en-GB", label: "English (UK)" },
                { value: "es-ES", label: "Español" },
                { value: "fr-FR", label: "Français" },
                { value: "de-DE", label: "Deutsch" }
            ], "en-US");
            langSection.querySelector(".settings-section-content").appendChild(langSelect);

            const devSection = this._createSection("Developer Mode");
            const devToggle = this._createToggle("developer-mode", "Enable debug console output", this._developerMode);
            devSection.querySelector(".settings-section-content").appendChild(devToggle);

            const resetSection = this._createSection("Reset Dashboard");
            const btnReset = Utils.createElement("button", {
                classes: ["btn", "btn-danger", "settings-reset-btn"],
                attributes: { type: "button" },
                html: '<i class="fa-solid fa-rotate" aria-hidden="true"></i><span>Reset All Settings</span>'
            });
            resetSection.querySelector(".settings-section-content").appendChild(btnReset);

            tabGeneralContent.append(themeSection, langSection, devSection, resetSection);

            /* Connection Tab */
            const tabConnectionContent = this._createTabContent("connection");

            const wifiSection = this._createSection("WiFi Settings");
            const wifiForm = Utils.createElement("div", { classes: "settings-form" });
            const hostRow = this._createInputRow("Host", "wifi-host", "text", this._connectionSettings.wifi.host, "Robot WiFi IP address");
            const portRow = this._createInputRow("Port", "wifi-port", "number", String(this._connectionSettings.wifi.port), "WebSocket port");
            const reconnectRow = this._createToggleRow("Auto Reconnect", "wifi-reconnect", "Automatically reconnect on disconnection", this._connectionSettings.wifi.autoReconnect);
            const delayRow = this._createInputRow("Reconnect Delay (ms)", "wifi-delay", "number", String(this._connectionSettings.wifi.reconnectDelay), "Delay between reconnection attempts");
            wifiForm.append(hostRow, portRow, reconnectRow, delayRow);
            wifiSection.querySelector(".settings-section-content").appendChild(wifiForm);

            const bleSection = this._createSection("Bluetooth Settings");
            const bleForm = Utils.createElement("div", { classes: "settings-form" });
            const deviceRow = this._createInputRow("Device Name", "ble-device", "text", this._connectionSettings.bluetooth.deviceName, "Bluetooth device identifier prefix");
            const autoPairRow = this._createToggleRow("Auto Pair", "ble-autopair", "Automatically pair on connection", this._connectionSettings.bluetooth.autoPair);
            bleForm.append(deviceRow, autoPairRow);
            bleSection.querySelector(".settings-section-content").appendChild(bleForm);

            tabConnectionContent.append(wifiSection, bleSection);

            /* Shortcuts Tab */
            const tabShortcutsContent = this._createTabContent("shortcuts");
            const shortcutsList = Utils.createElement("div", { classes: "settings-shortcuts-list" });
            const shortcuts = [
                { keys: ["↑", "W"], action: "Move Forward" },
                { keys: ["↓", "S"], action: "Move Backward" },
                { keys: ["←", "A"], action: "Turn Left" },
                { keys: ["→", "D"], action: "Turn Right" },
                { keys: ["Space"], action: "Stop / Emergency Stop" },
                { keys: ["Ctrl+Z"], action: "Undo" },
                { keys: ["Ctrl+Y"], action: "Redo" },
                { keys: ["Esc"], action: "Close Panel / Cancel" }
            ];

            shortcuts.forEach((shortcut) => {
                const item = this._createShortcutItem(shortcut.keys.join(" / "), shortcut.action);
                shortcutsList.appendChild(item);
            });

            const shortcutsSection = this._createSection("Keyboard Shortcuts");
            shortcutsSection.querySelector(".settings-section-content").appendChild(shortcutsList);
            tabShortcutsContent.appendChild(shortcutsSection);

            /* About Tab - will be populated by _buildAboutPanel */
            const tabAboutContent = this._createTabContent("about");

            content.append(tabGeneralContent, tabConnectionContent, tabShortcutsContent, tabAboutContent);
            panel.append(header, tabs, content);

            /* Insert panel into body or document */
            document.body.appendChild(panel);

            Object.assign(this._elements, {
                panel,
                btnClose,
                themeSelect,
                langSelect,
                devToggle,
                wifiHostInput: hostRow.querySelector("input"),
                wifiPortInput: portRow.querySelector("input"),
                wifiReconnectToggle: reconnectRow.querySelector("input"),
                bleDeviceInput: deviceRow.querySelector("input"),
                bleAutoPairToggle: autoPairRow.querySelector("input"),
                btnReset,
                aboutPanel: tabAboutContent
            });
        }

        /** @private */
        _buildAboutPanel() {
            const aboutPanel = this._elements.aboutPanel;
            if (!aboutPanel) return;

            const versionSection = this._createSection("Version");
            const versionValue = Utils.createElement("p", {
                classes: "settings-about-value",
                text: `${Config.app?.name || "Mission Control"} v${Config.app?.version || "1.0.0"}`
            });
            versionSection.querySelector(".settings-section-content").appendChild(versionValue);

            const teamSection = this._createSection("Team");
            const teamValue = Utils.createElement("p", {
                classes: "settings-about-value",
                text: Config.app?.team || "Mission Control Robotics Team"
            });
            teamSection.querySelector(".settings-section-content").appendChild(teamValue);

            const linksSection = this._createSection("Links");
            const linksList = Utils.createElement("div", { classes: "settings-links-list" });

            const websiteLink = Utils.createElement("a", {
                classes: "settings-link-item",
                attributes: { href: Config.app?.website || "#", target: "_blank", rel: "noopener noreferrer" },
                html: '<i class="fa-solid fa-globe" aria-hidden="true"></i><span>Project Website</span>'
            });

            const githubLink = Utils.createElement("a", {
                classes: "settings-link-item",
                attributes: { href: Config.app?.github || "#", target: "_blank", rel: "noopener noreferrer" },
                html: '<i class="fa-brands fa-github" aria-hidden="true"></i><span>GitHub Repository</span>'
            });

            const supportLink = Utils.createElement("a", {
                classes: "settings-link-item",
                attributes: { href: `mailto:${Config.app?.supportEmail || "#"}` },
                html: '<i class="fa-solid fa-envelope" aria-hidden="true"></i><span>Contact Support</span>'
            });

            linksList.append(websiteLink, githubLink, supportLink);
            linksSection.querySelector(".settings-section-content").appendChild(linksList);

            const copyrightSection = this._createSection("Copyright");
            const copyrightValue = Utils.createElement("p", {
                classes: "settings-about-value",
                text: "© 2025 Mission Control. All rights reserved."
            });
            copyrightSection.querySelector(".settings-section-content").appendChild(copyrightValue);

            aboutPanel.append(versionSection, teamSection, linksSection, copyrightSection);
        }

        /** @private */
        _createTabButton(id, icon, label) {
            const btn = Utils.createElement("button", {
                classes: ["settings-tab-btn"],
                attributes: { type: "button", "data-tab": id, "aria-label": label },
                html: `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span>`
            });
            return btn;
        }

        /** @private */
        _createTabContent(id) {
            const content = Utils.createElement("div", {
                classes: ["settings-tab-content"],
                attributes: { id: `settings-tab-${id}`, "data-tab": id, hidden: "true" }
            });
            return content;
        }

        /** @private */
        _createSection(title) {
            const section = Utils.createElement("div", { classes: "settings-section" });
            const header = Utils.createElement("h4", { classes: "settings-section-title", text: title });
            const content = Utils.createElement("div", { classes: "settings-section-content" });
            section.append(header, content);
            return section;
        }

        /** @private */
        _createSelect(id, options, selectedValue) {
            const select = Utils.createElement("select", {
                classes: "settings-select",
                attributes: { id: `settings-${id}`, "aria-label": id }
            });

            options.forEach((option) => {
                const opt = Utils.createElement("option", {
                    attributes: { value: option.value },
                    text: option.label
                });
                if (option.value === selectedValue) {
                    opt.setAttribute("selected", "");
                }
                select.appendChild(opt);
            });

            return select;
        }

        /** @private */
        _createToggle(id, label, checked) {
            const container = Utils.createElement("label", {
                classes: "settings-toggle",
                html: `<input type="checkbox" id="settings-${id}" ${checked ? "checked" : ""}> <span>${label}</span>`
            });
            return container;
        }

        /** @private */
        _createInputRow(label, id, type, value, placeholder) {
            const row = Utils.createElement("div", { classes: "settings-input-row" });
            const labelEl = Utils.createElement("label", {
                classes: "settings-input-label",
                attributes: { for: `settings-${id}` },
                text: label
            });
            const input = Utils.createElement("input", {
                classes: "settings-input",
                attributes: { type, id: `settings-${id}`, value, placeholder }
            });
            row.append(labelEl, input);
            return row;
        }

        /** @private */
        _createToggleRow(label, id, description, checked) {
            const row = Utils.createElement("div", { classes: "settings-toggle-row" });
            const toggle = this._createToggle(id, label, checked);
            const desc = Utils.createElement("span", { classes: "settings-toggle-desc", text: description });
            row.append(toggle, desc);
            return row;
        }

        /** @private */
        _createShortcutItem(keys, action) {
            const item = Utils.createElement("div", { classes: "settings-shortcut-item" });
            const keysEl = Utils.createElement("kbd", { classes: "settings-shortcut-keys", text: keys });
            const actionEl = Utils.createElement("span", { classes: "settings-shortcut-action", text: action });
            item.append(keysEl, actionEl);
            return item;
        }

        /* ==================================================================
         * EVENT BINDING
         * ================================================================== */

        /** @private */
        _bindEvents() {
            const { btnOpen, btnClose, panel, themeSelect, langSelect, devToggle,
                    wifiHostInput, wifiPortInput, wifiReconnectToggle,
                    bleDeviceInput, bleAutoPairToggle, btnReset } = this._elements;

            /* Open from header button */
            if (btnOpen && panel) {
                this._cleanupHandlers.push(
                    Utils.on?.(btnOpen, "click", () => this.toggle()) || (() => {})
                );
            }

            /* Close panel */
            if (btnClose && panel) {
                this._cleanupHandlers.push(
                    Utils.on?.(btnClose, "click", () => this.close()) || (() => {})
                );
            }

            /* Close on outside click */
            this._cleanupHandlers.push(
                Utils.on?.(document, "click", (e) => {
                    if (panel && !panel.hidden && !panel.contains(e.target) && btnOpen && !btnOpen.contains(e.target)) {
                        this.close();
                    }
                }) || (() => {})
            );

            /* Close on Escape */
            this._cleanupHandlers.push(
                Utils.on?.(document, "keydown", (e) => {
                    if (e.key === "Escape" && panel && !panel.hidden) {
                        this.close();
                    }
                }) || (() => {})
            );

            /* Tab switching */
            const tabs = Utils.$$?.(".settings-tab-btn", panel) || [];
            tabs.forEach((tab) => {
                this._cleanupHandlers.push(
                    Utils.on?.(tab, "click", () => this._showTab(tab.dataset.tab)) || (() => {})
                );
            });

            /* Theme change */
            if (themeSelect) {
                this._cleanupHandlers.push(
                    Utils.on?.(themeSelect, "change", (e) => this.setTheme(e.target.value)) || (() => {})
                );
            }

            /* Language change */
            if (langSelect) {
                this._cleanupHandlers.push(
                    Utils.on?.(langSelect, "change", (e) => {
                        this._language = e.target.value;
                        this._savePreferences();
                    }) || (() => {})
                );
            }

            /* Developer mode toggle */
            if (devToggle) {
                const input = devToggle.querySelector("input");
                this._cleanupHandlers.push(
                    Utils.on?.(input, "change", (e) => {
                        this._developerMode = e.target.checked;
                        Config.app.debug = this._developerMode;
                        this._savePreferences();
                    }) || (() => {})
                );
            }

            /* WiFi settings */
            if (wifiHostInput) {
                this._cleanupHandlers.push(
                    Utils.on?.(wifiHostInput, "input", (e) => {
                        this._connectionSettings.wifi.host = e.target.value;
                        this._savePreferences();
                    }) || (() => {})
                );
            }

            if (wifiPortInput) {
                this._cleanupHandlers.push(
                    Utils.on?.(wifiPortInput, "input", (e) => {
                        this._connectionSettings.wifi.port = Number(e.target.value) || 81;
                        this._savePreferences();
                    }) || (() => {})
                );
            }

            if (wifiReconnectToggle) {
                this._cleanupHandlers.push(
                    Utils.on?.(wifiReconnectToggle, "change", (e) => {
                        this._connectionSettings.wifi.autoReconnect = e.target.checked;
                        this._savePreferences();
                    }) || (() => {})
                );
            }

            /* Bluetooth settings */
            if (bleDeviceInput) {
                this._cleanupHandlers.push(
                    Utils.on?.(bleDeviceInput, "input", (e) => {
                        this._connectionSettings.bluetooth.deviceName = e.target.value;
                        this._savePreferences();
                    }) || (() => {})
                );
            }

            if (bleAutoPairToggle) {
                this._cleanupHandlers.push(
                    Utils.on?.(bleAutoPairToggle, "change", (e) => {
                        this._connectionSettings.bluetooth.autoPair = e.target.checked;
                        this._savePreferences();
                    }) || (() => {})
                );
            }

            /* Reset button */
            if (btnReset) {
                this._cleanupHandlers.push(
                    Utils.on?.(btnReset, "click", () => this.resetDashboard()) || (() => {})
                );
            }
        }

        /* ==================================================================
         * THEME MANAGEMENT
         * ================================================================== */

        /** @private */
        _applyTheme() {
            const body = document.body;
            if (!body) return;

            /* Remove all theme classes */
            Object.values(THEMES).forEach((theme) => body.classList.remove(theme));

            /* Add active theme */
            body.classList.add(this._activeTheme);

            /* Trigger transition */
            body.classList.add("theme-switching");
            global.setTimeout(() => body.classList.remove("theme-switching"), 500);
        }

        /* ==================================================================
         * PREFERENCES STORAGE
         * ================================================================== */

        /** @private */
        _loadPreferences() {
            try {
                const namespace = Config.storage?.namespace || "sarathi_v1_";
                const key = namespace + "settings";
                const raw = global.localStorage.getItem(key);
                const preferences = raw ? JSON.parse(raw) : {};

                this._activeTheme = preferences.theme || THEMES.DARK;
                this._language = preferences.language || "en-US";
                this._developerMode = preferences.developerMode || false;
                this._connectionSettings = preferences.connection || this._connectionSettings;
            } catch (error) {
                log.warn("Unable to load settings preferences:", error);
            }
        }

        /** @private */
        _savePreferences() {
            try {
                const namespace = Config.storage?.namespace || "sarathi_v1_";
                const key = namespace + "settings";
                const preferences = {
                    theme: this._activeTheme,
                    language: this._language,
                    developerMode: this._developerMode,
                    connection: { ...this._connectionSettings }
                };
                global.localStorage.setItem(key, JSON.stringify(preferences));
            } catch (error) {
                log.warn("Unable to save settings preferences:", error);
            }
        }

        /* ==================================================================
         * UI SYNC
         * ================================================================== */

        /** @private */
        _syncUI() {
            const { themeSelect, langSelect, devToggle,
                    wifiHostInput, wifiPortInput, wifiReconnectToggle,
                    bleDeviceInput, bleAutoPairToggle } = this._elements;

            if (themeSelect) themeSelect.value = this._activeTheme;
            if (langSelect) langSelect.value = this._language;
            if (devToggle) {
                const input = devToggle.querySelector("input");
                if (input) input.checked = this._developerMode;
            }

            if (wifiHostInput) wifiHostInput.value = this._connectionSettings.wifi.host;
            if (wifiPortInput) wifiPortInput.value = String(this._connectionSettings.wifi.port);
            if (wifiReconnectToggle) wifiReconnectToggle.checked = this._connectionSettings.wifi.autoReconnect;
            if (bleDeviceInput) bleDeviceInput.value = this._connectionSettings.bluetooth.deviceName;
            if (bleAutoPairToggle) bleAutoPairToggle.checked = this._connectionSettings.bluetooth.autoPair;
        }

        /** @private */
        _showTab(tabId) {
            const panel = this._elements.panel;
            if (!panel) return;

            /* Hide all tab contents */
            const contents = Utils.$$?.(".settings-tab-content", panel) || [];
            contents.forEach((content) => content.hidden = true);

            /* Deactivate all tab buttons */
            const tabs = Utils.$$?.(".settings-tab-btn", panel) || [];
            tabs.forEach((tab) => tab.classList.remove("is-active"));

            /* Show selected tab */
            const selectedContent = Utils.byId?.(`settings-tab-${tabId}`, panel);
            if (selectedContent) selectedContent.hidden = false;

            /* Activate selected tab button */
            const selectedTab = tabs.find((tab) => tab.dataset.tab === tabId);
            if (selectedTab) selectedTab.classList.add("is-active");
        }

        /** @private */
        _flashStatus(message) {
            /* Could add a temporary status message in the panel */
            log.info(message);
        }
    }

    global.Sarathi.Modules[MODULE_ID] = new SettingsModule();

})(typeof window !== "undefined" ? window : this);
