// 💎 VALO — intro sequence.
//
// The diamond emblem draws itself in stroke, floods with its violet→blue
// gradient, catches a sheen along the upper-right facet. Then a violet seam
// opens vertically out of the emblem's own centre and the screen splits along
// it — emblem, wordmark and all — the two halves sliding away like glass doors
// while the seam edges flare and trail light into the opening. The terminal has
// been mounted and loading underneath the whole time. Nothing is gated on this:
// no cost to time-to-first-data.
//
// How the split works: each door renders the FULL composition and clips itself
// to its own half at the seam. Because the composition is a child of the door,
// it inherits the door's transform for free — the halves can never drift out of
// sync with the edge they're cut against.
//
// Mount once, at the top of the app entry:
//
//     <ValoIntro />
//     <App />
//
// Plays once per browser session. Tap, click, or Escape skips. Honours
// prefers-reduced-motion by skipping straight to the site.

import { useEffect, useRef, useState } from "react";

const VIOLET = "#863bff";        // seam + wordmark accent (brand violet)
const VIOLET_RGB = "134,59,255"; // same, for the flare's alpha layers
const FACE_TOP = "#A78BFA";      // emblem, lit top face
const FACE_MID = "#8B7BF2";      // emblem, body
const FACE_LOW = "#5B8DEF";      // emblem, cool bottom
const BG = "#0B0E14";
const KEY = "valo-intro-seen";

const DOOR_MS = 1050;            // door travel — the flare is timed to match

// The emblem: a rounded diamond — a 30x30 square with 7-unit corner radii,
// rotated 45°, centred at (24,24) in a 48x48 box. Drawn clockwise from the
// upper-left facet. pathLength normalises the draw, so swapping in the exact
// path exported from your design file needs no retiming.
const MARK =
  "M19.05 7.95a7 7 0 0 1 9.9 0l11.1 11.1a7 7 0 0 1 0 9.9" +
  "l-11.1 11.1a7 7 0 0 1-9.9 0L7.95 28.95a7 7 0 0 1 0-9.9z";

// Claim the flag at MODULE LOAD, not in an effect. Effect ordering between
// sibling trees is not guaranteed to favour us, and the tour's own effect was
// reading `undefined` and starting its timer before we ever set it.
const willPlay = (() => {
  if (typeof window === "undefined") return false;
  try { if (sessionStorage.getItem(KEY) === "1") return false; } catch (e) {}
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return !reduce;
})();
try { if (willPlay) window.__VALO_INTRO__ = true; } catch (e) {}

export default function ValoIntro({ force = false }) {
  const [phase, setPhase] = useState(() => {
    if (force) return "draw";
    if (typeof window === "undefined") return "gone";
    try { if (sessionStorage.getItem(KEY) === "1") return "gone"; } catch (e) {}
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return reduce ? "gone" : "draw";
  });
  const timers = useRef([]);

  const seal = () => { try { sessionStorage.setItem(KEY, "1"); } catch (e) {} };

  // Anything that must not begin behind the doors — the first-run tour, most of
  // all — can read this flag or wait for the event.
  //   if (window.__VALO_INTRO__) { wait for "valo-intro-done" }
  useEffect(() => {
    try {
      if (phase === "gone") {
        window.__VALO_INTRO__ = false;
        window.dispatchEvent(new Event("valo-intro-done"));
      } else {
        window.__VALO_INTRO__ = true;
      }
    } catch (e) {}
  }, [phase]);

  useEffect(() => {
    if (phase === "gone") return;
    const t = (fn, ms) => timers.current.push(setTimeout(fn, ms));
    t(() => setPhase("cut"), 1800);
    t(() => setPhase("part"), 2280);
    t(() => { setPhase("gone"); seal(); }, 2280 + DOOR_MS + 120);
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
  }, [phase === "gone"]);

  const skip = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase("part");
    setTimeout(() => { setPhase("gone"); seal(); }, DOOR_MS - 150);
  };

  // hold the page still while the doors are shut — a swipe during the sequence
  // would otherwise scroll the terminal behind them
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") skip(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (phase === "gone") return null;

  const parting = phase === "part";
  const open = phase === "cut" || parting;

  // Each door is a hair over half the screen so the two always overlap at the
  // centre — no subpixel gap can open up before the split.
  const door = (side) => ({
    position: "fixed", top: 0, height: "100%", width: "calc(50% + 1px)",
    background: BG, zIndex: 2147483001, willChange: "transform", [side]: 0,
    transform: parting ? `translateX(${side === "left" ? "-102%" : "102%"})` : "none",
    transition: `transform ${DOOR_MS}ms cubic-bezier(.76,0,.24,1)`,
  });

  // The full composition, laid out against the whole viewport inside the door,
  // then clipped to this door's half. Both halves therefore sit on the same
  // screen coordinates and reassemble into one image at rest.
  const half = (side) => ({
    position: "absolute", top: 0, height: "100%",
    width: "calc(200% - 2px)",
    [side]: 0, zIndex: 1,
    display: "grid", placeItems: "center",
    clipPath: side === "left" ? "inset(0 50% 0 0)" : "inset(0 0 0 50%)",
  });

  // The lit edge of each door. Sits flush against the seam, rides off with it.
  const edge = (side) => ({
    position: "absolute", top: "50%", [side === "left" ? "right" : "left"]: 1,
    width: 1, height: open ? "100%" : 0, transform: "translateY(-50%)",
    background: `linear-gradient(180deg, ${FACE_LOW}, ${VIOLET} 50%, ${FACE_LOW})`,
    boxShadow: `0 0 18px ${VIOLET}`,
    zIndex: 2, pointerEvents: "none",
    transition: "height .5s cubic-bezier(.16,1,.3,1)",
    ...(parting ? { animation: `valoFlare ${DOOR_MS}ms ease-out forwards` } : null),
  });

  // Light spilling off that edge into the opening, trailing the door outward.
  const spill = (side) => ({
    position: "absolute", top: 0, height: "100%", width: 170,
    [side === "left" ? "left" : "right"]: "100%",
    background: `linear-gradient(${side === "left" ? "90deg" : "270deg"},
      rgba(${VIOLET_RGB},.30), rgba(${VIOLET_RGB},.08) 42%, rgba(${VIOLET_RGB},0))`,
    opacity: 0, zIndex: 2, pointerEvents: "none",
    ...(parting ? { animation: `valoSpill ${DOOR_MS}ms ease-out forwards` } : null),
  });

  const composition = (
    <div style={{ position: "relative" }}>
      {/* wordmark hangs above the emblem so it can't push it off centre */}
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: "100%",
        marginBottom: 26, textAlign: "center",
      }}>
        <div style={{
          display: "inline-block",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12, fontWeight: 900, color: "#E6E9F0",
          // letter-spacing leaves a trailing gap after the last glyph; the
          // matching indent puts the ink back on the shared axis
          letterSpacing: 7, textIndent: 7,
          opacity: 0, animation: "valoWord .8s cubic-bezier(.16,1,.3,1) .45s forwards",
          whiteSpace: "nowrap",
        }}>
          VALO <span style={{ color: VIOLET }}>·</span> TERMINAL
        </div>
      </div>

      <svg viewBox="-6 -6 60 60" style={{ width: "min(30vmin,168px)", height: "auto", overflow: "visible", display: "block" }}>
        <path className="valo-halo" d={MARK} />
        <path className="valo-fill" d={MARK} />
        <path className="valo-sheen" d={MARK} />
        <path className="valo-mark" d={MARK} pathLength="100" />
      </svg>
    </div>
  );

  return (
    <div onClick={skip} style={{ position: "fixed", inset: 0, zIndex: 2147483000, cursor: "pointer" }} aria-hidden="true">
      <style>{`
        @keyframes valoDraw  { to { stroke-dashoffset: 0 } }
        @keyframes valoFlood { 0%{opacity:0} 100%{opacity:1} }
        @keyframes valoSheen { 0%{opacity:0} 100%{opacity:1} }
        @keyframes valoGlow  { 0%{opacity:0} 40%{opacity:.5} 100%{opacity:.2} }
        @keyframes valoWord  { from{opacity:0;transform:translateY(-5px)} to{opacity:1;transform:none} }
        @keyframes valoUp    { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        /* the edge blows out as the door breaks away, then settles as it exits */
        @keyframes valoFlare {
          0%   { box-shadow: 0 0 18px ${VIOLET}; filter: brightness(1); }
          16%  { box-shadow: 0 0 46px ${VIOLET}, 0 0 130px rgba(${VIOLET_RGB},.7);
                 filter: brightness(1.7); }
          55%  { box-shadow: 0 0 32px ${VIOLET}, 0 0 90px rgba(${VIOLET_RGB},.4);
                 filter: brightness(1.2); }
          100% { box-shadow: 0 0 20px ${VIOLET}, 0 0 55px rgba(${VIOLET_RGB},.15);
                 filter: brightness(1); }
        }
        @keyframes valoSpill { 0%{opacity:0} 20%{opacity:1} 100%{opacity:0} }
        .valo-mark  { stroke:url(#valoEdge); stroke-width:1.4; fill:none;
          stroke-linejoin:round; stroke-linecap:round;
          stroke-dasharray:100; stroke-dashoffset:100;
          animation: valoDraw 1.15s cubic-bezier(.65,0,.35,1) forwards; }
        .valo-fill  { fill:url(#valoFace); opacity:0;
          animation: valoFlood .55s ease 1.05s forwards; }
        .valo-sheen { fill:url(#valoGloss); opacity:0;
          animation: valoSheen .7s ease 1.35s forwards; }
        .valo-halo  { fill:url(#valoFace); opacity:0; filter: blur(14px);
          animation: valoGlow 1s ease 1.05s forwards; }
      `}</style>

      {/* paint servers defined once; both halves reference the same ids */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          {/* body: lit violet at the top vertex, cooling to blue at the bottom */}
          <linearGradient id="valoFace" x1="0.18" y1="0" x2="0.7" y2="1">
            <stop offset="0%"   stopColor={FACE_TOP} />
            <stop offset="45%"  stopColor={FACE_MID} />
            <stop offset="100%" stopColor={FACE_LOW} />
          </linearGradient>
          {/* the glassy sheen across the upper-right facet */}
          <linearGradient id="valoGloss" x1="1" y1="0" x2="0.18" y2="0.85">
            <stop offset="0%"  stopColor="#FFFFFF" stopOpacity="0.34" />
            <stop offset="38%" stopColor="#FFFFFF" stopOpacity="0.10" />
            <stop offset="62%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
          {/* the drawing stroke carries the same violet→blue travel */}
          <linearGradient id="valoEdge" x1="0.2" y1="0" x2="0.7" y2="1">
            <stop offset="0%"   stopColor={FACE_TOP} />
            <stop offset="100%" stopColor={FACE_LOW} />
          </linearGradient>
        </defs>
      </svg>

      <div style={door("left")}>
        <div style={half("left")}>{composition}</div>
        <div style={spill("left")} />
        <div style={edge("left")} />
      </div>

      <div style={door("right")}>
        <div style={half("right")}>{composition}</div>
        <div style={spill("right")} />
        <div style={edge("right")} />
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); skip(); }}
        style={{
          position: "fixed", right: 16, bottom: 14, zIndex: 2147483004,
          background: "none", border: 0, color: "#5C6478", cursor: "pointer",
          fontFamily: "ui-monospace, Menlo, monospace", fontSize: 10, letterSpacing: 2,
          opacity: 0, animation: "valoUp .5s ease 1.5s forwards",
          ...(parting ? { opacity: 0, transition: "opacity .25s ease", animation: "none" } : null),
        }}>
        SKIP →
      </button>
    </div>
  );
}
