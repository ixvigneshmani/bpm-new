import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Per-route error boundary. Contains a render crash inside a single
 *  page so the DashboardLayout + sidebar don't unmount. Without this
 *  a single malformed audit payload (circular JSON, unexpected shape)
 *  would tear down the whole app shell and force a hard reload.
 *
 *  Kept deliberately simple — a "Something went wrong" card with the
 *  error message and a reload prompt. Full-featured recovery (retry,
 *  report-to-sentry, stack trace toggle) is an Ops & Security item. */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Surface in the console for devs; a real logger wires in during Ops & Security.
    // eslint-disable-next-line no-console
    console.error("PageErrorBoundary caught:", error, info);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        margin: "40px auto", maxWidth: 520, padding: "24px 28px",
        background: "#fff", border: "1px solid #FECACA", borderRadius: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}>
        <div style={{
          fontSize: 16, fontWeight: 700, color: "#B42318", marginBottom: 8,
        }}>
          Something went wrong on this page
        </div>
        <div style={{ fontSize: 13, color: "#667085", marginBottom: 14 }}>
          The rest of the app should still work — try navigating away and back.
          If this keeps happening, reload the page.
        </div>
        <pre style={{
          margin: 0, padding: 10, background: "#FEF2F2", borderRadius: 6,
          fontSize: 12, fontFamily: "var(--font-mono, monospace)", color: "#B42318",
          overflowX: "auto",
        }}>
          {this.state.error.message}
        </pre>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 12, padding: "8px 16px", borderRadius: 8, border: "none",
            background: "linear-gradient(135deg, #4F46E5, #6366F1)",
            fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Reload page
        </button>
      </div>
    );
  }
}
