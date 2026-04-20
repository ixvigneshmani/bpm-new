import { useEffect } from "react";

/** Hook: run `refresh` once on mount, then on an interval — but ONLY
 *  while the browser tab is visible. Also refreshes immediately when
 *  the tab becomes visible again after being hidden. Prevents idle
 *  tabs from hammering the API (open-overnight-laptop problem).
 *
 *  Returns nothing — state lives in the caller. Designed to be a
 *  drop-in replacement for the setInterval-in-useEffect pattern. */
export function useVisiblePoll(refresh: () => void, intervalMs: number): void {
  useEffect(() => {
    let timerId: number | null = null;

    const start = () => {
      if (timerId !== null) return;
      refresh();
      timerId = window.setInterval(refresh, intervalMs);
    };
    const stop = () => {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, intervalMs]);
}
