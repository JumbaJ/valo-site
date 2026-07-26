import React from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import "./index.css";
import App from "./App.jsx";

// env bridge: lets the terminal read Vite build flags without import.meta
window.__VALO_LIVE__ = import.meta.env.VITE_LIVE_DATA === "1";

// ☁ Phase 3 — Supabase client. Only created when both env vars exist; the
// terminal treats its absence as "cloud features off" and runs normally.
const sbUrl = import.meta.env.VITE_SUPABASE_URL;
const sbAnon = import.meta.env.VITE_SUPABASE_ANON;
if (sbUrl && sbAnon) {
  window.__VALO_SB_CLIENT__ = createClient(sbUrl, sbAnon);
}

createRoot(document.getElementById("root")).render(<App />);
