import React, { useMemo, useRef, useState, useEffect } from "react";
import type { CurveKitProps, Vec2, CurveState } from "../lib/types";
import { buildParamLUT, pointAtTime, timeAtPoint } from "../lib/geometry/ParamMap";

const PADDING = 24; // clamp rails for sculpt
const NODE_R = 20;  // 40px touch target

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

export function CurveKit(props: CurveKitProps): React.ReactElement {
  const { curve, nodes, onCurveChange, onNodeChange, onNodeTap, mode = "view", readOnly } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const prefersReduce = usePrefersReducedMotion();

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
      setDragging(null);
      setDragHint(null);
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
      (e.target as Element).setPointerCapture(e.pointerId);
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
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
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

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      className="w-full h-[320px] touch-pan-y select-none bg-transparent"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Curve path */}
      <path d={pathD} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />

      {/* Arc-length ticks (debug overlay) */}
      {lut.pt.map((p, i) => (i % 20 === 0 ? <circle key={`tick-${i}`} cx={p.x} cy={p.y} r={1.5} className="fill-gray-400/60" /> : null))}

      {/* Nodes */}
      {nodes.map((n) => {
        const p = pointAtTime(lut, n.time);
        // expressive elastic nudge if dragging this id (does not affect time mapping)
        let dx = 0,
          dy = 0;
        if (dragging?.id === n.id && dragHint) {
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

      {/* Sculpt handles */}
      {mode === "sculpt" &&
        props.curve.controls.map((c, i) => (
          <g key={`h-${i}`} transform={`translate(${c.x}, ${c.y})`}>
            <circle r={8} className="fill-cyan-500/80 cursor-grab" onPointerDown={handleHandleDrag(i)} />
          </g>
        ))}
    </svg>
  );
}

export default CurveKit;


