/* ==========================================================================
   MISSION CONTROL — SMART SURVEY ROBOT — modules/keyboard-control.js
   --------------------------------------------------------------------------
   Frontend Keyboard Control Module
   --------------------------------------------------------------------------
   Responsibilities
     • Listen for arrow keys + WASD + Space (stop)
     • Highlight the active direction on the UI D-Pad
     • Prevent default browser scrolling when arrow keys are used
     • Command placeholders — emit standardized events only
     • Visual feedback for key presses (glow + active state)

   Public API
     init(context) — called by dashboard controller
     destroy()     — remove listeners
   ========================================================================== */

import { CONFIG } from "../config.js";
import { COMMAND_TYPE, EVENT, KEY_BINDING, DIRECTION, CSS_CLASS, ANIMATION_CLASS } from "../constants.js";
import {
    Logger,
    getElementByID,
    addClass,
    removeClass,
    on,
    emit,
} from "../utils.js";

const TAG = "KeyboardControl";

class KeyboardControlModule {
    constructor() {
        this.isInitialized = false;
        this.isListening = false;
        this.currentDirection = DIRECTION.STOP;
        this.keyMap = new Map();
        this.unsubscribers = [];

        /* DOM cache for visual feedback */
        this.elements = {
            cardBody: null,
            forward: null,
            backward: null,
            left: null,
            right: null,
            stop: null,
            statusIndicator: null,
        };
    }

    async init(context) {
        if (this.isInitialized) return;
        this.isInitialized = true;

        Logger.info(TAG, "Initializing keyboard control");

        this.cacheElements();
        this.createKeyboardUI();
        this.bindKeyboardListeners();
        this.bindUIButtons();

        emit(document, EVENT["module:load"], { module: "keyboard-control" });
    }

    destroy() {
        this.stopListening();
        this.unsubscribers.forEach((unlisten) => unlisten());
        this.unsubscribers = [];
        this.isInitialized = false;
        emit(document, EVENT["module:unload"], { module: "keyboard-control" });
        Logger.info(TAG, "Keyboard control module destroyed");
    }

    /* ======================================================================
       UI SETUP
       ====================================================================== */

    cacheElements() {
        this.elements.cardBody = getElementByID("keyboard-control-body");
    }

    createKeyboardUI() {
        if (!this.elements.cardBody) return;

        const container = document.createElement("div");
        container.className = "keyboard-control-pad";

        /* Visual D-Pad for feedback */
        const dpad = document.createElement("div");
        dpad.className = "keyboard-dpad";

        const cells = [
            { pos: "1,1", dir: null },
            { pos: "1,2", dir: DIRECTION.FORWARD, label: "↑", key: "ArrowUp" },
            { pos: "1,3", dir: null },
            { pos: "2,1", dir: DIRECTION.LEFT, label: "←", key: "ArrowLeft" },
            { pos: "2,2", dir: DIRECTION.STOP, label: "■", key: "Space" },
            { pos: "2,3", dir: DIRECTION.RIGHT, label: "→", key: "ArrowRight" },
            { pos: "3,1", dir: null },
            { pos: "3,2", dir: DIRECTION.BACKWARD, label: "↓", key: "ArrowDown" },
            { pos: "3,3", dir: null },
        ];

        cells.forEach((cell) => {
            const el = document.createElement("div");
            el.className = "dpad-key keyboard-key";
            if (cell.dir) {
                el.dataset.direction = cell.dir;
                el.textContent = cell.label;
                if (cell.dir === DIRECTION.STOP) {
                    el.classList.add("is-stop");
                }
            } else {
                el.style.visibility = "hidden";
            }
            dpad.appendChild(el);
        });

        /* Status line */
        const status = document.createElement("div", "keyboard-status", "keyboard-status");
        status.innerHTML = `
            <span>Keyboard Control</span>
            <span id="kb-status-text" style="display:block;font-size:0.75rem;color:var(--clr-text-muted);margin-top:4px;">Press arrow keys or WASD</span>
        `;

        /* Arming controls — keyboard driving stays disarmed until Start */
        const armBar = document.createElement("div");
        armBar.className = "arm-bar";
        armBar.setAttribute("role", "group");
        armBar.setAttribute("aria-label", "Keyboard control arming");

        const armDot = document.createElement("span");
        armDot.className = "arm-dot";
        armDot.setAttribute("aria-hidden", "true");

        const armLabel = document.createElement("span");
        armLabel.className = "arm-label";
        armLabel.textContent = "Keyboard Driving";

        const armState = document.createElement("span");
        armState.className = "arm-state";
        armState.textContent = "Disarmed";

        const btnStart = document.createElement("button");
        btnStart.type = "button";
        btnStart.className = "btn btn-primary arm-btn";
        btnStart.setAttribute("aria-label", "Start keyboard control");
        btnStart.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i><span>Start</span>';

        const btnStop = document.createElement("button");
        btnStop.type = "button";
        btnStop.className = "btn btn-danger arm-btn";
        btnStop.setAttribute("aria-label", "Stop keyboard control");
        btnStop.disabled = true;
        btnStop.innerHTML = '<i class="fa-solid fa-stop" aria-hidden="true"></i><span>Stop</span>';

        armBar.append(armDot, armLabel, armState, btnStart, btnStop);

        container.append(armBar, dpad, status);
        this.elements.cardBody.appendChild(container);

        this.elements.armBar = armBar;
        this.elements.armState = armState;
        this.elements.btnArmStart = btnStart;
        this.elements.btnArmStop = btnStop;

        /* Cache the direction elements for highlighting */
        this.elements.forward = dpad.querySelector('[data-direction="forward"]');
        this.elements.backward = dpad.querySelector('[data-direction="backward"]');
        this.elements.left = dpad.querySelector('[data-direction="left"]');
        this.elements.right = dpad.querySelector('[data-direction="right"]');
        this.elements.stop = dpad.querySelector('[data-direction="stop"]');
        this.elements.statusText = status.querySelector("#kb-status-text");
    }

    bindUIButtons() {
        /* The D-Pad elements can also be clicked as fallback */
        const directions = [
            { el: this.elements.forward, dir: DIRECTION.FORWARD },
            { el: this.elements.backward, dir: DIRECTION.BACKWARD },
            { el: this.elements.left, dir: DIRECTION.LEFT },
            { el: this.elements.right, dir: DIRECTION.RIGHT },
            { el: this.elements.stop, dir: DIRECTION.STOP },
        ];

        directions.forEach(({ el, dir }) => {
            if (!el) return;
            on(el, "click", () => this.sendCommand(dir));
            on(el, "mousedown", () => this.highlightDirection(dir));
        });
    }

    /* ======================================================================
       KEYBOARD LISTENERS
       ====================================================================== */

    bindKeyboardListeners() {
        const handleKeyDown = (e) => {
            if (!this.isListening) return;

            /* Prevent scrolling on arrow keys */
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
                e.preventDefault();
            }

            const direction = this.getDirectionFromKey(e.key);
            if (!direction) return;

            this.highlightDirection(direction);
            this.sendCommand(direction);
        };

        const handleKeyUp = (e) => {
            if (!this.isListening) return;
            const direction = this.getDirectionFromKey(e.key);
            if (direction && direction !== DIRECTION.STOP) {
                this.sendCommand(DIRECTION.STOP);
                this.clearHighlights();
            }
        };

        this.unsubscribers.push(on(document, "keydown", handleKeyDown));
        this.unsubscribers.push(on(document, "keyup", handleKeyUp));

        /* Arming buttons — the mode no longer auto-arms on load */
        this.unsubscribers.push(on(this.elements.btnArmStart, "click", () => this.startListening()));
        this.unsubscribers.push(on(this.elements.btnArmStop, "click", () => this.stopListening()));
    }

    getDirectionFromKey(key) {
        if (KEY_BINDING.FORWARD.includes(key)) return DIRECTION.FORWARD;
        if (KEY_BINDING.BACKWARD.includes(key)) return DIRECTION.BACKWARD;
        if (KEY_BINDING.LEFT.includes(key)) return DIRECTION.LEFT;
        if (KEY_BINDING.RIGHT.includes(key)) return DIRECTION.RIGHT;
        if (KEY_BINDING.STOP.includes(key)) return DIRECTION.STOP;
        return null;
    }

    /* ======================================================================
       VISUAL FEEDBACK
       ====================================================================== */

    highlightDirection(direction) {
        this.clearHighlights();

        let target = null;
        switch (direction) {
            case DIRECTION.FORWARD: target = this.elements.forward; break;
            case DIRECTION.BACKWARD: target = this.elements.backward; break;
            case DIRECTION.LEFT: target = this.elements.left; break;
            case DIRECTION.RIGHT: target = this.elements.right; break;
            case DIRECTION.STOP: target = this.elements.stop; break;
        }

        if (target) {
            addClass(target, CSS_CLASS.ACTIVE);
            addClass(target, ANIMATION_CLASS.GLOW_CYAN);
        }

        if (this.elements.statusText) {
            this.elements.statusText.textContent = `Driving ${direction.toUpperCase()}`;
        }
    }

    clearHighlights() {
        [this.elements.forward, this.elements.backward, this.elements.left, this.elements.right, this.elements.stop]
            .forEach((el) => {
                if (el) {
                    removeClass(el, CSS_CLASS.ACTIVE);
                    removeClass(el, ANIMATION_CLASS.GLOW_CYAN);
                }
            });

        if (this.elements.statusText) {
            this.elements.statusText.textContent = "Press arrow keys or WASD";
        }
    }

    /* ======================================================================
       COMMAND EMISSION
       ====================================================================== */

    sendCommand(direction) {
        if (this.currentDirection === direction) return;
        this.currentDirection = direction;

        let commandType = COMMAND_TYPE.MOTOR_STOP;

        switch (direction) {
            case DIRECTION.FORWARD: commandType = COMMAND_TYPE.MOTOR_FORWARD; break;
            case DIRECTION.BACKWARD: commandType = COMMAND_TYPE.MOTOR_BACKWARD; break;
            case DIRECTION.LEFT: commandType = COMMAND_TYPE.MOTOR_TURN_LEFT; break;
            case DIRECTION.RIGHT: commandType = COMMAND_TYPE.MOTOR_TURN_RIGHT; break;
            case DIRECTION.STOP: commandType = COMMAND_TYPE.MOTOR_STOP; break;
        }

        const payload = {
            type: commandType,
            direction,
            source: "keyboard",
            timestamp: Date.now(),
        };

        emit(document, EVENT["command:sent"], payload);
        Logger.debug(TAG, `Keyboard command: ${direction}`);
    }

    startListening() {
        this.isListening = true;
        this.syncArmUI(true);
        if (this.elements.statusText) {
            this.elements.statusText.style.color = "var(--clr-success)";
            this.elements.statusText.textContent = "Armed — use arrows / WASD / Space";
        }
        Logger.info(TAG, "Keyboard control active — arrows + WASD + Space");
    }

    stopListening() {
        this.isListening = false;
        this.clearHighlights();
        this.syncArmUI(false);
        if (this.elements.statusText) {
            this.elements.statusText.style.color = "var(--clr-text-muted)";
            this.elements.statusText.textContent = "Disarmed — press Start to drive";
        }
    }

    /** Mirror the armed state onto the shared arming bar. */
    syncArmUI(armed) {
        const { armBar, armState, btnArmStart, btnArmStop } = this.elements;
        if (armBar) armBar.classList.toggle("is-armed", armed);
        if (armState) armState.textContent = armed ? "Armed" : "Disarmed";
        if (btnArmStart) btnArmStart.disabled = armed;
        if (btnArmStop) btnArmStop.disabled = !armed;
    }
}

/* Singleton exported for dashboard.js */
const keyboardControlModule = new KeyboardControlModule();
export default keyboardControlModule;
