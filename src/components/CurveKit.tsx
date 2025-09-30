import React, { useMemo, useRef, useState, useEffect } from "react";
import type { CurveKitProps, Vec2, CurveState } from "../lib/types";
import { buildParamLUT, pointAtTime, timeAtPoint } from "../lib/geometry/ParamMap";
import { cubicNormal } from "../lib/geometry/Bezier";

const PADDING = 24; // clamp rails for sculpt
const NODE_R = 20;  // 40px touch target
const TICK_EVERY = 2 * 3600;   // 2h
const MAJOR_EVERY = 6 * 3600;  // 6h labels
const TICK_LEN = 6;            // px half-length (minor)
const MAJOR_LEN = 10;          // px half-length (major)

function usePrefersReducedMotion() {
  const [prefers, set] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const h = () => set(!!m.matches);
    h();
    m.addEventListener("change", h);
    return () => m.removeEventListener("change", h);
  }, []);
  return prefers;
}

function nowSec(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

function formatHM(sec: number): string {
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function CurveKit(props: CurveKitProps): React.ReactElement {
  const { curve, nodes, onCurveChange, onNodeChange, onNodeTap, mode = "view", readOnly } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const prefersReduce = usePrefersReducedMotion();
  const dragStartRef = useRef<number | null>(null);
  const dragStartTimeRef = useRef<number | null>(null);
  const sculptMoveCountRef = useRef<number>(0);

  // First-run coachmark (long-press hint)
  const [coachmarkVisible, setCoachmarkVisible] = useState<boolean>(() => {
    try {
      return localStorage.getItem("ck_coachmark_seen") !== "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (!coachmarkVisible) return;
    const t = setTimeout(() => {
      try { localStorage.setItem("ck_coachmark_seen", "1"); } catch {}
      setCoachmarkVisible(false);
    }, 4000);
    return () => clearTimeout(t);
  }, [coachmarkVisible]);

  const lut = useMemo(() => buildParamLUT(curve), [curve]);

  const pathD = useMemo(() => {
    return lut.segments
      .map((c, i) =>
        `${i === 0 ? `M ${c.p0.x},${c.p0.y}` : ""} C ${c.p1.x},${c.p1.y} ${c.p2.x},${c.p2.y} ${c.p3.x},${c.p3.y}`
      )
      .join(" ");
  }, [lut]);

  const [dragging, setDragging] = useState<{ id: string } | null>(null);
  const [dragHint, setDragHint] = useState<Vec2 | null>(null);
  const [nowTime, setNowTime] = useState<number>(() => nowSec());
  useEffect(() => {
    // light refresh of the now marker every 30s (0 animations if reduced motion)
    const id = setInterval(() => setNowTime(nowSec()), 30_000);
    return () => clearInterval(id);
  }, []);

  function svgPoint(evt: React.PointerEvent): Vec2 {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const inv = ctm.inverse();
    const sp = pt.matrixTransform(inv);
    return { x: sp.x, y: sp.y };
  }

  function handleNodePointerDown(id: string) {
    return (e: React.PointerEvent) => {
      if (readOnly) return;
      // Guardrails: prevent page scroll during drag
      e.preventDefault();
      dragStartRef.current = performance.now();
      dragStartTimeRef.current = nodes.find(n => n.id === id)?.time ?? null;
      (e.target as Element).setPointerCapture(e.pointerId);
      setDragging({ id });
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    const p = svgPoint(e);
    setDragHint(p);
    if (onNodeChange) {
      const t = timeAtPoint(lut, p);
      onNodeChange(dragging.id, t);
    }
  }

  function handlePointerUp(_e: React.PointerEvent) {
    if (dragging) {
      // Telemetry stub: node drag
      const now = performance.now();
      const started = dragStartRef.current ?? now;
      const durationMs = now - started;
      const startTime = dragStartTimeRef.current ?? 0;
      const endTime = nodes.find(n => n.id === dragging.id)?.time ?? startTime;
      const deltaTime = endTime - startTime;
      // eslint-disable-next-line no-console
      console.log("telemetry: curvekit_node_drag", { id: dragging.id, durationMs: Math.round(durationMs), deltaTime });

      setDragging(null);
      setDragHint(null);
      dragStartRef.current = null;
      dragStartTimeRef.current = null;
    }
  }

  function handleNodeClick(id: string) {
    return (_e: React.MouseEvent) => {
      // if it was a drag, ignore click
      if (dragging) return;
      onNodeTap?.(id);
    };
  }

  function handleHandleDrag(i: number) {
    return (e: React.PointerEvent) => {
      if (readOnly || mode !== "sculpt" || !onCurveChange) return;
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      sculptMoveCountRef.current = 0;
      const move = (ev: PointerEvent) => {
        const svg = svgRef.current!;
        const pt = svg.createSVGPoint();
        pt.x = ev.clientX;
        pt.y = ev.clientY;
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const p = pt.matrixTransform(ctm.inverse());
        // Clamp within rails to avoid pathological loops
        const bb = svg.viewBox.baseVal;
        const x = Math.min(bb.width - PADDING, Math.max(PADDING, p.x));
        const y = Math.min(bb.height - PADDING, Math.max(PADDING, p.y));
        const next: CurveState = {
          ...props.curve,
          controls: props.curve.controls.map((v, idx) => (idx === i ? { x, y } : v)),
        };
        onCurveChange?.(next);
        sculptMoveCountRef.current += 1;
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        // Telemetry stub: sculpt change summary
        if (sculptMoveCountRef.current > 0) {
          // eslint-disable-next-line no-console
          console.log("telemetry: curvekit_sculpt_change", { handles_moved: 1, events: sculptMoveCountRef.current });
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  const viewBox = useMemo(() => {
    // derive from controls bounds with padding; fallback to 800x300
    const cs = curve.controls;
    if (!cs.length) return "0 0 800 300";
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    cs.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    const w = Math.max(800, maxX - minX + PADDING * 2);
    const h = Math.max(300, maxY - minY + PADDING * 2);
    return `${minX - PADDING} ${minY - PADDING} ${w} ${h}`;
  }, [curve.controls]);

  const easedStyle = prefersReduce ? {} : ({ transition: "transform 180ms ease-out" } as React.CSSProperties);

  // === Orientation landmarks (ticks, labels, now marker, wake/sleep anchors) ===
  const ticks = useMemo(() => {
    const arr: { t: number; x1: number; y1: number; x2: number; y2: number; label?: string }[] = [];
    for (let t = 0; t <= 86400; t += TICK_EVERY) {
      const p = pointAtTime(lut, t);
      const g = (t / 86400);
      const segIdx = Math.min(lut.segments.length - 1, Math.floor(g * lut.segments.length));
      const localT = Math.max(0.001, Math.min(0.999, g * lut.segments.length - segIdx));
      const n = cubicNormal(lut.segments[segIdx], localT);
      const len = (t % MAJOR_EVERY === 0) ? MAJOR_LEN : TICK_LEN;
      const x1 = p.x - n.x * len, y1 = p.y - n.y * len;
      const x2 = p.x + n.x * len, y2 = p.y + n.y * len;
      const label = (t % MAJOR_EVERY === 0) ? formatHM(t) : undefined;
      arr.push({ t, x1, y1, x2, y2, label });
    }
    return arr;
  }, [lut]);

  const nowPoint = useMemo(() => {
    const p = pointAtTime(lut, nowTime);
    const g = (nowTime / 86400);
    const segIdx = Math.min(lut.segments.length - 1, Math.floor(g * lut.segments.length));
    const localT = Math.max(0.001, Math.min(0.999, g * lut.segments.length - segIdx));
    const n = cubicNormal(lut.segments[segIdx], localT);
    return { p, n };
  }, [lut, nowTime]);

  const wakeSleepAnchors = useMemo(() => {
    const ws: { label: string; time: number }[] = [];
    for (const n of nodes) {
      const L = n.label.toLowerCase();
      if (L.includes('wake')) ws.push({ label: 'Wake', time: n.time });
      if (L.includes('sleep')) ws.push({ label: 'Sleep', time: n.time });
    }
    return ws;
  }, [nodes]);

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      className="w-full h-[320px] select-none bg-transparent"
      style={{ touchAction: "pan-y" }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Curve path */}
      <path d={pathD} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />

      {/* Arc-length ticks + labels (behind nodes) */}
      {ticks.map((tk) => (
        <g key={`tick-${tk.t}`}>
          <line x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2} className="stroke-gray-400/60" strokeWidth={1}/>
          {tk.label && (
            <text x={tk.x2 + (tk.x2 - tk.x1) * 0.4} y={tk.y2 + (tk.y2 - tk.y1) * 0.4}
                  className="fill-gray-500 text-[10px] select-none" textAnchor="start" dominantBaseline="middle">
              {tk.label}
            </text>
          )}
        </g>
      ))}

      {/* Wake/Sleep anchors (quiet markers) */}
      {wakeSleepAnchors.map(({ label, time }) => {
        const p = pointAtTime(lut, time);
        return (
          <g key={`ws-${label}`} transform={`translate(${p.x}, ${p.y})`}>
            <circle r={6} className="fill-transparent stroke-gray-500/70" strokeWidth={1.5}/>
            <text x={10} y={0} className="fill-gray-600 text-xs" dominantBaseline="middle">{label}</text>
          </g>
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const p = pointAtTime(lut, n.time);
        // expressive elastic nudge if dragging this id (does not affect time mapping)
        let dx = 0, dy = 0;
        if (!prefersReduce && dragging?.id === n.id && dragHint) {
          dx = (dragHint.x - p.x) * 0.06;
          dy = (dragHint.y - p.y) * 0.06;
        }
        return (
          <g
            key={n.id}
            transform={`translate(${p.x + dx}, ${p.y + dy})`}
            style={easedStyle}
            onPointerDown={handleNodePointerDown(n.id)}
            onClick={handleNodeClick(n.id)}
          >
            <circle r={NODE_R} className="fill-white stroke-current" strokeWidth={2} />
            <text y={5} textAnchor="middle" className="text-xs fill-current">
              {n.label}
            </text>
          </g>
        );
      })}

      {/* Now marker (on top) */}
      {(() => {
        const { p, n } = nowPoint;
        const len = MAJOR_LEN + 6;
        const x1 = p.x - n.x * len, y1 = p.y - n.y * len;
        const x2 = p.x + n.x * len, y2 = p.y + n.y * len;
        return (
          <g>
            <line x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-emerald-500" strokeWidth={2}/>
            <circle cx={p.x} cy={p.y} r={4} className="fill-emerald-500"/>
            <text x={x2 + 6} y={y2} className="fill-emerald-600 text-xs" dominantBaseline="middle">now</text>
          </g>
        );
      })()}

      {/* Sculpt handles */}
      {mode === "sculpt" &&
        props.curve.controls.map((c, i) => (
          <g key={`h-${i}`} transform={`translate(${c.x}, ${c.y})`}>
            <circle r={8} className="fill-cyan-500/80 cursor-grab" onPointerDown={handleHandleDrag(i)} />
          </g>
        ))}

      {/* Coachmark */}
      {coachmarkVisible && (
        <g transform={`translate(${typeof window !== 'undefined' ? 16 : 16}, ${typeof window !== 'undefined' ? 20 : 20})`}>
          <rect x={-8} y={-16} width={170} height={28} rx={6} className="fill-black/70" />
          <text x={0} y={0} className="text-xs fill-white">
            hold to sculpt • drag to reorder
          </text>
        </g>
      )}
    </svg>
  );
}

export default CurveKit;


