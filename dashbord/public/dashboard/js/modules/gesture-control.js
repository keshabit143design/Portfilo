/* ==========================================================================
   MISSION CONTROL — SMART SURVEY ROBOT — modules/gesture-control.js
   --------------------------------------------------------------------------
   Gesture Control Module — operator laptop webcam + MediaPipe Hands
   --------------------------------------------------------------------------
   The robot has NO onboard camera. This module drives the robot from the
   operator's own webcam:

     • Live mirrored webcam preview (getUserMedia)
     • MediaPipe Hands landmark overlay drawn on a synced canvas
     • Real-time classification of 7 gestures → robot commands
     • Commands dispatched through the existing event bus
       (EVENT["command:sent"]) — communication architecture untouched
     • Strict resource lifecycle: the camera never auto-starts, and the
       stream + MediaPipe worker are released when the operator leaves

   Gestures
     👍 Thumb Up    → FORWARD        ✋ Open Palm → STOP
     ✊ Closed Fist → REVERSE         👈 Point Left → TURN LEFT
     👉 Point Right → TURN RIGHT      ✌ Peace → AUTO MODE
     ☝ One Finger  → MANUAL MODE

   Public API
     init(context)  — build UI, wire controls (camera stays OFF)
     destroy()      — release stream, cancel rAF, close MediaPipe
   ========================================================================== */

import { COMMAND_TYPE, EVENT } from "../constants.js";
import {
    Logger,
    getElementByID,
    createElement,
    setText,
    setStyles,
    on,
    emit,
    removeElement,
    addClass,
    removeClass,
} from "../utils.js";

const TAG = "GestureControl";

/* MediaPipe Hands CDN build (self-contained; no camera_utils needed). */
const MEDIAPIPE_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240";

/* Frames a gesture must hold before it is accepted (de-bounce). */
const STABLE_FRAMES = 3;

/* Gesture → robot command mapping. `type` flows into the existing
   command pipeline exactly like keyboard/manual commands do. */
const GESTURE_COMMANDS = {
    "Thumb Up":    { type: COMMAND_TYPE.MOTOR_FORWARD,    label: "FORWARD" },
    "Open Palm":   { type: COMMAND_TYPE.MOTOR_STOP,       label: "STOP" },
    "Closed Fist": { type: COMMAND_TYPE.MOTOR_BACKWARD,   label: "REVERSE" },
    "Point Left":  { type: COMMAND_TYPE.MOTOR_TURN_LEFT,  label: "TURN LEFT" },
    "Point Right": { type: COMMAND_TYPE.MOTOR_TURN_RIGHT, label: "TURN RIGHT" },
    "Peace":       { type: "mode:auto",                   label: "AUTO MODE" },
    "One Finger":  { type: "mode:manual",                 label: "MANUAL MODE" },
};

/* Camera lifecycle states. */
const CAM = { OFF: "off", STARTING: "starting", LIVE: "live", ERROR: "error" };

class GestureControlModule {
    constructor() {
        this.isInitialized = false;

        /* Media / detection runtime */
        this.hands = null;
        this.stream = null;
        this.rafId = null;
        this.processing = false;
        this.camState = CAM.OFF;

        /* Recognition state */
        this.lastGesture = null;
        this.pendingGesture = null;
        this.pendingCount = 0;
        this.sensitivity = 60;               /* 0..100 slider value */

        /* FPS metering */
        this.frameCount = 0;
        this.fpsWindowStart = 0;
        this.fps = 0;

        /** @type {Array<Function>} */
        this.unsubscribers = [];

        /** @type {Object<string, HTMLElement|null>} */
        this.el = {};
    }

    /* ==================================================================
       LIFECYCLE
       ================================================================== */

    async init() {
        if (this.isInitialized) return;

        const body = getElementByID("gesture-control-body");
        if (!body) {
            Logger.warn(TAG, "gesture-control-body not found; module idle.");
            return;
        }

        Logger.info(TAG, "Initializing gesture control (webcam)");
        this.buildUI(body);
        this.bindControls();
        this.watchNavigation();

        this.isInitialized = true;
        emit(document, EVENT["module:load"], { module: "gesture-control" });
    }

    /** Release every resource: stream tracks, rAF loop, MediaPipe worker. */
    destroy() {
        this.teardownStream();
        this.unsubscribers.forEach((off) => off());
        this.unsubscribers = [];
        this.isInitialized = false;
        emit(document, EVENT["module:unload"], { module: "gesture-control" });
        Logger.info(TAG, "Gesture control destroyed — resources released.");
    }

    /* ==================================================================
       UI CONSTRUCTION
       ================================================================== */

    buildUI(body) {
        const placeholder = body.querySelector('[data-module="gesture-control"]');
        if (placeholder) removeElement(placeholder);

        /* --- Stage: mirrored video + landmark canvas ------------------ */
        const stage = createElement("div", "gesture-stage", "gesture-stage");
        this.el.video = createElement("video", "gesture-video", "gesture-video");
        setStyles(this.el.video, { display: "none" });
        this.el.video.setAttribute("playsinline", "true");
        this.el.video.setAttribute("muted", "true");
        this.el.video.setAttribute("aria-label", "Live webcam preview for gesture control");

        this.el.canvas = createElement("canvas", "gesture-canvas", "gesture-canvas");
        this.el.canvas.setAttribute("aria-hidden", "true");

        /* Offline veil shown until the stream is live */
        this.el.veil = createElement("div", "gesture-veil", "gesture-veil");
        this.el.veil.innerHTML =
            '<i class="fa-solid fa-hand" aria-hidden="true"></i>' +
            "<span>Webcam off — press Start Camera</span>";

        stage.append(this.el.video, this.el.canvas, this.el.veil);

        /* --- Live readout panel --------------------------------------- */
        const readout = createElement("div", "gesture-readout", "gesture-readout");
        readout.setAttribute("role", "status");
        readout.setAttribute("aria-live", "polite");

        this.el.gestureValue = this.readoutCell(readout, "fa-hand-sparkles", "Detected Gesture", "—", "gesture-value");
        this.el.commandValue = this.readoutCell(readout, "fa-satellite-dish", "Robot Command", "—", "gesture-command");
        this.el.confidenceValue = this.readoutCell(readout, "fa-gauge-high", "Confidence", "—", "gesture-confidence");
        this.el.fpsValue = this.readoutCell(readout, "fa-film", "FPS", "0", "gesture-fps");

        /* Camera status indicator */
        const statusRow = createElement("div", undefined, "gesture-status-row");
        const statusLabel = createElement("span", undefined, "gesture-status-label");
        setText(statusLabel, "Camera");
        this.el.statusDot = createElement("span", "gesture-status-dot", "gesture-status-dot");
        this.el.statusText = createElement("span", "gesture-status-text");
        setText(this.el.statusText, "Off");
        statusRow.append(statusLabel, this.el.statusDot, this.el.statusText);

        /* --- Controls -------------------------------------------------- */
        const controls = createElement("div", "gesture-controls", "gesture-controls");

        this.el.btnStart = this.controlButton("gesture-btn-start", "fa-play", "Start Camera", "btn-primary");
        this.el.btnStop = this.controlButton("gesture-btn-stop", "fa-stop", "Stop Camera", "btn-danger");
        this.el.btnCalibrate = this.controlButton("gesture-btn-calibrate", "fa-crosshairs", "Calibrate", "btn-ghost");
        this.el.btnStop.disabled = true;

        /* Sensitivity slider */
        const sliderWrap = createElement("div", undefined, "gesture-slider");
        const sliderLabel = createElement("label", undefined, "gesture-slider-label");
        sliderLabel.setAttribute("for", "gesture-sensitivity");
        setText(sliderLabel, "Sensitivity");
        this.el.slider = createElement("input", "gesture-sensitivity", "gesture-slider-input");
        this.el.slider.setAttribute("type", "range");
        this.el.slider.setAttribute("min", "10");
        this.el.slider.setAttribute("max", "100");
        this.el.slider.setAttribute("step", "5");
        this.el.slider.setAttribute("value", String(this.sensitivity));
        this.el.slider.setAttribute("aria-label", "Gesture detection sensitivity");
        this.el.sliderValue = createElement("span", "gesture-slider-value");
        setText(this.el.sliderValue, `${this.sensitivity}%`);
        sliderWrap.append(sliderLabel, this.el.slider, this.el.sliderValue);

        controls.append(this.el.btnStart, this.el.btnStop, this.el.btnCalibrate, sliderWrap);

        body.append(stage, readout, statusRow, controls);
    }

    readoutCell(parent, icon, label, initial, valueClass) {
        const cell = createElement("div", undefined, "gesture-cell");
        const iconEl = createElement("i", undefined, "fa-solid", icon);
        iconEl.setAttribute("aria-hidden", "true");
        const labelEl = createElement("span", undefined, "gesture-cell-label");
        setText(labelEl, label);
        const valueEl = createElement("strong", undefined, "gesture-cell-value", valueClass);
        setText(valueEl, initial);
        cell.append(iconEl, labelEl, valueEl);
        parent.appendChild(cell);
        return valueEl;
    }

    controlButton(id, icon, label, variant) {
        const btn = createElement("button", id, "btn", variant, "gesture-btn");
        btn.setAttribute("type", "button");
        btn.setAttribute("aria-label", label);
        const iconEl = createElement("i", undefined, "fa-solid", icon);
        iconEl.setAttribute("aria-hidden", "true");
        const text = createElement("span");
        setText(text, label);
        btn.append(iconEl, text);
        return btn;
    }

    bindControls() {
        this.unsubscribers.push(
            on(this.el.btnStart, "click", () => this.startCamera()),
            on(this.el.btnStop, "click", () => this.stopCamera("user")),
            on(this.el.btnCalibrate, "click", () => this.calibrate()),
            on(this.el.slider, "input", () => this.onSensitivityChange()),
            on(window, "beforeunload", () => this.teardownStream())
        );
    }

    /** Stop the webcam whenever the operator navigates away from any view
     *  where the gesture card is visible (dashboard grid or focused page). */
    watchNavigation() {
        this.unsubscribers.push(
            on(document, EVENT["page:change"], (event) => {
                const pageId = event.detail && event.detail.pageId;
                if (pageId && pageId !== "dashboard" && pageId !== "gesture-control") {
                    this.stopCamera("page-leave");
                }
            })
        );
    }

    /* ==================================================================
       CAMERA LIFECYCLE
       ================================================================== */

    async startCamera() {
        if (this.camState === CAM.LIVE || this.camState === CAM.STARTING) return;

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.setCamState(CAM.ERROR, "Webcam API unavailable");
            this.notify("error", "This browser does not support webcam access.");
            return;
        }

        this.setCamState(CAM.STARTING, "Requesting webcam…");
        this.el.btnStart.disabled = true;

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
                audio: false,
            });

            this.el.video.srcObject = this.stream;
            await this.el.video.play();

            /* Size the overlay to the decoded frame */
            this.el.canvas.width = this.el.video.videoWidth || 640;
            this.el.canvas.height = this.el.video.videoHeight || 480;

            await this.ensureHands();
            this.setCamState(CAM.LIVE, "Connected");

            this.el.video.style.display = "block";
            this.el.veil.style.display = "none";
            this.el.btnStop.disabled = false;

            this.resetFps();
            this.loop();
            Logger.info(TAG, "Webcam live.");
        } catch (error) {
            this.teardownStream();
            const reason = error && error.name === "NotAllowedError"
                ? "Permission denied"
                : (error && error.message) || "Webcam error";
            this.setCamState(CAM.ERROR, reason);
            this.notify("error", `Webcam unavailable: ${reason}`);
            this.el.btnStart.disabled = false;
            Logger.error(TAG, "startCamera failed:", error);
        }
    }

    /** Stop the stream and every processing loop; keep the UI reusable. */
    stopCamera(reason) {
        const wasLive = this.camState === CAM.LIVE || this.camState === CAM.STARTING;
        this.teardownStream();
        this.setCamState(CAM.OFF, reason === "page-leave" ? "Off (left page)" : "Off");

        this.el.video.style.display = "none";
        this.el.veil.style.display = "flex";
        this.el.btnStart.disabled = false;
        this.el.btnStop.disabled = true;

        this.resetRecognition();
        setText(this.el.gestureValue, "—");
        setText(this.el.commandValue, "—");
        setText(this.el.confidenceValue, "—");
        setText(this.el.fpsValue, "0");

        if (wasLive) Logger.info(TAG, `Camera stopped (${reason}).`);
    }

    /** Hard release: tracks, animation frame, MediaPipe worker. */
    teardownStream() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.stream) {
            this.stream.getTracks().forEach((track) => track.stop());
            this.stream = null;
        }
        if (this.el.video) this.el.video.srcObject = null;
        if (this.hands && typeof this.hands.close === "function") {
            try { this.hands.close(); } catch (_) { /* already closed */ }
            this.hands = null;
        }
        this.clearCanvas();
        this.processing = false;
    }

    /* Lazy-load MediaPipe Hands once per session of the module. */
    async ensureHands() {
        if (this.hands) return;

        if (typeof window.Hands === "undefined") {
            await new Promise((resolve, reject) => {
                const script = createElement("script");
                script.src = `${MEDIAPIPE_CDN}/hands.js`;
                script.async = true;
                script.onload = resolve;
                script.onerror = () => reject(new Error("MediaPipe failed to load"));
                document.head.appendChild(script);
            });
        }

        this.hands = new window.Hands({
            locateFile: (file) => `${MEDIAPIPE_CDN}/${file}`,
        });
        this.hands.setOptions(this.handsOptions());
        this.hands.onResults((results) => this.onHandResults(results));
    }

    handsOptions() {
        /* Slider 10..100 → detection confidence 0.85..0.5 (more sensitive
           = accepts weaker evidence) while keeping tracking stable. */
        const s = this.sensitivity / 100;
        return {
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.85 - s * 0.35,
            minTrackingConfidence: 0.6,
        };
    }

    onSensitivityChange() {
        this.sensitivity = Number(this.el.slider.value) || 60;
        setText(this.el.sliderValue, `${this.sensitivity}%`);
        if (this.hands) this.hands.setOptions(this.handsOptions());
        this.resetRecognition();
    }

    /** Reset rolling gesture state without touching the stream. */
    calibrate() {
        this.resetRecognition();
        if (this.hands) this.hands.setOptions(this.handsOptions());
        setText(this.el.gestureValue, "—");
        setText(this.el.commandValue, "—");
        setText(this.el.confidenceValue, "—");
        this.setCamState(this.camState === CAM.LIVE ? CAM.LIVE : this.camState,
            this.camState === CAM.LIVE ? "Calibrated ✓" : "Off");
        this.notify("info", "Gesture baseline recalibrated.");
        Logger.info(TAG, "Calibration performed.");
    }

    resetRecognition() {
        this.lastGesture = null;
        this.pendingGesture = null;
        this.pendingCount = 0;
    }

    /* ==================================================================
       DETECTION LOOP
       ================================================================== */

    /** Self-paced rAF loop; a `processing` guard prevents frame stacking. */
    loop() {
        if (this.camState !== CAM.LIVE) return;

        this.rafId = requestAnimationFrame(() => this.loop());

        if (this.processing || !this.hands) return;
        if (this.el.video.readyState < 2) return;

        this.processing = true;
        this.hands.send({ image: this.el.video })
            .catch(() => { /* transient frame error — skip */ })
            .finally(() => {
                this.processing = false;
                this.countFrame();
            });
    }

    countFrame() {
        const now = performance.now();
        if (!this.fpsWindowStart) this.fpsWindowStart = now;
        this.frameCount++;
        const elapsed = now - this.fpsWindowStart;
        if (elapsed >= 500) {
            this.fps = Math.round((this.frameCount * 1000) / elapsed);
            setText(this.el.fpsValue, String(this.fps));
            this.frameCount = 0;
            this.fpsWindowStart = now;
        }
    }

    resetFps() {
        this.frameCount = 0;
        this.fpsWindowStart = 0;
        this.fps = 0;
    }

    onHandResults(results) {
        this.clearCanvas();

        if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
            /* No hand: clear any pending gesture after one unstable frame. */
            this.pendingGesture = null;
            this.pendingCount = 0;
            if (this.lastGesture) {
                this.lastGesture = null;
                setText(this.el.gestureValue, "—");
                setText(this.el.commandValue, "—");
                setText(this.el.confidenceValue, "—");
            }
            return;
        }

        const landmarks = results.multiHandLandmarks[0];
        this.drawLandmarks(landmarks);

        const gesture = this.classifyHand(landmarks);
        const confidence = results.multiHandedness && results.multiHandedness[0]
            ? results.multiHandedness[0].score
            : 0;

        if (!gesture) {
            this.pendingGesture = null;
            this.pendingCount = 0;
            return;
        }

        /* De-bounce: accept only after STABLE_FRAMES consecutive matches. */
        if (gesture === this.pendingGesture) {
            this.pendingCount++;
        } else {
            this.pendingGesture = gesture;
            this.pendingCount = 1;
        }

        setText(this.el.gestureValue, gesture);
        setText(this.el.confidenceValue, `${Math.round(confidence * 100)}%`);

        if (this.pendingCount >= STABLE_FRAMES && gesture !== this.lastGesture) {
            this.lastGesture = gesture;
            this.dispatchCommand(gesture, confidence);
        }
    }

    /* ==================================================================
       GESTURE CLASSIFICATION
       --------------------------------------------------------------------
       Landmarks are normalized 0..1 in the UN-mirrored frame; the preview
       is mirrored with CSS, so horizontal decisions use mirrored X.
       ================================================================== */

    classifyHand(lm) {
        if (!lm || lm.length < 21) return null;

        const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
        const wrist = 0;

        /* Finger extension: tip noticeably farther from wrist than PIP.
           Higher sensitivity lowers the required ratio. */
        const k = 1.18 - (this.sensitivity / 100) * 0.22;
        const indexExt  = d(8, wrist)  > d(6, wrist) * k;
        const middleExt = d(12, wrist) > d(10, wrist) * k;
        const ringExt   = d(16, wrist) > d(14, wrist) * k;
        const pinkyExt  = d(20, wrist) > d(18, wrist) * k;
        const thumbExt  = d(4, wrist) > d(3, wrist) * 1.12 && d(4, 5) > d(3, 5);

        const fingers = [indexExt, middleExt, ringExt, pinkyExt];
        const extendedCount = fingers.filter(Boolean).length;

        /* ✋ Open Palm — all four fingers out */
        if (extendedCount === 4) return "Open Palm";

        /* ✊ Closed Fist — everything curled */
        if (extendedCount === 0 && !thumbExt) return "Closed Fist";

        /* 👍 Thumb Up — only the thumb, raised above the wrist */
        if (thumbExt && extendedCount === 0 && lm[4].y < lm[0].y) return "Thumb Up";

        /* Index-led gestures */
        if (indexExt && !middleExt && !ringExt && !pinkyExt) {
            const mx = (p) => 1 - p.x; /* mirror */
            const dx = mx(lm[8]) - mx(lm[5]);
            const dy = lm[8].y - lm[5].y;

            /* Horizontal index → point; vertical → one finger */
            if (Math.abs(dx) > Math.abs(dy) * 1.1) {
                return dx < 0 ? "Point Left" : "Point Right";
            }
            return "One Finger";
        }

        /* ✌ Peace — index + middle only */
        if (indexExt && middleExt && !ringExt && !pinkyExt) return "Peace";

        return null;
    }

    /* ==================================================================
       COMMAND DISPATCH — existing communication pipeline only
       ================================================================== */

    dispatchCommand(gesture, confidence) {
        const mapping = GESTURE_COMMANDS[gesture];
        if (!mapping) return;

        setText(this.el.commandValue, mapping.label);

        emit(document, EVENT["command:sent"], {
            type: mapping.type,
            direction: mapping.type.startsWith("motor:") ? mapping.type.split(":")[1] : undefined,
            source: "gesture",
            gesture,
            confidence: Number(confidence.toFixed(2)),
            timestamp: Date.now(),
        });

        Logger.info(TAG, `Gesture "${gesture}" → ${mapping.label}`);
    }

    /* ==================================================================
       CANVAS OVERLAY
       ================================================================== */

    drawLandmarks(lm) {
        const ctx = this.el.canvas.getContext("2d");
        if (!ctx) return;
        const w = this.el.canvas.width;
        const h = this.el.canvas.height;

        ctx.save();
        ctx.clearRect(0, 0, w, h);

        /* Bone connections (MediaPipe HAND_CONNECTIONS pairs) */
        const links = window.HAND_CONNECTIONS || [];
        ctx.strokeStyle = "rgba(45, 212, 191, 0.8)";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        links.forEach(([a, b]) => {
            ctx.beginPath();
            ctx.moveTo(lm[a].x * w, lm[a].y * h);
            ctx.lineTo(lm[b].x * w, lm[b].y * h);
            ctx.stroke();
        });

        /* Joint dots */
        ctx.fillStyle = "#5eead4";
        ctx.shadowColor = "rgba(45, 212, 191, 0.8)";
        ctx.shadowBlur = 6;
        lm.forEach((p) => {
            ctx.beginPath();
            ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.restore();
    }

    clearCanvas() {
        const ctx = this.el.canvas && this.el.canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, this.el.canvas.width, this.el.canvas.height);
    }

    /* ==================================================================
       STATUS HELPERS
       ================================================================== */

    setCamState(state, text) {
        this.camState = state;
        setText(this.el.statusText, text);

        removeClass(this.el.statusDot, "dot-live", "dot-starting", "dot-error");
        if (state === CAM.LIVE) addClass(this.el.statusDot, "dot-live");
        else if (state === CAM.STARTING) addClass(this.el.statusDot, "dot-starting");
        else if (state === CAM.ERROR) addClass(this.el.statusDot, "dot-error");
    }

    /** Route a user-facing alert through the notification center. */
    notify(level, message) {
        emit(document, EVENT["notification:add"], {
            level,
            title: "Gesture Control",
            message,
        });
    }
}

export default new GestureControlModule();
