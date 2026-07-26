/* ==========================================================================
   MISSION CONTROL — SMART SURVEY ROBOT — modules/manual-control.js
   --------------------------------------------------------------------------
   Frontend Manual Control Module
   --------------------------------------------------------------------------
   Responsibilities
     • On-screen directional D-Pad (Forward, Backward, Left, Right, Stop)
     • Large Emergency Stop button with red pulse animation
     • Visual button press feedback (scale + glow)
     • Command placeholders only — no actual ESP32 transmission
     • Emits standardized command events so the command manager (later)
       can pick them up

   Public API (exported default)
     init(context)     — called by dashboard.js
     destroy()         — cleanup on module unload
   ========================================================================== */

import { CONFIG } from "../config.js";
import { COMMAND_TYPE, EVENT, DIRECTION, CSS_CLASS, ANIMATION_CLASS } from "../constants.js";
import {
    Logger,
    getElementByID,
    addClass,
    removeClass,
    on,
    emit,
    withErrorHandling,
} from "../utils.js";

const TAG = "ManualControl";

class ManualControlModule {
    constructor() {
        this.isInitialized = false;
        this.currentDirection = DIRECTION.STOP;
        this.isPressed = false;

        /* DOM cache */
        this.elements = {
            card: null,
            btnForward: null,
            btnBackward: null,
            btnLeft: null,
            btnRight: null,
            btnStop: null,
            btnEmergency: null,
        };

        /* Button press timeout (visual feedback) */
        this.pressTimeout = null;

        /** @type {boolean} Directional driving is armed only after Start */
        this.armed = false;
    }

    /* ======================================================================
       PUBLIC API
       ====================================================================== */

    /**
     * Initialize the manual control UI inside its card.
     * @param {Object} context — provided by dashboard controller
     */
    async init(context) {
        if (this.isInitialized) return;
        this.isInitialized = true;

        Logger.info(TAG, "Initializing manual control UI");

        this.cacheElements();
        this.buildControlPad();
        this.bindButtonEvents();

        emit(document, EVENT["module:load"], { module: "manual-control" });
    }

    /** Cleanup when the module is unloaded. */
    destroy() {
        if (this.pressTimeout) {
            clearTimeout(this.pressTimeout);
            this.pressTimeout = null;
        }
        this.isInitialized = false;
        emit(document, EVENT["module:unload"], { module: "manual-control" });
        Logger.info(TAG, "Manual control module destroyed");
    }

    /* ======================================================================
       UI CONSTRUCTION
       ====================================================================== */

    cacheElements() {
        this.elements.card = getElementByID("manual-control-body");
    }

    buildControlPad() {
        if (!this.elements.card) return;

        const pad = document.createElement("div");
        pad.className = "manual-dpad";

        /* Grid positions for D-Pad */
        const positions = [
            { dir: null, label: "" },                     // top-left empty
            { dir: DIRECTION.FORWARD, label: "↑", icon: "fa-arrow-up" },
            { dir: null, label: "" },                     // top-right empty
            { dir: DIRECTION.LEFT, label: "←", icon: "fa-arrow-left" },
            { dir: DIRECTION.STOP, label: "STOP", icon: "fa-stop" },
            { dir: DIRECTION.RIGHT, label: "→", icon: "fa-arrow-right" },
            { dir: null, label: "" },                     // bottom-left empty
            { dir: DIRECTION.BACKWARD, label: "↓", icon: "fa-arrow-down" },
            { dir: null, label: "" },                     // bottom-right empty
        ];

        positions.forEach((pos) => {
            const btn = document.createElement("button");
            btn.className = "manual-btn";

            if (pos.dir) {
                btn.dataset.direction = pos.dir;
                btn.innerHTML = pos.icon
                    ? `<i class="fa-solid ${pos.icon}"></i>`
                    : pos.label;

                if (pos.dir === DIRECTION.STOP) {
                    btn.classList.add("is-stop");
                }
            } else {
                btn.style.visibility = "hidden";
            }

            pad.appendChild(btn);
        });

        /* Emergency Stop — full width, pulsing danger */
        const emergencyContainer = document.createElement("div", "manual-emergency-wrap");

        this.elements.btnEmergency = document.createElement("button", "manual-emergency", "manual-emergency");
        this.elements.btnEmergency.innerHTML = `
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span>EMERGENCY STOP</span>
        `;

        emergencyContainer.appendChild(this.elements.btnEmergency);

        /* Arming controls — the D-pad stays disarmed until Start.
           Emergency Stop is deliberately OUTSIDE this gate. */
        const armBar = document.createElement("div");
        armBar.className = "arm-bar";
        armBar.setAttribute("role", "group");
        armBar.setAttribute("aria-label", "Manual control arming");

        const armDot = document.createElement("span");
        armDot.className = "arm-dot";
        armDot.setAttribute("aria-hidden", "true");

        const armLabel = document.createElement("span");
        armLabel.className = "arm-label";
        armLabel.textContent = "Manual Driving";

        const armState = document.createElement("span");
        armState.className = "arm-state";
        armState.textContent = "Disarmed";

        const btnStart = document.createElement("button");
        btnStart.type = "button";
        btnStart.className = "btn btn-primary arm-btn";
        btnStart.setAttribute("aria-label", "Start manual control");
        btnStart.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i><span>Start</span>';

        const btnStop = document.createElement("button");
        btnStop.type = "button";
        btnStop.className = "btn btn-danger arm-btn";
        btnStop.setAttribute("aria-label", "Stop manual control");
        btnStop.disabled = true;
        btnStop.innerHTML = '<i class="fa-solid fa-stop" aria-hidden="true"></i><span>Stop</span>';

        armBar.append(armDot, armLabel, armState, btnStart, btnStop);

        this.elements.card.append(armBar, pad, emergencyContainer);

        this.elements.armBar = armBar;
        this.elements.armState = armState;
        this.elements.btnArmStart = btnStart;
        this.elements.btnArmStop = btnStop;
        this.elements.pad = pad;
        pad.style.opacity = "0.45";

        on(btnStart, "click", () => this.setArmed(true));
        on(btnStop, "click", () => this.setArmed(false));

        /* Store directional buttons for later binding */
        this.elements.btnForward = pad.querySelector('[data-direction="forward"]');
        this.elements.btnBackward = pad.querySelector('[data-direction="backward"]');
        this.elements.btnLeft = pad.querySelector('[data-direction="left"]');
        this.elements.btnRight = pad.querySelector('[data-direction="right"]');
        this.elements.btnStop = pad.querySelector('[data-direction="stop"]');
    }

    bindButtonEvents() {
        const buttons = [
            this.elements.btnForward,
            this.elements.btnBackward,
            this.elements.btnLeft,
            this.elements.btnRight,
            this.elements.btnStop,
        ];

        buttons.forEach((btn) => {
            if (!btn) return;

            on(btn, "mousedown", (e) => this.handleDirectionPress(e));
            on(btn, "mouseup", () => this.handleDirectionRelease());
            on(btn, "mouseleave", () => this.handleDirectionRelease());

            /* Touch support for tablets/phones */
            on(btn, "touchstart", (e) => {
                e.preventDefault();
                this.handleDirectionPress(e);
            });
            on(btn, "touchend", () => this.handleDirectionRelease());
        });

        if (this.elements.btnEmergency) {
            on(this.elements.btnEmergency, "click", withErrorHandling(() => {
                this.triggerEmergencyStop();
            }, "EmergencyStop"));
        }
    }

    /* ======================================================================
       COMMAND HANDLERS (placeholders — emit events only)
       ====================================================================== */

    handleDirectionPress(event) {
        if (!this.armed) return;
        if (this.isPressed) return;
        this.isPressed = true;

        const btn = event.currentTarget;
        const direction = btn.dataset.direction;
        if (!direction) return;

        this.currentDirection = direction;

        /* Visual feedback */
        addClass(btn, "is-pressed");
        addClass(btn, ANIMATION_CLASS.SCALE_IN);

        this.sendCommand(direction);

        /* Auto-release after 800ms if user holds (prevents stuck motors) */
        if (this.pressTimeout) clearTimeout(this.pressTimeout);
        this.pressTimeout = setTimeout(() => this.handleDirectionRelease(), 800);
    }

    handleDirectionRelease() {
        if (!this.isPressed) return;
        this.isPressed = false;

        if (this.pressTimeout) {
            clearTimeout(this.pressTimeout);
            this.pressTimeout = null;
        }

        /* Release visual state on all buttons */
        [this.elements.btnForward, this.elements.btnBackward, this.elements.btnLeft, this.elements.btnRight, this.elements.btnStop]
            .forEach((btn) => {
                if (btn) {
                    removeClass(btn, "is-pressed");
                    removeClass(btn, ANIMATION_CLASS.SCALE_IN);
                }
            });

        this.sendCommand(DIRECTION.STOP);
        this.currentDirection = DIRECTION.STOP;
    }

    /** Arm or disarm the directional D-pad (Emergency Stop stays live). */
    setArmed(armed) {
        this.armed = !!armed;

        const { armBar, armState, btnArmStart, btnArmStop, pad } = this.elements;
        if (armBar) armBar.classList.toggle("is-armed", this.armed);
        if (armState) armState.textContent = this.armed ? "Armed" : "Disarmed";
        if (btnArmStart) btnArmStart.disabled = this.armed;
        if (btnArmStop) btnArmStop.disabled = !this.armed;

        /* Dim the D-pad while disarmed */
        if (pad) pad.classList.toggle("is-dimmed", !this.armed);

        if (!this.armed) this.handleDirectionRelease();

        Logger.info(TAG, this.armed ? "Manual control armed." : "Manual control disarmed.");
    }

    triggerEmergencyStop() {
        /* Visual flash on emergency button */
        const btn = this.elements.btnEmergency;
        if (btn) {
            addClass(btn, ANIMATION_CLASS.SHAKE);
            addClass(btn, ANIMATION_CLASS.GLOW_DANGER);
            setTimeout(() => {
                removeClass(btn, ANIMATION_CLASS.SHAKE);
                removeClass(btn, ANIMATION_CLASS.GLOW_DANGER);
            }, 800);
        }

        /* Immediate stop command */
        this.sendCommand(DIRECTION.STOP, true);
        this.handleDirectionRelease();

        /* Global emergency event for other modules */
        emit(document, EVENT["command:failed"], {
            command: COMMAND_TYPE.MOTOR_STOP,
            reason: "Emergency stop activated",
        });

        Logger.warn(TAG, "EMERGENCY STOP triggered");
    }

    /**
     * Send a placeholder command.
     * In a real implementation this would call the command manager.
     * For now we only emit events so the UI can react.
     */
    sendCommand(direction, isEmergency = false) {
        let commandType = COMMAND_TYPE.MOTOR_STOP;

        switch (direction) {
            case DIRECTION.FORWARD:
                commandType = COMMAND_TYPE.MOTOR_FORWARD;
                break;
            case DIRECTION.BACKWARD:
                commandType = COMMAND_TYPE.MOTOR_BACKWARD;
                break;
            case DIRECTION.LEFT:
                commandType = COMMAND_TYPE.MOTOR_TURN_LEFT;
                break;
            case DIRECTION.RIGHT:
                commandType = COMMAND_TYPE.MOTOR_TURN_RIGHT;
                break;
            case DIRECTION.STOP:
                commandType = COMMAND_TYPE.MOTOR_STOP;
                break;
        }

        const payload = {
            type: commandType,
            direction,
            timestamp: Date.now(),
            source: "manual-control",
            emergency: isEmergency,
        };

        emit(document, EVENT["command:sent"], payload);
        Logger.debug(TAG, `Manual command → ${direction}`, payload);
    }
}

/* Singleton exported for dashboard.js */
const manualControlModule = new ManualControlModule();
export default manualControlModule;
