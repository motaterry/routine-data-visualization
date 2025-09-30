# CurveKit — minimal scaffold

This is a drop-in scaffold to implement your spec exactly as written: serpentine SVG path, nodes bound to **time** via arc‑length, sculpt mode with 4 anchors → cubic Bézier segments (Catmull‑Rom → Bézier), nearest‑point solver for drag, deterministic serialization, and a tiny `/playground`.

> Files are separated by headings. Copy them into a new **Next.js + TypeScript + Tailwind** project. Run `pnpm dlx create-next-app@latest curvekit --ts --tailwind --eslint --src-dir --app false`, then add these files.

---

## `src/lib/types.ts`

```ts
export type TimeSec = number; // 0..86400
export type NodeId = string;

export type CurveControlPoint = { x: number; y: number };
export type CurveState = {
  controls: CurveControlPoint[];   // 4+ anchors for Catmull-Rom; start with 4
  tension: number;                 // 0..1 (0 = loose/smooth, 1 = tight)
};

export type NodeModel = {
  id: NodeId;
  time: TimeSec;                   // canonical time (seconds in day)
  label: string;
  icon: string;                    // token name or URL (host renders)
  color: string;                   // CSS token or hex
};

export type CurveKitProps = {
  curve: CurveState;
  nodes: NodeModel[];
  onCurveChange?: (next: CurveState) => void;   // fired while sculpting
  onNodeChange?: (id: NodeId, nextTime: TimeSec) => void; // drag along path
  onNodeTap?: (id: NodeId) => void;             // host handles editor
  mode?: 'view' | 'sculpt' | 'plan';            // sculpt toggles handles
  readOnly?: boolean;
};

export type Vec2 = { x: number; y: number };

export type Cubic = { p0: Vec2; p1: Vec2; p2: Vec2; p3: Vec2 };

export type LUT = {
  // Global lookup over all segments
  // arrays aligned by index: [0..N]
  t: number[];       // global t in [0,1]
  s: number[];       // cumulative arc length in px, [0..L]
  segIndex: number[];// which segment covers this sample
  pt: Vec2[];        // sampled points
  length: number;    // total length (px)
  segments: Cubic[]; // the cubic segments used
};
```

---

## `src/lib/geometry/Bezier.ts`

```ts
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
```

---

## `src/lib/geometry/ParamMap.ts`

```ts
import type { CurveControlPoint, CurveState, Vec2, Cubic, LUT, TimeSec } from "../types";
import { add, mul, sub, cubicPoint } from "./Bezier";
import { buildLUT, accumulateLengths, projectPointToCubic } from "./Bezier";

/** Convert anchor controls to cubic segments via Catmull–Rom → Bézier. */
export function controlsToSegments(controls: CurveControlPoint[], tension: number): Cubic[] {
  const pts = controls.map(p => ({ x: p.x, y: p.y }));
  if (pts.length < 2) return [];
  // Duplicate endpoints for boundary conditions
  const P: Vec2[] = [pts[0], ...pts, pts[pts.length - 1]];
  const s = (1 - clamp01(tension)) / 6; // 0..1 → 1/6..0
  const segs: Cubic[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P[i];
    const p1 = P[i + 1];
    const p2 = P[i + 2];
    const p3 = P[i + 3];
    const b0 = p1;
    const b3 = p2;
    const b1 = add(p1, mul(sub(p2, p0), s));
    const b2 = sub(p2, mul(sub(p3, p1), s));
    segs.push({ p0: b0, p1: b1, p2: b2, p3: b3 });
  }
  return segs;
}

export function clamp01(x: number) { return Math.min(1, Math.max(0, x)); }

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
```

---

## `src/components/CurveKit.tsx`

```tsx
import React, { useMemo, useRef, useState } from "react";
```
