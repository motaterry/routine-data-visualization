type Pt = { x: number; y: number };

export function quadControl(prevPrev: Pt, prev: Pt, curr: Pt, softness = 0.4, maxPx = 50): Pt {
  const tx = curr.x - prevPrev.x;
  const ty = curr.y - prevPrev.y;
  const tLen = Math.hypot(tx, ty) || 1;

  // Use the actual distance between prev and curr for handle scaling
  const segLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
  
  // Handle grows with distance - no hard cap, just scale by softness
  // This makes distant nodes have longer, flowing handles
  const scale = segLen * softness;

  const nx = (tx / tLen) * scale;
  const ny = (ty / tLen) * scale;

  return { x: prev.x + nx, y: prev.y + ny };
}

export function toSmoothQPath(points: Pt[], softness = 0.5): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const curr = points[i];
    const prev = points[i - 1];
    if (i === 1) {
      // First segment: use simple control point between prev and curr
      const cp = { x: (prev.x + curr.x) / 2, y: (prev.y + curr.y) / 2 };
      d += ` Q ${cp.x} ${cp.y}, ${curr.x} ${curr.y}`;
    } else {
      const prevPrev = points[i - 2];
      const cp = quadControl(prevPrev, prev, curr, softness);
      d += ` Q ${cp.x} ${cp.y}, ${curr.x} ${curr.y}`;
    }
  }
  return d;
}
