import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { ActingForProvider } from "./lib/acting-for";
import { App } from "./App";
import "./globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ActingForProvider>
          <App />
        </ActingForProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
