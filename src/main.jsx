import React from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import "./index.css";
import App from "./App.jsx";

window.__VALO_LIVE__ = import.meta.env.VITE_LIVE_DATA === "1";
window.__VALO_STREAM__ = import.meta.env.VITE_VALO_STREAM || null;
window.__VALO_STREAM__ = import.meta.env.VITE_VALO_STREAM || null;

const sbUrl = import.meta.env.VITE_SUPABASE_URL;
const sbAnon = import.meta.env.VITE_SUPABASE_ANON;
if (sbUrl && sbAnon) window.__VALO_SB_CLIENT__ = createClient(sbUrl, sbAnon);

class ValoBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("[VALO] render error:", err, info && info.componentStack); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ position: "fixed", inset: 0, background: "#0a0d14", color: "#e6e9ef",
        fontFamily: "ui-monospace, Menlo, monospace", display: "flex", alignItems: "center",
        justifyContent: "center", padding: 20, textAlign: "center" }}>
        <div style={{ maxWidth: 420, width: "100%" }}>
          <div style={{ width: 46, height: 46, margin: "0 auto 16px", borderRadius: 14, transform: "rotate(45deg)",
            background: "linear-gradient(135deg,#a07ff2,#5b93ec)", boxShadow: "0 0 26px rgba(125,92,240,0.65)" }} />
          <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: 2, marginBottom: 8 }}>VALO HIT A SNAG</div>
          <div style={{ fontSize: 11.5, lineHeight: 1.7, color: "#8a94a8", marginBottom: 18 }}>
            Something stopped rendering. Your account, wallet and positions are safe in the cloud —
            reloading picks up where you left off.
          </div>
          <button onClick={() => window.location.reload()}
            style={{ width: "100%", border: "none", borderRadius: 11, padding: 13, background: "#7d5cf0",
              color: "#0a0713", fontWeight: 900, fontSize: 12, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" }}>
            ⟳ RELOAD VALO
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(<ValoBoundary><App /></ValoBoundary>);
