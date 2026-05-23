import { useEffect, useState } from "react";

export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  if (!iso) return "";
  const diff = now - new Date(iso).getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/**
 * Subscribe to a browser-clock ticker. Returns `Date.now()` and re-renders
 * the caller every `intervalMs` (default 30s). Use this so labels like
 * "2m ago" stay accurate without depending on data refetches. The whole
 * point is the displayed time tracks the user's local clock; the
 * server-provided ISO timestamp is the immovable reference, "now" is the
 * browser's.
 */
export function useNow(intervalMs: number = 30_000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [intervalMs]);
  return now;
}

export function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

export function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
