/* ==========================================================================
   MISSION CONTROL — SMART SURVEY ROBOT — app.js
   --------------------------------------------------------------------------
   Sidebar Interaction Controller · Instagram-style navigation UX
   --------------------------------------------------------------------------
   Responsibilities
     • Mobile  → off-canvas drawer + dimmed scrim, tap-outside to close,
                 body scroll lock, Escape to close, auto-close on nav.
     • Desktop → hamburger collapses the sidebar into a slim icon rail
                 (state persisted in localStorage).
     • Hamburger icon morphs (bars ↔ xmark) while the drawer is open.

   Deliberately dependency-free (no imports) so it works as a module or
   classic script, and never fights dashboard.js — it only owns the
   drawer/collapse presentation, not navigation or robot logic.
   ========================================================================== */

(function () {
    "use strict";

    const MOBILE_QUERY = "(max-width: 768px)";
    const STORE_KEY = "sarathi_v1_sidebar_collapsed";
    const OPEN_CLASS = "is-open";
    const COLLAPSED_CLASS = "sidebar-collapsed";
    const SCROLL_LOCK_CLASS = "drawer-locked";

    const sidebar = document.getElementById("app-sidebar");
    const toggleBtn = document.getElementById("sidebar-toggle-btn");

    if (!sidebar || !toggleBtn) return;

    const mobileMQ = window.matchMedia(MOBILE_QUERY);

    /* --- Scrim (dimmed backdrop behind the drawer) -------------------- */
    const scrim = document.createElement("div");
    scrim.className = "sidebar-scrim";
    scrim.setAttribute("aria-hidden", "true");
    scrim.hidden = true;
    document.body.appendChild(scrim);

    const toggleIcon = toggleBtn.querySelector("i");

    function isMobile() {
        return mobileMQ.matches;
    }

    function setToggleIcon(open) {
        if (!toggleIcon) return;
        toggleIcon.classList.toggle("fa-bars", !open);
        toggleIcon.classList.toggle("fa-xmark", !!open);
    }

    /* ==================================================================
       MOBILE DRAWER
       ================================================================== */

    function openDrawer() {
        sidebar.classList.add(OPEN_CLASS);
        scrim.hidden = false;
        /* allow the element to paint before fading in */
        requestAnimationFrame(() => scrim.classList.add("is-visible"));
        document.body.classList.add(SCROLL_LOCK_CLASS);
        toggleBtn.setAttribute("aria-expanded", "true");
        setToggleIcon(true);
    }

    function closeDrawer() {
        if (!sidebar.classList.contains(OPEN_CLASS)) return;
        sidebar.classList.remove(OPEN_CLASS);
        scrim.classList.remove("is-visible");
        document.body.classList.remove(SCROLL_LOCK_CLASS);
        toggleBtn.setAttribute("aria-expanded", "false");
        setToggleIcon(false);
        window.setTimeout(() => { scrim.hidden = true; }, 260);
    }

    /* ==================================================================
       DESKTOP RAIL COLLAPSE
       ================================================================== */

    function applyCollapsed(collapsed, persist) {
        document.body.classList.toggle(COLLAPSED_CLASS, collapsed);
        toggleBtn.setAttribute("aria-pressed", String(collapsed));
        if (persist) {
            try { localStorage.setItem(STORE_KEY, collapsed ? "1" : "0"); } catch (_) { /* private mode */ }
        }
    }

    function restoreCollapsedPreference() {
        let collapsed = false;
        try { collapsed = localStorage.getItem(STORE_KEY) === "1"; } catch (_) { /* ignore */ }
        document.body.classList.toggle(COLLAPSED_CLASS, collapsed);
        toggleBtn.setAttribute("aria-pressed", String(collapsed));
    }

    /* ==================================================================
       EVENT WIRING (capture phase so nothing can swallow the toggle)
       ================================================================== */

    /* Capture phase + stopImmediatePropagation so the duplicate binding
       inside dashboard.js can never double-toggle the drawer. */
    toggleBtn.addEventListener("click", (event) => {
        event.stopImmediatePropagation();
        if (isMobile()) {
            sidebar.classList.contains(OPEN_CLASS) ? closeDrawer() : openDrawer();
        } else {
            applyCollapsed(!document.body.classList.contains(COLLAPSED_CLASS), true);
        }
    }, true);

    scrim.addEventListener("click", closeDrawer);

    /* Close the drawer when a navigation link is chosen (mobile) */
    sidebar.addEventListener("click", (event) => {
        if (!isMobile()) return;
        if (event.target.closest(".nav-link")) closeDrawer();
    });

    /* Escape closes the drawer */
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeDrawer();
    });

    /* Breakpoint changes: reset drawer state, keep desktop preference */
    const handleBreakpoint = () => {
        closeDrawer();
        if (!isMobile()) restoreCollapsedPreference();
    };
    if (mobileMQ.addEventListener) mobileMQ.addEventListener("change", handleBreakpoint);
    else mobileMQ.addListener(handleBreakpoint);

    /* Swipe-left on the drawer edge closes it (touch nicety) */
    let touchStartX = null;
    sidebar.addEventListener("touchstart", (e) => {
        touchStartX = e.touches[0].clientX;
    }, { passive: true });
    sidebar.addEventListener("touchend", (e) => {
        if (touchStartX === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (dx < -60) closeDrawer();
        touchStartX = null;
    }, { passive: true });

    restoreCollapsedPreference();
})();
