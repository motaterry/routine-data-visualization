type Pt = { x: number; y: number };

/**
 * Calculate bezier arm (control point) for smooth quadratic curves.
 * The arm extends from 'prev' node along the tangent defined by prevPrev → curr.
 * Arm length is proportional to distance between prev and curr.
 */
export function calculateBezierArm(prevPrev: Pt, prev: Pt, curr: Pt, softness = 0.5): Pt {
  // Tangent vector from prevPrev through to curr
  const tx = curr.x - prevPrev.x;
  const ty = curr.y - prevPrev.y;
  const tLen = Math.hypot(tx, ty) || 1;

  // Distance between prev and curr determines arm length
  const segLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
  
  // Arm grows proportionally with distance - closer nodes = shorter arms
  const armLength = segLen * softness;

  const nx = (tx / tLen) * armLength;
  const ny = (ty / tLen) * armLength;

  return { x: prev.x + nx, y: prev.y + ny };
}

/**
 * Build smooth path using tangent-aligned bezier arms.
 * Arm length adapts to node spacing for consistent smoothness.
 */
export function toSmoothQPath(points: Pt[], softness = 0.5): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const curr = points[i];
    const prev = points[i - 1];
    if (i === 1) {
      // First segment: simple midpoint arm
      const arm = { x: (prev.x + curr.x) / 2, y: (prev.y + curr.y) / 2 };
      d += ` Q ${arm.x} ${arm.y}, ${curr.x} ${curr.y}`;
    } else {
      const prevPrev = points[i - 2];
      const arm = calculateBezierArm(prevPrev, prev, curr, softness);
      d += ` Q ${arm.x} ${arm.y}, ${curr.x} ${curr.y}`;
    }
  }
  return d;
}
