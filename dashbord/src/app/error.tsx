"use client";

import { useEffect } from "react";
import { SatelliteDish, TriangleAlert } from "lucide-react";

/**
 * App-level error boundary — branded, recoverable, and loud in the console
 * so failures are never swallowed silently.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[MissionControl] Unhandled route error:", error);
  }, [error]);

  return (
    <main className="mc-backdrop relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div className="mc-grid pointer-events-none absolute inset-0" aria-hidden="true" />

      <section
        role="alert"
        className="relative w-full max-w-md rounded-2xl border border-red-500/30 bg-slate-950/70 p-8 text-center shadow-[0_0_60px_rgba(239,68,68,0.15)] backdrop-blur-xl"
      >
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-red-500/40 bg-red-500/10">
          <TriangleAlert className="h-7 w-7 text-red-400" aria-hidden="true" />
        </div>

        <p className="font-heading text-[11px] uppercase tracking-[0.35em] text-red-400/80">
          Signal Lost
        </p>
        <h1 className="font-display mt-2 text-2xl font-bold tracking-[0.14em] text-slate-100">
          SYSTEM FAULT
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          Mission Control hit an unexpected error. The uplink can usually be
          re-established by re-initializing the console.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="font-heading inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-400 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-950 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-cyan-300"
          >
            <SatelliteDish className="h-4 w-4" aria-hidden="true" />
            Re-initialize
          </button>
          <a
            href="/dashboard/index.html"
            className="font-heading inline-flex items-center justify-center rounded-lg border border-slate-700 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300 transition-colors hover:border-cyan-400/50 hover:text-cyan-300"
          >
            Open Dashboard
          </a>
        </div>
      </section>
    </main>
  );
}
