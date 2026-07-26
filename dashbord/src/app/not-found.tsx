import { Compass } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sector Not Found" };

export default function NotFound() {
  return (
    <main className="mc-backdrop relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div className="mc-grid pointer-events-none absolute inset-0" aria-hidden="true" />

      <section className="relative w-full max-w-md rounded-2xl border border-cyan-400/20 bg-slate-950/70 p-8 text-center shadow-[0_0_60px_rgba(34,211,238,0.1)] backdrop-blur-xl">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-cyan-400/40 bg-cyan-400/10">
          <Compass className="h-7 w-7 text-cyan-300" aria-hidden="true" />
        </div>

        <p className="font-heading text-[11px] uppercase tracking-[0.35em] text-cyan-400/80">
          Navigation Error
        </p>
        <h1 className="font-display mt-2 text-4xl font-bold tracking-[0.14em] text-slate-100">
          404
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          This sector isn&apos;t on the survey map. Return to Mission Control
          to re-acquire the beacon.
        </p>

        <a
          href="/"
          className="font-heading mt-6 inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-blue-500 to-cyan-400 px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-950 transition-transform hover:-translate-y-0.5"
        >
          Return to Base
        </a>
      </section>
    </main>
  );
}
