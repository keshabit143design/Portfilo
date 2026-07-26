/**
 * ============================================================================
 * MISSION CONTROL — SMART SURVEY ROBOT — modules/draw-line.js
 * ----------------------------------------------------------------------------
 * Draw Line Module — single-path waypoint plotter
 *
 * Capabilities
 *   • Canvas workspace with mission grid + HiDPI scaling
 *   • Draw ONE continuous line (click/tap to append waypoints)
 *   • Undo / Redo history stack
 *   • Clear workspace
 *   • Save path (localStorage + event emission)
 *   • Returns a coordinate array via getCoordinates()
 *
 * No ESP32 communication. No path transmission. Frontend geometry only.
 *
 * Registered at: window.Sarathi.Modules["draw-line"]
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

    const MODULE_ID = Constants.MODULES?.DRAW_LINE || "draw-line";

    /* Local event names (no drawing events exist in constants.js yet) */
    const LOCAL_EVENTS = {
        UPDATED: "sarathi:draw-line:updated",
        SAVED: "sarathi:draw-line:saved",
        CLEARED: "sarathi:draw-line:cleared"
    };

    /* Geometry / rendering constants */
    const GRID_SPACING_PX = 32;
    const POINT_RADIUS = 6;
    const HIT_RADIUS = 14;
    const MAX_WAYPOINTS = 64;

    /**
     * @class DrawLineModule
     * @description Single-path waypoint editor on a 2D canvas.
     */
    class DrawLineModule {
        constructor() {
            this._initialized = false;

            /** @private @type {Array<{x:number,y:number}>} Committed waypoints (pixel space) */
            this._points = [];

            /** @private @type {Array<Array<{x:number,y:number}>>} Undo stack of snapshots */
            this._undoStack = [];

            /** @private @type {Array<Array<{x:number,y:number}>>} Redo stack of snapshots */
            this._redoStack = [];

            /** @private @type {{x:number,y:number}|null} Live cursor preview position */
            this._cursor = null;

            /** @private @type {boolean} Waypoint plotting is armed only after Start */
            this._armed = false;

            /** @private */
            this._dpr = 1;

            /** @private */
            this._cleanupHandlers = [];

            /** @private */
            this._resizeObserver = null;

            /** @private */
            this._elements = {
                body: null,
                canvas: null,
                ctx: null,
                stage: null,
                readout: null,
                btnUndo: null,
                btnRedo: null,
                btnClear: null,
                btnSave: null
            };
        }

        /* ==================================================================
         * LIFECYCLE
         * ================================================================== */

        /**
         * Initialize the draw-line workspace.
         * @returns {Promise<boolean>}
         */
        async init() {
            if (this._initialized) return true;

            this._elements.body = Utils.byId?.("draw-line-body");
            if (!this._elements.body) {
                log.debug("Draw Line card body not found; module idle.");
                return false;
            }

            log.info("Initializing draw-line module...");

            try {
                this._buildInterface();
                this._bindCanvasEvents();
                this._bindToolbarEvents();
                this._observeResize();
                this._resizeCanvas();
                this._render();
                this._syncToolbarState();

                this._initialized = true;
                return true;
            } catch (error) {
                log.error("Draw-line initialization failed:", error);
                return false;
            }
        }

        /**
         * Tear down listeners, observers and canvas references.
         */
        dispose() {
            while (this._cleanupHandlers.length > 0) {
                const off = this._cleanupHandlers.pop();
                if (typeof off === "function") {
                    try { off(); } catch (_) { /* noop */ }
                }
            }

            if (this._resizeObserver) {
                this._resizeObserver.disconnect();
                this._resizeObserver = null;
            }

            this._points = [];
            this._undoStack = [];
            this._redoStack = [];
            this._cursor = null;
            this._initialized = false;
        }

        /* ==================================================================
         * PUBLIC API
         * ================================================================== */

        /**
         * Return the plotted path as a coordinate array.
         * @param {Object} [options={}]
         * @param {boolean} [options.normalized=true] Include 0..1 normalized coords
         * @returns {Array<{index:number,x:number,y:number,nx:number,ny:number}>}
         */
        getCoordinates(options = {}) {
            const normalized = options.normalized !== false;
            const width = this._logicalWidth() || 1;
            const height = this._logicalHeight() || 1;

            return this._points.map((point, index) => {
                const coordinate = {
                    index,
                    x: Math.round(point.x),
                    y: Math.round(point.y)
                };

                if (normalized) {
                    coordinate.nx = Number((point.x / width).toFixed(4));
                    coordinate.ny = Number((point.y / height).toFixed(4));
                }

                return coordinate;
            });
        }

        /**
         * Append a waypoint to the single active line.
         * @param {number} x - Canvas-space X
         * @param {number} y - Canvas-space Y
         * @returns {boolean} Whether the point was added
         */
        addPoint(x, y) {
            if (this._points.length >= MAX_WAYPOINTS) {
                log.warn(`Waypoint limit reached (${MAX_WAYPOINTS}).`);
                return false;
            }

            this._pushHistory();
            this._points.push({ x, y });
            this._redoStack.length = 0;

            this._afterMutation();
            return true;
        }

        /**
         * Undo the last waypoint mutation.
         * @returns {boolean} Whether an undo was applied
         */
        undo() {
            if (this._undoStack.length === 0) return false;

            this._redoStack.push(this._snapshot());
            this._points = this._undoStack.pop();

            this._afterMutation();
            return true;
        }

        /**
         * Redo the last undone mutation.
         * @returns {boolean} Whether a redo was applied
         */
        redo() {
            if (this._redoStack.length === 0) return false;

            this._undoStack.push(this._snapshot());
            this._points = this._redoStack.pop();

            this._afterMutation();
            return true;
        }

        /**
         * Clear all waypoints (undoable).
         * @returns {boolean}
         */
        clear() {
            if (this._points.length === 0) return false;

            this._pushHistory();
            this._points = [];
            this._redoStack.length = 0;

            this._afterMutation();
            Utils.dispatch?.(LOCAL_EVENTS.CLEARED, { module: MODULE_ID });
            return true;
        }

        /**
         * Persist the current path to local storage and emit a saved event.
         * @returns {{id:string,createdAt:string,points:Array}|null} Saved record
         */
        save() {
            if (this._points.length < 2) {
                log.warn("Path requires at least two waypoints before saving.");
                this._flashReadout("Need at least 2 waypoints");
                return null;
            }

            const record = {
                id: Utils.generateUUID?.() || String(Date.now()),
                type: "draw-line",
                createdAt: new Date().toISOString(),
                width: Math.round(this._logicalWidth()),
                height: Math.round(this._logicalHeight()),
                points: this.getCoordinates()
            };

            this._persist(record);
            Utils.dispatch?.(LOCAL_EVENTS.SAVED, record);
            this._flashReadout(`Saved ${record.points.length} waypoints`);
            log.info(`Draw-line path saved (${record.points.length} waypoints).`);

            return record;
        }

        /**
         * Current module status snapshot.
         * @returns {{initialized:boolean,points:number,canUndo:boolean,canRedo:boolean}}
         */
        getStatus() {
            return {
                initialized: this._initialized,
                points: this._points.length,
                canUndo: this._undoStack.length > 0,
                canRedo: this._redoStack.length > 0
            };
        }

        /* ==================================================================
         * INTERFACE CONSTRUCTION
         * ================================================================== */

        /** @private */
        _buildInterface() {
            const body = this._elements.body;

            /* Remove the static placeholder shipped in index.html */
            const placeholder = body.querySelector('[data-module="draw-line"]');
            if (placeholder) placeholder.remove();

            /* Arming controls — plotting stays disarmed until Start */
            const armBar = this._createArmBar("Line Drawing");

            const stage = Utils.createElement("div", { classes: "drawline-stage" });
            const canvas = Utils.createElement("canvas", {
                classes: "drawline-canvas",
                attributes: {
                    id: "draw-line-canvas",
                    role: "application",
                    tabindex: "0",
                    "aria-label": "Line path drawing canvas. Click to place waypoints."
                }
            });

            this._elements.veil = Utils.createElement("div", {
                classes: "mode-veil",
                attributes: { id: "draw-line-veil", "aria-hidden": "true" },
                html: '<i class="fa-solid fa-pen-ruler" aria-hidden="true"></i><span>Disarmed — press Start to plot waypoints</span>'
            });

            stage.append(canvas, this._elements.veil);

            const toolbar = Utils.createElement("div", { classes: "drawline-toolbar" });

            const btnUndo = this._createToolButton("draw-line-undo", "fa-rotate-left", "Undo", "btn-ghost");
            const btnRedo = this._createToolButton("draw-line-redo", "fa-rotate-right", "Redo", "btn-ghost");
            const btnClear = this._createToolButton("draw-line-clear", "fa-trash-can", "Clear", "btn-ghost");
            const btnSave = this._createToolButton("draw-line-save", "fa-floppy-disk", "Save", "btn-primary");

            toolbar.append(btnUndo, btnRedo, btnClear, btnSave);

            const readout = Utils.createElement("p", {
                classes: "drawline-readout",
                attributes: { id: "draw-line-readout", role: "status", "aria-live": "polite" },
                text: "Click the canvas to plot waypoints."
            });

            body.append(armBar, stage, toolbar, readout);

            Object.assign(this._elements, {
                stage,
                canvas,
                ctx: canvas.getContext("2d"),
                readout,
                btnUndo,
                btnRedo,
                btnClear,
                btnSave
            });
        }

        /** @private Build the shared Start/Stop arming bar. */
        _createArmBar(labelText) {
            const bar = Utils.createElement("div", {
                classes: "arm-bar",
                attributes: { role: "group", "aria-label": `${labelText} arming controls` }
            });

            const dot = Utils.createElement("span", { classes: "arm-dot", attributes: { "aria-hidden": "true" } });
            const label = Utils.createElement("span", { classes: "arm-label", text: labelText });
            const state = Utils.createElement("span", { classes: "arm-state", text: "Disarmed" });

            const btnStart = Utils.createElement("button", {
                classes: ["btn", "btn-primary", "arm-btn"],
                attributes: { type: "button", "aria-label": `Start ${labelText.toLowerCase()}` },
                html: '<i class="fa-solid fa-play" aria-hidden="true"></i><span>Start</span>'
            });
            const btnStop = Utils.createElement("button", {
                classes: ["btn", "btn-danger", "arm-btn"],
                attributes: { type: "button", "aria-label": `Stop ${labelText.toLowerCase()}`, disabled: "true" },
                html: '<i class="fa-solid fa-stop" aria-hidden="true"></i><span>Stop</span>'
            });

            bar.append(dot, label, state, btnStart, btnStop);

            this._elements.armBar = bar;
            this._elements.armState = state;
            this._elements.btnArmStart = btnStart;
            this._elements.btnArmStop = btnStop;

            this._cleanupHandlers.push(
                Utils.on?.(btnStart, "click", () => this.setArmed(true)) || (() => {}),
                Utils.on?.(btnStop, "click", () => this.setArmed(false)) || (() => {})
            );

            return bar;
        }

        /** @private Arm or disarm waypoint plotting. */
        setArmed(armed) {
            this._armed = !!armed;

            const { armBar, armState, btnArmStart, btnArmStop, veil } = this._elements;
            if (armBar) armBar.classList.toggle("is-armed", this._armed);
            if (armState) armState.textContent = this._armed ? "Armed" : "Disarmed";
            if (btnArmStart) btnArmStart.disabled = this._armed;
            if (btnArmStop) btnArmStop.disabled = !this._armed;
            if (veil) veil.hidden = this._armed;

            if (!this._armed) {
                this._cursor = null;
                this._render();
            }

            Utils.dispatch?.(LOCAL_EVENTS.UPDATED, {
                module: MODULE_ID,
                armed: this._armed,
                count: this._points.length
            });
        }

        /** @private */
        _createToolButton(id, icon, label, variant) {
            return Utils.createElement("button", {
                classes: ["btn", variant, "drawline-btn"],
                attributes: { id, type: "button", "aria-label": `${label} path` },
                html: `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span>`
            });
        }

        /* ==================================================================
         * EVENT BINDING
         * ================================================================== */

        /** @private */
        _bindCanvasEvents() {
            const canvas = this._elements.canvas;

            const toLocal = (clientX, clientY) => {
                const rect = canvas.getBoundingClientRect();
                return {
                    x: Utils.clamp?.(clientX - rect.left, 0, rect.width) ?? 0,
                    y: Utils.clamp?.(clientY - rect.top, 0, rect.height) ?? 0
                };
            };

            const onClick = (event) => {
                if (!this._armed) {
                    this._flashReadout("Press Start to arm drawing");
                    return;
                }
                const local = toLocal(event.clientX, event.clientY);
                this.addPoint(local.x, local.y);
            };

            const onMove = Utils.throttle?.((event) => {
                this._cursor = toLocal(event.clientX, event.clientY);
                this._render();
            }, 24) || (() => {});

            const onLeave = () => {
                this._cursor = null;
                this._render();
            };

            const onTouch = (event) => {
                if (!event.touches || event.touches.length === 0) return;
                if (!this._armed) return;
                event.preventDefault();
                const touch = event.touches[0];
                const local = toLocal(touch.clientX, touch.clientY);
                this.addPoint(local.x, local.y);
            };

            /* Keyboard accessibility: Ctrl+Z / Ctrl+Y while canvas focused */
            const onKeyDown = (event) => {
                if (!event.ctrlKey && !event.metaKey) return;
                const key = event.key.toLowerCase();
                if (key === "z") {
                    event.preventDefault();
                    this.undo();
                } else if (key === "y") {
                    event.preventDefault();
                    this.redo();
                }
            };

            this._cleanupHandlers.push(
                Utils.on?.(canvas, "click", onClick) || (() => {}),
                Utils.on?.(canvas, "mousemove", onMove) || (() => {}),
                Utils.on?.(canvas, "mouseleave", onLeave) || (() => {}),
                Utils.on?.(canvas, "touchstart", onTouch, { passive: false }) || (() => {}),
                Utils.on?.(canvas, "keydown", onKeyDown) || (() => {})
            );
        }

        /** @private */
        _bindToolbarEvents() {
            const { btnUndo, btnRedo, btnClear, btnSave } = this._elements;

            this._cleanupHandlers.push(
                Utils.on?.(btnUndo, "click", () => this.undo()) || (() => {}),
                Utils.on?.(btnRedo, "click", () => this.redo()) || (() => {}),
                Utils.on?.(btnClear, "click", () => this.clear()) || (() => {}),
                Utils.on?.(btnSave, "click", () => this.save()) || (() => {})
            );
        }

        /** @private */
        _observeResize() {
            if (typeof ResizeObserver === "undefined") {
                const onWindowResize = Utils.debounce?.(() => {
                    this._resizeCanvas();
                    this._render();
                }, 150) || (() => {});
                this._cleanupHandlers.push(Utils.on?.(global, "resize", onWindowResize) || (() => {}));
                return;
            }

            this._resizeObserver = new ResizeObserver(() => {
                this._resizeCanvas();
                this._render();
            });
            this._resizeObserver.observe(this._elements.stage);
        }

        /* ==================================================================
         * CANVAS SIZING & RENDERING
         * ================================================================== */

        /** @private */
        _logicalWidth() {
            return this._elements.canvas ? this._elements.canvas.clientWidth : 0;
        }

        /** @private */
        _logicalHeight() {
            return this._elements.canvas ? this._elements.canvas.clientHeight : 0;
        }

        /** @private */
        _resizeCanvas() {
            const canvas = this._elements.canvas;
            const ctx = this._elements.ctx;
            if (!canvas || !ctx) return;

            this._dpr = global.devicePixelRatio || 1;
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;
            if (width === 0 || height === 0) return;

            canvas.width = Math.round(width * this._dpr);
            canvas.height = Math.round(height * this._dpr);
            ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
        }

        /** @private */
        _render() {
            const ctx = this._elements.ctx;
            if (!ctx) return;

            const width = this._logicalWidth();
            const height = this._logicalHeight();
            if (width === 0 || height === 0) return;

            ctx.clearRect(0, 0, width, height);
            this._drawGrid(ctx, width, height);
            this._drawPreviewSegment(ctx);
            this._drawPath(ctx);
            this._drawWaypoints(ctx);
        }

        /** @private */
        _drawGrid(ctx, width, height) {
            ctx.save();
            ctx.strokeStyle = "rgba(45, 212, 191, 0.10)";
            ctx.lineWidth = 1;

            for (let x = GRID_SPACING_PX; x < width; x += GRID_SPACING_PX) {
                ctx.beginPath();
                ctx.moveTo(x + 0.5, 0);
                ctx.lineTo(x + 0.5, height);
                ctx.stroke();
            }

            for (let y = GRID_SPACING_PX; y < height; y += GRID_SPACING_PX) {
                ctx.beginPath();
                ctx.moveTo(0, y + 0.5);
                ctx.lineTo(width, y + 0.5);
                ctx.stroke();
            }

            ctx.restore();
        }

        /** @private */
        _drawPath(ctx) {
            if (this._points.length < 2) return;

            ctx.save();
            ctx.strokeStyle = "#2dd4bf";
            ctx.lineWidth = 3;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.shadowColor = "rgba(45, 212, 191, 0.55)";
            ctx.shadowBlur = 12;

            ctx.beginPath();
            ctx.moveTo(this._points[0].x, this._points[0].y);
            for (let i = 1; i < this._points.length; i++) {
                ctx.lineTo(this._points[i].x, this._points[i].y);
            }
            ctx.stroke();
            ctx.restore();
        }

        /** @private */
        _drawPreviewSegment(ctx) {
            if (!this._cursor || this._points.length === 0) return;

            const last = this._points[this._points.length - 1];

            ctx.save();
            ctx.strokeStyle = "rgba(245, 158, 11, 0.55)";
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(last.x, last.y);
            ctx.lineTo(this._cursor.x, this._cursor.y);
            ctx.stroke();
            ctx.restore();
        }

        /** @private */
        _drawWaypoints(ctx) {
            this._points.forEach((point, index) => {
                const isStart = index === 0;
                const isEnd = index === this._points.length - 1 && this._points.length > 1;

                ctx.save();
                ctx.beginPath();
                ctx.arc(point.x, point.y, POINT_RADIUS, 0, Math.PI * 2);

                if (isStart) {
                    ctx.fillStyle = "#2bd576";
                } else if (isEnd) {
                    ctx.fillStyle = "#ff4d6d";
                } else {
                    ctx.fillStyle = "#fbbf24";
                }

                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = "rgba(4, 15, 14, 0.85)";
                ctx.stroke();
                ctx.restore();
            });
        }

        /* ==================================================================
         * STATE HELPERS
         * ================================================================== */

        /** @private */
        _snapshot() {
            return this._points.map((point) => ({ x: point.x, y: point.y }));
        }

        /** @private */
        _pushHistory() {
            this._undoStack.push(this._snapshot());
            if (this._undoStack.length > 100) this._undoStack.shift();
        }

        /** @private */
        _afterMutation() {
            this._render();
            this._syncToolbarState();
            this._updateReadout();

            Utils.dispatch?.(LOCAL_EVENTS.UPDATED, {
                module: MODULE_ID,
                count: this._points.length,
                coordinates: this.getCoordinates()
            });
        }

        /** @private */
        _syncToolbarState() {
            const { btnUndo, btnRedo, btnClear, btnSave } = this._elements;
            if (btnUndo) btnUndo.disabled = this._undoStack.length === 0;
            if (btnRedo) btnRedo.disabled = this._redoStack.length === 0;
            if (btnClear) btnClear.disabled = this._points.length === 0;
            if (btnSave) btnSave.disabled = this._points.length < 2;
        }

        /** @private */
        _updateReadout() {
            const readout = this._elements.readout;
            if (!readout) return;

            if (this._points.length === 0) {
                readout.textContent = "Click the canvas to plot waypoints.";
                return;
            }

            const distance = this._totalDistance();
            readout.textContent =
                `${this._points.length} waypoint${this._points.length === 1 ? "" : "s"} · ` +
                `path length ${Math.round(distance)} px`;
        }

        /** @private */
        _flashReadout(message) {
            const readout = this._elements.readout;
            if (!readout) return;

            readout.textContent = message;
            global.setTimeout(() => this._updateReadout(), 2200);
        }

        /** @private */
        _totalDistance() {
            let total = 0;
            for (let i = 1; i < this._points.length; i++) {
                const dx = this._points[i].x - this._points[i - 1].x;
                const dy = this._points[i].y - this._points[i - 1].y;
                total += Math.sqrt(dx * dx + dy * dy);
            }
            return total;
        }

        /** @private */
        _persist(record) {
            try {
                const namespace = Config.storage?.namespace || "sarathi_v1_";
                const key = namespace + (Config.storage?.keys?.savedPaths || "saved_paths");
                const limit = Config.storage?.maxSavedPaths || 30;

                const raw = global.localStorage.getItem(key);
                const existing = raw ? JSON.parse(raw) : [];
                const list = Array.isArray(existing) ? existing : [];

                list.unshift(record);
                global.localStorage.setItem(key, JSON.stringify(list.slice(0, limit)));
            } catch (error) {
                log.warn("Unable to persist path to local storage:", error);
            }
        }
    }

    const drawLineInstance = new DrawLineModule();
    global.Sarathi.Modules[MODULE_ID] = drawLineInstance;

    /* Self-bootstrap: the ES-module dashboard pipeline cannot see IIFE
       exports, so the module initializes itself once the DOM is ready. */
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => drawLineInstance.init(), { once: true });
    } else {
        drawLineInstance.init();
    }

})(typeof window !== "undefined" ? window : this);
