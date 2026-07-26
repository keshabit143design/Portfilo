/**
 * ============================================================================
 * MISSION CONTROL — SMART SURVEY ROBOT — modules/history.js
 * ----------------------------------------------------------------------------
 * Command History Module — Complete Mission Log & Timeline
 *
 * Capabilities
 *   • Real-time command logging with timestamps
 *   • Timeline view with grouping by date/session
 *   • Search through command history
 *   • Filter by type, source, or status
 *   • Export history as JSON file
 *   • Clear history with confirmation
 *   • Persistent storage via localStorage
 *
 * Registered at: window.Sarathi.Modules["history"]
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

    const MODULE_ID = Constants.MODULES?.HISTORY || "history";

    const LOCAL_EVENTS = {
        RECORDED: "sarathi:history:recorded",
        CLEARED: "sarathi:history:cleared",
        EXPORTED: "sarathi:history:exported"
    };

    const MAX_ENTRIES = Config.storage?.maxCommandHistoryEntries || 200;

    const COMMAND_STATUS = {
        SENT: "sent",
        RECEIVED: "received",
        FAILED: "failed",
        COMPLETED: "completed"
    };

    /**
     * @class HistoryModule
     * @description Complete command logging and history management.
     */
    class HistoryModule {
        constructor() {
            this._initialized = false;

            /** @private @type {Array<Object>} */
            this._entries = [];

            /** @private @type {string} */
            this._searchQuery = "";

            /** @private @type {string} */
            this._filterType = "all";

            /** @private @type {Array<Function>} */
            this._cleanupHandlers = [];

            /** @private */
            this._elements = {
                body: null,
                timeline: null,
                searchInput: null,
                filterSelect: null,
                btnClear: null,
                btnExport: null,
                stats: null
            };
        }

        /* ==================================================================
         * LIFECYCLE
         * ================================================================== */

        async init() {
            if (this._initialized) return true;

            this._elements.body = Utils.byId?.("history-body");
            if (!this._elements.body) {
                log.debug("History card body not found; module idle.");
                return false;
            }

            log.info("Initializing history module...");

            try {
                this._loadEntries();
                this._buildInterface();
                this._bindEvents();
                this._bindSystemEvents();
                this._renderTimeline();
                this._updateStats();

                this._initialized = true;
                return true;
            } catch (error) {
                log.error("History initialization failed:", error);
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
            this._initialized = false;
        }

        /* ==================================================================
         * PUBLIC API
         * ================================================================== */

        /**
         * Record a new command entry.
         * @param {Object} entry - Command entry data
         * @param {string} entry.type - Command type
         * @param {string} [entry.direction] - Movement direction
         * @param {string} [entry.source] - Source module
         * @param {string} [entry.mode] - Control mode
         * @param {string} [entry.status] - Command status
         * @param {string} [entry.message] - Additional message
         * @param {number} [entry.timestamp] - Timestamp
         * @returns {Object} Recorded entry
         */
        record(entry) {
            const record = {
                id: Utils.generateUUID?.() || String(Date.now()),
                timestamp: entry.timestamp || Date.now(),
                type: entry.type || "unknown",
                direction: entry.direction,
                source: entry.source || "manual",
                mode: entry.mode,
                status: entry.status || COMMAND_STATUS.SENT,
                message: entry.message,
                data: entry.data
            };

            this._entries.unshift(record);
            if (this._entries.length > MAX_ENTRIES) {
                this._entries.pop();
            }

            this._saveEntries();
            this._renderTimeline();
            this._updateStats();

            Utils.dispatch?.(LOCAL_EVENTS.RECORDED, record);
            return record;
        }

        /**
         * Record a sent command.
         */
        recordSent(entry) {
            return this.record({ ...entry, status: COMMAND_STATUS.SENT });
        }

        /**
         * Record a failed command.
         */
        recordFailed(entry) {
            return this.record({ ...entry, status: COMMAND_STATUS.FAILED });
        }

        /**
         * Record a completed command.
         */
        recordCompleted(entry) {
            return this.record({ ...entry, status: COMMAND_STATUS.COMPLETED });
        }

        /**
         * Search history entries.
         * @param {string} query - Search term
         */
        search(query) {
            this._searchQuery = query || "";
            this._renderTimeline();
            this._updateStats();
        }

        /**
         * Filter history by type.
         * @param {string} type - Filter type (all, motor, mode, etc.)
         */
        filter(type) {
            this._filterType = type || "all";
            this._renderTimeline();
            this._updateStats();
        }

        /**
         * Clear all history entries.
         */
        clear() {
            this._entries = [];
            this._saveEntries();
            this._renderTimeline();
            this._updateStats();
            Utils.dispatch?.(LOCAL_EVENTS.CLEARED, { module: MODULE_ID });
        }

        /**
         * Export history as JSON file.
         */
        exportJSON() {
            if (this._entries.length === 0) {
                this._flashStats("No history to export.");
                return;
            }

            try {
                const blob = new Blob([JSON.stringify(this._entries, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const link = Utils.createElement("a", {
                    attributes: {
                        href: url,
                        download: `sarathi-history-${Date.now()}.json`
                    }
                });
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                global.setTimeout(() => URL.revokeObjectURL(url), 1000);

                Utils.dispatch?.(LOCAL_EVENTS.EXPORTED, { module: MODULE_ID, count: this._entries.length });
                this._flashStats(`Exported ${this._entries.length} entries.`);
            } catch (error) {
                log.error("Failed to export history:", error);
                this._flashStats("Export failed.");
            }
        }

        /**
         * Get filtered history entries.
         * @returns {Array<Object>}
         */
        getEntries() {
            return this._entries;
        }

        /**
         * Get current history statistics.
         * @returns {Object}
         */
        getStats() {
            const filtered = this._getFilteredEntries();
            const byType = {};
            filtered.forEach((entry) => {
                const type = entry.type || "unknown";
                byType[type] = (byType[type] || 0) + 1;
            });

            return {
                total: filtered.length,
                byType,
                oldest: filtered.length > 0 ? new Date(filtered[filtered.length - 1].timestamp) : null,
                newest: filtered.length > 0 ? new Date(filtered[0].timestamp) : null
            };
        }

        /* ==================================================================
         * INTERFACE CONSTRUCTION
         * ================================================================== */

        /** @private */
        _buildInterface() {
            const body = this._elements.body;
            const placeholder = body.querySelector('[data-module="history"]');
            if (placeholder) placeholder.remove();

            /* Control bar */
            const controlBar = Utils.createElement("div", { classes: "history-control-bar" });

            const searchWrap = Utils.createElement("div", { classes: "history-search-wrap" });
            const searchIcon = Utils.createElement("i", { classes: ["fa-solid", "fa-magnifying-glass"] });
            const searchInput = Utils.createElement("input", {
                classes: "history-search-input",
                attributes: {
                    type: "search",
                    placeholder: "Search commands...",
                    "aria-label": "Search command history"
                }
            });
            searchWrap.append(searchIcon, searchInput);

            const filterWrap = Utils.createElement("div", { classes: "history-filter-wrap" });
            const filterLabel = Utils.createElement("label", { classes: "history-filter-label", text: "Filter:" });
            const filterSelect = Utils.createElement("select", {
                classes: "history-filter-select",
                attributes: { "aria-label": "Filter by command type" },
                html: `
                    <option value="all">All Commands</option>
                    <option value="motor">Motor Commands</option>
                    <option value="mode">Mode Changes</option>
                    <option value="stop">Stop Commands</option>
                    <option value="system">System Events</option>
                `
            });
            filterWrap.append(filterLabel, filterSelect);

            const actionWrap = Utils.createElement("div", { classes: "history-actions-wrap" });
            const btnClear = this._createBtn("history-clear", "fa-trash-can", "Clear History", "btn-ghost");
            const btnExport = this._createBtn("history-export", "fa-file-export", "Export JSON", "btn-primary");
            actionWrap.append(btnClear, btnExport);

            controlBar.append(searchWrap, filterWrap, actionWrap);

            /* Stats */
            const stats = Utils.createElement("p", { classes: "history-stats" });

            /* Timeline */
            const timeline = Utils.createElement("div", { classes: "history-timeline" });

            body.append(controlBar, stats, timeline);

            Object.assign(this._elements, {
                timeline,
                searchInput,
                filterSelect,
                btnClear,
                btnExport,
                stats
            });
        }

        /** @private */
        _createBtn(id, icon, label, variant) {
            return Utils.createElement("button", {
                classes: ["btn", variant, "history-btn"],
                attributes: { id, type: "button", "aria-label": label },
                html: `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span>`
            });
        }

        /* ==================================================================
         * EVENT BINDING
         * ================================================================== */

        /** @private */
        _bindEvents() {
            const { searchInput, filterSelect, btnClear, btnExport } = this._elements;

            if (searchInput) {
                this._cleanupHandlers.push(
                    Utils.on?.(searchInput, "input", (e) => this.search(e.target.value)) || (() => {})
                );
            }

            if (filterSelect) {
                this._cleanupHandlers.push(
                    Utils.on?.(filterSelect, "change", (e) => this.filter(e.target.value)) || (() => {})
                );
            }

            if (btnClear) {
                this._cleanupHandlers.push(
                    Utils.on?.(btnClear, "click", () => {
                        if (global.confirm("Clear all command history? This cannot be undone.")) {
                            this.clear();
                        }
                    }) || (() => {})
                );
            }

            if (btnExport) {
                this._cleanupHandlers.push(
                    Utils.on?.(btnExport, "click", () => this.exportJSON()) || (() => {})
                );
            }
        }

        /** @private */
        _bindSystemEvents() {
            /* Listen for command events */
            const onCommandSent = (e) => {
                const detail = e.detail || {};
                this.recordSent({
                    type: detail.type || "unknown",
                    direction: detail.direction,
                    source: detail.source || "manual",
                    mode: detail.mode,
                    message: detail.reason,
                    timestamp: detail.timestamp
                });
            };

            const onCommandFailed = (e) => {
                const detail = e.detail || {};
                this.recordFailed({
                    type: detail.type || "unknown",
                    direction: detail.direction,
                    source: detail.source || "manual",
                    mode: detail.mode,
                    message: detail.reason,
                    timestamp: detail.timestamp
                });
            };

            /* Listen for mode changes */
            const onModeChanged = (e) => {
                const mode = e.detail?.mode;
                if (mode) {
                    this.recordCompleted({
                        type: "mode:change",
                        message: `Switched to ${mode} mode`,
                        source: "system",
                        mode
                    });
                }
            };

            /* Listen for auto mode completion */
            const onAutoComplete = (e) => {
                this.recordCompleted({
                    type: "auto:mission",
                    message: "Autonomous mission completed",
                    source: "auto-mode"
                });
            };

            this._cleanupHandlers.push(
                Utils.on?.(window, Constants.EVENTS?.COMMAND_SENT || "sarathi:command:sent", onCommandSent) || (() => {}),
                Utils.on?.(window, Constants.EVENTS?.COMMAND_FAILED || "sarathi:command:failed", onCommandFailed) || (() => {}),
                Utils.on?.(window, Constants.EVENTS?.MODE_CHANGED || "sarathi:robot:mode-changed", onModeChanged) || (() => {}),
                Utils.on?.(window, "sarathi:auto-mode:completed", onAutoComplete) || (() => {})
            );
        }

        /* ==================================================================
         * TIMELINE RENDERING
         * ================================================================== */

        /** @private */
        _renderTimeline() {
            const timeline = this._elements.timeline;
            if (!timeline) return;

            const entries = this._getFilteredEntries();

            if (entries.length === 0) {
                timeline.innerHTML = '<p class="history-empty">No commands recorded yet. Control the robot to start logging.</p>';
                return;
            }

            const dateGroups = this._groupByDate(entries);

            for (const [date, items] of Object.entries(dateGroups)) {
                const dateHeader = Utils.createElement("div", {
                    classes: "history-date-header",
                    text: date
                });
                timeline.appendChild(dateHeader);

                const dateList = Utils.createElement("div", { classes: "history-date-list" });

                items.forEach((item) => {
                    const entryEl = this._createTimelineEntry(item);
                    dateList.appendChild(entryEl);
                });

                timeline.appendChild(dateList);
            }
        }

        /** @private */
        _getFilteredEntries() {
            let filtered = this._entries;

            /* Filter by type */
            if (this._filterType !== "all") {
                filtered = filtered.filter((entry) => entry.type && entry.type.includes(this._filterType));
            }

            /* Search */
            if (this._searchQuery) {
                const query = this._searchQuery.toLowerCase();
                filtered = filtered.filter((entry) =>
                    (entry.type && entry.type.toLowerCase().includes(query)) ||
                    (entry.direction && entry.direction.toLowerCase().includes(query)) ||
                    (entry.source && entry.source.toLowerCase().includes(query)) ||
                    (entry.message && entry.message.toLowerCase().includes(query))
                );
            }

            return filtered;
        }

        /** @private */
        _groupByDate(list) {
            const groups = {};
            list.forEach((item) => {
                const dateStr = new Date(item.timestamp).toLocaleDateString();
                if (!groups[dateStr]) groups[dateStr] = [];
                groups[dateStr].push(item);
            });
            return groups;
        }

        /** @private */
        _createTimelineEntry(item) {
            const entry = Utils.createElement("div", {
                classes: ["history-entry", `history-entry-${item.status}`],
                attributes: { "data-id": item.id }
            });

            const time = Utils.createElement("time", {
                classes: "history-entry-time",
                text: new Date(item.timestamp).toLocaleTimeString(),
                attributes: { datetime: item.timestamp }
            });

            const icon = this._getStatusIcon(item.status);

            const content = Utils.createElement("div", { classes: "history-entry-content" });

            const header = Utils.createElement("div", { classes: "history-entry-header" });
            const type = Utils.createElement("strong", { classes: "history-entry-type", text: item.type || "unknown" });
            const source = Utils.createElement("span", { classes: "history-entry-source", text: item.source || "manual" });
            header.append(type, source);

            const message = Utils.createElement("p", { classes: "history-entry-message" });
            if (item.direction) {
                message.innerHTML = `<span class="history-entry-direction">Direction: ${item.direction}</span>`;
            }
            if (item.message) {
                message.innerHTML += (item.direction ? "<br>" : "") + Utils.escapeHTML?.(item.message);
            }
            if (!item.direction && !item.message) {
                message.textContent = "—";
            }
            content.append(header, message);

            const status = Utils.createElement("span", {
                classes: ["history-entry-status", `badge-${item.status}`],
                text: item.status
            });

            entry.append(time, icon, content, status);
            return entry;
        }

        /** @private */
        _getStatusIcon(status) {
            const icons = {
                sent: "fa-paper-plane",
                received: "fa-check",
                failed: "fa-exclamation",
                completed: "fa-circle-check"
            };
            return Utils.createElement("i", {
                classes: ["fa-solid", icons[status] || "fa-circle"],
                attributes: { "aria-hidden": "true" }
            });
        }

        /* ==================================================================
         * STATS & HELPERS
         * ================================================================== */

        /** @private */
        _updateStats() {
            const statsEl = this._elements.stats;
            if (!statsEl) return;

            const stats = this.getStats();
            const typeCounts = Object.entries(stats.byType)
                .map(([type, count]) => `${type}:${count}`)
                .join(", ");

            statsEl.textContent = `${stats.total} commands · ${typeCounts}`;
        }

        /** @private */
        _flashStats(message) {
            const statsEl = this._elements.stats;
            if (!statsEl) return;

            const original = statsEl.textContent;
            statsEl.textContent = message;
            global.setTimeout(() => this._updateStats(), 2200);
        }

        /* ==================================================================
         * STORAGE
         * ================================================================== */

        /** @private */
        _loadEntries() {
            try {
                const namespace = Config.storage?.namespace || "sarathi_v1_";
                const key = namespace + (Config.storage?.keys?.commandHistory || "command_history");
                const raw = global.localStorage.getItem(key);
                this._entries = raw ? JSON.parse(raw) : [];
            } catch (error) {
                log.warn("Unable to load command history:", error);
                this._entries = [];
            }
        }

        /** @private */
        _saveEntries() {
            try {
                const namespace = Config.storage?.namespace || "sarathi_v1_";
                const key = namespace + (Config.storage?.keys?.commandHistory || "command_history");
                global.localStorage.setItem(key, JSON.stringify(this._entries));
            } catch (error) {
                log.warn("Unable to save command history:", error);
            }
        }
    }

    global.Sarathi.Modules[MODULE_ID] = new HistoryModule();

})(typeof window !== "undefined" ? window : this);
