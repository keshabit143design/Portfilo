"use client";

import { useEffect } from "react";

/**
 * Navigate to `url` after `delayMs`, honoring reduced-motion (instant jump).
 * The timer is cleaned up on unmount so a fast back-navigation never
 * yanks the user away from where they intended to go.
 */
export function useClientRedirect(
  url: string,
  delayMs: number,
  reducedMotion: boolean
): void {
  useEffect(() => {
    const wait = reducedMotion ? 0 : delayMs;
    const timer = window.setTimeout(() => {
      window.location.assign(url);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [url, delayMs, reducedMotion]);
}
