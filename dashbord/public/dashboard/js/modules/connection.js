/* ==========================================================================
   MISSION CONTROL — SMART SURVEY ROBOT — modules/connection.js
   --------------------------------------------------------------------------
   Connection Manager — REAL WiFi (WebSocket) + Bluetooth (Web Bluetooth)
   --------------------------------------------------------------------------
   Responsibilities
     • Real WebSocket link to the ESP32 (ws://host:port) with JSON protocol
     • Real Web Bluetooth pairing (name prefix SARATHI_, GATT TX/RX chars)
     • Tabbed panel: WiFi · Bluetooth · How to Connect
     • Honest fallback — if no robot answers, runs a labelled SIM LINK so
       the rest of the dashboard stays alive for demos
     • Command bridge — every `command:sent` event is forwarded to the
       active transport, so voice / gesture / D-pad all reach the robot
     • Emits the standardized events the header pills and telemetry expect

   WIRE PROTOCOL (text JSON frames, both directions)
     → { "id": "msg_…", "type": "motor:forward", "payload": {}, "ts": 1700000000000 }
     ← { "type": "ack", "id": "msg_…" }
     ← { "type": "telemetry:sample", "payload": { battery: 87, rssi: -52, … } }
     ← { "type": "hello", "payload": { fw: "1.0.0", name: "SARATHI_A1" } }

   Public API (unchanged)
     init(context) · disconnect() · reconnect() · getStatus()
   ========================================================================== */

import { CONFIG } from "../config.js";
import { EVENT, STATUS, CSS_CLASS } from "../constants.js";
import {
    Logger,
    getElementByID,
    addClass,
    removeClass,
    toggleClass,
    on,
    emit,
    createElement,
    setText,
} from "../utils.js";

const TAG = "Connection";

/* Parse the configured default endpoint into host/port for the form. */
function parseDefaultUrl() {
    try {
        const u = new URL(CONFIG.API.WEBSOCKET.URL);
        return { host: u.hostname || "192.168.4.1", port: u.port || "81" };
    } catch (_) {
        return { host: "192.168.4.1", port: "81" };
    }
}

/* ==========================================================================
   WIFI TRANSPORT — real WebSocket
   ========================================================================== */

class WifiTransport {
    constructor() {
        this.socket = null;
        this.connectTimer = null;
        this.pingTimer = null;
        this.lastLatency = null;
        this.onStatus = () => {};
        this.onMessage = () => {};
    }

    get isOpen() {
        return !!this.socket && this.socket.readyState === WebSocket.OPEN;
    }

    /**
     * Open a socket with a hard timeout so an unreachable ESP32 fails fast.
     * @param {string} host @param {string} port @param {number} timeoutMs
     */
    connect(host, port, timeoutMs = 4000) {
        return new Promise((resolve, reject) => {
            this.closeSocket();

            let settled = false;
            const url = `ws://${host}:${port}`;

            try {
                this.socket = new WebSocket(url);
            } catch (err) {
                reject(new Error(`Invalid address ${url}`));
                return;
            }

            const fail = (msg) => {
                if (settled) return;
                settled = true;
                clearTimeout(this.connectTimer);
                this.closeSocket();
                reject(new Error(msg));
            };

            this.connectTimer = setTimeout(
                () => fail(`No answer from ${url} within ${timeoutMs / 1000}s`),
                timeoutMs
            );

            this.socket.onopen = () => {
                if (settled) return;
                settled = true;
                clearTimeout(this.connectTimer);
                this.startPing();
                this.send({ type: "hello", payload: { client: "mission-control" } });
                resolve();
            };

            this.socket.onerror = () => fail(`Could not reach the robot at ${url}`);
            this.socket.onclose = () => {
                this.stopPing();
                if (!settled) fail(`Connection to ${url} was closed`);
                else this.onStatus("closed");
            };
            this.socket.onmessage = (ev) => this.handleMessage(ev.data);
        });
    }

    handleMessage(raw) {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch (_) {
            return; // ignore non-JSON frames
        }
        if (msg.type === "hello" && msg.ts) {
            this.lastLatency = Date.now() - msg.ts;
        }
        this.onMessage(msg);
    }

    /** Latency probe — the ESP32 is expected to echo `ping` as `pong`. */
    startPing() {
        this.stopPing();
        this.pingTimer = setInterval(() => {
            if (this.isOpen) this.send({ type: "ping", ts: Date.now() });
        }, CONFIG.API.WEBSOCKET.PING_INTERVAL_MS || 28000);
    }

    stopPing() {
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = null;
    }

    send(message) {
        if (!this.isOpen) return false;
        this.socket.send(JSON.stringify(message));
        return true;
    }

    closeSocket() {
        if (this.socket) {
            this.socket.onclose = null;
            this.socket.onerror = null;
            this.socket.onmessage = null;
            try { this.socket.close(); } catch (_) {}
            this.socket = null;
        }
    }

    destroy() {
        this.stopPing();
        clearTimeout(this.connectTimer);
        this.closeSocket();
    }
}

/* ==========================================================================
   BLUETOOTH TRANSPORT — real Web Bluetooth GATT
   ========================================================================== */

class BleTransport {
    constructor() {
        this.device = null;
        this.txChar = null;
        this.rxChar = null;
        this.encoder = new TextEncoder();
        this.onStatus = () => {};
        this.onMessage = () => {};
    }

    static isSupported() {
        return typeof navigator !== "undefined" && !!navigator.bluetooth;
    }

    get isConnected() {
        return !!(this.device && this.device.gatt && this.device.gatt.connected);
    }

    get deviceName() {
        return this.device ? this.device.name : null;
    }

    /**
     * Scan for a robot and pair. MUST be called from a user gesture
     * (the Pair button) — the browser blocks programmatic scans.
     */
    async connect() {
        const bt = CONFIG.API.BLUETOOTH;

        this.device = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: "SARATHI_" }],
            optionalServices: [bt.SERVICE_UUID],
        });

        this.device.addEventListener("gattserverdisconnected", () => {
            this.onStatus("disconnected");
        });

        const server = await this.device.gatt.connect();
        const service = await server.getPrimaryService(bt.SERVICE_UUID);
        this.txChar = await service.getCharacteristic(bt.TX_CHAR_UUID);
        this.rxChar = await service.getCharacteristic(bt.RX_CHAR_UUID);

        await this.rxChar.startNotifications();
        this.rxChar.addEventListener("characteristicvaluechanged", (ev) => {
            const text = new TextDecoder().decode(ev.target.value);
            try { this.onMessage(JSON.parse(text)); } catch (_) {}
        });
    }

    send(message) {
        if (!this.isConnected || !this.txChar) return false;
        this.txChar.writeValue(this.encoder.encode(JSON.stringify(message)));
        return true;
    }

    destroy() {
        if (this.device && this.device.gatt && this.device.gatt.connected) {
            try { this.device.gatt.disconnect(); } catch (_) {}
        }
        this.device = null;
        this.txChar = null;
        this.rxChar = null;
    }
}

/* ==========================================================================
   CONNECTION MODULE
   ========================================================================== */

class ConnectionModule {
    constructor() {
        this.isInitialized = false;
        this.unsubscribers = [];

        this.wifi = new WifiTransport();
        this.ble = new BleTransport();

        /** "real" | "sim" | "off" */
        this.mode = "off";
        this.simTimer = null;

        this.state = {
            wifi: STATUS.CONNECTION.DISCONNECTED,
            bluetooth: STATUS.CONNECTION.DISCONNECTED,
            robot: STATUS.ROBOT.OFFLINE,
            lastError: null,
            deviceName: null,
            latency: null,
        };

        this.elements = {};
        this.activeTab = "wifi";
    }

    /* ==================================================================
       PUBLIC API
       ================================================================== */

    async init(context) {
        if (this.isInitialized) return;
        this.isInitialized = true;

        Logger.info(TAG, "Initializing connection manager (real transports)");

        this.cacheHeaderElements();
        this.wireTransports();
        this.buildPanel();
        this.bindCommandBridge();
        this.renderAll();

        /* Try a remembered robot first; otherwise probe the configured
           default once, then fall back to a labelled SIM LINK so the
           dashboard never boots dead. */
        const remembered = this.rememberedEndpoint() || parseDefaultUrl();
        setTimeout(() => this.connectWifi(remembered.host, remembered.port, true), 600);

        emit(document, EVENT["module:load"], { module: "connection" });
    }

    disconnect() {
        this.wifi.destroy();
        this.ble.destroy();
        this.stopSimulation();
        this.mode = "off";
        this.state = { ...this.state, wifi: STATUS.CONNECTION.DISCONNECTED,
            bluetooth: STATUS.CONNECTION.DISCONNECTED, robot: STATUS.ROBOT.OFFLINE,
            latency: null, deviceName: null };
        this.renderAll();
        emit(document, EVENT["connection:disconnected"], { source: "user" });
        Logger.warn(TAG, "Disconnected all links");
    }

    reconnect() {
        const ep = this.rememberedEndpoint() || parseDefaultUrl();
        this.connectWifi(ep.host, ep.port, false);
    }

    getStatus() {
        return { ...this.state, mode: this.mode };
    }

    /* ==================================================================
       TRANSPORT WIRING
       ================================================================== */

    wireTransports() {
        this.wifi.onStatus = (reason) => {
            if (this.mode === "real") {
                this.state.wifi = STATUS.CONNECTION.DISCONNECTED;
                this.state.robot = STATUS.ROBOT.OFFLINE;
                this.mode = "off";
                this.renderAll();
                emit(document, EVENT["connection:disconnected"], { reason });
            }
        };

        this.wifi.onMessage = (msg) => this.handleRobotMessage(msg, "wifi");

        this.ble.onStatus = () => {
            this.state.bluetooth = STATUS.CONNECTION.DISCONNECTED;
            this.state.robot = STATUS.ROBOT.OFFLINE;
            this.state.deviceName = null;
            this.mode = "off";
            this.renderAll();
            emit(document, EVENT["connection:bluetooth:lost"]);
        };

        this.ble.onMessage = (msg) => this.handleRobotMessage(msg, "bluetooth");
    }

    /** Robot → dashboard: telemetry refreshes the simulated gauges too. */
    handleRobotMessage(msg, link) {
        if (!msg || !msg.type) return;

        if (msg.type === "telemetry:sample" || msg.type === "telemetry") {
            emit(document, EVENT["telemetry:sample"], { ...msg.payload, link });
        } else if (msg.type === "pong" && msg.ts) {
            this.state.latency = Date.now() - msg.ts;
            this.renderLinkStats();
        } else if (msg.type === "hello") {
            this.state.deviceName = msg.payload?.name || this.state.deviceName;
            this.renderLinkStats();
        }
        Logger.debug(TAG, `← ${link}: ${msg.type}`);
    }

    /** Dashboard → robot: forward every command on the active link. */
    bindCommandBridge() {
        this.unsubscribers.push(
            on(document, EVENT["command:sent"], (ev) => {
                const detail = ev.detail || {};
                const frame = {
                    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    type: detail.type || "command",
                    payload: {
                        direction: detail.direction,
                        gesture: detail.gesture,
                        source: detail.source,
                    },
                    ts: Date.now(),
                };

                const sent = this.wifi.send(frame) || this.ble.send(frame);
                if (sent) {
                    emit(document, EVENT["command:acked"], { id: frame.id, type: frame.type });
                }
            })
        );
    }

    /* ==================================================================
       CONNECT FLOWS
       ================================================================== */

    async connectWifi(host, port, quiet) {
        this.stopSimulation();
        this.wifi.destroy();
        this.ble.destroy();

        this.mode = "off";
        this.state.wifi = STATUS.CONNECTION.CONNECTING;
        this.state.robot = STATUS.ROBOT.BOOTING;
        this.setPanelStatus(`Connecting to ws://${host}:${port} …`);
        this.renderAll();
        emit(document, EVENT["connection:connecting"], { host, port });

        try {
            await this.wifi.connect(host, port);
            this.mode = "real";
            this.state.wifi = STATUS.CONNECTION.CONNECTED;
            this.state.robot = STATUS.ROBOT.ONLINE;
            this.rememberEndpoint(host, port);
            this.setPanelStatus(`Linked to robot at ws://${host}:${port}`);
            emit(document, EVENT["connection:connected"], { host, port });
            emit(document, EVENT["robot:online"]);
        } catch (err) {
            this.state.wifi = STATUS.CONNECTION.DISCONNECTED;
            this.state.robot = STATUS.ROBOT.OFFLINE;
            this.state.lastError = err.message;
            this.setPanelStatus(`${err.message} — switched to SIM LINK for demos.`);
            emit(document, EVENT["connection:error"], { message: err.message });
            this.startSimulation();
        }
        this.renderAll();
    }

    async connectBle() {
        if (!BleTransport.isSupported()) {
            this.setPanelStatus("Web Bluetooth is not available in this browser (try Chrome/Edge on desktop or Android).");
            return;
        }

        this.stopSimulation();
        this.wifi.destroy();
        this.state.bluetooth = STATUS.CONNECTION.CONNECTING;
        this.setPanelStatus("Scanning for SARATHI_ devices — pick your robot in the dialog…");
        this.renderAll();

        try {
            await this.ble.connect();
            this.mode = "real";
            this.state.bluetooth = STATUS.CONNECTION.CONNECTED;
            this.state.robot = STATUS.ROBOT.ONLINE;
            this.state.deviceName = this.ble.deviceName;
            this.setPanelStatus(`Paired with ${this.ble.deviceName} over Bluetooth LE`);
            emit(document, EVENT["connection:bluetooth:paired"], { name: this.ble.deviceName });
            emit(document, EVENT["robot:online"]);
        } catch (err) {
            this.state.bluetooth = STATUS.CONNECTION.DISCONNECTED;
            const cancelled = err && err.name === "NotFoundError";
            this.state.lastError = cancelled ? "Scan cancelled" : err.message;
            this.setPanelStatus(cancelled
                ? "Scan cancelled — no device was paired."
                : `Pairing failed: ${err.message}`);
            if (!cancelled) emit(document, EVENT["connection:error"], { message: err.message });
        }
        this.renderAll();
    }

    /* ==================================================================
       SIMULATION FALLBACK (labelled, keeps the dashboard alive)
       ================================================================== */

    startSimulation() {
        this.stopSimulation();
        this.mode = "sim";
        this.state.wifi = STATUS.CONNECTION.CONNECTED;
        this.state.robot = STATUS.ROBOT.ONLINE;
        this.state.latency = 24;
        this.simTimer = setInterval(() => {
            this.state.latency = 18 + Math.round(Math.random() * 22);
            this.renderLinkStats();
        }, 2000);
        emit(document, EVENT["connection:connected"], { simulated: true });
        emit(document, EVENT["robot:online"]);
        Logger.info(TAG, "SIM LINK active — no real robot detected");
    }

    stopSimulation() {
        if (this.simTimer) clearInterval(this.simTimer);
        this.simTimer = null;
        if (this.mode === "sim") this.mode = "off";
    }

    /* ==================================================================
       UI — TABBED PANEL
       ================================================================== */

    cacheHeaderElements() {
        this.elements = {
            statusWifi: getElementByID("status-wifi"),
            statusWifiValue: getElementByID("status-wifi-value"),
            statusBluetooth: getElementByID("status-bluetooth"),
            statusBluetoothValue: getElementByID("status-bluetooth-value"),
            statusRobot: getElementByID("status-robot"),
            statusRobotValue: getElementByID("status-robot-value"),
            connectionIndicator: getElementByID("connection-indicator"),
            connectionText: getElementByID("connection-indicator-text"),
            cardBody: getElementByID("connection-body"),
        };
    }

    buildPanel() {
        const body = this.elements.cardBody;
        if (!body) return;

        /* Clear the placeholder block that ships in index.html */
        body.querySelectorAll(".card-placeholder").forEach((el) => el.remove());
        body.querySelectorAll("p.card-description").forEach((el) => el.remove());

        const root = createElement("div", "conn-panel");

        /* Status banner */
        this.elements.banner = createElement("div", "conn-banner", "conn-banner");
        this.elements.bannerDot = createElement("span", "conn-banner-dot", "conn-banner-dot");
        this.elements.bannerText = createElement("span");
        this.elements.banner.append(this.elements.bannerDot, this.elements.bannerText);
        root.appendChild(this.elements.banner);

        /* Tabs */
        const tabs = createElement("div", "conn-tabs", "conn-tabs");
        this.tabButtons = {};
        [["wifi", "WiFi"], ["bluetooth", "Bluetooth"], ["guide", "How to Connect"]].forEach(([id, label]) => {
            const btn = createElement("button", "conn-tab-" + id, "conn-tab-btn");
            setText(btn, label);
            on(btn, "click", () => this.switchTab(id));
            this.tabButtons[id] = btn;
            tabs.appendChild(btn);
        });
        root.appendChild(tabs);

        /* Tab bodies */
        this.elements.tabWifi = this.buildWifiTab();
        this.elements.tabBle = this.buildBleTab();
        this.elements.tabGuide = this.buildGuideTab();
        root.append(this.elements.tabWifi, this.elements.tabBle, this.elements.tabGuide);

        /* Link stats row */
        this.elements.stats = createElement("div", "conn-stats", "conn-stats");
        root.appendChild(this.elements.stats);

        body.appendChild(root);
        this.switchTab("wifi");
    }

    buildWifiTab() {
        const wrap = createElement("div", "conn-tab-body-wifi", "conn-tab-body");

        const d = parseDefaultUrl();
        const row = createElement("div", "conn-row", "conn-row");

        this.elements.hostInput = createElement("input", "conn-input-host", "conn-input", "conn-input--host");
        this.elements.hostInput.placeholder = "192.168.4.1";
        this.elements.hostInput.setAttribute("aria-label", "Robot IP or hostname");


        this.elements.portInput = createElement("input", "conn-input-port", "conn-input", "conn-input--port");

        row.append(this.elements.hostInput, this.elements.portInput);

        const actions = createElement("div", "conn-actions", "conn-actions");

        this.elements.btnConnect = this.actionButton("fa-tower-broadcast", "Connect", "btn btn-primary");
        on(this.elements.btnConnect, "click", () =>
            this.connectWifi(this.elements.hostInput.value.trim() || d.host,
                this.elements.portInput.value.trim() || d.port, false));

        this.elements.btnDisconnect = this.actionButton("fa-plug-circle-xmark", "Disconnect", "btn btn-ghost");
        on(this.elements.btnDisconnect, "click", () => this.disconnect());

        this.elements.btnSim = this.actionButton("fa-flask", "Demo Link", "btn btn-ghost");
        this.elements.btnSim.title = "Run without a robot — simulated telemetry";
        on(this.elements.btnSim, "click", () => {
            this.wifi.destroy();
            this.ble.destroy();
            this.setPanelStatus("SIM LINK active — telemetry is simulated.");
            this.startSimulation();
            this.renderAll();
        });

        actions.append(this.elements.btnConnect, this.elements.btnDisconnect, this.elements.btnSim);

        const hint = createElement("p", "conn-hint", "conn-hint");
        setText(hint, "Enter the ESP32's IP and WebSocket port. On the robot's access-point network this is usually 192.168.4.1:81.");

        wrap.append(row, actions, hint);
        return wrap;
    }

    buildBleTab() {
        const wrap = createElement("div", "conn-tab-body-bluetooth", "conn-tab-body");

        const supported = BleTransport.isSupported();

        const actions = createElement("div", "conn-actions", "conn-actions");

        this.elements.btnPair = this.actionButton("fa-bluetooth-b", "Scan & Pair", "btn btn-primary", true);
        this.elements.btnPair.disabled = !supported;
        on(this.elements.btnPair, "click", () => this.connectBle());

        this.elements.btnBleOff = this.actionButton("fa-plug-circle-xmark", "Disconnect", "btn btn-ghost");
        on(this.elements.btnBleOff, "click", () => this.disconnect());

        actions.append(this.elements.btnPair, this.elements.btnBleOff);

        const note = createElement("p", "conn-hint", "conn-hint");
        setText(note, supported
            ? "Powers on the radio and lists nearby devices named SARATHI_*. Pick your robot in the browser dialog — pairing happens automatically."
            : "Web Bluetooth requires Chrome or Edge on desktop / Android over HTTPS. WiFi is the recommended link on other browsers.");

        wrap.append(actions, note);
        return wrap;
    }

    buildGuideTab() {
        const wrap = createElement("div", "conn-guide", "conn-tab-body");

        const steps = (title, icon, items) => {
            const box = createElement("div", "conn-guide-box", "conn-guide-box");
            const h = createElement("h4", undefined, "conn-guide-title");
            h.innerHTML = `<i class="${icon}" aria-hidden="true"></i> ${title}`;
            box.appendChild(h);
            const ol = createElement("ol", "conn-guide-list", "conn-guide-list");
            items.forEach((t) => {
                const li = createElement("li", undefined, "conn-guide-item");
                li.innerHTML = t;
                ol.appendChild(li);
            });
            box.appendChild(ol);
            return box;
        };

        wrap.appendChild(steps("Connect over WiFi", "fa-solid fa-wifi", [
            "Flash the robot firmware and confirm it prints <code>WiFi ready · IP 192.168.x.x</code> in the Serial Monitor.",
            "Join the robot's own hotspot (<code>SARATHI_AP</code>) or put both devices on your home network.",
            "Type that IP and port <code>81</code> into the WiFi tab and press <strong>Connect</strong>.",
            "The status flips to <strong>LINK ACTIVE</strong> and every command you send streams straight to the motors.",
        ]));

        wrap.appendChild(steps("Connect over Bluetooth", "fa-brands fa-bluetooth-b", [
            "Use Chrome or Edge — Safari and Firefox do not ship Web Bluetooth.",
            "Press <strong>Scan &amp; Pair</strong> and choose the device named <code>SARATHI_A1</code> (or your unit's suffix).",
            "The dashboard opens the GATT service and subscribes to the robot's TX characteristic automatically.",
            "Range is roughly 10&nbsp;m — WiFi is the better choice for full survey runs.",
        ]));

        wrap.appendChild(steps("ESP32 side", "fa-solid fa-microchip", [
            "WiFi: run a <code>WebSocketsServer</code> on port 81 that echoes JSON frames.",
            "BLE: advertise <code>SARATHI_</code> + the service/characteristic UUIDs from <code>config.js</code>.",
            "Reply to <code>ping</code> with <code>pong</code> (same <code>ts</code>) so latency stays honest.",
        ]));

        return wrap;
    }

    actionButton(icon, label, variant, brand = false) {
        const btn = createElement("button");
        btn.type = "button";
        btn.className = variant + " conn-action";
        btn.innerHTML = `<i class="${brand ? "fa-brands" : "fa-solid"} ${icon}" aria-hidden="true"></i><span>${label}</span>`;
        return btn;
    }

    switchTab(id) {
        this.activeTab = id;
        Object.entries(this.tabButtons).forEach(([key, btn]) => {
            toggleClass(btn, "is-active", key === id);
        });
        if (this.elements.tabWifi) this.elements.tabWifi.style.display = id === "wifi" ? "flex" : "none";
        if (this.elements.tabBle) this.elements.tabBle.style.display = id === "bluetooth" ? "flex" : "none";
        if (this.elements.tabGuide) this.elements.tabGuide.style.display = id === "guide" ? "block" : "none";
    }

    setPanelStatus(text) {
        if (this.elements.bannerText) setText(this.elements.bannerText, text);
        if (this.elements.bannerDot) {
            const live = this.mode === "real" || this.mode === "sim";
            this.elements.bannerDot.style.background = live
                ? (this.mode === "real" ? "var(--clr-success)" : "var(--clr-warning)")
                : "var(--clr-text-muted)";
            this.elements.bannerDot.style.boxShadow = live ? "0 0 8px currentColor" : "none";
        }
    }

    /* ==================================================================
       RENDER — header pills + stats
       ================================================================== */

    renderAll() {
        this.renderPill(this.elements.statusWifi, this.elements.statusWifiValue,
            this.state.wifi, "WiFi", this.mode === "sim" ? "SIM" : null);
        this.renderPill(this.elements.statusBluetooth, this.elements.statusBluetoothValue,
            this.state.bluetooth, "Bluetooth", this.state.deviceName);
        this.renderRobotPill();

        const linked = this.state.wifi === STATUS.CONNECTION.CONNECTED ||
            this.state.bluetooth === STATUS.CONNECTION.CONNECTED;
        if (this.elements.connectionIndicator) {
            toggleClass(this.elements.connectionIndicator, CSS_CLASS.CONNECTION_CONNECTED, linked);
            toggleClass(this.elements.connectionIndicator, CSS_CLASS.CONNECTION_DISCONNECTED, !linked);
        }
        if (this.elements.connectionText) {
            setText(this.elements.connectionText, linked
                ? (this.mode === "real" ? "Link Active" : "Sim Link")
                : "No Link");
        }
        this.renderLinkStats();
        this.setPanelStatus(this.elements.bannerText?.textContent || "Ready — connect over WiFi or Bluetooth.");
    }

    renderPill(pill, valueEl, state, label, suffix) {
        if (!pill || !valueEl) return;
        removeClass(pill, CSS_CLASS.STATUS_ONLINE, CSS_CLASS.STATUS_OFFLINE, CSS_CLASS.STATUS_WARNING);
        let text;
        if (state === STATUS.CONNECTION.CONNECTED) {
            addClass(pill, CSS_CLASS.STATUS_ONLINE);
            text = suffix || "Connected";
        } else if (state === STATUS.CONNECTION.CONNECTING) {
            addClass(pill, CSS_CLASS.STATUS_WARNING);
            text = "Connecting";
        } else {
            addClass(pill, CSS_CLASS.STATUS_OFFLINE);
            text = "Offline";
        }
        setText(valueEl, text);
        pill.setAttribute("aria-label", `${label} status: ${text}`);
    }

    renderRobotPill() {
        const pill = this.elements.statusRobot;
        const valueEl = this.elements.statusRobotValue;
        if (!pill || !valueEl) return;
        removeClass(pill, CSS_CLASS.STATUS_ONLINE, CSS_CLASS.STATUS_OFFLINE, CSS_CLASS.STATUS_WARNING);
        let text = "Offline";
        if (this.state.robot === STATUS.ROBOT.ONLINE) { addClass(pill, CSS_CLASS.STATUS_ONLINE); text = "Online"; }
        else if (this.state.robot === STATUS.ROBOT.BOOTING) { addClass(pill, CSS_CLASS.STATUS_WARNING); text = "Booting"; }
        else { addClass(pill, CSS_CLASS.STATUS_OFFLINE); }
        setText(valueEl, text);
    }

    renderLinkStats() {
        if (!this.elements.stats) return;
        const cells = [
            ["LINK", this.mode === "real" ? (this.ble.isConnected ? "BLE" : "WIFI") : this.mode === "sim" ? "SIM" : "—"],
            ["LATENCY", this.state.latency != null ? `${this.state.latency} ms` : "—"],
            ["DEVICE", this.state.deviceName || (this.mode === "real" ? "robot" : "—")],
        ];
        this.elements.stats.innerHTML = "";
        cells.forEach(([label, value]) => {
            const cell = createElement("div", undefined, "conn-stat-cell");
            const l = createElement("span", undefined, "conn-stat-label");
            setText(l, label);
            const v = createElement("span", undefined, "conn-stat-value");
            setText(v, value);
            cell.append(l, v);
            this.elements.stats.appendChild(cell);
        });
    }

    /* ==================================================================
       PERSISTENCE
       ================================================================== */

    rememberEndpoint(host, port) {
        try { localStorage.setItem("mc_last_endpoint", JSON.stringify({ host, port })); } catch (_) {}
    }

    rememberedEndpoint() {
        try {
            const raw = localStorage.getItem("mc_last_endpoint");
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }
}

const connectionModule = new ConnectionModule();
export default connectionModule;
export { ConnectionModule, WifiTransport, BleTransport };
