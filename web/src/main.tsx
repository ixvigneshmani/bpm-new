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
      fallback={({ error }) => (
        <AppErrorBoundary>
          {/* If we hit this, Sentry already captured the error;
              AppErrorBoundary renders its existing friendly fallback. */}
          <div data-sentry-thrown>{(error as Error)?.message}</div>
        </AppErrorBoundary>
      )}
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
