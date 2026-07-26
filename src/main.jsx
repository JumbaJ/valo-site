import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

// env bridge: lets the terminal read the Vite build flag without import.meta
window.__VALO_LIVE__ = import.meta.env.VITE_LIVE_DATA === "1";

createRoot(document.getElementById("root")).render(<App />);
