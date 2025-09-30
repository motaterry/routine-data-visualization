import type { CurveControlPoint, CurveState, Vec2, Cubic, LUT, TimeSec } from "../types";
import { add, mul, sub, cubicPoint } from "./Bezier";
import { buildLUT, accumulateLengths, projectPointToCubic } from "./Bezier";

/** Convert anchor controls to cubic segments via adaptive Catmull–Rom → Bézier. */
export function controlsToSegments(controls: CurveControlPoint[], tension: number): Cubic[] {
  const pts = controls.map(p => ({ x: p.x, y: p.y }));
  if (pts.length < 2) return [];
  // Duplicate endpoints for boundary conditions
  const P: Vec2[] = [pts[0], ...pts, pts[pts.length - 1]];
  // Cap tension to keep curves tame
  const tight = clampRange(tension, 0.15, 0.85);
  const segs: Cubic[] = [];
  
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P[i];
    const p1 = P[i + 1];
    const p2 = P[i + 2];
    const p3 = P[i + 3];
    const b0 = p1;
    const b3 = p2;
    
    // Adaptive tension based on segment distance and angle
    const d1 = Math.hypot(p2.x - p1.x, p2.y - p1.y); // Current segment length
    const d0 = Math.hypot(p1.x - p0.x, p1.y - p0.y); // Previous segment
    const d2 = Math.hypot(p3.x - p2.x, p3.y - p2.y); // Next segment
    
    // Calculate angle change at each endpoint
    const v01 = { x: p1.x - p0.x, y: p1.y - p0.y };
    const v12 = { x: p2.x - p1.x, y: p2.y - p1.y };
    const v23 = { x: p3.x - p2.x, y: p3.y - p2.y };
    
    // Normalize vectors
    const len01 = Math.hypot(v01.x, v01.y) || 1;
    const len12 = Math.hypot(v12.x, v12.y) || 1;
    const len23 = Math.hypot(v23.x, v23.y) || 1;
    
    const n01 = { x: v01.x / len01, y: v01.y / len01 };
    const n12 = { x: v12.x / len12, y: v12.y / len12 };
    const n23 = { x: v23.x / len23, y: v23.y / len23 };
    
    // Dot products to measure smoothness
    const dot1 = n01.x * n12.x + n01.y * n12.y; // -1 to 1
    const dot2 = n12.x * n23.x + n12.y * n23.y;
    
    // Adaptive strength: tighter on sharp turns, looser on smooth curves
    const sharpness1 = 1 - Math.abs(dot1); // 0 = smooth, 1 = sharp turn
    const sharpness2 = 1 - Math.abs(dot2);
    
    // Scale handle length based on segment length and smoothness
    // Increased multipliers for smoother, more flowing curves
    const scale1 = (0.4 + 0.6 * (1 - sharpness1)); // Range: 0.4 to 1.0
    const scale2 = (0.4 + 0.6 * (1 - sharpness2));
    
    const s = (1 - clamp01(tight)) / 6;
    const b1 = add(p1, mul(sub(p2, p0), s * scale1));
    const b2 = sub(p2, mul(sub(p3, p1), s * scale2));
    
    segs.push({ p0: b0, p1: b1, p2: b2, p3: b3 });
  }
  return segs;
}

export function clamp01(x: number) { return Math.min(1, Math.max(0, x)); }

function clampRange(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

/** Build a global LUT for arc-length mapping over the whole path. */
export function buildParamLUT(curve: CurveState): LUT {
  const segments = controlsToSegments(curve.controls, curve.tension);
  const lutBase = buildLUT(segments, 0.75);
  const s = accumulateLengths(lutBase.pt);
  return { ...lutBase, s, length: s[s.length - 1], segments } as LUT;
}

/** Map time (0..86400) to a point on the curve using arc-length. */
export function pointAtTime(lut: LUT, time: TimeSec): Vec2 {
  const tt = clamp01(time / 86400);
  const targetS = tt * lut.length;
  const idx = lowerBound(lut.s, targetS);
  if (idx <= 0) return lut.pt[0];
  if (idx >= lut.s.length) return lut.pt[lut.s.length - 1];
  const s0 = lut.s[idx - 1], s1 = lut.s[idx];
  const t0 = lut.t[idx - 1], t1 = lut.t[idx];
  const w = (targetS - s0) / Math.max(1e-6, (s1 - s0));
  const g = t0 + w * (t1 - t0);
  // evaluate exactly, not via sampled pt, to reduce bias
  const segIdx = Math.min(lut.segments.length - 1, Math.floor(g * lut.segments.length));
  const localT = g * lut.segments.length - segIdx;
  return cubicPoint(lut.segments[segIdx], clamp01(localT));
}

/** Inverse: nearest curve point to screen-space p → approximate time. */
export function timeAtPoint(lut: LUT, p: Vec2): TimeSec {
  // coarse search on LUT, then refine in the matched segment
  let best = 0; let bestD2 = Infinity; let bestSeg = 0; let bestLocalT = 0;
  for (let i = 0; i < lut.pt.length; i++) {
    const d2 = (lut.pt[i].x - p.x) ** 2 + (lut.pt[i].y - p.y) ** 2;
    if (d2 < bestD2) { bestD2 = d2; best = i; bestSeg = lut.segIndex[i]; }
  }
  // refine in its segment
  const seg = lut.segments[bestSeg];
  const { t, pt } = projectPointToCubic(seg, p, 25);
  bestLocalT = t;

  // convert segment-local t to global t
  const globalT = (bestSeg + bestLocalT) / lut.segments.length;

  // map globalT → arc-length s via LUT linearization (for consistency with forward mapping)
  // locate nearest bracketing indices around gT
  let j = 0;
  while (j < lut.t.length - 1 && lut.t[j + 1] < globalT) j++;
  const j1 = Math.min(lut.t.length - 1, j + 1);
  const w = (globalT - lut.t[j]) / Math.max(1e-6, (lut.t[j1] - lut.t[j]));
  const s = lut.s[j] + w * (lut.s[j1] - lut.s[j]);
  const frac = s / Math.max(1e-6, lut.length);
  return clamp01(frac) * 86400;
}

function lowerBound(arr: number[], x: number) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}


