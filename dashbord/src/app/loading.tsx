import { Loader2 } from "lucide-react";

/** Suspense fallback for route transitions — intentionally minimal. */
export default function Loading() {
  return (
    <main
      className="mc-backdrop flex min-h-screen items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      <Loader2 className="h-8 w-8 animate-spin text-cyan-300" aria-hidden="true" />
    </main>
  );
}
