import type { Vec2, Cubic } from "../types";

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);

export function cubicPoint(c: Cubic, t: number): Vec2 {
  // De Casteljau (explicit blend)
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  const p = { x: 0, y: 0 } as Vec2;
  p.x = uuu * c.p0.x + 3 * uu * t * c.p1.x + 3 * u * tt * c.p2.x + ttt * c.p3.x;
  p.y = uuu * c.p0.y + 3 * uu * t * c.p1.y + 3 * u * tt * c.p2.y + ttt * c.p3.y;
  return p;
}

export function cubicDerivative(c: Cubic, t: number): Vec2 {
  const u = 1 - t;
  const a = mul(sub(c.p1, c.p0), 3 * u * u);
  const b = mul(sub(c.p2, c.p1), 6 * u * t);
  const d = mul(sub(c.p3, c.p2), 3 * t * t);
  return add(add(a, b), d);
}

export function cubicNormal(c: Cubic, t: number): Vec2 {
  const d = cubicDerivative(c, t);
  const n = { x: -d.y, y: d.x };
  const L = len(n) || 1;
  return { x: n.x / L, y: n.y / L };
}

export function polylineLength(pts: Vec2[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
  return L;
}

/**
 * Sample a cubic adaptively into a polyline with error control.
 * maxSeg controls upper bound; maxErrPx controls flatness error (corner test).
 */
export function sampleCubic(c: Cubic, maxErrPx = 0.75, maxSeg = 64): { t: number[]; pt: Vec2[] } {
  const ts: number[] = [0];
  const ps: Vec2[] = [c.p0];

  function recurse(t0: number, p0: Vec2, t1: number, p1: Vec2, depth: number) {
    if (ts.length > maxSeg) return; // safety
    const tm = 0.5 * (t0 + t1);
    const pm = cubicPoint(c, tm);
    // Distance from mid to chord
    const cx = (p0.x + p1.x) * 0.5;
    const cy = (p0.y + p1.y) * 0.5;
    const err = Math.hypot(pm.x - cx, pm.y - cy);
    if (err > maxErrPx && depth < 12) {
      recurse(t0, p0, tm, pm, depth + 1);
      recurse(tm, pm, t1, p1, depth + 1);
    } else {
      ts.push(t1);
      ps.push(p1);
    }
  }

  recurse(0, c.p0, 1, c.p3, 0);
  return { t: ts, pt: ps };
}

export function buildLUT(segments: Cubic[], maxErrPx = 0.75): { t: number[]; pt: Vec2[]; segIndex: number[] } {
  const T: number[] = []; const P: Vec2[] = []; const SI: number[] = [];
  const segCount = segments.length;
  for (let i = 0; i < segCount; i++) {
    const seg = segments[i];
    const { t, pt } = sampleCubic(seg, maxErrPx);
    const base = T.length; // where this segment starts in global arrays
    for (let k = 0; k < t.length; k++) {
      const g = (i + t[k]) / segCount; // global t in [0,1]
      // Avoid duplicating the very first point for i>0
      if (i > 0 && k === 0) continue;
      T.push(g);
      P.push(pt[k]);
      SI.push(i);
    }
  }
  return { t: T, pt: P, segIndex: SI };
}

export function accumulateLengths(pts: Vec2[]): number[] {
  const S: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
    S.push(S[i - 1] + d);
  }
  return S;
}

/** Project a point onto one cubic: coarse sample + 1–2 Newton steps; robustly clamped. */
export function projectPointToCubic(c: Cubic, p: Vec2, coarseSteps = 25): { t: number; pt: Vec2; dist2: number } {
  // coarse search
  let bestT = 0; let bestPt = c.p0; let bestD2 = (bestPt.x - p.x) ** 2 + (bestPt.y - p.y) ** 2;
  for (let i = 1; i <= coarseSteps; i++) {
    const t = i / coarseSteps;
    const q = cubicPoint(c, t);
    const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d2 < bestD2) { bestD2 = d2; bestT = t; bestPt = q; }
  }
  // refine with Newton (Clamp each iteration)
  for (let iter = 0; iter < 2; iter++) {
    const q = cubicPoint(c, bestT);
    const dq = cubicDerivative(c, bestT);
    // minimize f(t) = |q(t)-p|^2 ; f' = 2 dq·(q - p)
    const grad = 2 * (dq.x * (q.x - p.x) + dq.y * (q.y - p.y));
    const d2q = secondDerivative(c, bestT);
    const hess = 2 * (d2q.x * (q.x - p.x) + d2q.y * (q.y - p.y) + dq.x * dq.x + dq.y * dq.y);
    if (Math.abs(hess) < 1e-6) break;
    let tNext = bestT - grad / hess;
    if (!Number.isFinite(tNext)) break;
    bestT = Math.min(1, Math.max(0, tNext));
  }
  bestPt = cubicPoint(c, bestT);
  bestD2 = (bestPt.x - p.x) ** 2 + (bestPt.y - p.y) ** 2;
  return { t: bestT, pt: bestPt, dist2: bestD2 };
}

function secondDerivative(c: Cubic, t: number): Vec2 {
  const u = 1 - t;
  const a = mul(sub(c.p2, mul(c.p1, 2)), 6 * u);
  const b = mul(add(c.p3, add(mul(c.p1, 2), mul(c.p2, -3))), 6 * t); // 6*(p3 -3p2 +2p1)
  return add(a, b);
}


