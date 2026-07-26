/**
 * ============================================================================
 * MISSION CONTROL — SMART SURVEY ROBOT — modules/telemetry.js
 * ----------------------------------------------------------------------------
 * Telemetry Module — Live Sensor Dashboard & System Monitoring
 *
 * Capabilities
 *   • Battery level display with animated radial gauge
 *   • WiFi signal strength gauge (simulated)
 *   • Bluetooth connection strength gauge (simulated)
 *   • Robot status indicator with pulse animation
 *   • Current control mode display
 *   • Current / last command display
 *   • Uptime counter with live clock
 *   • Animated gauges using CSS transforms
 *   • Future sensor placeholders (IMU, ultrasonic, temperature, voltage)
 *
 * Registered at: window.Sarathi.Modules["telemetry"]
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

    const MODULE_ID = Constants.MODULES?.TELEMETRY || "telemetry";

    const LOCAL_EVENTS = {
        STATUS_CHANGED: "sarathi:telemetry:status-changed",
        BATTERY_LOW: "sarathi:telemetry:battery-low",
        SIGNAL_CHANGED: "sarathi:telemetry:signal-changed"
    };

    const MAX_BATTERY = Config.telemetry?.batteryMaxVoltage || 12.6;
    const MIN_BATTERY = Config.telemetry?.batteryMinVoltage || 9.6;
    const WARNING_THRESHOLD = Config.telemetry?.batteryWarningThreshold || 20;

    /**
     * @class TelemetryModule
     * @description Real-time sensor and system monitoring dashboard.
     */
    class TelemetryModule {
        constructor() {
            this._initialized = false;

            /** @private @type {number} */
            this._batteryVoltage = MAX_BATTERY;

            /** @private @type {number} */
            this._wifiSignal = 85;

            /** @private @type {number} */
            this._bluetoothSignal = 0;

            /** @private @type {string} */
            this._robotStatus = Constants.CONNECTION_STATES?.DISCONNECTED || "offline";

            /** @private @type {string} */
            this._currentMode = Constants.CONTROL_MODES?.STANDBY || "standby";

            /** @private @type {string} */
            this._currentCommand = "—";

            /** @private @type {number} */
            this._startTime = Date.now();

            /** @private @type {number|null} */
            this._clockIntervalId = null;

            /** @private @type {number|null} */
            this._simulationIntervalId = null;

            /** @private @type {Array<Function>} */
            this._cleanupHandlers = [];

            /** @private */
            this._elements = {
                body: null,
                batteryGauge: null,
                batteryText: null,
                batteryBadge: null,
                wifiGauge: null,
                wifiText: null,
                bleGauge: null,
                bleText: null,
                robotStatus: null,
                modeValue: null,
                commandValue: null,
                uptimeValue: null,
                sensorsContainer: null
            };
        }

        /* ==================================================================
         * LIFECYCLE
         * ================================================================== */

        async init() {
            if (this._initialized) return true;

            this._elements.body = Utils.byId?.("telemetry-body");
            if (!this._elements.body) {
                log.debug("Telemetry card body not found; module idle.");
                return false;
            }

            log.info("Initializing telemetry module...");

            try {
                this._buildInterface();
                this._bindEvents();
                this._startClock();
                this._startSimulation();
                this._render();

                this._initialized = true;
                return true;
            } catch (error) {
                log.error("Telemetry initialization failed:", error);
                return false;
            }
        }

        dispose() {
            if (this._clockIntervalId !== null) {
                global.clearInterval(this._clockIntervalId);
                this._clockIntervalId = null;
            }
            if (this._simulationIntervalId !== null) {
                global.clearInterval(this._simulationIntervalId);
                this._simulationIntervalId = null;
            }
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
         * Update battery voltage and recalculate percentage.
         * @param {number} voltage - Battery voltage in volts
         */
        setBatteryVoltage(voltage) {
            this._batteryVoltage = Utils.clamp?.(Number(voltage) || MAX_BATTERY, MIN_BATTERY, MAX_BATTERY) ?? MAX_BATTERY;
            this._updateBatteryUI();
            this._checkBatteryWarning();
        }

        /**
         * Update WiFi signal strength.
         * @param {number} signal - Signal percentage (0-100)
         */
        setWifiSignal(signal) {
            this._wifiSignal = Utils.clamp?.(Number(signal) || 0, 0, 100) ?? 0;
            this._updateSignalUI("wifi");
        }

        /**
         * Update Bluetooth signal strength.
         * @param {number} signal - Signal percentage (0-100)
         */
        setBluetoothSignal(signal) {
            this._bluetoothSignal = Utils.clamp?.(Number(signal) || 0, 0, 100) ?? 0;
            this._updateSignalUI("bluetooth");
        }

        /**
         * Update robot connection status.
         * @param {string} status - One of Constants.CONNECTION_STATES
         */
        setRobotStatus(status) {
            this._robotStatus = status || Constants.CONNECTION_STATES?.DISCONNECTED || "offline";
            this._updateRobotStatusUI();
        }

        /**
         * Update current control mode.
         * @param {string} mode - One of Constants.CONTROL_MODES
         */
        setCurrentMode(mode) {
            this._currentMode = mode || Constants.CONTROL_MODES?.STANDBY || "standby";
            this._updateModeUI();
        }

        /**
         * Update the most recent command executed.
         * @param {string} command - Command description
         */
        setCurrentCommand(command) {
            this._currentCommand = String(command || "—");
            this._updateCommandUI();
        }

        /**
         * Reset the uptime counter to now.
         */
        resetUptime() {
            this._startTime = Date.now();
            this._updateUptimeUI();
        }

        /**
         * Get current telemetry snapshot.
         * @returns {Object}
         */
        getStatus() {
            const pct = this._voltageToPercentage(this._batteryVoltage);
            return {
                initialized: this._initialized,
                batteryVoltage: this._batteryVoltage,
                batteryPercentage: pct,
                batteryLow: pct <= WARNING_THRESHOLD,
                wifiSignal: this._wifiSignal,
                bluetoothSignal: this._bluetoothSignal,
                robotStatus: this._robotStatus,
                currentMode: this._currentMode,
                currentCommand: this._currentCommand,
                uptimeSeconds: Math.floor((Date.now() - this._startTime) / 1000)
            };
        }

        /* ==================================================================
         * INTERFACE CONSTRUCTION
         * ================================================================== */

        /** @private */
        _buildInterface() {
            const body = this._elements.body;
            const placeholder = body.querySelector('[data-module="telemetry"]');
            if (placeholder) placeholder.remove();

            /* Gauges row */
            const gaugesRow = Utils.createElement("div", { classes: "telemetry-gauges-row" });

            const batteryGauge = this._createGauge("battery", "fa-battery-three-quarters", "Battery", "100%");
            const wifiGauge = this._createGauge("wifi", "fa-wifi", "WiFi", "85%");
            const bleGauge = this._createGauge("bluetooth", "fa-bluetooth", "Bluetooth", "0%");
            gaugesRow.append(batteryGauge, wifiGauge, bleGauge);

            /* Status row */
            const statusRow = Utils.createElement("div", { classes: "telemetry-status-row" });

            const robotStatus = this._createStatusCell("robot-status", "fa-robot", "Robot", "Offline", "badge-danger");
            const modeCell = this._createStatusCell("mode", "fa-sliders", "Mode", "Standby", "badge-neutral");
            const commandCell = this._createStatusCell("command", "fa-terminal", "Command", "—", "badge-neutral");
            const uptimeCell = this._createStatusCell("uptime", "fa-clock", "Uptime", "00:00:00", "badge-neutral");
            statusRow.append(robotStatus, modeCell, commandCell, uptimeCell);

            /* Sensor placeholders section */
            const sensorsContainer = Utils.createElement("div", { classes: "telemetry-sensors-container" });
            const sensorsTitle = Utils.createElement("h4", { classes: "telemetry-sensors-title", text: "Sensor Placeholders" });
            const sensorGrid = Utils.createElement("div", { classes: "telemetry-sensor-grid" });
            sensorsContainer.append(sensorsTitle, sensorGrid);

            const sensors = [
                { icon: "fa-compass", label: "IMU", value: "—", unit: "°" },
                { icon: "fa-waves", label: "Ultrasonic", value: "—", unit: "cm" },
                { icon: "fa-thermometer-half", label: "Temperature", value: "—", unit: "°C" },
                { icon: "fa-bolt", label: "Voltage", value: "—", unit: "V" }
            ];

            sensors.forEach((sensor) => {
                const sensorCard = this._createSensorCard(sensor.icon, sensor.label, sensor.value, sensor.unit);
                sensorGrid.appendChild(sensorCard);
            });

            body.append(gaugesRow, statusRow, sensorsContainer);

            Object.assign(this._elements, {
                batteryGauge,
                batteryText: batteryGauge.querySelector(".telemetry-gauge-text"),
                batteryBadge: batteryGauge.querySelector(".telemetry-gauge-badge"),
                wifiGauge,
                wifiText: wifiGauge.querySelector(".telemetry-gauge-text"),
                bleGauge,
                bleText: bleGauge.querySelector(".telemetry-gauge-text"),
                robotStatus,
                modeValue: modeCell.querySelector(".telemetry-status-value"),
                commandValue: commandCell.querySelector(".telemetry-status-value"),
                uptimeValue: uptimeCell.querySelector(".telemetry-status-value"),
                sensorsContainer,
                sensorCards: sensors.map((_, i) => sensorGrid.children[i])
            });
        }

        /** @private */
        _createGauge(id, icon, label, initialText) {
            const container = Utils.createElement("div", { classes: "telemetry-gauge-container" });
            container.id = id;

            const gaugeWrap = Utils.createElement("div", { classes: "telemetry-gauge-wrap" });
            const canvas = Utils.createElement("canvas", { classes: "telemetry-gauge-canvas" });
            const badge = Utils.createElement("span", { classes: "telemetry-gauge-badge badge-neutral", text: initialText });
            gaugeWrap.append(canvas, badge);

            const infoRow = Utils.createElement("div", { classes: "telemetry-gauge-info" });
            const iconEl = Utils.createElement("i", { classes: ["fa-solid", icon], attributes: { "aria-hidden": "true" } });
            const labelEl = Utils.createElement("span", { classes: "telemetry-gauge-label", text: label });
            const textEl = Utils.createElement("span", { classes: "telemetry-gauge-text", text: "100%" });
            infoRow.append(iconEl, labelEl, textEl);

            container.append(gaugeWrap, infoRow);
            return container;
        }

        /** @private */
        _createStatusCell(id, icon, label, initialValue, badgeClass) {
            const container = Utils.createElement("div", { classes: "telemetry-status-cell", id });

            const iconEl = Utils.createElement("i", { classes: ["fa-solid", icon], attributes: { "aria-hidden": "true" } });
            const labelEl = Utils.createElement("span", { classes: "telemetry-status-label", text: label });
            const valueEl = Utils.createElement("span", { classes: "telemetry-status-value", text: initialValue });
            const badgeEl = Utils.createElement("span", { classes: ["telemetry-status-badge", badgeClass], text: initialValue });

            container.append(iconEl, labelEl, valueEl, badgeEl);
            return container;
        }

        /** @private */
        _createSensorCard(icon, label, value, unit) {
            const card = Utils.createElement("div", { classes: "telemetry-sensor-card" });

            const iconEl = Utils.createElement("i", { classes: ["fa-solid", icon], attributes: { "aria-hidden": "true" } });
            const labelEl = Utils.createElement("span", { classes: "telemetry-sensor-label", text: label });
            const valueEl = Utils.createElement("span", { classes: "telemetry-sensor-value" });
            valueEl.innerHTML = `${value}<small>${unit}</small>`;

            card.append(iconEl, labelEl, valueEl);
            return card;
        }

        /* ==================================================================
         * EVENT BINDING
         * ================================================================== */

        /** @private */
        _bindEvents() {
            /* Listen to connection state changes */
            const onConnection = (e) => {
                const detail = e.detail || {};
                if (detail.type === "wifi" || detail.type === "bluetooth") {
                    this._updateSignalFromEvent(detail);
                }
            };

            /* Listen to mode changes */
            const onModeChanged = (e) => {
                const mode = e.detail?.mode;
                if (mode) this.setCurrentMode(mode);
            };

            /* Listen to command events */
            const onCommand = (e) => {
                const detail = e.detail || {};
                if (detail.type) {
                    this.setCurrentCommand(detail.type);
                }
            };

            /* Listen to robot online/offline */
            const onRobotOnline = () => this.setRobotStatus(Constants.CONNECTION_STATES?.CONNECTED || "connected");
            const onRobotOffline = () => this.setRobotStatus(Constants.CONNECTION_STATES?.DISCONNECTED || "disconnected");

            this._cleanupHandlers.push(
                Utils.on?.(window, Constants.EVENTS?.CONNECTION_LINK_CHANGE || "sarathi:connection:link-change", onConnection) || (() => {}),
                Utils.on?.(window, Constants.EVENTS?.MODE_CHANGED || "sarathi:robot:mode-changed", onModeChanged) || (() => {}),
                Utils.on?.(window, Constants.EVENTS?.COMMAND_SENT || "sarathi:command:sent", onCommand) || (() => {}),
                Utils.on?.(window, Constants.EVENTS?.ROBOT_ONLINE || "sarathi:robot:online", onRobotOnline) || (() => {}),
                Utils.on?.(window, Constants.EVENTS?.ROBOT_OFFLINE || "sarathi:robot:offline", onRobotOffline) || (() => {})
            );
        }

        /* ==================================================================
         * SIMULATION & UPDATES
         * ================================================================== */

        /** @private */
        _startClock() {
            this._clockIntervalId = global.setInterval(() => this._updateUptimeUI(), 1000);
        }

        /** @private */
        _startSimulation() {
            /* Simulate battery drain and signal fluctuations */
            this._simulationIntervalId = global.setInterval(() => {
                /* Battery drain (slow) */
                this.setBatteryVoltage(this._batteryVoltage - 0.005);

                /* WiFi signal fluctuation */
                this.setWifiSignal(this._wifiSignal + (Math.random() * 6 - 3));

                /* Bluetooth signal fluctuation */
                if (this._bluetoothSignal > 0) {
                    this.setBluetoothSignal(this._bluetoothSignal + (Math.random() * 4 - 2));
                }
            }, 2000);
        }

        /** @private */
        _updateBatteryUI() {
            const pct = this._voltageToPercentage(this._batteryVoltage);
            const gauge = this._elements.batteryGauge;
            const text = this._elements.batteryText;
            const badge = this._elements.batteryBadge;

            if (!gauge || !text || !badge) return;

            /* Update percentage text */
            text.textContent = `${Math.round(pct)}%`;

            /* Update badge color */
            badge.className = "telemetry-gauge-badge";
            if (pct <= 15) {
                badge.classList.add("badge-danger");
            } else if (pct <= WARNING_THRESHOLD) {
                badge.classList.add("badge-warning");
            } else {
                badge.classList.add("badge-success");
            }
            badge.textContent = `${pct.toFixed(0)}%`;

            /* Update gauge arc */
            this._drawGauge(gauge.querySelector("canvas"), pct, pct <= 15 ? "danger" : pct <= WARNING_THRESHOLD ? "warning" : "success");
        }

        /** @private */
        _updateSignalUI(type) {
            const isWifi = type === "wifi";
            const value = isWifi ? this._wifiSignal : this._bluetoothSignal;
            const gauge = isWifi ? this._elements.wifiGauge : this._elements.bleGauge;
            const text = isWifi ? this._elements.wifiText : this._elements.bleText;

            if (!gauge || !text) return;

            text.textContent = `${Math.round(value)}%`;
            this._drawGauge(gauge.querySelector("canvas"), value, value > 60 ? "success" : value > 30 ? "warning" : "danger");
        }

        /** @private */
        _updateRobotStatusUI() {
            const cell = this._elements.robotStatus;
            if (!cell) return;

            const valueEl = cell.querySelector(".telemetry-status-value");
            const badgeEl = cell.querySelector(".telemetry-status-badge");

            if (valueEl) {
                valueEl.textContent = this._robotStatus === Constants.CONNECTION_STATES?.CONNECTED ? "Online" : this._robotStatus;
            }

            if (badgeEl) {
                badgeEl.className = "telemetry-status-badge";
                switch (this._robotStatus) {
                    case Constants.CONNECTION_STATES?.CONNECTED:
                        badgeEl.classList.add("badge-success");
                        badgeEl.textContent = "Online";
                        break;
                    case Constants.CONNECTION_STATES?.CONNECTING:
                        badgeEl.classList.add("badge-warning");
                        badgeEl.textContent = "Connecting...";
                        break;
                    default:
                        badgeEl.classList.add("badge-danger");
                        badgeEl.textContent = "Offline";
                }
            }
        }

        /** @private */
        _updateModeUI() {
            const valueEl = this._elements.modeValue;
            const badgeEl = this._elements.modeValue?.nextElementSibling;

            if (valueEl) {
                valueEl.textContent = this._currentMode;
            }

            if (badgeEl) {
                badgeEl.className = "telemetry-status-badge badge-neutral";
                badgeEl.textContent = this._currentMode;
            }
        }

        /** @private */
        _updateCommandUI() {
            const valueEl = this._elements.commandValue;
            const badgeEl = this._elements.commandValue?.nextElementSibling;

            if (valueEl) {
                valueEl.textContent = this._currentCommand;
            }

            if (badgeEl) {
                badgeEl.className = "telemetry-status-badge badge-neutral";
                badgeEl.textContent = this._currentCommand;
            }
        }

        /** @private */
        _updateUptimeUI() {
            const valueEl = this._elements.uptimeValue;
            if (!valueEl) return;

            const seconds = Math.floor((Date.now() - this._startTime) / 1000);
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;
            valueEl.textContent = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
        }

        /** @private */
        _updateSignalFromEvent(detail) {
            if (detail.type === "wifi") {
                this.setWifiSignal(detail.signal);
            } else if (detail.type === "bluetooth") {
                this.setBluetoothSignal(detail.signal);
            }
        }

        /** @private */
        _checkBatteryWarning() {
            const pct = this._voltageToPercentage(this._batteryVoltage);
            if (pct <= WARNING_THRESHOLD) {
                Utils.dispatch?.(LOCAL_EVENTS.BATTERY_LOW, { level: pct, voltage: this._batteryVoltage });
            }
        }

        /** @private */
        _voltageToPercentage(voltage) {
            return Utils.mapRange?.(voltage, MIN_BATTERY, MAX_BATTERY, 0, 100) || 100;
        }

        /* ==================================================================
         * GAUGE DRAWING
         * ================================================================== */

        /** @private */
        _drawGauge(canvasEl, percentage, variant) {
            if (!canvasEl) return;

            const canvas = canvasEl;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            const size = Math.min(canvas.width, canvas.height);
            const center = size / 2;
            const radius = (size / 2) * 0.85;
            const lineWidth = size * 0.12;

            /* Clear */
            ctx.clearRect(0, 0, size, size);

            /* Background ring */
            ctx.strokeStyle = "rgba(45, 212, 191, 0.15)";
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.arc(center, center, radius, 0, Math.PI * 2);
            ctx.stroke();

            /* Colored arc */
            const endAngle = (percentage / 100) * (Math.PI * 2) - Math.PI / 2;
            ctx.strokeStyle = variant === "danger" ? "#ff4d6d" : variant === "warning" ? "#ffb224" : "#2dd4bf";
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.arc(center, center, radius, -Math.PI / 2, endAngle);
            ctx.stroke();

            /* Glow effect */
            if (percentage > 0) {
                const gradient = ctx.createRadialGradient(center, center, radius * 0.4, center, center, radius);
                const color = variant === "danger" ? "#ff4d6d" : variant === "warning" ? "#ffb224" : "#2dd4bf";
                gradient.addColorStop(0, color + "40");
                gradient.addColorStop(1, color + "00");

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(center, center, radius, -Math.PI / 2, endAngle);
                ctx.lineTo(center, center);
                ctx.closePath();
                ctx.fill();
            }

            /* Needle indicator */
            ctx.fillStyle = variant === "danger" ? "#ff4d6d" : variant === "warning" ? "#ffb224" : "#2dd4bf";
            ctx.beginPath();
            ctx.arc(center, center, lineWidth / 2, 0, Math.PI * 2);
            ctx.fill();
        }

        /* ==================================================================
         * RENDER
         * ================================================================== */

        /** @private */
        _render() {
            this._updateBatteryUI();
            this._updateSignalUI("wifi");
            this._updateSignalUI("bluetooth");
            this._updateRobotStatusUI();
            this._updateModeUI();
            this._updateCommandUI();
            this._updateUptimeUI();
        }
    }

    global.Sarathi.Modules[MODULE_ID] = new TelemetryModule();

})(typeof window !== "undefined" ? window : this);
