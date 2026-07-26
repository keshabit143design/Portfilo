/**
 * ============================================================================
 * MISSION CONTROL — SMART SURVEY ROBOT — modules/notifications.js
 * ----------------------------------------------------------------------------
 * Professional Notification Center Module
 *
 * Capabilities
 *   • Centralized notification panel (slide-in from right)
 *   • Toast notifications (auto-dismiss)
 *   • Multiple severity levels: info, success, warning, error
 *   • History timeline with persistent storage
 *   • Search through past notifications
 *   • Export notification history as JSON
 *
 * Registered at: window.Sarathi.Modules["notifications"]
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

    const MODULE_ID = Constants.MODULES?.NOTIFICATIONS || "notifications";

    const LEVEL = {
        INFO: "info",
        SUCCESS: "success",
        WARNING: "warning",
        ERROR: "error"
    };

    const LEVEL_CLASS = {
        info: "badge-info",
        success: "badge-success",
        warning: "badge-warning",
        error: "badge-danger"
    };

    const LEVEL_ICON = {
        info: "fa-circle-info",
        success: "fa-circle-check",
        warning: "fa-triangle-exclamation",
        error: "fa-circle-xmark"
    };

    const LOCAL_EVENTS = {
        NOTIFICATION_POSTED: "sarathi:notifications:posted",
        NOTIFICATION_DISMISSED: "sarathi:notifications:dismissed",
        HISTORY_CLEARED: "sarathi:notifications:history-cleared"
    };

    const MAX_HISTORY = Config.notificationMaxHistory || 50;
    const TOAST_DURATION = Config.ui?.toastDurationMs || 4500;

    /**
     * @class NotificationsModule
     * @description Centralized notification center and toast manager.
     */
    class NotificationsModule {
        constructor() {
            this._initialized = false;

            /** @private @type {Array<Object>} */
            this._history = [];

            /** @private @type {Array<HTMLElement>} */
            this._toastQueue = [];

            /** @private @type {number} */
            this._visibleToastCount = 0;

            /** @private @type {Array<Function>} */
            this._cleanupHandlers = [];

            /** @private */
            this._elements = {
                body: null,
                panel: null,
                list: null,
                bellBtn: null,
                bellBadge: null,
                toastContainer: null,
                searchInput: null,
                btnClearHistory: null,
                btnExportHistory: null
            };
        }

        /* ==================================================================
         * LIFECYCLE
         * ================================================================== */

        async init() {
            if (this._initialized) return true;

            this._elements.body = Utils.byId?.("notifications-body");
            this._elements.panel = Utils.byId?.("notification-panel");
            this._elements.list = Utils.byId?.("notification-panel-list");
            this._elements.bellBtn = Utils.byId?.("notification-bell-btn");
            this._elements.bellBadge = Utils.byId?.("notification-badge");
            this._elements.toastContainer = Utils.byId?.("toast-container");

            if (!this._elements.panel || !this._elements.list || !this._elements.toastContainer) {
                log.debug("Notification elements not found; module idle.");
                return false;
            }

            log.info("Initializing notifications module...");

            try {
                this._loadHistory();
                this._buildPanelUI();
                this._bindEvents();
                this._bindSystemEvents();
                this._updateBadge();

                this._initialized = true;
                return true;
            } catch (error) {
                log.error("Notifications initialization failed:", error);
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
         * Post a new notification.
         * @param {string} message - Notification text
         * @param {string} [level="info"] - Severity level (info, success, warning, error)
         * @param {Object} [options={}] - Additional options
         * @param {boolean} [options.toast=true] - Show toast popup
         * @param {boolean} [options.persist=false] - Keep in history panel
         * @param {string} [options.title] - Optional title
         * @param {Object} [options.data] - Custom payload
         * @returns {Object} Notification record
         */
        post(message, level = LEVEL.INFO, options = {}) {
            const record = {
                id: Utils.generateUUID?.() || String(Date.now()),
                timestamp: new Date().toISOString(),
                level,
                message,
                title: options.title,
                data: options.data,
                read: false
            };

            /* Add to history */
            if (options.persist !== false) {
                this._history.unshift(record);
                if (this._history.length > MAX_HISTORY) {
                    this._history.pop();
                }
                this._saveHistory();
                this._renderHistory();
            }

            /* Show toast */
            if (options.toast !== false) {
                this._showToast(record);
            }

            this._updateBadge();
            Utils.dispatch?.(LOCAL_EVENTS.NOTIFICATION_POSTED, record);
            return record;
        }

        /**
         * Show a success notification.
         */
        success(message, options = {}) {
            return this.post(message, LEVEL.SUCCESS, { ...options, toast: true });
        }

        /**
         * Show a warning notification.
         */
        warn(message, options = {}) {
            return this.post(message, LEVEL.WARNING, { ...options, toast: true });
        }

        /**
         * Show an error notification.
         */
        error(message, options = {}) {
            return this.post(message, LEVEL.ERROR, { ...options, toast: true });
        }

        /**
         * Show an info notification.
         */
        info(message, options = {}) {
            return this.post(message, LEVEL.INFO, { ...options, toast: true });
        }

        /**
         * Dismiss a specific toast by its ID.
         * @param {string} id - Toast notification ID
         */
        dismissToast(id) {
            const toast = this._toastQueue.find((t) => t.dataset.id === id);
            if (toast) {
                this._hideToast(toast);
            }
        }

        /**
         * Dismiss all currently visible toasts.
         */
        dismissAllToasts() {
            this._toastQueue.forEach((toast) => this._hideToast(toast));
            this._toastQueue = [];
            this._visibleToastCount = 0;
        }

        /**
         * Clear all notification history.
         */
        clearHistory() {
            this._history = [];
            this._saveHistory();
            this._renderHistory();
            this._updateBadge();
            Utils.dispatch?.(LOCAL_EVENTS.HISTORY_CLEARED, { module: MODULE_ID });
        }

        /**
         * Export notification history as JSON file.
         */
        exportHistory() {
            if (this._history.length === 0) {
                this.info("No notifications to export.");
                return;
            }

            try {
                const blob = new Blob([JSON.stringify(this._history, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const link = Utils.createElement("a", {
                    attributes: {
                        href: url,
                        download: `sarathi-notifications-${Date.now()}.json`
                    }
                });
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                global.setTimeout(() => URL.revokeObjectURL(url), 1000);
                this.success("Notification history exported successfully.");
            } catch (error) {
                log.error("Failed to export notification history:", error);
                this.error("Failed to export notification history.");
            }
        }

        /**
         * Search notification history.
         * @param {string} query - Search term
         */
        search(query) {
            if (!query || query.trim() === "") {
                this._renderHistory();
                return;
            }

            const searchInput = this._elements.searchInput;
            if (searchInput) searchInput.value = query;

            const lowerQuery = query.toLowerCase();
            const filtered = this._history.filter((item) =>
                (item.title && item.title.toLowerCase().includes(lowerQuery)) ||
                (item.message && item.message.toLowerCase().includes(lowerQuery)) ||
                (item.level && item.level.toLowerCase().includes(lowerQuery))
            );

            this._renderHistory(filtered);
        }

        /**
         * Mark a notification as read.
         * @param {string} id - Notification ID
         */
        markAsRead(id) {
            const notification = this._history.find((item) => item.id === id);
            if (notification) {
                notification.read = true;
                this._saveHistory();
                this._renderHistory();
                this._updateBadge();
            }
        }

        /**
         * Mark all notifications as read.
         */
        markAllAsRead() {
            this._history.forEach((item) => (item.read = true));
            this._saveHistory();
            this._renderHistory();
            this._updateBadge();
        }

        /**
         * Get current notification count.
         * @returns {Object}
         */
        getStatus() {
            const unread = this._history.filter((item) => !item.read).length;
            return {
                initialized: this._initialized,
                total: this._history.length,
                unread,
                visibleToasts: this._visibleToastCount
            };
        }

        /* ==================================================================
         * PANEL UI
         * ================================================================== */

        /** @private */
        _buildPanelUI() {
            const panel = this._elements.panel;
            if (!panel) return;

            /* Header */
            const header = Utils.createElement("div", { classes: "notification-panel-header" });
            const title = Utils.createElement("h3", { classes: "notification-panel-title", text: "Notifications" });

            const actions = Utils.createElement("div", { classes: "notification-panel-actions" });
            const btnClear = this._createPanelBtn("fa-trash-can", "Clear All", "btn-ghost");
            const btnExport = this._createPanelBtn("fa-file-export", "Export", "btn-ghost");
            const btnMarkRead = this._createPanelBtn("fa-check-double", "Mark All Read", "btn-ghost");
            actions.append(btnClear, btnExport, btnMarkRead);

            header.append(title, actions);

            /* Search */
            const searchWrap = Utils.createElement("div", { classes: "notification-search-wrap" });
            const searchIcon = Utils.createElement("i", { classes: ["fa-solid", "fa-magnifying-glass"] });
            const searchInput = Utils.createElement("input", {
                classes: "notification-search-input",
                attributes: {
                    type: "search",
                    placeholder: "Search notifications...",
                    "aria-label": "Search notifications"
                }
            });
            searchWrap.append(searchIcon, searchInput);

            /* Insert before existing list */
            if (panel.firstChild) {
                panel.insertBefore(header, panel.firstChild);
                panel.insertBefore(searchWrap, panel.firstChild.nextSibling);
            } else {
                panel.append(header, searchWrap);
            }

            Object.assign(this._elements, {
                searchInput,
                btnClearHistory: btnClear,
                btnExportHistory: btnExport,
                btnMarkAllRead: btnMarkRead
            });
        }

        /** @private */
        _createPanelBtn(icon, label, variant) {
            const btn = Utils.createElement("button", {
                classes: ["btn", variant, "notification-panel-btn"],
                attributes: { type: "button", "aria-label": label },
                html: `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span>`
            });
            return btn;
        }

        /* ==================================================================
         * EVENT BINDING
         * ================================================================== */

        /** @private */
        _bindEvents() {
            const { bellBtn, panel, btnClearHistory, btnExportHistory, btnMarkAllRead, searchInput } = this._elements;

            if (bellBtn && panel) {
                this._cleanupHandlers.push(
                    Utils.on?.(bellBtn, "click", () => {
                        const isHidden = panel.hasAttribute("hidden");
                        panel.hidden = !isHidden;
                        bellBtn.setAttribute("aria-expanded", String(!isHidden));
                        if (!isHidden) {
                            this.markAllAsRead();
                        }
                    }) || (() => {})
                );
            }

            if (btnClearHistory) {
                this._cleanupHandlers.push(
                    Utils.on?.(btnClearHistory, "click", () => this.clearHistory()) || (() => {})
                );
            }

            if (btnExportHistory) {
                this._cleanupHandlers.push(
                    Utils.on?.(btnExportHistory, "click", () => this.exportHistory()) || (() => {})
                );
            }

            if (btnMarkAllRead) {
                this._cleanupHandlers.push(
                    Utils.on?.(btnMarkAllRead, "click", () => this.markAllAsRead()) || (() => {})
                );
            }

            if (searchInput) {
                this._cleanupHandlers.push(
                    Utils.on?.(searchInput, "input", (e) => this.search(e.target.value)) || (() => {})
                );
            }

            /* Close panel on outside click */
            this._cleanupHandlers.push(
                Utils.on?.(document, "click", (e) => {
                    if (panel && !panel.hidden && !panel.contains(e.target) && bellBtn && !bellBtn.contains(e.target)) {
                        panel.hidden = true;
                        bellBtn.setAttribute("aria-expanded", "false");
                    }
                }) || (() => {})
            );
        }

        /** @private */
        _bindSystemEvents() {
            /* Listen for module events that should generate notifications */
            const onConnection = () => this.info("Connection status changed");
            const onCommandSent = (e) => {
                const detail = e.detail || {};
                if (detail.type && detail.type !== "stop") {
                    this.info(`Command sent: ${detail.type}`);
                }
            };
            const onRobotOnline = () => this.success("Robot is now online and ready!");
            const onRobotOffline = () => this.error("Robot connection lost!");
            const onBatteryLow = (e) => this.warn(`Low battery warning: ${e.detail.level || 20}% remaining`);
            const onAutoComplete = () => this.success("Autonomous mission completed successfully!");

            this._cleanupHandlers.push(
                Utils.on?.(window, Constants.EVENTS?.CONNECTION_LINK_CHANGE || "sarathi:connection:link-change", onConnection) || (() => {}),
                Utils.on?.(window, Constants.EVENTS?.COMMAND_SENT || "sarathi:command:sent", onCommandSent) || (() => {}),
                Utils.on?.(window, Constants.EVENTS?.ROBOT_ONLINE || "sarathi:robot:online", onRobotOnline) || (() => {}),
                Utils.on?.(window, Constants.EVENTS?.ROBOT_OFFLINE || "sarathi:robot:offline", onRobotOffline) || (() => {}),
                Utils.on?.(window, "sarathi:telemetry:battery-low", onBatteryLow) || (() => {}),
                Utils.on?.(window, "sarathi:auto-mode:completed", onAutoComplete) || (() => {})
            );
        }

        /* ==================================================================
         * TOAST SYSTEM
         * ================================================================== */

        /** @private */
        _showToast(record) {
            if (this._visibleToastCount >= (Config.ui?.toastMaxVisible || 4)) {
                this._toastQueue.shift();
                this._visibleToastCount--;
            }

            const toast = this._createToastElement(record);
            this._elements.toastContainer.appendChild(toast);
            this._toastQueue.push(toast);
            this._visibleToastCount++;

            /* Auto-dismiss */
            global.setTimeout(() => this._hideToast(toast), TOAST_DURATION);

            /* Slide-in animation */
            global.setTimeout(() => toast.classList.add("toast-visible"), 20);
        }

        /** @private */
        _createToastElement(record) {
            const toast = Utils.createElement("div", {
                classes: ["toast", `toast-${record.level}`],
                attributes: { role: "status", "aria-live": "polite", id: `toast-${record.id}`, "data-id": record.id }
            });

            const icon = Utils.createElement("i", { classes: ["fa-solid", LEVEL_ICON[record.level]] });
            const content = Utils.createElement("div", { classes: "toast-content" });

            if (record.title) {
                const title = Utils.createElement("strong", { classes: "toast-title", text: record.title });
                content.append(title);
            }

            const message = Utils.createElement("p", { classes: "toast-message", text: record.message });
            content.append(message);

            const dismiss = Utils.createElement("button", {
                classes: ["toast-dismiss", "btn-icon"],
                attributes: { type: "button", "aria-label": "Dismiss notification" },
                html: `<i class="fa-solid fa-times" aria-hidden="true"></i>`
            });

            toast.append(icon, content, dismiss);

            Utils.on?.(dismiss, "click", () => this._hideToast(toast));

            return toast;
        }

        /** @private */
        _hideToast(toast) {
            toast.classList.remove("toast-visible");
            toast.classList.add("toast-hidden");

            global.setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
                const idx = this._toastQueue.indexOf(toast);
                if (idx !== -1) {
                    this._toastQueue.splice(idx, 1);
                    this._visibleToastCount--;
                }
                Utils.dispatch?.(LOCAL_EVENTS.NOTIFICATION_DISMISSED, { id: toast.dataset.id });
            }, 260);
        }

        /* ==================================================================
         * HISTORY RENDERING
         * ================================================================== */

        /** @private */
        _renderHistory(list = this._history) {
            const container = this._elements.list;
            if (!container) return;

            container.innerHTML = "";

            if (list.length === 0) {
                const emptyMsg = Utils.createElement("p", {
                    classes: "notification-empty",
                    text: "No notifications yet. System events will appear here."
                });
                container.appendChild(emptyMsg);
                return;
            }

            const dateGroups = this._groupByDate(list);

            for (const [date, items] of Object.entries(dateGroups)) {
                const dateHeader = Utils.createElement("li", {
                    classes: "notification-date-header",
                    text: date
                });
                container.appendChild(dateHeader);

                items.forEach((item) => {
                    const li = this._createHistoryItem(item);
                    container.appendChild(li);
                });
            }
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
        _createHistoryItem(item) {
            const li = Utils.createElement("li", {
                classes: ["notification-item", item.read ? "" : "is-unread"],
                attributes: { "data-id": item.id }
            });

            const icon = Utils.createElement("i", { classes: ["fa-solid", LEVEL_ICON[item.level]] });
            const content = Utils.createElement("div", { classes: "notification-item-content" });

            if (item.title) {
                const title = Utils.createElement("strong", { classes: "notification-item-title", text: item.title });
                content.append(title);
            }

            const message = Utils.createElement("p", { classes: "notification-item-message", text: item.message });
            const time = Utils.createElement("time", {
                classes: "notification-item-time",
                text: new Date(item.timestamp).toLocaleTimeString(),
                attributes: { datetime: item.timestamp }
            });
            content.append(message, time);

            const badge = Utils.createElement("span", {
                classes: ["notification-item-badge", LEVEL_CLASS[item.level]],
                text: item.level
            });

            const actions = Utils.createElement("div", { classes: "notification-item-actions" });
            const btnMarkRead = Utils.createElement("button", {
                classes: ["btn-icon", "notification-mark-read"],
                attributes: { type: "button", "aria-label": "Mark as read" },
                html: `<i class="fa-solid fa-envelope-open" aria-hidden="true"></i>`
            });

            if (!item.read) {
                actions.append(btnMarkRead);
                Utils.on?.(btnMarkRead, "click", (e) => {
                    e.stopPropagation();
                    this.markAsRead(item.id);
                });
            }

            li.append(icon, content, badge, actions);

            /* Click to mark as read */
            Utils.on?.(li, "click", () => {
                if (!item.read) this.markAsRead(item.id);
            });

            return li;
        }

        /* ==================================================================
         * STORAGE
         * ================================================================== */

        /** @private */
        _loadHistory() {
            try {
                const namespace = Config.storage?.namespace || "sarathi_v1_";
                const key = namespace + "notification_history";
                const raw = global.localStorage.getItem(key);
                this._history = raw ? JSON.parse(raw) : [];
            } catch (error) {
                log.warn("Unable to load notification history:", error);
                this._history = [];
            }
        }

        /** @private */
        _saveHistory() {
            try {
                const namespace = Config.storage?.namespace || "sarathi_v1_";
                const key = namespace + "notification_history";
                global.localStorage.setItem(key, JSON.stringify(this._history));
            } catch (error) {
                log.warn("Unable to save notification history:", error);
            }
        }

        /** @private */
        _updateBadge() {
            const badge = this._elements.bellBadge;
            if (!badge) return;

            const unread = this._history.filter((item) => !item.read).length;
            badge.textContent = unread > 0 ? (unread > 99 ? "99+" : String(unread)) : "";
            badge.style.display = unread > 0 ? "inline-flex" : "none";
        }
    }

    global.Sarathi.Modules[MODULE_ID] = new NotificationsModule();

})(typeof window !== "undefined" ? window : this);
