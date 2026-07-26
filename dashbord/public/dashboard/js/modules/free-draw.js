/**
 * ============================================================================
 * MISSION CONTROL — SMART SURVEY ROBOT — modules/free-draw.js
 * ----------------------------------------------------------------------------
 * Free Draw Module — freehand path sketching workspace
 *
 * Capabilities
 *   • Transparent HiDPI canvas over a CSS mission grid
 *   • Smooth freehand drawing (quadratic midpoint interpolation)
 *   • Brush tool with adjustable size
 *   • Eraser tool (destination-out compositing)
 *   • Stroke-level Undo / Redo
 *   • Clear workspace
 *   • Export coordinates (JSON download + localStorage + event)
 *
 * No ESP32 communication. Frontend geometry only.
 *
 * Registered at: window.Sarathi.Modules["free-draw"]
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

    const MODULE_ID = Constants.MODULES?.FREE_DRAW || "free-draw";

    /* Local event names (no drawing events exist in constants.js yet) */
    const LOCAL_EVENTS = {
        UPDATED: "sarathi:free-draw:updated",
        EXPORTED: "sarathi:free-draw:exported",
        CLEARED: "sarathi:free-draw:cleared",
        TOOL_CHANGED: "sarathi:free-draw:tool-changed"
    };

    const TOOL = { BRUSH: "brush", ERASER: "eraser" };

    const BRUSH_MIN = 2;
    const BRUSH_MAX = 32;
    const BRUSH_DEFAULT = 6;
    const ERASER_SCALE = 2.4;          /* eraser is wider than brush at same setting */
    const MIN_POINT_DISTANCE = 1.6;    /* px — drops jitter samples */
    const SIMPLIFY_TOLERANCE = 1.5;    /* px — export-time point reduction */
    const HISTORY_LIMIT = 60;

    /**
     * @class FreeDrawModule
     * @description Freehand sketching surface with brush/eraser and history.
     */
    class FreeDrawModule {
        constructor() {
            this._initialized = false;

            /** @private @type {Array<{tool:string,size:number,points:Array<{x:number,y:number}>}>} */
            this._strokes = [];

            /** @private @type {Array<Array<Object>>} */
            this._undoStack = [];

            /** @private @type {Array<Array<Object>>} */
            this._redoStack = [];

            /** @private @type {Object|null} Stroke currently being drawn */
            this._activeStroke = null;

            /** @private */
            this._tool = TOOL.BRUSH;

            /** @private */
            this._brushSize = BRUSH_DEFAULT;

            /** @private */
            this._dpr = 1;

            /** @private */
            this._pointerId = null;

            /** @private @type {boolean} Sketching is armed only after Start */
            this._armed = false;

            /** @private */
            this._cleanupHandlers = [];

            /** @private */
            this._resizeObserver = null;

            /** @private */
            this._elements = {
                body: null,
                stage: null,
                canvas: null,
                ctx: null,
                readout: null,
                btnBrush: null,
                btnEraser: null,
                sizeInput: null,
                sizeLabel: null,
                btnUndo: null,
                btnRedo: null,
                btnClear: null,
                btnExport: null
            };
        }

        /* ==================================================================
         * LIFECYCLE
         * ================================================================== */

        /**
         * Initialize the free-draw workspace.
         * @returns {Promise<boolean>}
         */
        async init() {
            if (this._initialized) return true;

            this._elements.body = Utils.byId?.("free-draw-body");
            if (!this._elements.body) {
                log.debug("Free Draw card body not found; module idle.");
                return false;
            }

            log.info("Initializing free-draw module...");

            try {
                this._buildInterface();
                this._bindPointerEvents();
                this._bindToolbarEvents();
                this._observeResize();
                this._resizeCanvas();
                this._renderAll();
                this._syncToolbarState();

                this._initialized = true;
                return true;
            } catch (error) {
                log.error("Free-draw initialization failed:", error);
                return false;
            }
        }

        /**
         * Tear down listeners, observers and buffered strokes.
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

            this._strokes = [];
            this._undoStack = [];
            this._redoStack = [];
            this._activeStroke = null;
            this._initialized = false;
        }

        /* ==================================================================
         * PUBLIC API
         * ================================================================== */

        /**
         * Select the active drawing tool.
         * @param {"brush"|"eraser"} tool
         * @returns {boolean} Whether the tool changed
         */
        setTool(tool) {
            if (tool !== TOOL.BRUSH && tool !== TOOL.ERASER) return false;
            if (this._tool === tool) return false;

            this._tool = tool;
            this._syncToolbarState();
            Utils.dispatch?.(LOCAL_EVENTS.TOOL_CHANGED, { module: MODULE_ID, tool });
            return true;
        }

        /**
         * Set the brush/eraser radius in pixels.
         * @param {number} size
         * @returns {number} Applied size
         */
        setBrushSize(size) {
            this._brushSize = Utils.clamp?.(Number(size) || BRUSH_DEFAULT, BRUSH_MIN, BRUSH_MAX) ?? BRUSH_DEFAULT;
            this._syncToolbarState();
            return this._brushSize;
        }

        /**
         * Undo the most recent stroke.
         * @returns {boolean}
         */
        undo() {
            if (this._undoStack.length === 0) return false;

            this._redoStack.push(this._snapshot());
            this._strokes = this._undoStack.pop();

            this._afterMutation();
            return true;
        }

        /**
         * Redo the most recently undone stroke.
         * @returns {boolean}
         */
        redo() {
            if (this._redoStack.length === 0) return false;

            this._undoStack.push(this._snapshot());
            this._strokes = this._redoStack.pop();

            this._afterMutation();
            return true;
        }

        /**
         * Clear every stroke (undoable).
         * @returns {boolean}
         */
        clear() {
            if (this._strokes.length === 0) return false;

            this._pushHistory();
            this._strokes = [];
            this._redoStack.length = 0;

            this._afterMutation();
            Utils.dispatch?.(LOCAL_EVENTS.CLEARED, { module: MODULE_ID });
            return true;
        }

        /**
         * Return all brush strokes as coordinate arrays.
         * Eraser strokes are excluded — they are subtractive, not drivable.
         * @param {Object} [options={}]
         * @param {boolean} [options.normalized=true] Include 0..1 coordinates
         * @param {boolean} [options.simplify=true] Apply distance-based reduction
         * @returns {Array<{stroke:number,size:number,points:Array}>}
         */
        getCoordinates(options = {}) {
            const normalized = options.normalized !== false;
            const simplify = options.simplify !== false;
            const width = this._logicalWidth() || 1;
            const height = this._logicalHeight() || 1;

            return this._strokes
                .filter((stroke) => stroke.tool === TOOL.BRUSH && stroke.points.length > 0)
                .map((stroke, strokeIndex) => {
                    const source = simplify ? this._simplify(stroke.points, SIMPLIFY_TOLERANCE) : stroke.points;

                    return {
                        stroke: strokeIndex,
                        size: stroke.size,
                        points: source.map((point) => {
                            const coordinate = {
                                x: Math.round(point.x),
                                y: Math.round(point.y)
                            };
                            if (normalized) {
                                coordinate.nx = Number((point.x / width).toFixed(4));
                                coordinate.ny = Number((point.y / height).toFixed(4));
                            }
                            return coordinate;
                        })
                    };
                });
        }

        /**
         * Export the sketch: persists locally, emits an event, downloads JSON.
         * @returns {Object|null} Export record
         */
        exportCoordinates() {
            const strokes = this.getCoordinates();

            if (strokes.length === 0) {
                this._flashReadout("Nothing to export");
                return null;
            }

            const record = {
                id: Utils.generateUUID?.() || String(Date.now()),
                type: "free-draw",
                createdAt: new Date().toISOString(),
                width: Math.round(this._logicalWidth()),
                height: Math.round(this._logicalHeight()),
                strokeCount: strokes.length,
                pointCount: strokes.reduce((total, stroke) => total + stroke.points.length, 0),
                strokes
            };

            this._persist(record);
            this._download(record);
            Utils.dispatch?.(LOCAL_EVENTS.EXPORTED, record);
            this._flashReadout(`Exported ${record.strokeCount} stroke${record.strokeCount === 1 ? "" : "s"}`);
            log.info(`Free-draw exported (${record.pointCount} points).`);

            return record;
        }

        /**
         * Current module status snapshot.
         * @returns {Object}
         */
        getStatus() {
            return {
                initialized: this._initialized,
                tool: this._tool,
                brushSize: this._brushSize,
                strokes: this._strokes.length,
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

            const placeholder = body.querySelector('[data-module="free-draw"]');
            if (placeholder) placeholder.remove();

            /* Arming controls — sketching stays disarmed until Start */
            const armBar = this._createArmBar("Free Drawing");

            const stage = Utils.createElement("div", { classes: "freedraw-stage" });
            const canvas = Utils.createElement("canvas", {
                classes: "freedraw-canvas",
                attributes: {
                    id: "free-draw-canvas",
                    role: "application",
                    tabindex: "0",
                    "aria-label": "Freehand drawing canvas. Press and drag to sketch a path."
                }
            });

            this._elements.veil = Utils.createElement("div", {
                classes: "mode-veil",
                attributes: { id: "free-draw-veil", "aria-hidden": "true" },
                html: '<i class="fa-solid fa-signature" aria-hidden="true"></i><span>Disarmed — press Start to sketch</span>'
            });

            stage.append(canvas, this._elements.veil);

            /* Tool selector */
            const tools = Utils.createElement("div", {
                classes: "freedraw-tools",
                attributes: { role: "group", "aria-label": "Drawing tools" }
            });

            const btnBrush = this._createToolButton("free-draw-brush", "fa-paintbrush", "Brush");
            const btnEraser = this._createToolButton("free-draw-eraser", "fa-eraser", "Erase");
            tools.append(btnBrush, btnEraser);

            /* Size control */
            const sizeRow = Utils.createElement("div", { classes: "freedraw-size" });
            const sizeLabel = Utils.createElement("label", {
                classes: "freedraw-size-label",
                attributes: { for: "free-draw-size" },
                text: `Size ${BRUSH_DEFAULT}px`
            });
            const sizeInput = Utils.createElement("input", {
                classes: "freedraw-size-input",
                attributes: {
                    id: "free-draw-size",
                    type: "range",
                    min: String(BRUSH_MIN),
                    max: String(BRUSH_MAX),
                    step: "1",
                    value: String(BRUSH_DEFAULT),
                    "aria-label": "Brush size in pixels"
                }
            });
            sizeRow.append(sizeLabel, sizeInput);

            /* Action toolbar */
            const toolbar = Utils.createElement("div", { classes: "freedraw-toolbar" });
            const btnUndo = this._createActionButton("free-draw-undo", "fa-rotate-left", "Undo", "btn-ghost");
            const btnRedo = this._createActionButton("free-draw-redo", "fa-rotate-right", "Redo", "btn-ghost");
            const btnClear = this._createActionButton("free-draw-clear", "fa-trash-can", "Clear", "btn-ghost");
            const btnExport = this._createActionButton("free-draw-export", "fa-file-export", "Export", "btn-primary");
            toolbar.append(btnUndo, btnRedo, btnClear, btnExport);

            const readout = Utils.createElement("p", {
                classes: "freedraw-readout",
                attributes: { id: "free-draw-readout", role: "status", "aria-live": "polite" },
                text: "Press and drag on the canvas to sketch."
            });

            body.append(armBar, stage, tools, sizeRow, toolbar, readout);

            Object.assign(this._elements, {
                stage,
                canvas,
                ctx: canvas.getContext("2d"),
                readout,
                btnBrush,
                btnEraser,
                sizeInput,
                sizeLabel,
                btnUndo,
                btnRedo,
                btnClear,
                btnExport
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

        /** @private Arm or disarm freehand sketching. */
        setArmed(armed) {
            this._armed = !!armed;

            /* Interrupt any in-flight stroke when disarming mid-draw */
            if (!this._armed && this._activeStroke) {
                this._activeStroke = null;
                this._pointerId = null;
                this._afterMutation();
            }

            const { armBar, armState, btnArmStart, btnArmStop, veil } = this._elements;
            if (armBar) armBar.classList.toggle("is-armed", this._armed);
            if (armState) armState.textContent = this._armed ? "Armed" : "Disarmed";
            if (btnArmStart) btnArmStart.disabled = this._armed;
            if (btnArmStop) btnArmStop.disabled = !this._armed;
            if (veil) veil.hidden = this._armed;

            Utils.dispatch?.(LOCAL_EVENTS.UPDATED, {
                module: MODULE_ID,
                armed: this._armed,
                strokes: this._strokes.length
            });
        }

        /** @private */
        _createToolButton(id, icon, label) {
            return Utils.createElement("button", {
                classes: ["freedraw-tool"],
                attributes: {
                    id,
                    type: "button",
                    "aria-pressed": "false",
                    "aria-label": `${label} tool`
                },
                html: `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span>`
            });
        }

        /** @private */
        _createActionButton(id, icon, label, variant) {
            return Utils.createElement("button", {
                classes: ["btn", variant, "freedraw-btn"],
                attributes: { id, type: "button", "aria-label": `${label} sketch` },
                html: `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span>`
            });
        }

        /* ==================================================================
         * POINTER INPUT
         * ================================================================== */

        /** @private */
        _bindPointerEvents() {
            const canvas = this._elements.canvas;

            const toLocal = (event) => {
                const rect = canvas.getBoundingClientRect();
                return {
                    x: Utils.clamp?.(event.clientX - rect.left, 0, rect.width) ?? 0,
                    y: Utils.clamp?.(event.clientY - rect.top, 0, rect.height) ?? 0
                };
            };

            const onPointerDown = (event) => {
                if (!this._armed) {
                    this._flashReadout("Press Start to arm sketching");
                    return;
                }
                if (this._activeStroke) return;
                event.preventDefault();

                this._pointerId = event.pointerId;
                if (canvas.setPointerCapture) {
                    try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* noop */ }
                }

                this._pushHistory();
                this._redoStack.length = 0;

                const point = toLocal(event);
                this._activeStroke = {
                    tool: this._tool,
                    size: this._tool === TOOL.ERASER
                        ? this._brushSize * ERASER_SCALE
                        : this._brushSize,
                    points: [point]
                };
                this._strokes.push(this._activeStroke);

                /* Dot for a single tap */
                this._renderDot(this._activeStroke, point);
            };

            const onPointerMove = (event) => {
                if (!this._activeStroke || event.pointerId !== this._pointerId) return;
                event.preventDefault();

                const point = toLocal(event);
                const points = this._activeStroke.points;
                const last = points[points.length - 1];

                const dx = point.x - last.x;
                const dy = point.y - last.y;
                if ((dx * dx + dy * dy) < (MIN_POINT_DISTANCE * MIN_POINT_DISTANCE)) return;

                points.push(point);
                this._renderNewestSegment(this._activeStroke);
            };

            const onPointerUp = (event) => {
                if (!this._activeStroke || event.pointerId !== this._pointerId) return;

                if (canvas.releasePointerCapture) {
                    try { canvas.releasePointerCapture(event.pointerId); } catch (_) { /* noop */ }
                }

                this._activeStroke = null;
                this._pointerId = null;
                this._afterMutation();
            };

            /* Keyboard accessibility */
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
                Utils.on?.(canvas, "pointerdown", onPointerDown) || (() => {}),
                Utils.on?.(canvas, "pointermove", onPointerMove) || (() => {}),
                Utils.on?.(canvas, "pointerup", onPointerUp) || (() => {}),
                Utils.on?.(canvas, "pointercancel", onPointerUp) || (() => {}),
                Utils.on?.(canvas, "keydown", onKeyDown) || (() => {})
            );
        }

        /** @private */
        _bindToolbarEvents() {
            const {
                btnBrush, btnEraser, sizeInput,
                btnUndo, btnRedo, btnClear, btnExport
            } = this._elements;

            this._cleanupHandlers.push(
                Utils.on?.(btnBrush, "click", () => this.setTool(TOOL.BRUSH)) || (() => {}),
                Utils.on?.(btnEraser, "click", () => this.setTool(TOOL.ERASER)) || (() => {}),
                Utils.on?.(sizeInput, "input", (event) => this.setBrushSize(event.target.value)) || (() => {}),
                Utils.on?.(btnUndo, "click", () => this.undo()) || (() => {}),
                Utils.on?.(btnRedo, "click", () => this.redo()) || (() => {}),
                Utils.on?.(btnClear, "click", () => this.clear()) || (() => {}),
                Utils.on?.(btnExport, "click", () => this.exportCoordinates()) || (() => {})
            );
        }

        /** @private */
        _observeResize() {
            if (typeof ResizeObserver === "undefined") {
                const onWindowResize = Utils.debounce?.(() => {
                    this._resizeCanvas();
                    this._renderAll();
                }, 150) || (() => {});
                this._cleanupHandlers.push(Utils.on?.(global, "resize", onWindowResize) || (() => {}));
                return;
            }

            this._resizeObserver = new ResizeObserver(() => {
                this._resizeCanvas();
                this._renderAll();
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

        /** @private Apply stroke styling for a given stroke record. */
        _applyStrokeStyle(ctx, stroke) {
            ctx.lineWidth = stroke.size;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            if (stroke.tool === TOOL.ERASER) {
                ctx.globalCompositeOperation = "destination-out";
                ctx.strokeStyle = "rgba(0, 0, 0, 1)";
                ctx.fillStyle = "rgba(0, 0, 0, 1)";
                ctx.shadowBlur = 0;
            } else {
                ctx.globalCompositeOperation = "source-over";
                ctx.strokeStyle = "#2dd4bf";
                ctx.fillStyle = "#2dd4bf";
                ctx.shadowColor = "rgba(45, 212, 191, 0.45)";
                ctx.shadowBlur = 8;
            }
        }

        /** @private Render a single dot (tap without drag). */
        _renderDot(stroke, point) {
            const ctx = this._elements.ctx;
            if (!ctx) return;

            ctx.save();
            this._applyStrokeStyle(ctx, stroke);
            ctx.beginPath();
            ctx.arc(point.x, point.y, stroke.size / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        /**
         * Incrementally draw only the newest smoothed segment of a stroke.
         * Uses midpoint quadratic interpolation for smoothness.
         * @private
         */
        _renderNewestSegment(stroke) {
            const ctx = this._elements.ctx;
            const points = stroke.points;
            if (!ctx || points.length < 2) return;

            ctx.save();
            this._applyStrokeStyle(ctx, stroke);

            const count = points.length;

            if (count === 2) {
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                ctx.lineTo(points[1].x, points[1].y);
                ctx.stroke();
            } else {
                const p0 = points[count - 3];
                const p1 = points[count - 2];
                const p2 = points[count - 1];

                const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
                const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

                ctx.beginPath();
                ctx.moveTo(mid1.x, mid1.y);
                ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
                ctx.stroke();
            }

            ctx.restore();
        }

        /** @private Draw one complete stroke with smoothing. */
        _renderStroke(ctx, stroke) {
            const points = stroke.points;
            if (points.length === 0) return;

            ctx.save();
            this._applyStrokeStyle(ctx, stroke);

            if (points.length === 1) {
                ctx.beginPath();
                ctx.arc(points[0].x, points[0].y, stroke.size / 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                return;
            }

            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);

            for (let i = 1; i < points.length - 1; i++) {
                const current = points[i];
                const next = points[i + 1];
                const mid = { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 };
                ctx.quadraticCurveTo(current.x, current.y, mid.x, mid.y);
            }

            const last = points[points.length - 1];
            ctx.lineTo(last.x, last.y);
            ctx.stroke();
            ctx.restore();
        }

        /** @private Full repaint of every stroke. */
        _renderAll() {
            const ctx = this._elements.ctx;
            if (!ctx) return;

            const width = this._logicalWidth();
            const height = this._logicalHeight();
            if (width === 0 || height === 0) return;

            ctx.save();
            ctx.globalCompositeOperation = "source-over";
            ctx.clearRect(0, 0, width, height);
            ctx.restore();

            this._strokes.forEach((stroke) => this._renderStroke(ctx, stroke));
        }

        /* ==================================================================
         * STATE HELPERS
         * ================================================================== */

        /** @private Deep-copy the stroke list for history. */
        _snapshot() {
            return this._strokes.map((stroke) => ({
                tool: stroke.tool,
                size: stroke.size,
                points: stroke.points.map((point) => ({ x: point.x, y: point.y }))
            }));
        }

        /** @private */
        _pushHistory() {
            this._undoStack.push(this._snapshot());
            if (this._undoStack.length > HISTORY_LIMIT) this._undoStack.shift();
        }

        /** @private */
        _afterMutation() {
            this._renderAll();
            this._syncToolbarState();
            this._updateReadout();

            Utils.dispatch?.(LOCAL_EVENTS.UPDATED, {
                module: MODULE_ID,
                strokes: this._strokes.length,
                tool: this._tool
            });
        }

        /** @private */
        _syncToolbarState() {
            const {
                btnBrush, btnEraser, sizeInput, sizeLabel,
                btnUndo, btnRedo, btnClear, btnExport
            } = this._elements;

            const isBrush = this._tool === TOOL.BRUSH;

            if (btnBrush) {
                btnBrush.classList.toggle("is-active", isBrush);
                btnBrush.setAttribute("aria-pressed", String(isBrush));
            }
            if (btnEraser) {
                btnEraser.classList.toggle("is-active", !isBrush);
                btnEraser.setAttribute("aria-pressed", String(!isBrush));
            }
            if (sizeInput) sizeInput.value = String(this._brushSize);
            if (sizeLabel) sizeLabel.textContent = `Size ${this._brushSize}px`;

            const hasBrushStrokes = this._strokes.some((stroke) => stroke.tool === TOOL.BRUSH);

            if (btnUndo) btnUndo.disabled = this._undoStack.length === 0;
            if (btnRedo) btnRedo.disabled = this._redoStack.length === 0;
            if (btnClear) btnClear.disabled = this._strokes.length === 0;
            if (btnExport) btnExport.disabled = !hasBrushStrokes;
        }

        /** @private */
        _updateReadout() {
            const readout = this._elements.readout;
            if (!readout) return;

            if (this._strokes.length === 0) {
                readout.textContent = "Press and drag on the canvas to sketch.";
                return;
            }

            const brushStrokes = this._strokes.filter((s) => s.tool === TOOL.BRUSH).length;
            const eraseStrokes = this._strokes.length - brushStrokes;
            const points = this._strokes.reduce((total, s) => total + s.points.length, 0);

            let text = `${brushStrokes} stroke${brushStrokes === 1 ? "" : "s"} · ${points} points`;
            if (eraseStrokes > 0) {
                text += ` · ${eraseStrokes} erase`;
            }
            readout.textContent = text;
        }

        /** @private */
        _flashReadout(message) {
            const readout = this._elements.readout;
            if (!readout) return;

            readout.textContent = message;
            global.setTimeout(() => this._updateReadout(), 2200);
        }

        /**
         * Distance-based point reduction (perpendicular-free, cheap and stable).
         * @private
         */
        _simplify(points, tolerance) {
            if (points.length <= 2) return points.slice();

            const result = [points[0]];
            const toleranceSq = tolerance * tolerance;

            for (let i = 1; i < points.length - 1; i++) {
                const last = result[result.length - 1];
                const dx = points[i].x - last.x;
                const dy = points[i].y - last.y;
                if ((dx * dx + dy * dy) >= toleranceSq) {
                    result.push(points[i]);
                }
            }

            result.push(points[points.length - 1]);
            return result;
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
                log.warn("Unable to persist sketch to local storage:", error);
            }
        }

        /** @private Trigger a JSON file download of the export record. */
        _download(record) {
            try {
                const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const link = Utils.createElement("a", {
                    attributes: {
                        href: url,
                        download: `sarathi-free-draw-${record.id.slice(0, 8)}.json`
                    }
                });

                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                global.setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (error) {
                log.warn("Unable to download sketch export:", error);
            }
        }
    }

    const freeDrawInstance = new FreeDrawModule();
    global.Sarathi.Modules[MODULE_ID] = freeDrawInstance;

    /* Self-bootstrap: the ES-module dashboard pipeline cannot see IIFE
       exports, so the module initializes itself once the DOM is ready. */
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => freeDrawInstance.init(), { once: true });
    } else {
        freeDrawInstance.init();
    }

})(typeof window !== "undefined" ? window : this);
