"use client";

import { memo } from "react";
import { Bot, Radar } from "lucide-react";
import { useClientRedirect } from "@/hooks/use-client-redirect";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { APP_IDENTITY, BOOT_TIMING, DASHBOARD_URL } from "@/lib/robot/constants";
import { cx } from "@/lib/utils";

/* ---------------------------------------------------------------------------
   Presentational pieces — memoized, pure, zero re-render cost.
--------------------------------------------------------------------------- */

interface StatusLineProps {
  label: string;
  value: string;
  tone?: "ok" | "warn";
  delayMs: number;
  reduced: boolean;
}

const StatusLine = memo(function StatusLine({
  label,
  value,
  tone = "ok",
  delayMs,
  reduced,
}: StatusLineProps) {
  return (
    <div
      className={cx(
        "flex items-center justify-between gap-6 border-b border-amber-400/10 py-1.5",
        "font-heading text-[11px] uppercase tracking-[0.18em]",
        !reduced && "mc-rise"
      )}
      style={reduced ? undefined : { animationDelay: `${delayMs}ms` }}
    >
      <span className="text-slate-500">{label}</span>
      <span
        className={cx(
          "flex items-center gap-1.5",
          tone === "ok" ? "text-amber-300" : "text-amber-300"
        )}
      >
        <span
          className={cx(
            "inline-block h-1.5 w-1.5 rounded-full",
            tone === "ok" ? "bg-amber-400" : "bg-amber-400",
            !reduced && "animate-pulse"
          )}
          aria-hidden="true"
        />
        {value}
      </span>
    </div>
  );
});

const RadarDial = memo(function RadarDial({ reduced }: { reduced: boolean }) {
  return (
    <div className="relative grid h-32 w-32 place-items-center" aria-hidden="true">
      {/* concentric rings */}
      <div className="absolute inset-0 rounded-full border border-amber-400/20" />
      <div className="absolute inset-3 rounded-full border border-amber-400/15" />
      <div className="absolute inset-7 rounded-full border border-amber-400/10" />
      {/* crosshair */}
      <div className="absolute inset-x-0 top-1/2 h-px bg-amber-400/10" />
      <div className="absolute inset-y-0 left-1/2 w-px bg-amber-400/10" />
      {/* rotating sweep */}
      {!reduced && (
        <div
          className="mc-sweep absolute inset-0 rounded-full"
          style={{ animationDuration: `${BOOT_TIMING.radarSweepMs}ms` }}
        />
      )}
      {/* blip */}
      <span
        className={cx(
          "absolute right-6 top-7 h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.9)]",
          !reduced && "animate-ping"
        )}
      />
      <Bot className="relative h-10 w-10 text-amber-300 drop-shadow-[0_0_14px_rgba(251,191,36,0.55)]" />
    </div>
  );
});

/* ---------------------------------------------------------------------------
   Boot screen — owns the redirect + reduced-motion awareness.
--------------------------------------------------------------------------- */

export function BootScreen() {
  const reduced = usePrefersReducedMotion();
  useClientRedirect(DASHBOARD_URL, BOOT_TIMING.redirectDelay, reduced);

  return (
    <main
      role="status"
      aria-live="polite"
      aria-label={`${APP_IDENTITY.name} is initializing`}
      className="mc-backdrop relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6"
    >
      {/* ambient layers */}
      <div className="mc-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="mc-glow pointer-events-none absolute inset-0" aria-hidden="true" />
      {!reduced && <div className="mc-scanline pointer-events-none absolute inset-0" aria-hidden="true" />}

      <section className="relative w-full max-w-sm">
        <div className="flex flex-col items-center gap-6">
          <RadarDial reduced={reduced} />

          <header className="text-center">
            <p className="font-heading text-[11px] uppercase tracking-[0.4em] text-amber-400/80">
              {APP_IDENTITY.robot}
            </p>
            <h1 className="font-display mt-2 text-3xl font-bold tracking-[0.22em] text-slate-100 drop-shadow-[0_0_24px_rgba(251,191,36,0.35)]">
              {APP_IDENTITY.name.toUpperCase()}
            </h1>
          </header>

          <div className="w-full">
            <StatusLine reduced={reduced} delayMs={120} label="Uplink" value="Standby" tone="warn" />
            <StatusLine reduced={reduced} delayMs={260} label="Telemetry" value="Armed" />
            <StatusLine reduced={reduced} delayMs={400} label="Nav grid" value="Locked" />
          </div>

          {/* progress shimmer */}
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-slate-800"
            role="progressbar"
            aria-label="Loading dashboard"
          >
            <div className={cx("mc-bar h-full w-1/3 rounded-full bg-gradient-to-r from-amber-500 to-teal-400", reduced && "opacity-70")} />
          </div>

          <a
            href={DASHBOARD_URL}
            className="font-heading inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400 transition-colors hover:text-amber-300 focus-visible:text-amber-300"
          >
            <Radar className="h-3.5 w-3.5" aria-hidden="true" />
            Enter {APP_IDENTITY.name}
          </a>
        </div>
      </section>

      <p className="font-heading absolute bottom-5 text-[10px] uppercase tracking-[0.3em] text-slate-600">
        v{APP_IDENTITY.version} · ESP32 Survey Platform
      </p>
    </main>
  );
}
