import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import * as Sentry from "@sentry/react";
import { AuthProvider } from "./lib/auth";
import { ActingForProvider } from "./lib/acting-for";
import { AppErrorBoundary } from "./components/layout/app-error-boundary";
import { App } from "./App";
import "./globals.css";

// L11 — Frontend error tracking. Only initialises when VITE_SENTRY_DSN
// is set in the build env; left unset = no-op, no network calls.
// Paired with the API-side Sentry wired in OS4 so a user-visible error
// produces correlated reports on both sides (the browser keeps the
// X-Request-Id from the response, which the API has already tagged).
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    release: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "dev",
    // Performance + replays off by default — opt in later if there's
    // budget for the payload.
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      // Outer Sentry boundary captures + reports anything that
      // escapes AppErrorBoundary (which has its own friendly UI).
      // Fallback here only runs if AppErrorBoundary itself crashed —
      // a minimal recovery card with no app dependencies.
      fallback={
        <div style={{
          minHeight: "100vh", display: "flex", alignItems: "center",
          justifyContent: "center", background: "#F9FAFB",
          fontFamily: "system-ui, sans-serif", padding: 24,
        }}>
          <div style={{
            maxWidth: 420, background: "#fff", padding: 24, borderRadius: 12,
            border: "1px solid #FECACA", textAlign: "center",
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#B42318", marginBottom: 8 }}>
              Something went wrong
            </div>
            <div style={{ fontSize: 13, color: "#475467", marginBottom: 16 }}>
              The page can't render. Reload to try again.
            </div>
            <button
              onClick={() => window.location.assign("/")}
              style={{
                padding: "9px 16px", borderRadius: 8, border: "none",
                background: "linear-gradient(135deg,#4F46E5,#6366F1)",
                color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              Reload app
            </button>
          </div>
        </div>
      }
    >
      <AppErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <ActingForProvider>
              <App />
            </ActingForProvider>
          </AuthProvider>
        </BrowserRouter>
      </AppErrorBoundary>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
