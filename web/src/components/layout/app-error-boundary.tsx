import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Top-level error boundary wrapping the entire app tree. Catches
 *  render crashes that happen OUTSIDE a page (in AuthProvider,
 *  ActingForProvider, the router, the layout shell, or in the
 *  /login + /login/mfa pages that aren't wrapped by PageErrorBoundary).
 *
 *  Without this, an unhandled render error blanks the page entirely
 *  with no signal to ops or the user. We render a minimal recovery
 *  card that doesn't depend on any app state. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Surface in the console for devs. Sentry / Datadog wiring lands in
    // OS4 (structured logging + error tracking).
    // eslint-disable-next-line no-console
    console.error("AppErrorBoundary caught:", error, info);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  private hardReload = () => {
    window.location.assign("/");
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F9FAFB",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            background: "#fff",
            padding: 28,
            borderRadius: 12,
            border: "1px solid #FECACA",
            boxShadow: "0 4px 12px rgba(15,23,42,0.06)",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, color: "#B42318", marginBottom: 8 }}>
            Something went wrong
          </div>
          <div style={{ fontSize: 14, color: "#475467", marginBottom: 16, lineHeight: 1.5 }}>
            The app hit an unexpected error and can't continue rendering. Try
            reloading. If this keeps happening, share the message below with
            an engineer.
          </div>
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: "#FEF2F2",
              borderRadius: 8,
              fontSize: 12,
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              color: "#B42318",
              overflowX: "auto",
              border: "1px solid #FECACA",
            }}
          >
            {this.state.error.message || String(this.state.error)}
          </pre>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              onClick={this.reset}
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                border: "1px solid #EAECF0",
                background: "#fff",
                fontSize: 13,
                fontWeight: 600,
                color: "#344054",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              onClick={this.hardReload}
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                border: "none",
                background: "linear-gradient(135deg,#4F46E5,#6366F1)",
                fontSize: 13,
                fontWeight: 600,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
