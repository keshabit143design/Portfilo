/* ==========================================================================
   MISSION CONTROL — SMART SURVEY ROBOT — modules/voice-control.js
   --------------------------------------------------------------------------
   Voice Control — conversational robot commands
   --------------------------------------------------------------------------
   Features
     • Continuous listening with auto-restart (hands-free operation)
     • Live interim transcript while you speak
     • Real microphone level meter (AnalyserNode, animated bars)
     • Expanded command vocabulary with synonyms & phrases
     • Confidence readout + threshold gate
     • Optional spoken confirmation (speechSynthesis)
     • Language selector (en-US / en-IN / hi-IN)
     • Commands flow onto the shared bus — if a WiFi/BLE link is live,
       connection.js forwards them straight to the ESP32

   NOTE: All visual styles live in css/style.css under section "12j.
   DYNAMIC-MODULE STYLES" so the responsive layer can target them.

   Public API
     init(context) · destroy()
   ========================================================================== */

import { COMMAND_TYPE, EVENT, ANIMATION_CLASS } from "../constants.js";
import {
    Logger,
    getElementByID,
    addClass,
    removeClass,
    on,
    emit,
    createElement,
    setText,
} from "../utils.js";

const TAG = "VoiceControl";

/* Ordered longest-first so "emergency stop" matches before "stop". */
const VOCABULARY = [
    { phrases: ["emergency stop", "kill switch", "e stop", "estop"], type: COMMAND_TYPE.ROBOT_SHUTDOWN, label: "Emergency Stop", icon: "fa-skull-crossbones", say: "Emergency stop engaged" },
    { phrases: ["turn left", "go left", "port side"], type: COMMAND_TYPE.MOTOR_TURN_LEFT, label: "Turn Left", icon: "fa-arrow-turn-up", say: "Turning left" },
    { phrases: ["turn right", "go right", "starboard"], type: COMMAND_TYPE.MOTOR_TURN_RIGHT, label: "Turn Right", icon: "fa-arrow-turn-up", say: "Turning right" },
    { phrases: ["go forward", "move forward", "drive forward", "straight ahead", "full ahead", "forward", "ahead", "advance"], type: COMMAND_TYPE.MOTOR_FORWARD, label: "Forward", icon: "fa-arrow-up", say: "Moving forward" },
    { phrases: ["go back", "move back", "drive back", "back up", "backward", "backwards", "reverse"], type: COMMAND_TYPE.MOTOR_BACKWARD, label: "Reverse", icon: "fa-arrow-down", say: "Reversing" },
    { phrases: ["hold position", "all stop", "stop now", "stop", "halt", "brake", "freeze"], type: COMMAND_TYPE.MOTOR_STOP, label: "Stop", icon: "fa-hand", say: "Stopped" },
    { phrases: ["auto mode", "autonomous", "self drive", "cruise", "auto"], type: COMMAND_TYPE.MODE_AUTO, label: "Auto Mode", icon: "fa-route", say: "Auto mode selected" },
    { phrases: ["manual mode", "take over", "hand control", "manual"], type: COMMAND_TYPE.MODE_MANUAL, label: "Manual Mode", icon: "fa-gamepad", say: "Manual control" },
];

const LANGUAGES = [
    { code: "en-US", label: "English (US)" },
    { code: "en-IN", label: "English (India)" },
    { code: "hi-IN", label: "हिन्दी" },
];

class VoiceControlModule {
    constructor() {
        this.isInitialized = false;
        this.unsubscribers = [];

        this.recognition = null;
        this.supported = false;
        this.isListening = false;
        this.continuous = true;
        this.speakBack = true;
        this.language = "en-US";
        this.confidenceGate = 0.55;

        this.audioContext = null;
        this.analyser = null;
        this.micStream = null;
        this.meterRaf = null;

        this.elements = {};
    }

    async init(context) {
        if (this.isInitialized) return;
        this.isInitialized = true;

        Logger.info(TAG, "Initializing voice control");

        this.cacheElements();
        this.buildUI();
        this.setupRecognition();

        emit(document, EVENT["module:load"], { module: "voice-control" });
    }

    destroy() {
        this.stopListening();
        this.teardownMicMeter();
        if (this.recognition) {
            try { this.recognition.abort(); } catch (_) {}
        }
        this.unsubscribers.forEach((off) => off());
        this.unsubscribers = [];
        this.isInitialized = false;
        emit(document, EVENT["module:unload"], { module: "voice-control" });
        Logger.info(TAG, "Voice control destroyed");
    }

    cacheElements() {
        this.elements.cardBody = getElementByID("voice-control-body");
    }

    /* ==================================================================
       UI — uses static CSS classes (see style.css section 12j)
       ================================================================== */

    buildUI() {
        const body = this.elements.cardBody;
        if (!body) return;
        body.querySelectorAll(".card-placeholder").forEach((el) => el.remove());
        body.querySelectorAll("p.card-description").forEach((el) => el.remove());

        const root = createElement("div", "voice-panel");

        this.elements.meter = createElement("div", "voice-meter", "voice-meter");
        this.elements.meter.setAttribute("aria-hidden", "true");
        this.meterBars = [];
        for (let i = 0; i < 24; i++) {
            const bar = createElement("span", undefined, "voice-meter-bar");
            this.elements.meter.appendChild(bar);
            this.meterBars.push(bar);
        }
        root.appendChild(this.elements.meter);

        this.elements.micButton = createElement("button", "voice-mic-btn", "voice-mic-btn");
        this.elements.micButton.type = "button";
        this.elements.micButton.setAttribute("aria-label", "Toggle voice listening");
        this.elements.micButton.innerHTML = `<i class="fa-solid fa-microphone" aria-hidden="true"></i>`;
        this.unsubscribers.push(on(this.elements.micButton, "click", () => this.toggleListening()));
        root.appendChild(this.elements.micButton);

        this.elements.status = createElement("div", "voice-status", "voice-status");
        this.elements.status.setAttribute("role", "status");
        root.appendChild(this.elements.status);

        this.elements.transcript = createElement("div", "voice-transcript", "voice-transcript");
        setText(this.elements.transcript, "—");
        root.appendChild(this.elements.transcript);

        const matchRow = createElement("div", "voice-match-row", "voice-match-row");
        this.elements.matchChip = createElement("div", undefined, "voice-chip");
        this.elements.confChip = createElement("div", undefined, "voice-chip", "voice-chip--conf");
        setText(this.elements.matchChip, "No command");
        setText(this.elements.confChip, "—");
        matchRow.append(this.elements.matchChip, this.elements.confChip);
        root.appendChild(matchRow);

        const options = createElement("div", "voice-options", "voice-options");
        this.continuousToggle = this.optionToggle("Continuous", this.continuous, (v) => { this.continuous = v; });
        this.speakToggle = this.optionToggle("Speak back", this.speakBack, (v) => { this.speakBack = v; });

        const langWrap = createElement("label", "voice-lang", "voice-lang");
        const langSelect = createElement("select", "voice-lang-select");
        langSelect.setAttribute("aria-label", "Recognition language");
        LANGUAGES.forEach((l) => {
            const opt = createElement("option");
            opt.value = l.code;
            setText(opt, l.label);
            langSelect.appendChild(opt);
        });
        this.unsubscribers.push(on(langSelect, "change", (e) => {
            this.language = e.target.value;
            if (this.recognition) this.recognition.lang = this.language;
            if (this.isListening) { this.stopListening(); this.startListening(); }
        }));
        langWrap.append(document.createTextNode("Lang"), langSelect);

        options.append(this.continuousToggle, this.speakToggle, langWrap);
        root.appendChild(options);

        const refTitle = createElement("div", "voice-ref-title", "voice-ref-title");
        setText(refTitle, "Say any of these");
        root.appendChild(refTitle);

        const chips = createElement("div", "voice-ref-chips", "voice-ref-chips");
        [
            ["fa-arrow-up", "“forward”"],
            ["fa-arrow-down", "“reverse”"],
            ["fa-arrow-turn-up", "“turn left / right”"],
            ["fa-hand", "“stop”"],
            ["fa-route", "“auto mode”"],
            ["fa-gamepad", "“manual mode”"],
            ["fa-skull-crossbones", "“emergency stop”"],
        ].forEach(([icon, text]) => {
            const chip = createElement("span", undefined, "voice-ref-chip");
            chip.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i>${text}`;
            chips.appendChild(chip);
        });
        root.appendChild(chips);

        body.appendChild(root);
        this.setStatus(this.supported === false ? "Speech recognition is not supported in this browser." : "Tap the mic and speak a command.");
    }

    optionToggle(label, initial, onChange) {
        const wrap = createElement("label", undefined, "voice-toggle");
        const input = createElement("input", "voice-toggle-" + label);
        input.type = "checkbox";
        input.checked = initial;
        this.unsubscribers.push(on(input, "change", (e) => onChange(e.target.checked)));
        wrap.append(input, document.createTextNode(label));
        return wrap;
    }

    /* ==================================================================
       SPEECH RECOGNITION
       ================================================================== */

    setupRecognition() {
        const SR = (typeof window !== "undefined") &&
            (window.SpeechRecognition || window.webkitSpeechRecognition);

        this.supported = !!SR;
        if (!SR) {
            this.setStatus("Speech recognition is not supported in this browser — try Chrome or Edge.");
            if (this.elements.micButton) this.elements.micButton.disabled = true;
            return;
        }

        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = this.language;
        rec.maxAlternatives = 1;

        rec.onstart = () => {
            this.isListening = true;
            this.startMicMeter();
            addClass(this.elements.micButton, ANIMATION_CLASS.PULSE, "is-listening");
            this.setStatus("Listening…");
            emit(document, EVENT["voice:listening:start"]);
        };

        rec.onend = () => {
            if (this.continuous && this.isListening) {
                try { rec.start(); return; } catch (_) {}
            }
            this.isListening = false;
            this.teardownMicMeter();
            removeClass(this.elements.micButton, ANIMATION_CLASS.PULSE, "is-listening");
            this.setStatus("Tap the mic to listen again.");
            emit(document, EVENT["voice:listening:stop"]);
        };

        rec.onerror = (e) => {
            if (e.error === "not-allowed" || e.error === "service-not-allowed") {
                this.setStatus("Microphone access was blocked — allow it in browser settings.");
                this.isListening = false;
            } else if (e.error === "no-speech") {
                this.setStatus("Didn't catch that — try again.");
            } else if (e.error !== "aborted") {
                this.setStatus(`Recognition error: ${e.error}`);
            }
        };

        rec.onresult = (e) => this.handleResult(e);
        this.recognition = rec;
    }

    handleResult(event) {
        let interim = "";
        let finalText = "";
        let confidence = 0;

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            if (res.isFinal) {
                finalText += res[0].transcript;
                confidence = Math.max(confidence, res[0].confidence || 0);
            } else {
                interim += res[0].transcript;
            }
        }

        if (interim) setText(this.elements.transcript, `…${interim}`);
        if (finalText) {
            setText(this.elements.transcript, `“${finalText.trim()}”`);
            this.resolveCommand(finalText, confidence);
        }
    }

    resolveCommand(text, confidence) {
        const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
        const match = VOCABULARY.find((entry) => entry.phrases.some((p) => normalized.includes(p)));

        if (!match) {
            setText(this.elements.matchChip, "Not recognized");
            setText(this.elements.confChip, confidence ? `${Math.round(confidence * 100)}%` : "—");
            return;
        }

        setText(this.elements.matchChip, match.label.toUpperCase());
        const pct = Math.round((confidence || 0.9) * 100);
        setText(this.elements.confChip, `${pct}%`);

        if (confidence && confidence < this.confidenceGate) {
            this.setStatus(`Heard “${match.label}” but confidence ${pct}% is below the gate.`);
            return;
        }

        emit(document, EVENT["command:sent"], {
            type: match.type,
            source: "voice",
            transcript: normalized,
            confidence: confidence || 0.9,
            timestamp: Date.now(),
        });
        emit(document, EVENT["voice:recognized"], { label: match.label, confidence });

        this.setStatus(`✓ ${match.label} — command sent`);
        if (this.speakBack) this.speak(match.say);
        Logger.info(TAG, `Voice command: ${match.label} (${pct}%)`);
    }

    speak(text) {
        if (!("speechSynthesis" in window)) return;
        try {
            const utter = new SpeechSynthesisUtterance(text);
            utter.lang = this.language;
            utter.rate = 1.05;
            utter.volume = 0.8;
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utter);
        } catch (_) {}
    }

    /* ==================================================================
       MIC LEVEL METER
       ================================================================== */

    async startMicMeter() {
        if (this.meterRaf || !navigator.mediaDevices) return;
        try {
            this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const AC = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AC();
            const source = this.audioContext.createMediaStreamSource(this.micStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 64;
            source.connect(this.analyser);
            this.bins = new Uint8Array(this.analyser.frequencyBinCount);
            this.tickMeter();
        } catch (err) {
            Logger.debug(TAG, "Mic meter unavailable:", err.message);
        }
    }

    tickMeter() {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(this.bins);
        const bars = this.meterBars.length;
        const step = Math.max(1, Math.floor(this.bins.length / bars));
        for (let i = 0; i < bars; i++) {
            const v = this.bins[i * step] / 255;
            this.meterBars[i].style.height = `${Math.max(8, Math.round(v * 100))}%`;
        }
        this.meterRaf = requestAnimationFrame(() => this.tickMeter());
    }

    teardownMicMeter() {
        if (this.meterRaf) cancelAnimationFrame(this.meterRaf);
        this.meterRaf = null;
        if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
        this.micStream = null;
        if (this.audioContext) {
            try { this.audioContext.close(); } catch (_) {}
            this.audioContext = null;
        }
        this.analyser = null;
        if (this.meterBars) this.meterBars.forEach((b) => { b.style.height = "12%"; });
    }

    /* ==================================================================
       LISTENING CONTROL
       ================================================================== */

    toggleListening() {
        if (!this.supported) return;
        this.isListening ? this.stopListening() : this.startListening();
    }

    startListening() {
        if (!this.recognition || this.isListening) return;
        try { this.recognition.start(); } catch (_) { /* already started */ }
    }

    stopListening() {
        this.isListening = false;
        if (this.recognition) {
            try { this.recognition.stop(); } catch (_) {}
        }
        this.teardownMicMeter();
    }

    setStatus(text) {
        if (this.elements.status) setText(this.elements.status, text);
    }
}

const voiceControlModule = new VoiceControlModule();
export default voiceControlModule;
export { VoiceControlModule, VOCABULARY };
