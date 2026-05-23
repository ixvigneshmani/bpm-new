import { formatRelativeTime, useNow } from "../lib/utils";

type Props = {
  /** ISO 8601 timestamp from the server (UTC). */
  iso: string;
  /** How often to re-tick the label, in ms. Default 30s. */
  intervalMs?: number;
};

/**
 * Renders a relative-time label ("2m ago") that lives off the browser
 * clock and re-ticks on its own. Every relative-time render in the app
 * should funnel through this component so we get a single source of
 * truth + no stale "5h ago" tabs that should say "Just now" after a save
 * elsewhere in the app.
 */
export default function RelativeTime({ iso, intervalMs }: Props) {
  const now = useNow(intervalMs);
  return <>{formatRelativeTime(iso, now)}</>;
}
