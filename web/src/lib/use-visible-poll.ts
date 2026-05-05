import { useEffect } from "react";

/** Hook: run `refresh` once on mount, then on an interval — but ONLY
 *  while the browser tab is visible. Also refreshes immediately when
 *  the tab becomes visible again after being hidden. Prevents idle
 *  tabs from hammering the API (open-overnight-laptop problem).
 *
 *  Returns nothing — state lives in the caller. Designed to be a
 *  drop-in replacement for the setInterval-in-useEffect pattern.
 *
 *  IMPORTANT: the *first* refresh runs unconditionally on mount, even
 *  if the page is hidden. That's needed because most callers track a
 *  `loading` flag that flips to `false` only inside the refresh's
 *  `finally`. If the very first refresh never fires, the page is
 *  stuck rendering "Loading…" forever. This bit My-Tasks and Running
 *  list pages on first navigation when the visibility API briefly
 *  reports "hidden" during route transitions / prerender / preview
 *  tooling — BUG-21.
 *
 *  After that initial fire, the *interval* polling is still gated on
 *  visibility, so background tabs still don't hammer the API. */
export function useVisiblePoll(refresh: () => void, intervalMs: number): void {
  useEffect(() => {
    let timerId: number | null = null;
    /** True once we've fired the initial refresh. Prevents a
     *  visibilitychange-restore from double-firing on the very first
     *  mount-while-hidden + tab-comes-visible-immediately sequence. */
    let firstRefreshDone = false;

    const fireOnce = () => {
      refresh();
      firstRefreshDone = true;
    };
    const start = () => {
      if (timerId !== null) return;
      if (!firstRefreshDone) fireOnce();
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

    if (document.visibilityState === "visible") {
      start();
    } else {
      // Mounted while hidden — kick off exactly one fetch so the
      // caller's `loading` flag (which only clears in refresh's
      // finally) doesn't get stuck. The polling interval still waits
      // for the tab to become visible.
      fireOnce();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, intervalMs]);
}
