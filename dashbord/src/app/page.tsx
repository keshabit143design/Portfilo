import { BootScreen } from "@/components/boot-screen";

/**
 * Root route — renders the Mission Control boot screen, which hands off
 * to the operations dashboard at /dashboard/index.html.
 * Kept a server component: only the splash hydrates on the client.
 */
export default function HomePage() {
  return <BootScreen />;
}
