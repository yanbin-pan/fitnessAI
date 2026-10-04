import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// After signing in again the app reloads at /?reauth=…; tidy the address bar.
const url = new URL(window.location.href);
if (url.searchParams.has("reauth")) {
  url.searchParams.delete("reauth");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
