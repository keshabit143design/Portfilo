/**
 * ============================================================================
 * MISSION CONTROL — SMART SURVEY ROBOT — modules/auto-mode.js
 * ----------------------------------------------------------------------------
 * Auto Mode Module — Autonomous Path Playback & Mission Management
 *
 * Capabilities
 *   • Load, inspect, and delete paths saved from Draw Line & Free Draw
 *   • Import & Export survey paths as JSON files
 *   • Autonomous path replay engine (Replay, Pause, Resume, Stop)
 *   • Real-time progress tracking with percentage bar and waypoint readout
 *   • Emits command events and telemetry updates during playback
 *
 * Registered at: window.Sarathi.Modules["auto-mode"]
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

    const MODULE_ID = Constants.MODULES?.AUTO_MODE || "auto-mode";

    const STATE = {
        IDLE: "idle",
        REPLAYING: "replaying",
        PAUSED: "paused",
        COMPLETED: "completed",
        ERROR: "error"
    };

    const LOCAL_EVENTS = {
        STATUS_CHANGED: "sarathi:auto-mode:status-changed",
        PROGRESS: "sarathi:auto-mode:progress",
        COMPLETED: "sarathi:auto-mode:completed"
    };

    /**
     * @class AutoModeModule
     * @description Coordinates loading saved paths and replaying them autonomously.
     */
    class AutoModeModule {
        constructor() {
            this._initialized = false;

            /** @private @type {string} */
            this._state = STATE.IDLE;

            /** @private @type {Object|null} Active loaded path record */
            this._activePath = null;

            /** @private @type {number} Current waypoint index being executed */
            this._currentIndex = 0;

            /** @private @type {number} Playback speed in ms per waypoint */
            this._playbackSpeedMs = 600;

            /** @private @type {number|null} Timer ID for playback loop */
            this._timerId = null;

            /** @private @type {Array<Function>} */
            this._cleanupHandlers = [];

            /** @private */
            this._elements = {
                body: null,
                statusBadge: null,
                pathTitle: null,
                pathMeta: null,
                progressBar: null,
                progressFill: null,
                progressText: null,
                btnReplay: null,
                btnPause: null,
                btnResume: null,
                btnStop: null,
                btnImport: null,
                speedSelect: null,
                pathListContainer: null,
                fileInput: null
            };
        }

        /* ==================================================================
         * LIFECYCLE
         * ================================================================== */

        async init() {
            if (this._initialized) return true;

            this._elements.body = Utils.byId?.("auto-mode-body");
            if (!this._elements.body) {
                log.debug("Auto Mode card body not found; module idle.");
                return false;
            }

            log.info("Initializing auto-mode module...");

            try {
                this._buildInterface();
                this._bindEvents();
                this._loadSavedPathsList();
                this._syncUI();

                this._initialized = true;
                return true;
            } catch (error) {
                log.error("Auto-mode initialization failed:", error);
                return false;
            }
        }

        dispose() {
            this.stop();
            while (this._cleanupHandlers.length > 0) {
                const off = this._cleanupHandlers.pop();
                if (typeof off === "function") {
                    try { off(); } catch (_) { /* noop */ }
                }
            }
            this._activePath = null;
            this._initialized = false;
        }

        /* ==================================================================
         * PUBLIC API
         * ================================================================== */

        /**
         * Load a path record into the auto-mode execution engine.
         * @param {Object|string} pathOrId - Full path object or localStorage ID
         * @returns {boolean} Whether the path was loaded
         */
        loadPath(pathOrId) {
            this.stop();

            let pathObj = pathOrId;
            if (typeof pathOrId === "string") {
                const list = this._getStoredPaths();
                pathObj = list.find((item) => item.id === pathOrId);
            }

            if (!pathObj || !Array.isArray(pathObj.points) || pathObj.points.length === 0) {
                if (pathObj && Array.isArray(pathObj.strokes)) {
                    /* Flatten strokes from free-draw export into a continuous point sequence */
                    const flatPoints = [];
                    pathObj.strokes.forEach((stroke) => {
                        if (Array.isArray(stroke.points)) {
                            flatPoints.push(...stroke.points);
                        }
                    });
                    if (flatPoints.length > 0) {
                        pathObj.points = flatPoints;
                    }
                }
            }

            if (!pathObj || !Array.isArray(pathObj.points) || pathObj.points.length < 2) {
                log.warn("Invalid path format or insufficient waypoints for autonomous replay.");
                this._flashStatus("Invalid Path Format", STATE.ERROR);
                return false;
            }

            this._activePath = pathObj;
            this._currentIndex = 0;
            this._state = STATE.IDLE;
            this._syncUI();
            log.info(`Path loaded into Auto Mode: [${pathObj.id || "custom"}] (${pathObj.points.length} waypoints)`);
            return true;
        }

        /**
         * Start or restart replay of the currently loaded path.
         * @returns {boolean}
         */
        replay() {
            if (!this._activePath) {
                log.warn("No path loaded for autonomous replay.");
                return false;
            }

            this.stop();
            this._currentIndex = 0;
            this._state = STATE.REPLAYING;
            this._syncUI();

            log.info("Autonomous mission playback started.");
            this._emitCommand("mode:auto", "Autonomous mode engaged");
            this._step();

            this._timerId = global.setInterval(() => this._step(), this._playbackSpeedMs);
            return true;
        }

        /**
         * Pause active replay.
         * @returns {boolean}
         */
        pause() {
            if (this._state !== STATE.REPLAYING) return false;

            if (this._timerId !== null) {
                global.clearInterval(this._timerId);
                this._timerId = null;
            }

            this._state = STATE.PAUSED;
            this._syncUI();
            log.info("Autonomous mission playback paused.");
            this._emitCommand("stop", "Playback paused by operator");
            return true;
        }

        /**
         * Resume paused replay.
         * @returns {boolean}
         */
        resume() {
            if (this._state !== STATE.PAUSED || !this._activePath) return false;

            this._state = STATE.REPLAYING;
            this._syncUI();
            log.info("Autonomous mission playback resumed.");
            this._emitCommand("mode:auto", "Autonomous mode resumed");

            this._timerId = global.setInterval(() => this._step(), this._playbackSpeedMs);
            return true;
        }

        /**
         * Stop replay and reset progress to zero.
         * @returns {boolean}
         */
        stop() {
            if (this._timerId !== null) {
                global.clearInterval(this._timerId);
                this._timerId = null;
            }

            if (this._state !== STATE.IDLE && this._state !== STATE.COMPLETED) {
                this._emitCommand("stop", "Autonomous mission stopped");
            }

            this._state = STATE.IDLE;
            this._currentIndex = 0;
            this._syncUI();
            return true;
        }

        /**
         * Delete a saved path from local storage by its ID.
         * @param {string} id - Path record ID
         * @returns {boolean}
         */
        deletePath(id) {
            if (!id) return false;

            const list = this._getStoredPaths();
            const filtered = list.filter((item) => item.id !== id);

            if (filtered.length === list.length) return false;

            this._saveStoredPaths(filtered);

            if (this._activePath && this._activePath.id === id) {
                this.stop();
                this._activePath = null;
                this._syncUI();
            }

            this._loadSavedPathsList();
            log.info(`Deleted saved path [${id}].`);
            return true;
        }

        /**
         * Save a coordinate array or path object directly into JSON storage.
         * @param {Object} pathRecord - Path data object
         * @returns {boolean}
         */
        savePath(pathRecord) {
            if (!pathRecord || !pathRecord.points || pathRecord.points.length < 2) return false;

            const record = {
                id: pathRecord.id || (Utils.generateUUID?.() || String(Date.now())),
                type: pathRecord.type || "auto-path",
                createdAt: pathRecord.createdAt || new Date().toISOString(),
                points: pathRecord.points,
                name: pathRecord.name || `Survey Route #${Math.floor(Math.random() * 900) + 100}`
            };

            const list = this._getStoredPaths();
            list.unshift(record);
            this._saveStoredPaths(list);
            this._loadSavedPathsList();
            log.info(`Saved survey path to library: [${record.id}]`);
            return true;
        }

        /**
         * Trigger file download of a path record as JSON.
         * @param {string} [id] - Optional ID; defaults to active loaded path
         */
        exportPathJSON(id) {
            let target = this._activePath;
            if (id) {
                target = this._getStoredPaths().find((item) => item.id === id) || target;
            }

            if (!target) {
                log.warn("No path available to export.");
                return;
            }

            try {
                const blob = new Blob([JSON.stringify(target, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const link = Utils.createElement("a", {
                    attributes: {
                        href: url,
                        download: `sarathi-path-${(target.id || "route").slice(0, 8)}.json`
                    }
                });
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                global.setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (error) {
                log.error("Failed to export path JSON:", error);
            }
        }

        /**
         * Get current module status.
         * @returns {Object}
         */
        getStatus() {
            return {
                initialized: this._initialized,
                state: this._state,
                loadedPathId: this._activePath ? this._activePath.id : null,
                currentIndex: this._currentIndex,
                totalPoints: this._activePath ? this._activePath.points.length : 0,
                speedMs: this._playbackSpeedMs
            };
        }

        /* ==================================================================
         * INTERFACE CONSTRUCTION
         * ================================================================== */

        /** @private */
        _buildInterface() {
            const body = this._elements.body;
            const placeholder = body.querySelector('[data-module="auto-mode"]');
            if (placeholder) placeholder.remove();

            /* Top control and progress panel */
            const controlCard = Utils.createElement("div", { classes: "automode-control-panel" });

            const headerRow = Utils.createElement("div", { classes: "automode-header-row" });
            const titleGroup = Utils.createElement("div", { classes: "automode-title-group" });
            const pathTitle = Utils.createElement("h3", { classes: "automode-path-title", text: "No Path Loaded" });
            const pathMeta = Utils.createElement("span", { classes: "automode-path-meta", text: "Select a route from the library below or import a JSON file." });
            titleGroup.append(pathTitle, pathMeta);

            const statusBadge = Utils.createElement("span", {
                classes: ["card-badge", "badge-neutral", "automode-status-badge"],
                text: "Idle"
            });
            headerRow.append(titleGroup, statusBadge);

            /* Progress bar */
            const progressContainer = Utils.createElement("div", { classes: "automode-progress-container" });
            const progressInfo = Utils.createElement("div", { classes: "automode-progress-info" });
            const progressText = Utils.createElement("span", { classes: "automode-progress-text", text: "Waypoint 0 / 0 (0%)" });
            const speedSelect = Utils.createElement("select", {
                classes: "automode-speed-select",
                attributes: { "aria-label": "Playback speed" },
                html: `
                    <option value="1000">Slow (1.0s)</option>
                    <option value="600" selected>Normal (0.6s)</option>
                    <option value="300">Fast (0.3s)</option>
                    <option value="120">Turbo (0.12s)</option>
                `
            });
            progressInfo.append(progressText, speedSelect);

            const progressBar = Utils.createElement("div", {
                classes: "automode-progress-bar",
                attributes: { role: "progressbar", "aria-valuenow": "0", "aria-valuemin": "0", "aria-valuemax": "100" }
            });
            const progressFill = Utils.createElement("div", { classes: "automode-progress-fill" });
            progressBar.appendChild(progressFill);
            progressContainer.append(progressInfo, progressBar);

            /* Action buttons toolbar */
            const toolbar = Utils.createElement("div", { classes: "automode-toolbar" });
            const btnReplay = this._createBtn("automode-replay", "fa-play", "Replay", "btn-primary");
            const btnPause = this._createBtn("automode-pause", "fa-pause", "Pause", "btn-ghost");
            const btnResume = this._createBtn("automode-resume", "fa-play-circle", "Resume", "btn-ghost");
            const btnStop = this._createBtn("automode-stop", "fa-stop", "Stop", "btn-danger");
            const btnImport = this._createBtn("automode-import", "fa-file-import", "Import JSON", "btn-ghost");

            toolbar.append(btnReplay, btnPause, btnResume, btnStop, btnImport);
            controlCard.append(headerRow, progressContainer, toolbar);

            /* Hidden file input for importing JSON */
            const fileInput = Utils.createElement("input", {
                attributes: { type: "file", accept: ".json,application/json", style: "display:none" }
            });
            body.appendChild(fileInput);

            /* Library Section */
            const librarySection = Utils.createElement("div", { classes: "automode-library-section" });
            const libraryTitle = Utils.createElement("h4", { classes: "automode-library-title", text: "Saved Survey Routes Library" });
            const pathListContainer = Utils.createElement("div", { classes: "automode-path-list" });
            librarySection.append(libraryTitle, pathListContainer);

            body.append(controlCard, librarySection);

            Object.assign(this._elements, {
                statusBadge,
                pathTitle,
                pathMeta,
                progressBar,
                progressFill,
                progressText,
                btnReplay,
                btnPause,
                btnResume,
                btnStop,
                btnImport,
                speedSelect,
                pathListContainer,
                fileInput
            });
        }

        /** @private */
        _createBtn(id, icon, label, variant) {
            return Utils.createElement("button", {
                classes: ["btn", variant, "automode-btn"],
                attributes: { id, type: "button", "aria-label": label },
                html: `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span>`
            });
        }

        /* ==================================================================
         * EVENT BINDING
         * ================================================================== */

        /** @private */
        _bindEvents() {
            const { btnReplay, btnPause, btnResume, btnStop, btnImport, speedSelect, fileInput } = this._elements;

            this._cleanupHandlers.push(
                Utils.on?.(btnReplay, "click", () => this.replay()) || (() => {}),
                Utils.on?.(btnPause, "click", () => this.pause()) || (() => {}),
                Utils.on?.(btnResume, "click", () => this.resume()) || (() => {}),
                Utils.on?.(btnStop, "click", () => this.stop()) || (() => {}),
                Utils.on?.(speedSelect, "change", (e) => {
                    this._playbackSpeedMs = Number(e.target.value) || 600;
                    if (this._state === STATE.REPLAYING) {
                        this.pause();
                        this.resume();
                    }
                }) || (() => {}),
                Utils.on?.(btnImport, "click", () => fileInput && fileInput.click()) || (() => {}),
                Utils.on?.(fileInput, "change", (e) => this._handleFileImport(e)) || (() => {})
            );

            /* Listen for paths saved by draw-line or free-draw */
            const onExternalSave = () => this._loadSavedPathsList();
            this._cleanupHandlers.push(
                Utils.on?.(window, "sarathi:draw-line:saved", onExternalSave) || (() => {}),
                Utils.on?.(window, "sarathi:free-draw:exported", onExternalSave) || (() => {})
            );
        }

        /** @private */
        _handleFileImport(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (this.loadPath(data)) {
                        this.savePath(data);
                        log.info(`Imported path JSON file: ${file.name}`);
                    }
                } catch (err) {
                    log.error("Failed to parse imported path JSON:", err);
                    this._flashStatus("JSON Parse Error", STATE.ERROR);
                }
            };
            reader.readAsText(file);
            event.target.value = "";
        }

        /* ==================================================================
         * PLAYBACK ENGINE
         * ================================================================== */

        /** @private */
        _step() {
            if (this._state !== STATE.REPLAYING || !this._activePath) return;

            const points = this._activePath.points;
            if (this._currentIndex >= points.length) {
                this._complete();
                return;
            }

            const pt = points[this._currentIndex];
            const nextPt = points[this._currentIndex + 1];

            /* Calculate estimated robot directional command */
            let cmdDirection = "forward";
            if (nextPt) {
                const dx = nextPt.x - pt.x;
                const dy = nextPt.y - pt.y;
                if (Math.abs(dx) > Math.abs(dy)) {
                    cmdDirection = dx > 0 ? "right" : "left";
                } else {
                    cmdDirection = dy > 0 ? "backward" : "forward";
                }
            }

            this._emitCommand(cmdDirection, `Executing waypoint #${this._currentIndex + 1}`);

            /* Dispatch progress event for robot-map and telemetry */
            Utils.dispatch?.(LOCAL_EVENTS.PROGRESS, {
                module: MODULE_ID,
                pathId: this._activePath.id,
                index: this._currentIndex,
                total: points.length,
                point: pt,
                percentage: Math.round(((this._currentIndex + 1) / points.length) * 100)
            });

            this._currentIndex++;
            this._syncUI();
        }

        /** @private */
        _complete() {
            if (this._timerId !== null) {
                global.clearInterval(this._timerId);
                this._timerId = null;
            }

            this._state = STATE.COMPLETED;
            this._syncUI();
            log.info("Autonomous mission playback successfully completed!");
            this._emitCommand("stop", "Mission waypoint sequence completed");
            Utils.dispatch?.(LOCAL_EVENTS.COMPLETED, { module: MODULE_ID, pathId: this._activePath?.id });
        }

        /** @private */
        _emitCommand(direction, reason) {
            Utils.dispatch?.(Constants.EVENTS?.COMMAND_SENT || "sarathi:command:sent", {
                type: direction.startsWith("mode:") ? direction : `motor:${direction}`,
                direction,
                source: "auto-mode",
                reason,
                waypoint: this._currentIndex,
                timestamp: Date.now()
            });
        }

        /* ==================================================================
         * STORAGE HELPERS
         * ================================================================== */

        /** @private */
        _getStoredPaths() {
            try {
                const namespace = Config.storage?.namespace || "sarathi_v1_";
                const key = namespace + (Config.storage?.keys?.savedPaths || "saved_paths");
                const raw = global.localStorage.getItem(key);
                const parsed = raw ? JSON.parse(raw) : [];
                return Array.isArray(parsed) ? parsed : [];
            } catch (error) {
                log.warn("Unable to read saved paths from local storage:", error);
                return [];
            }
        }

        /** @private */
        _saveStoredPaths(list) {
            try {
                const namespace = Config.storage?.namespace || "sarathi_v1_";
                const key = namespace + (Config.storage?.keys?.savedPaths || "saved_paths");
                global.localStorage.setItem(key, JSON.stringify(list));
            } catch (error) {
                log.warn("Unable to write saved paths to local storage:", error);
            }
        }

        /* ==================================================================
         * UI SYNC & RENDER
         * ================================================================== */

        /** @private */
        _syncUI() {
            const {
                statusBadge, pathTitle, pathMeta, progressFill,
                progressText, progressBar, btnReplay, btnPause, btnResume, btnStop
            } = this._elements;

            if (statusBadge) {
                statusBadge.className = "card-badge automode-status-badge";
                switch (this._state) {
                    case STATE.REPLAYING:
                        statusBadge.classList.add("badge-success");
                        statusBadge.textContent = "Replaying";
                        break;
                    case STATE.PAUSED:
                        statusBadge.classList.add("badge-warning");
                        statusBadge.textContent = "Paused";
                        break;
                    case STATE.COMPLETED:
                        statusBadge.classList.add("badge-success");
                        statusBadge.textContent = "Completed";
                        break;
                    case STATE.ERROR:
                        statusBadge.classList.add("badge-danger");
                        statusBadge.textContent = "Error";
                        break;
                    default:
                        statusBadge.classList.add("badge-neutral");
                        statusBadge.textContent = "Idle";
                }
            }

            if (pathTitle && pathMeta) {
                if (this._activePath) {
                    const count = this._activePath.points ? this._activePath.points.length : 0;
                    pathTitle.textContent = this._activePath.name || `Route [${(this._activePath.id || "").slice(0, 8)}]`;
                    pathMeta.textContent = `Type: ${this._activePath.type || "survey"} · ${count} waypoints · Created: ${new Date(this._activePath.createdAt || Date.now()).toLocaleDateString()}`;
                } else {
                    pathTitle.textContent = "No Path Loaded";
                    pathMeta.textContent = "Select a route from the library below or import a JSON file.";
                }
            }

            const total = this._activePath && this._activePath.points ? this._activePath.points.length : 0;
            const pct = total > 0 ? Math.min(100, Math.round((this._currentIndex / total) * 100)) : 0;

            if (progressFill) progressFill.style.width = `${pct}%`;
            if (progressBar) progressBar.setAttribute("aria-valuenow", String(pct));
            if (progressText) progressText.textContent = `Waypoint ${this._currentIndex} / ${total} (${pct}%)`;

            const hasPath = !!this._activePath && total > 0;
            const isReplaying = this._state === STATE.REPLAYING;
            const isPaused = this._state === STATE.PAUSED;

            if (btnReplay) btnReplay.style.display = isPaused ? "none" : "inline-flex";
            if (btnResume) btnResume.style.display = isPaused ? "inline-flex" : "none";

            if (btnReplay) btnReplay.disabled = !hasPath || isReplaying;
            if (btnPause) btnPause.disabled = !isReplaying;
            if (btnResume) btnResume.disabled = !isPaused;
            if (btnStop) btnStop.disabled = !isReplaying && !isPaused && this._state !== STATE.COMPLETED;
        }

        /** @private */
        _flashStatus(text, stateType) {
            const statusBadge = this._elements.statusBadge;
            if (!statusBadge) return;
            const prevText = statusBadge.textContent;
            statusBadge.textContent = text;
            statusBadge.className = `card-badge automode-status-badge badge-${stateType === STATE.ERROR ? "danger" : "warning"}`;
            global.setTimeout(() => this._syncUI(), 2500);
        }

        /** @private */
        _loadSavedPathsList() {
            const container = this._elements.pathListContainer;
            if (!container) return;

            const list = this._getStoredPaths();
            container.innerHTML = "";

            if (list.length === 0) {
                const emptyMsg = Utils.createElement("p", {
                    classes: "automode-empty-list",
                    text: "No saved survey paths found. Use Draw Line or Free Draw to create and save routes."
                });
                container.appendChild(emptyMsg);
                return;
            }

            const table = Utils.createElement("table", { classes: "automode-table" });
            table.innerHTML = `
                <thead>
                    <tr>
                        <th>Route ID</th>
                        <th>Type</th>
                        <th>Waypoints</th>
                        <th>Date</th>
                        <th style="text-align:right;">Actions</th>
                    </tr>
                </thead>
            `;

            const tbody = Utils.createElement("tbody");

            list.forEach((item) => {
                const count = item.points ? item.points.length : (item.strokeCount || 0);
                const dateStr = new Date(item.createdAt || Date.now()).toLocaleDateString();
                const tr = Utils.createElement("tr");

                const isLoaded = this._activePath && this._activePath.id === item.id;
                if (isLoaded) tr.classList.add("is-loaded-row");

                tr.innerHTML = `
                    <td><strong>${item.name || (item.id || "").slice(0, 8)}</strong></td>
                    <td><span class="code-badge">${item.type || "path"}</span></td>
                    <td>${count} pts</td>
                    <td>${dateStr}</td>
                    <td class="automode-actions-cell" style="text-align:right;"></td>
                `;

                const actionCell = tr.querySelector(".automode-actions-cell");

                const btnLoad = Utils.createElement("button", {
                    classes: ["btn", isLoaded ? "btn-primary" : "btn-ghost", "btn-sm"],
                    attributes: { type: "button", "aria-label": `Load path ${item.id}` },
                    html: `<i class="fa-solid fa-folder-open"></i><span>${isLoaded ? "Loaded" : "Load"}</span>`
                });

                const btnExport = Utils.createElement("button", {
                    classes: ["btn", "btn-ghost", "btn-sm"],
                    attributes: { type: "button", "aria-label": `Export path ${item.id}` },
                    html: `<i class="fa-solid fa-download"></i>`
                });

                const btnDel = Utils.createElement("button", {
                    classes: ["btn", "btn-ghost", "btn-sm", "text-danger"],
                    attributes: { type: "button", "aria-label": `Delete path ${item.id}` },
                    html: `<i class="fa-solid fa-trash"></i>`
                });

                Utils.on?.(btnLoad, "click", () => {
                    this.loadPath(item);
                    this._loadSavedPathsList();
                });
                Utils.on?.(btnExport, "click", () => this.exportPathJSON(item.id));
                Utils.on?.(btnDel, "click", () => this.deletePath(item.id));

                actionCell.append(btnLoad, btnExport, btnDel);
                tbody.appendChild(tr);
            });

            table.appendChild(tbody);
            container.appendChild(table);
        }
    }

    global.Sarathi.Modules[MODULE_ID] = new AutoModeModule();

})(typeof window !== "undefined" ? window : this);
