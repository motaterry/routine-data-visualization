import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import type { CurveKitProps, Vec2, CurveState } from "../lib/types";
import { buildParamLUT, pointAtTime, timeAtPoint } from "../lib/geometry/ParamMap";
import { cubicNormal } from "../lib/geometry/Bezier";

const PADDING = 24; // clamp rails for sculpt
const NODE_R = 30;  // 60px touch target for mobile
const TICK_EVERY = 2 * 3600;   // 2h
const MAJOR_EVERY = 6 * 3600;  // 6h labels
const TICK_LEN = 8;            // px half-length (minor) - larger for mobile
const MAJOR_LEN = 12;          // px half-length (major) - larger for mobile

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

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => {
      // More comprehensive mobile detection
      const width = window.innerWidth;
      const height = window.innerHeight;
      const isPortrait = height > width;
      const isSmallScreen = width < 768 || height < 600;
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      
      setIsMobile(isSmallScreen || (isPortrait && isTouchDevice));
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    window.addEventListener('orientationchange', checkMobile);
    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('orientationchange', checkMobile);
    };
  }, []);
  return isMobile;
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
  const isMobile = useIsMobile();
  const isMobileRef = useRef(isMobile);
  useEffect(() => { isMobileRef.current = isMobile; }, [isMobile]);
  const sculptMoveCountRef = useRef<number>(0);

  // --- Tier-0 buttery drag: imperative controller refs ---
  const nodeRefs = useRef<Record<string, SVGGElement | null>>({});
  const lastTimeById = useRef<Map<string, number>>(new Map());

  type DragState = {
    id: string | null;
    pointerId: number | null;
    raf: number | null;
    pendingClientXY: { x: number; y: number } | null;
    lastEmitTs: number; // throttle onNodeChange to ~60Hz
    basePos: { x: number; y: number } | null; // base SVG position at drag start
  };
  const drag = useRef<DragState>({
    id: null,
    pointerId: null,
    raf: null,
    pendingClientXY: null,
    lastEmitTs: 0,
    basePos: null,
  });

  // map client → svg coords
  const clientToSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const sp = pt.matrixTransform(ctm.inverse());
    return { x: sp.x, y: sp.y };
  }, []);

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

  // Create mobile-optimized vertical curve
  const mobileCurve = useMemo(() => {
    if (!isMobile) return curve;
    
    // For mobile, create a vertical S-curve that spans the full height
    const verticalControls = [
      { x: 150, y: 50 },   // top
      { x: 100, y: 200 },  // left curve
      { x: 200, y: 400 },  // right curve  
      { x: 150, y: 550 },  // bottom
    ];
    
    return {
      ...curve,
      controls: verticalControls
    };
  }, [curve, isMobile]);

  const activeCurve = isMobile ? mobileCurve : curve;
  const lut = useMemo(() => buildParamLUT(activeCurve), [activeCurve]);

  const pathD = useMemo(() => {
    return lut.segments
      .map((c, i) =>
        `${i === 0 ? `M ${c.p0.x},${c.p0.y}` : ""} C ${c.p1.x},${c.p1.y} ${c.p2.x},${c.p2.y} ${c.p3.x},${c.p3.y}`
      )
      .join(" ");
  }, [lut]);

  const [nowTime, setNowTime] = useState<number>(() => nowSec());
  const [debugInfo, setDebugInfo] = useState<string>('');
  useEffect(() => {
    // light refresh of the now marker every 30s (0 animations if reduced motion)
    const id = setInterval(() => setNowTime(nowSec()), 30_000);
    return () => clearInterval(id);
  }, []);

  const frame = useCallback(() => {
    const s = drag.current;
    if (!s.id || !s.pendingClientXY) { s.raf = null; return; }

    const { x, y } = s.pendingClientXY;
    const svgP = clientToSvg(x, y);
    console.log('🎬 FRAME running for node:', s.id, 'svgP:', svgP);
    if (svgP) {
      // Always use curve-constrained movement for now (simpler)
      const tSec = timeAtPoint(lut, svgP);
      const pos = pointAtTime(lut, tSec);
      const base = drag.current.basePos ?? pos;
      
      const el = nodeRefs.current[s.id];
      if (el) {
        const dx = pos.x - base.x;
        const dy = pos.y - base.y;
        setDebugInfo(`DRAG: node=${s.id} dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} pos=(${pos.x.toFixed(1)},${pos.y.toFixed(1)})`);
        el.style.transform = `translate(${dx}px, ${dy}px) scale(1.2)`;
        el.style.willChange = 'transform';
        el.style.opacity = '0.8';
        lastTimeById.current.set(s.id, tSec);
      } else {
        setDebugInfo(`ERROR: No element for node ${s.id}`);
      }

      // throttle onNodeChange to ~60Hz
      if (onNodeChange) {
        const now = performance.now();
        if (now - s.lastEmitTs >= 16) {
          onNodeChange(s.id, tSec);
          s.lastEmitTs = now;
        }
      }
    }

    s.raf = requestAnimationFrame(frame);
  }, [clientToSvg, lut, onNodeChange]);

  const onMove = useCallback((e: PointerEvent) => {
    const s = drag.current;
    if (s.pointerId !== e.pointerId) return;
    console.log('🚀 MOVE event for node:', s.id, 'at', e.clientX, e.clientY);
    s.pendingClientXY = { x: e.clientX, y: e.clientY };
    if (!s.raf) {
      console.log('Starting rAF for node:', s.id);
      s.raf = requestAnimationFrame(frame);
    }
  }, [frame]);

  const onUp = useCallback((e: PointerEvent) => {
    const s = drag.current;
    if (s.pointerId !== e.pointerId) return;

    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = null; }

    // final commit (one last canonical time)
    if (s.id) {
      const tFinal = lastTimeById.current.get(s.id);
      if (tFinal != null && onNodeChange) {
        onNodeChange(s.id, tFinal);
      }
      const el = nodeRefs.current[s.id];
      if (el) {
        el.style.transform = ''; // clear delta CSS transform
        el.style.opacity = ''; // restore opacity
      }
    }

    // cleanup listeners + touch-action
    const svg = svgRef.current;
    if (svg) svg.style.touchAction = isMobileRef.current ? 'none' : 'pan-y';
    s.basePos = null;

    document.removeEventListener('pointermove', onMove as any);
    document.removeEventListener('pointerup', onUp as any);
    document.removeEventListener('pointercancel', onUp as any);
    // optional high-frequency input path
    (document as any).removeEventListener?.('pointerrawupdate', onMove as any);

    // reset
    drag.current = { id: null, pointerId: null, raf: null, pendingClientXY: null, lastEmitTs: 0, basePos: null };
  }, [onMove, onNodeChange]);

  function handleNodeClick(id: string) {
    return (_e: React.MouseEvent) => {
      // if it was a drag, ignore click
      if (drag.current.id) return; // If currently dragging, ignore click
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
        
        let next: CurveState;
        if (isMobile) {
          // For mobile, we need to rotate back to original coordinates
          const originalControl = { x: 400 - y, y: x };
          next = {
            ...curve,
            controls: curve.controls.map((v, idx) => (idx === i ? originalControl : v)),
          };
        } else {
          next = {
            ...curve,
            controls: curve.controls.map((v, idx) => (idx === i ? { x, y } : v)),
          };
        }
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
    const cs = activeCurve.controls;
    if (!cs.length) return isMobile ? "0 0 300 600" : "0 0 800 300";
    
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
    
    // Dynamic sizing based on viewport
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 800;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 600;
    
    if (isMobile) {
      // Mobile: use viewport dimensions with padding
      const w = Math.max(300, Math.min(400, viewportWidth - 40));
      const h = Math.max(500, Math.min(800, viewportHeight - 100));
      return `${minX - PADDING} ${minY - PADDING} ${w} ${h}`;
    } else {
      const w = Math.max(800, maxX - minX + PADDING * 2);
      const h = Math.max(300, maxY - minY + PADDING * 2);
      return `${minX - PADDING} ${minY - PADDING} ${w} ${h}`;
    }
  }, [activeCurve.controls, isMobile]);

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
    <div 
      className={`w-full overflow-hidden`}
      style={{
        // Ensure proper mobile viewport handling
        position: isMobile ? 'fixed' : 'relative',
        top: isMobile ? 0 : undefined,
        left: isMobile ? 0 : undefined,
        right: isMobile ? 0 : undefined,
        bottom: isMobile ? 0 : undefined,
        width: isMobile ? '100vw' : '100%',
        height: isMobile ? '100vh' : undefined,
        minHeight: isMobile ? '100vh' : '50vh',
        maxHeight: isMobile ? '100vh' : '80vh',
        zIndex: isMobile ? 10 : undefined,
      }}
    >
      <svg
        ref={svgRef}
        viewBox={viewBox}
        className="w-full h-full select-none bg-transparent"
        style={{ 
          touchAction: isMobile ? "none" : "pan-y",
          // Ensure SVG fills container properly on all mobile browsers
          minHeight: isMobile ? '100%' : undefined,
          maxHeight: isMobile ? '100%' : undefined,
        }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Curve path */}
        <path d={pathD} fill="none" stroke="currentColor" strokeWidth={isMobile ? 4 : 3} strokeLinecap="round" />

        {/* Arc-length ticks + labels (behind nodes) */}
        {ticks.map((tk) => (
          <g key={`tick-${tk.t}`}>
            <line x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2} className="stroke-gray-400/60" strokeWidth={isMobile ? 2 : 1}/>
            {tk.label && (
              <text x={tk.x2 + (tk.x2 - tk.x1) * 0.4} y={tk.y2 + (tk.y2 - tk.y1) * 0.4}
                    className={`fill-gray-500 select-none ${isMobile ? 'text-sm' : 'text-[10px]'}`} textAnchor="start" dominantBaseline="middle">
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
              <circle r={isMobile ? 8 : 6} className="fill-transparent stroke-gray-500/70" strokeWidth={isMobile ? 2 : 1.5}/>
              <text x={isMobile ? 12 : 10} y={0} className={`fill-gray-600 ${isMobile ? 'text-sm' : 'text-xs'}`} dominantBaseline="middle">{label}</text>
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((n) => {
          const p = pointAtTime(lut, n.time);
          return (
            <g
              key={n.id}
              ref={el => { nodeRefs.current[n.id] = el; }}
              transform={`translate(${p.x}, ${p.y})`}
              style={{ transformBox: 'fill-box', transformOrigin: 'center', willChange: 'transform' }}
              onTouchStart={(e) => {
                e.preventDefault();
                if (readOnly || mode !== 'view') {
                  setDebugInfo(`BLOCKED: mode=${mode}`);
                  return;
                }
                
                const touch = e.touches[0];
                const s = drag.current;
                s.id = n.id;
                s.pointerId = touch.identifier;
                s.pendingClientXY = { x: touch.clientX, y: touch.clientY };
                s.lastEmitTs = 0;
                s.basePos = pointAtTime(lut, n.time);
                
                setDebugInfo(`START: node=${n.id} touch=(${touch.clientX},${touch.clientY})`);
                
                // Visual feedback
                const el = nodeRefs.current[s.id];
                if (el) {
                  el.style.transform = 'scale(1.3)';
                  el.style.opacity = '0.7';
                }
                
                if (!s.raf) s.raf = requestAnimationFrame(frame);
              }}
              onTouchMove={(e) => {
                e.preventDefault();
                const s = drag.current;
                if (!s.id) return;
                
                const touch = Array.from(e.touches).find(t => t.identifier === s.pointerId);
                if (!touch) return;
                
                s.pendingClientXY = { x: touch.clientX, y: touch.clientY };
                if (!s.raf) s.raf = requestAnimationFrame(frame);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                const s = drag.current;
                if (!s.id) return;
                
                if (s.raf) {
                  cancelAnimationFrame(s.raf);
                  s.raf = null;
                }
                
                const el = nodeRefs.current[s.id];
                if (el) {
                  el.style.transform = '';
                  el.style.opacity = '';
                }
                
                const tFinal = lastTimeById.current.get(s.id);
                if (tFinal != null && onNodeChange) {
                  onNodeChange(s.id, tFinal);
                }
                
                drag.current = { id: null, pointerId: null, raf: null, pendingClientXY: null, lastEmitTs: 0, basePos: null };
              }}
            >
              {/* Larger touch target for mobile - with visual feedback */}
              <circle r={isMobile ? 40 : NODE_R} className="fill-transparent" style={{ cursor: 'grab' }} />
              <circle r={NODE_R} className="fill-white stroke-current" strokeWidth={isMobile ? 3 : 2} style={{ 
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
                cursor: 'grab'
              }} />
              <text y={isMobile ? 8 : 5} textAnchor="middle" className={`fill-current ${isMobile ? 'text-sm font-medium' : 'text-xs'}`} style={{ pointerEvents: 'none' }}>{n.label}</text>
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
              <line x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-emerald-500" strokeWidth={isMobile ? 3 : 2}/>
              <circle cx={p.x} cy={p.y} r={isMobile ? 6 : 4} className="fill-emerald-500"/>
              <text x={x2 + (isMobile ? 8 : 6)} y={y2} className={`fill-emerald-600 ${isMobile ? 'text-sm font-medium' : 'text-xs'}`} dominantBaseline="middle">now</text>
            </g>
          );
        })()}

        {/* Sculpt handles */}
        {mode === "sculpt" &&
          activeCurve.controls.map((c, i) => (
            <g key={`h-${i}`} transform={`translate(${c.x}, ${c.y})`}>
              <circle r={isMobile ? 12 : 8} className="fill-cyan-500/80 cursor-grab" onPointerDown={handleHandleDrag(i)} />
            </g>
          ))}

        {/* Debug Info */}
        {debugInfo && (
          <g transform="translate(20, 30)">
            <rect x={-10} y={-20} width={350} height={30} rx={4} className="fill-black/80" />
            <text x={0} y={0} className="fill-green-400 text-xs font-mono">
              {debugInfo}
            </text>
          </g>
        )}

        {/* Coachmark */}
        {coachmarkVisible && !debugInfo && (
          <g transform={`translate(${typeof window !== 'undefined' ? 16 : 16}, ${typeof window !== 'undefined' ? 20 : 20})`}>
            <rect x={-8} y={-16} width={isMobile ? 200 : 170} height={isMobile ? 32 : 28} rx={6} className="fill-black/70" />
            <text x={0} y={0} className={`fill-white ${isMobile ? 'text-sm' : 'text-xs'}`}>
              {isMobile ? 'drag anywhere • tap to edit' : 'hold to sculpt • drag to reorder'}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

export default CurveKit;