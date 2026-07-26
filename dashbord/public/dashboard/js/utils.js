/* ==========================================================================
   MISSION CONTROL — SMART SURVEY ROBOT — utils.js
   --------------------------------------------------------------------------
   Utility functions · Helpers · DOM queries · Type checks
   No business logic · Pure functions where possible.
   Used across all modules.

   SECTIONS
   01. Logger (console.*, debug levels)
   02. Type Checks
   03. DOM Helpers (safe queries, class/attr mutations)
   04. Time & Date
   05. String Formatters
   06. Array & Object Utilities
   07. Event Helpers
   08. Local Storage Wrapper
   09. Debounce & Throttle
   10. Error Handling
   ========================================================================== */

import { CONFIG } from "./config.js";
import { ELEMENT_ID, CSS_CLASS } from "./constants.js";

/* ==========================================================================
   01. LOGGER — Console output with severity levels & CONFIG
   ========================================================================== */

/**
 * Logger singleton with INFO / WARN / ERROR / DEBUG levels.
 * Respects CONFIG.DEBUG.LOG_LEVEL to filter output.
 * @type {Object}
 */
export const Logger = {
    _levels: { silent: -1, error: 0, warn: 1, info: 2, debug: 3 },
    _current: 1,

    init() {
        const level = CONFIG.DEBUG.LOG_LEVEL || "warn";
        this._current = this._levels[level] || 1;
    },

    debug(tag, message, data) {
        if (this._current >= 3) {
            console.debug(`[${tag}]`, message, data || "");
        }
    },

    info(tag, message, data) {
        if (this._current >= 2) {
            console.info(`%c[${tag}]`, "color: #2dd4bf; font-weight: bold;", message, data || "");
        }
    },

    warn(tag, message, data) {
        if (this._current >= 1) {
            console.warn(`%c[${tag}]`, "color: #ffb224; font-weight: bold;", message, data || "");
        }
    },

    error(tag, message, error) {
        if (this._current >= 0) {
            console.error(`%c[${tag}]`, "color: #ff4d6d; font-weight: bold;", message, error || "");
        }
    },
};

Logger.init();

/* ==========================================================================
   02. TYPE CHECKS
   ========================================================================== */

/**
 * Safe type checking functions.
 * @type {Object}
 */
export const is = {
    string(val) {
        return typeof val === "string";
    },

    number(val) {
        return typeof val === "number" && !isNaN(val);
    },

    boolean(val) {
        return typeof val === "boolean";
    },

    array(val) {
        return Array.isArray(val);
    },

    object(val) {
        return val !== null && typeof val === "object" && !Array.isArray(val);
    },

    function(val) {
        return typeof val === "function";
    },

    null(val) {
        return val === null;
    },

    undefined(val) {
        return val === undefined;
    },

    element(val) {
        return val instanceof Element || val instanceof HTMLElement;
    },

    /**
     * Any object that can receive listeners / dispatch events.
     * NOTE: `document` and `window` are NOT Elements — guarding listener
     * and dispatch helpers with is.element() silently dropped every
     * document/window binding (dead keyboard input, dead event bus).
     * @param {*} val
     * @returns {boolean}
     */
    eventTarget(val) {
        return (
            val instanceof EventTarget ||
            (!!val && typeof val.addEventListener === "function")
        );
    },

    event(val) {
        return val instanceof Event;
    },

    promise(val) {
        return val instanceof Promise;
    },

    defined(val) {
        return val !== undefined && val !== null;
    },

    empty(val) {
        if (is.string(val)) return val.trim().length === 0;
        if (is.array(val)) return val.length === 0;
        if (is.object(val)) return Object.keys(val).length === 0;
        return !val;
    },
};

/* ==========================================================================
   03. DOM HELPERS — Safe element access & mutations
   ========================================================================== */

/**
 * Safe querySelector that returns null instead of throwing.
 * @param {string} selector
 * @returns {Element|null}
 */
export function query(selector) {
    try {
        return document.querySelector(selector);
    } catch (e) {
        Logger.warn("DOM", `Invalid selector: ${selector}`);
        return null;
    }
}

/**
 * Safe querySelectorAll.
 * @param {string} selector
 * @returns {Element[]}
 */
export function queryAll(selector, root) {
    const scope = root && is.function(root.querySelectorAll) ? root : document;
    try {
        return Array.from(scope.querySelectorAll(selector));
    } catch (e) {
        Logger.warn("DOM", `Invalid selector: ${selector}`);
        return [];
    }
}

/**
 * Get element by ID with fallback.
 * @param {string} id - element ID from constants.ELEMENT_ID
 * @returns {HTMLElement|null}
 */
export function getElementByID(id) {
    const el = document.getElementById(id);
    if (!el && CONFIG.DEBUG.ENABLED) {
        Logger.warn("DOM", `Element not found: #${id}`);
    }
    return el;
}

/**
 * Safe class toggling (handles null elements).
 * @param {Element} el
 * @param {string} className - from constants.CSS_CLASS
 * @param {boolean} force - optional, if true always add, if false always remove
 */
export function toggleClass(el, className, force) {
    if (!is.element(el)) return;
    if (force === true) {
        el.classList.add(className);
    } else if (force === false) {
        el.classList.remove(className);
    } else {
        el.classList.toggle(className);
    }
}

/**
 * Add one or more classes to an element.
 * @param {Element} el
 * @param {...string} classNames
 */
export function addClass(el, ...classNames) {
    if (!is.element(el)) return;
    el.classList.add(...classNames);
}

/**
 * Remove one or more classes from an element.
 * @param {Element} el
 * @param {...string} classNames
 */
export function removeClass(el, ...classNames) {
    if (!is.element(el)) return;
    el.classList.remove(...classNames);
}

/**
 * Check if element has a class.
 * @param {Element} el
 * @param {string} className
 * @returns {boolean}
 */
export function hasClass(el, className) {
    if (!is.element(el)) return false;
    return el.classList.contains(className);
}

/**
 * Set or get an element's text content.
 * @param {Element} el
 * @param {string} text - optional, if provided sets the text
 * @returns {string}
 */
export function setText(el, text) {
    if (!is.element(el)) return "";
    if (is.string(text)) {
        el.textContent = text;
    }
    return el.textContent;
}

/**
 * Set or get an HTML attribute.
 * @param {Element} el
 * @param {string} attr
 * @param {string} value - optional
 * @returns {string}
 */
export function attr(el, attr, value) {
    if (!is.element(el)) return "";
    if (is.string(value)) {
        el.setAttribute(attr, value);
    }
    return el.getAttribute(attr) || "";
}

/**
 * Remove an element from the DOM.
 * @param {Element} el
 */
export function removeElement(el) {
    if (!is.element(el)) return;
    el.remove();
}

/**
 * Create a new element with optional attributes & classes.
 * @param {string} tag
 * @param {string} id - optional
 * @param {...string} classNames - optional
 * @returns {Element}
 */
export function createElement(tag, id, ...classNames) {
    const el = document.createElement(tag);
    if (is.string(id) && id) el.id = id;
    if (classNames.length) el.classList.add(...classNames);
    return el;
}

/**
 * Insert an element into another, optionally with animation.
 * @param {Element} target
 * @param {Element} newEl
 * @param {string} position - "before" | "after" | "inside" | "replace" (default: "inside")
 * @param {boolean} animate - if true, adds entrance animation class
 */
export function insertElement(target, newEl, position = "inside", animate = false) {
    if (!is.element(target) || !is.element(newEl)) return;

    if (animate) {
        addClass(newEl, "anim-fade-in-up");
    }

    switch (position) {
        case "before":
            target.before(newEl);
            break;
        case "after":
            target.after(newEl);
            break;
        case "replace":
            target.replaceWith(newEl);
            break;
        default: // "inside"
            target.appendChild(newEl);
    }
}

/**
 * Get computed style of an element.
 * @param {Element} el
 * @param {string} prop - CSS property name
 * @returns {string}
 */
export function getStyle(el, prop) {
    if (!is.element(el)) return "";
    return window.getComputedStyle(el).getPropertyValue(prop);
}

/**
 * Set inline styles on an element (object notation).
 * @param {Element} el
 * @param {Object} styles - { property: value, ... }
 */
export function setStyles(el, styles) {
    if (!is.element(el) || !is.object(styles)) return;
    Object.assign(el.style, styles);
}

/* ==========================================================================
   04. TIME & DATE
   ========================================================================== */

/**
 * Format a Date to readable string (locale-aware).
 * @param {Date} date
 * @param {string} format - "date", "time", "datetime" (default: "datetime")
 * @returns {string}
 */
export function formatDate(date, format = "datetime") {
    if (!(date instanceof Date) || isNaN(date)) return "";

    const opts = {
        date: { year: "numeric", month: "short", day: "2-digit" },
        time: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
        datetime: { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" },
    };

    return date.toLocaleDateString(
        navigator.language,
        opts[format] || opts.datetime
    );
}

/**
 * Format milliseconds as HH:MM:SS.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
    if (!is.number(ms) || ms < 0) return "00:00:00";

    const total = Math.floor(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    return [hours, minutes, seconds].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Get current time in HH:MM:SS format.
 * @returns {string}
 */
export function getCurrentTime() {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes()
        .toString()
        .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
}

/**
 * Get current date in "MMM DD, YYYY" format.
 * @returns {string}
 */
export function getCurrentDate() {
    const now = new Date();
    const options = { year: "numeric", month: "short", day: "2-digit" };
    return now.toLocaleDateString(navigator.language, options);
}

/**
 * Get time elapsed since a timestamp in human-readable format.
 * @param {number|Date} timestamp
 * @returns {string}
 */
export function timeAgo(timestamp) {
    const now = Date.now();
    const then = timestamp instanceof Date ? timestamp.getTime() : timestamp;
    const diff = now - then;

    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
}

/* ==========================================================================
   05. STRING FORMATTERS
   ========================================================================== */

/**
 * Capitalize first letter of a string.
 * @param {string} str
 * @returns {string}
 */
export function capitalize(str) {
    if (!is.string(str)) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert "command_name" to "Command Name".
 * @param {string} str
 * @returns {string}
 */
export function humanize(str) {
    if (!is.string(str)) return "";
    return str
        .split("_")
        .map(capitalize)
        .join(" ");
}

/**
 * Truncate a string to a max length with ellipsis.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
export function truncate(str, maxLen = 50) {
    if (!is.string(str)) return "";
    return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
}

/**
 * Format a number with thousands separator.
 * @param {number} num
 * @returns {string}
 */
export function formatNumber(num) {
    if (!is.number(num)) return "";
    return num.toLocaleString(navigator.language);
}

/**
 * Format a number as a percentage (0–100).
 * @param {number} value
 * @param {number} decimals (default: 0)
 * @returns {string}
 */
export function formatPercent(value, decimals = 0) {
    if (!is.number(value)) return "";
    return `${(value).toFixed(decimals)}%`;
}

/**
 * Format a number as bytes (B, KB, MB, GB).
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
    if (!is.number(bytes) || bytes < 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit++;
    }
    return `${size.toFixed(1)} ${units[unit]}`;
}

/* ==========================================================================
   06. ARRAY & OBJECT UTILITIES
   ========================================================================== */

/**
 * Deep clone an object or array.
 * @param {*} obj
 * @returns {*}
 */
export function deepClone(obj) {
    if (obj === null || typeof obj !== "object") return obj;
    if (obj instanceof Date) return new Date(obj);
    if (obj instanceof Array) return obj.map((item) => deepClone(item));
    if (obj instanceof Object) {
        const cloned = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                cloned[key] = deepClone(obj[key]);
            }
        }
        return cloned;
    }
    return obj;
}

/**
 * Flatten a nested array one level.
 * @param {Array} arr
 * @returns {Array}
 */
export function flatten(arr) {
    if (!is.array(arr)) return [];
    return arr.reduce((flat, item) => {
        return flat.concat(is.array(item) ? item : [item]);
    }, []);
}

/**
 * Remove duplicates from an array (primitives only).
 * @param {Array} arr
 * @returns {Array}
 */
export function unique(arr) {
    if (!is.array(arr)) return [];
    return [...new Set(arr)];
}

/**
 * Group array items by a key or function.
 * @param {Array} arr
 * @param {string|function} keyOrFn
 * @returns {Object}
 */
export function groupBy(arr, keyOrFn) {
    if (!is.array(arr)) return {};
    return arr.reduce((grouped, item) => {
        const key = is.function(keyOrFn) ? keyOrFn(item) : item[keyOrFn];
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
        return grouped;
    }, {});
}

/**
 * Merge multiple objects (shallow).
 * @param {...Object} objs
 * @returns {Object}
 */
export function merge(...objs) {
    return Object.assign({}, ...objs);
}

/* ==========================================================================
   07. EVENT HELPERS
   ========================================================================== */

/**
 * Attach an event listener and return a function to remove it.
 * @param {Element} el
 * @param {string} event - event name (e.g., "click")
 * @param {function} handler
 * @param {boolean|Object} options (default: false)
 * @returns {function} unlisten
 */
export function on(el, event, handler, options = false) {
    if (!is.eventTarget(el) || !is.string(event) || !is.function(handler)) {
        return () => {};
    }

    el.addEventListener(event, handler, options);

    return () => {
        el.removeEventListener(event, handler, options);
    };
}

/**
 * Attach a one-time event listener.
 * @param {Element} el
 * @param {string} event
 * @param {function} handler
 */
export function once(el, event, handler) {
    if (!is.eventTarget(el) || !is.string(event) || !is.function(handler)) return;
    el.addEventListener(event, handler, { once: true });
}

/**
 * Trigger a custom event on an element.
 * @param {Element} el
 * @param {string} eventName
 * @param {*} detail - optional detail data
 */
export function emit(el, eventName, detail) {
    if (!is.eventTarget(el) || !is.string(eventName)) return;
    const event = new CustomEvent(eventName, { detail, bubbles: true, cancelable: true });
    el.dispatchEvent(event);
}

/* ==========================================================================
   08. LOCAL STORAGE WRAPPER
   Safe localStorage access with JSON serialization.
   ========================================================================== */

export const Storage = {
    /**
     * Save a value (auto-JSON serializes objects).
     * @param {string} key - should be from CONFIG.STORAGE.KEYS
     * @param {*} value
     */
    set(key, value) {
        try {
            const json = JSON.stringify(value);
            localStorage.setItem(key, json);
        } catch (e) {
            Logger.error("Storage", `Failed to save ${key}:`, e);
        }
    },

    /**
     * Get a value (auto-JSON deserializes).
     * @param {string} key
     * @param {*} fallback - default value if not found
     * @returns {*}
     */
    get(key, fallback = null) {
        try {
            const json = localStorage.getItem(key);
            return json ? JSON.parse(json) : fallback;
        } catch (e) {
            Logger.warn("Storage", `Failed to read ${key}, using fallback`);
            return fallback;
        }
    },

    /**
     * Remove a key.
     * @param {string} key
     */
    remove(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            Logger.error("Storage", `Failed to remove ${key}:`, e);
        }
    },

    /**
     * Clear all keys (or just those with our namespace).
     * @param {boolean} onlyNamespace (default: true)
     */
    clear(onlyNamespace = true) {
        try {
            if (onlyNamespace) {
                const ns = CONFIG.STORAGE.NS;
                Object.keys(localStorage).forEach((key) => {
                    if (key.startsWith(ns)) localStorage.removeItem(key);
                });
            } else {
                localStorage.clear();
            }
        } catch (e) {
            Logger.error("Storage", "Failed to clear storage:", e);
        }
    },
};

/* ==========================================================================
   09. DEBOUNCE & THROTTLE
   ========================================================================== */

/**
 * Debounce a function (delay execution until calls stop).
 * @param {function} fn
 * @param {number} wait - delay in ms
 * @returns {function}
 */
export function debounce(fn, wait = 300) {
    let timeoutId = null;

    return function (...args) {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            fn.apply(this, args);
            timeoutId = null;
        }, wait);
    };
}

/**
 * Throttle a function (limit execution to once per interval).
 * @param {function} fn
 * @param {number} limit - interval in ms
 * @returns {function}
 */
export function throttle(fn, limit = 300) {
    let inThrottle = false;

    return function (...args) {
        if (!inThrottle) {
            fn.apply(this, args);
            inThrottle = true;
            setTimeout(() => {
                inThrottle = false;
            }, limit);
        }
    };
}

/**
 * Request animation frame debounce (for high-frequency events).
 * @param {function} fn
 * @returns {function}
 */
export function rafDebounce(fn) {
    let rafId = null;

    return function (...args) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            fn.apply(this, args);
        });
    };
}

/* ==========================================================================
   10. ERROR HANDLING & VALIDATION
   ========================================================================== */

/**
 * Wrap a promise-returning function to catch and log errors.
 * @param {function} fn
 * @param {string} label - for logging
 * @returns {function}
 */
export function withErrorHandling(fn, label = "Operation") {
    return async function (...args) {
        try {
            return await fn.apply(this, args);
        } catch (error) {
            Logger.error("ErrorHandler", `${label} failed:`, error);
            throw error;
        }
    };
}

/**
 * Validate a required string.
 * @param {*} value
 * @param {string} fieldName - for error message
 * @returns {boolean}
 */
export function validateRequired(value, fieldName = "Field") {
    if (!is.string(value) || is.empty(value)) {
        Logger.warn("Validation", `${fieldName} is required`);
        return false;
    }
    return true;
}

/**
 * Validate a number is within range.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {string} fieldName
 * @returns {boolean}
 */
export function validateRange(value, min, max, fieldName = "Value") {
    if (!is.number(value) || value < min || value > max) {
        Logger.warn("Validation", `${fieldName} must be between ${min} and ${max}`);
        return false;
    }
    return true;
}

/**
 * Validate an email address (basic).
 * @param {string} email
 * @returns {boolean}
 */
export function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}
