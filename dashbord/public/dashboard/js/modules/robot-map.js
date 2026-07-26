/**
 * ============================================================================
 * MISSION CONTROL — SMART SURVEY ROBOT — modules/robot-map.js
 * ----------------------------------------------------------------------------
 * Robot Map Module — 2D Mission Map & Estimated Odometry Tracking
 *
 * Capabilities
 *   • HiDPI Canvas-based mission map with pan & zoom controls
 *   • Estimated Robot Position tracking (x, y, heading angle θ)
 *   • Cyberpunk Robot Icon with directional heading and sonar ring
 *   • Coordinate Grid with metric scale and North compass indicator
 *   • Historical movement Trail polyline (with Reset / Clear Trail)
 *   • No GPS requirement (pure odometry / local coordinate estimation)
 *   • Integrates with Auto Mode replay and manual control events
 *
 * Registered at: window.Sarathi.Modules["robot-map"]
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

    const MODULE_ID = Constants.MODULES?.ROBOT_MAP || "robot-map";

    const LOCAL_EVENTS = {
        UPDATED: "sarathi:robot-map:updated",
        RESET: "sarathi:robot-map:reset"
    };

    const PIXELS_PER_METER = 40;
    const GRID_SPACING_M = 1;
    const MAX_TRAIL_LENGTH = 500;
    const ZOOM_MIN = 0.4;
    const ZOOM_MAX = 3.0;

    /**
     * @class RobotMapModule
     * @description Live 2D mission map tracking estimated odometry position.
     */
    class RobotMapModule {
        constructor() {
            this._initialized = false;

            /** @private @type {{x:number,y:number,heading:number}} Position in meters and radians */
            this._robotPos = { x: 0, y: 0, heading: -Math.PI / 2 };

            /** @private @type {Array<{x:number,y:number}>} Trail in meters */
            this._trail = [{ x: 0, y: 0 }];

            /** @private @type {number} */
            this._zoom = 1.0;

            /** @private @type {{x:number,y:number}} Pan offset in pixels */
            this._offset = { x: 0, y: 0 };

            /** @private @type {boolean} */
            this._isDragging = false;

            /** @private @type {{x:number,y:number}|null} */
            this._dragStart = null;

            /** @private @type {boolean} */
            this._showGrid = true;

            /** @private @type {boolean} */
            this._showCompass = true;

            /** @private @type {number} */
            this._dpr = 1;

            /** @private @type {number|null} */
            this._demoTimerId = null;

            /** @private @type {Array<Function>} */
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
                btnZoomIn: null,
                btnZoomOut: null,
                btnReset: null,
                btnClearTrail: null,
                btnToggleGrid: null,
                btnDemo: null
            };
        }

        /* ==================================================================
         * LIFECYCLE
         * ================================================================== */

        async init() {
            if (this._initialized) return true;

            this._elements.body = Utils.byId?.("robot-map-body");
            if (!this._elements.body) {
                log.debug("Robot Map card body not found; module idle.");
                return false;
            }

            log.info("Initializing robot-map module...");

            try {
                this._buildInterface();
                this._bindPointerEvents();
                this._bindToolbarEvents();
                this._bindSystemEvents();
                this._observeResize();
                this._resizeCanvas();
                this._centerView();
                this._render();

                this._initialized = true;
                return true;
            } catch (error) {
                log.error("Robot-map initialization failed:", error);
                return false;
            }
        }

        dispose() {
            if (this._demoTimerId !== null) {
                global.clearInterval(this._demoTimerId);
                this._demoTimerId = null;
            }
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
            this._trail = [];
            this._initialized = false;
        }

        /* ==================================================================
         * PUBLIC API
         * ================================================================== */

        /**
         * Update estimated robot coordinates and heading angle.
         * @param {number} x - Meters X
         * @param {number} y - Meters Y
         * @param {number} headingRad - Heading angle in radians (0 is East, -PI/2 is North)
         */
        updatePosition(x, y, headingRad) {
            const numX = Number(x) || 0;
            const numY = Number(y) || 0;
            const numH = Number(headingRad) || 0;

            const dist = Math.hypot(numX - this._robotPos.x, numY - this._robotPos.y);
            this._robotPos = { x: numX, y: numY, heading: numH };

            if (dist > 0.05 || this._trail.length === 0) {
                this._trail.push({ x: numX, y: numY });
                if (this._trail.length > MAX_TRAIL_LENGTH) {
                    this._trail.shift();
                }
            }

            this._render();
            this._updateReadout();

            Utils.dispatch?.(LOCAL_EVENTS.UPDATED, {
                module: MODULE_ID,
                position: { ...this._robotPos },
                trailLength: this._trail.length
            });
        }

        /**
         * Reset map position to origin (0,0) and clear trail.
         */
        resetMap() {
            this._robotPos = { x: 0, y: 0, heading: -Math.PI / 2 };
            this._trail = [{ x: 0, y: 0 }];
            this._centerView();
            this._render();
            this._updateReadout();
            Utils.dispatch?.(LOCAL_EVENTS.RESET, { module: MODULE_ID });
            log.info("Robot Map coordinates reset to origin (0,0).");
        }

        /**
         * Clear historical movement trail without resetting current position.
         */
        clearTrail() {
            this._trail = [{ x: this._robotPos.x, y: this._robotPos.y }];
            this._render();
            this._updateReadout();
        }

        /**
         * Set zoom level.
         * @param {number} level - Zoom multiplier
         */
        setZoom(level) {
            this._zoom = Utils.clamp?.(Number(level) || 1.0, ZOOM_MIN, ZOOM_MAX) ?? 1.0;
            this._render();
        }

        /**
         * Get module status.
         * @returns {Object}
         */
        getStatus() {
            return {
                initialized: this._initialized,
                position: { ...this._robotPos },
                zoom: this._zoom,
                trailCount: this._trail.length,
                isDemoActive: this._demoTimerId !== null
            };
        }

        /* ==================================================================
         * INTERFACE CONSTRUCTION
         * ================================================================== */

        /** @private */
        _buildInterface() {
            const body = this._elements.body;
            const placeholder = body.querySelector('[data-module="robot-map"]');
            if (placeholder) placeholder.remove();

            const stage = Utils.createElement("div", { classes: "robotmap-stage" });
            const canvas = Utils.createElement("canvas", {
                classes: "robotmap-canvas",
                attributes: {
                    id: "robot-map-canvas",
                    role: "application",
                    tabindex: "0",
                    "aria-label": "2D Mission map showing estimated robot position and trail."
                }
            });
            stage.appendChild(canvas);

            const toolbar = Utils.createElement("div", { classes: "robotmap-toolbar" });
            const btnZoomIn = this._createBtn("robotmap-zoomin", "fa-magnifying-glass-plus", "Zoom In", "btn-ghost");
            const btnZoomOut = this._createBtn("robotmap-zoomout", "fa-magnifying-glass-minus", "Zoom Out", "btn-ghost");
            const btnReset = this._createBtn("robotmap-reset", "fa-compress-arrows-alt", "Center & Reset", "btn-ghost");
            const btnClearTrail = this._createBtn("robotmap-clear-trail", "fa-eraser", "Clear Trail", "btn-ghost");
            const btnToggleGrid = this._createBtn("robotmap-toggle-grid", "fa-table-cells", "Grid", "btn-ghost");
            const btnDemo = this._createBtn("robotmap-demo", "fa-gamepad", "Demo Odometry", "btn-primary");

            toolbar.append(btnZoomIn, btnZoomOut, btnReset, btnClearTrail, btnToggleGrid, btnDemo);

            const readout = Utils.createElement("p", {
                classes: "robotmap-readout",
                attributes: { id: "robot-map-readout", role: "status", "aria-live": "polite" },
                text: "Pos: X 0.00m, Y 0.00m · Heading: 0° (North) · Zoom: 1.0x"
            });

            body.append(stage, toolbar, readout);

            Object.assign(this._elements, {
                stage,
                canvas,
                ctx: canvas.getContext("2d"),
                readout,
                btnZoomIn,
                btnZoomOut,
                btnReset,
                btnClearTrail,
                btnToggleGrid,
                btnDemo
            });
        }

        /** @private */
        _createBtn(id, icon, label, variant) {
            return Utils.createElement("button", {
                classes: ["btn", variant, "robotmap-btn"],
                attributes: { id, type: "button", "aria-label": label },
                html: `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span>`
            });
        }

        /* ==================================================================
         * EVENT BINDING
         * ================================================================== */

        /** @private */
        _bindPointerEvents() {
            const canvas = this._elements.canvas;

            const onPointerDown = (e) => {
                e.preventDefault();
                this._isDragging = true;
                this._dragStart = { x: e.clientX - this._offset.x, y: e.clientY - this._offset.y };
                if (canvas.setPointerCapture) {
                    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
                }
            };

            const onPointerMove = (e) => {
                if (!this._isDragging || !this._dragStart) return;
                e.preventDefault();
                this._offset.x = e.clientX - this._dragStart.x;
                this._offset.y = e.clientY - this._dragStart.y;
                this._render();
            };

            const onPointerUp = (e) => {
                this._isDragging = false;
                this._dragStart = null;
                if (canvas.releasePointerCapture) {
                    try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
                }
            };

            const onWheel = (e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                this.setZoom(this._zoom + delta);
                this._updateReadout();
            };

            this._cleanupHandlers.push(
                Utils.on?.(canvas, "pointerdown", onPointerDown) || (() => {}),
                Utils.on?.(canvas, "pointermove", onPointerMove) || (() => {}),
                Utils.on?.(canvas, "pointerup", onPointerUp) || (() => {}),
                Utils.on?.(canvas, "pointercancel", onPointerUp) || (() => {}),
                Utils.on?.(canvas, "wheel", onWheel, { passive: false }) || (() => {})
            );
        }

        /** @private */
        _bindToolbarEvents() {
            const { btnZoomIn, btnZoomOut, btnReset, btnClearTrail, btnToggleGrid, btnDemo } = this._elements;

            this._cleanupHandlers.push(
                Utils.on?.(btnZoomIn, "click", () => { this.setZoom(this._zoom + 0.2); this._updateReadout(); }) || (() => {}),
                Utils.on?.(btnZoomOut, "click", () => { this.setZoom(this._zoom - 0.2); this._updateReadout(); }) || (() => {}),
                Utils.on?.(btnReset, "click", () => { this._centerView(); this.setZoom(1.0); this._render(); this._updateReadout(); }) || (() => {}),
                Utils.on?.(btnClearTrail, "click", () => this.clearTrail()) || (() => {}),
                Utils.on?.(btnToggleGrid, "click", () => {
                    this._showGrid = !this._showGrid;
                    if (btnToggleGrid) btnToggleGrid.classList.toggle("is-active", this._showGrid);
                    this._render();
                }) || (() => {}),
                Utils.on?.(btnDemo, "click", () => this._toggleDemoOdometry()) || (() => {})
            );
        }

        /** @private */
        _bindSystemEvents() {
            /* Listen to Auto Mode replay progress */
            const onAutoProgress = (e) => {
                const detail = e.detail || {};
                const pt = detail.point;
                if (pt && typeof pt.x === "number" && typeof pt.y === "number") {
                    const metersX = (pt.x - 200) / PIXELS_PER_METER;
                    const metersY = (pt.y - 150) / PIXELS_PER_METER;
                    const dx = metersX - this._robotPos.x;
                    const dy = metersY - this._robotPos.y;
                    let heading = this._robotPos.heading;
                    if (Math.hypot(dx, dy) > 0.01) {
                        heading = Math.atan2(dy, dx);
                    }
                    this.updatePosition(metersX, metersY, heading);
                }
            };

            /* Listen to manual control motor commands */
            const onCommand = (e) => {
                const detail = e.detail || {};
                const dir = detail.direction || "";
                if (!dir || dir === "stop") return;

                let { x, y, heading } = this._robotPos;
                const stepM = 0.25;
                const turnRad = Math.PI / 8;

                switch (dir) {
                    case "forward":
                        x += Math.cos(heading) * stepM;
                        y += Math.sin(heading) * stepM;
                        break;
                    case "backward":
                        x -= Math.cos(heading) * stepM;
                        y -= Math.sin(heading) * stepM;
                        break;
                    case "left":
                        heading -= turnRad;
                        break;
                    case "right":
                        heading += turnRad;
                        break;
                }
                this.updatePosition(x, y, heading);
            };

            this._cleanupHandlers.push(
                Utils.on?.(window, "sarathi:auto-mode:progress", onAutoProgress) || (() => {}),
                Utils.on?.(window, Constants.EVENTS?.COMMAND_SENT || "sarathi:command:sent", onCommand) || (() => {})
            );
        }

        /** @private */
        _observeResize() {
            if (typeof ResizeObserver === "undefined") {
                const onWinResize = Utils.debounce?.(() => {
                    this._resizeCanvas();
                    this._render();
                }, 150) || (() => {});
                this._cleanupHandlers.push(Utils.on?.(global, "resize", onWinResize) || (() => {}));
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
        _logicalWidth() { return this._elements.canvas ? this._elements.canvas.clientWidth : 0; }

        /** @private */
        _logicalHeight() { return this._elements.canvas ? this._elements.canvas.clientHeight : 0; }

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
        _centerView() {
            const width = this._logicalWidth();
            const height = this._logicalHeight();
            this._offset = { x: width / 2, y: height / 2 };
        }

        /** @private */
        _worldToScreen(meterX, meterY) {
            const scale = PIXELS_PER_METER * this._zoom;
            return {
                x: this._offset.x + meterX * scale,
                y: this._offset.y + meterY * scale
            };
        }

        /** @private */
        _render() {
            const ctx = this._elements.ctx;
            if (!ctx) return;

            const width = this._logicalWidth();
            const height = this._logicalHeight();
            if (width === 0 || height === 0) return;

            ctx.clearRect(0, 0, width, height);

            if (this._showGrid) {
                this._drawGrid(ctx, width, height);
            }
            this._drawTrail(ctx);
            this._drawRobotIcon(ctx);
            if (this._showCompass) {
                this._drawCompass(ctx, width);
            }
            this._drawScaleBar(ctx, height);
        }

        /** @private */
        _drawGrid(ctx, width, height) {
            ctx.save();
            const scale = PIXELS_PER_METER * this._zoom;
            const gridSpacingPx = GRID_SPACING_M * scale;

            ctx.strokeStyle = "rgba(45, 212, 191, 0.12)";
            ctx.lineWidth = 1;

            const startX = ((this._offset.x % gridSpacingPx) + gridSpacingPx) % gridSpacingPx;
            const startY = ((this._offset.y % gridSpacingPx) + gridSpacingPx) % gridSpacingPx;

            for (let x = startX; x < width; x += gridSpacingPx) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
            }
            for (let y = startY; y < height; y += gridSpacingPx) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }

            /* Draw origin axes (0,0) */
            const origin = this._worldToScreen(0, 0);
            ctx.strokeStyle = "rgba(45, 212, 191, 0.35)";
            ctx.lineWidth = 2;
            if (origin.x >= 0 && origin.x <= width) {
                ctx.beginPath();
                ctx.moveTo(origin.x, 0);
                ctx.lineTo(origin.x, height);
                ctx.stroke();
            }
            if (origin.y >= 0 && origin.y <= height) {
                ctx.beginPath();
                ctx.moveTo(0, origin.y);
                ctx.lineTo(width, origin.y);
                ctx.stroke();
            }

            ctx.restore();
        }

        /** @private */
        _drawTrail(ctx) {
            if (this._trail.length < 2) return;

            ctx.save();
            ctx.strokeStyle = "#2dd4bf";
            ctx.lineWidth = 3;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.shadowColor = "rgba(45, 212, 191, 0.65)";
            ctx.shadowBlur = 10;

            ctx.beginPath();
            const first = this._worldToScreen(this._trail[0].x, this._trail[0].y);
            ctx.moveTo(first.x, first.y);

            for (let i = 1; i < this._trail.length; i++) {
                const pt = this._worldToScreen(this._trail[i].x, this._trail[i].y);
                ctx.lineTo(pt.x, pt.y);
            }
            ctx.stroke();
            ctx.restore();
        }

        /** @private */
        _drawRobotIcon(ctx) {
            const screen = this._worldToScreen(this._robotPos.x, this._robotPos.y);
            const heading = this._robotPos.heading;
            const radius = 16 * Math.min(1.4, Math.max(0.7, this._zoom));

            ctx.save();
            ctx.translate(screen.x, screen.y);

            /* Pulsing Sonar Ring */
            ctx.strokeStyle = "rgba(245, 158, 11, 0.45)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, radius * 1.8, 0, Math.PI * 2);
            ctx.stroke();

            ctx.rotate(heading);

            /* Cyberpunk Rover Triangular Body */
            ctx.fillStyle = "#f59e0b";
            ctx.shadowColor = "rgba(245, 158, 11, 0.8)";
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.moveTo(radius * 1.4, 0);
            ctx.lineTo(-radius * 0.9, radius * 0.8);
            ctx.lineTo(-radius * 0.5, 0);
            ctx.lineTo(-radius * 0.9, -radius * 0.8);
            ctx.closePath();
            ctx.fill();

            /* Glowing Cyan Directional Nose */
            ctx.fillStyle = "#2dd4bf";
            ctx.shadowColor = "rgba(45, 212, 191, 0.9)";
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(radius * 0.5, 0, radius * 0.28, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        }

        /** @private */
        _drawCompass(ctx, width) {
            const x = width - 42;
            const y = 42;
            const radius = 22;

            ctx.save();
            ctx.translate(x, y);

            ctx.fillStyle = "rgba(7, 26, 24, 0.75)";
            ctx.strokeStyle = "rgba(45, 212, 191, 0.4)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            /* North Pointer (pointing up -> -Y in screen space) */
            ctx.fillStyle = "#ff4d6d";
            ctx.beginPath();
            ctx.moveTo(0, -radius * 0.75);
            ctx.lineTo(radius * 0.25, 0);
            ctx.lineTo(-radius * 0.25, 0);
            ctx.closePath();
            ctx.fill();

            /* South Pointer */
            ctx.fillStyle = "#9fb3d1";
            ctx.beginPath();
            ctx.moveTo(0, radius * 0.75);
            ctx.lineTo(radius * 0.25, 0);
            ctx.lineTo(-radius * 0.25, 0);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = "#e8f1ff";
            ctx.font = "bold 10px Orbitron, Rajdhani, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("N", 0, -radius - 8);

            ctx.restore();
        }

        /** @private */
        _drawScaleBar(ctx, height) {
            const x = 20;
            const y = height - 24;
            const scalePx = PIXELS_PER_METER * this._zoom;

            ctx.save();
            ctx.strokeStyle = "#e8f1ff";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, y - 4);
            ctx.lineTo(x, y);
            ctx.lineTo(x + scalePx, y);
            ctx.lineTo(x + scalePx, y - 4);
            ctx.stroke();

            ctx.fillStyle = "#e8f1ff";
            ctx.font = "11px Rajdhani, Inter, sans-serif";
            ctx.fillText("1 meter", x + 6, y - 6);
            ctx.restore();
        }

        /** @private */
        _updateReadout() {
            const readout = this._elements.readout;
            if (!readout) return;

            const deg = Math.round((((this._robotPos.heading * 180) / Math.PI + 90 + 360) % 360));
            const compassDir = this._degToCompass(deg);
            readout.textContent =
                `Pos: X ${this._robotPos.x.toFixed(2)}m, Y ${this._robotPos.y.toFixed(2)}m · ` +
                `Heading: ${deg}° (${compassDir}) · Zoom: ${this._zoom.toFixed(1)}x`;
        }

        /** @private */
        _degToCompass(deg) {
            const dirs = ["North", "NE", "East", "SE", "South", "SW", "West", "NW"];
            const index = Math.round(deg / 45) % 8;
            return dirs[index];
        }

        /** @private */
        _toggleDemoOdometry() {
            const btnDemo = this._elements.btnDemo;

            if (this._demoTimerId !== null) {
                global.clearInterval(this._demoTimerId);
                this._demoTimerId = null;
                if (btnDemo) {
                    btnDemo.classList.remove("is-active", "btn-danger");
                    btnDemo.classList.add("btn-primary");
                    btnDemo.querySelector("span").textContent = "Demo Odometry";
                }
                log.info("Demo odometry simulation paused.");
            } else {
                if (btnDemo) {
                    btnDemo.classList.add("is-active", "btn-danger");
                    btnDemo.classList.remove("btn-primary");
                    btnDemo.querySelector("span").textContent = "Stop Demo";
                }
                log.info("Demo odometry simulation active.");

                let angle = this._robotPos.heading;
                let step = 0;
                this._demoTimerId = global.setInterval(() => {
                    step += 0.05;
                    angle += Math.sin(step * 0.4) * 0.08;
                    const speed = 0.15;
                    const nextX = this._robotPos.x + Math.cos(angle) * speed;
                    const nextY = this._robotPos.y + Math.sin(angle) * speed;
                    this.updatePosition(nextX, nextY, angle);
                }, 150);
            }
        }
    }

    global.Sarathi.Modules[MODULE_ID] = new RobotMapModule();

})(typeof window !== "undefined" ? window : this);
