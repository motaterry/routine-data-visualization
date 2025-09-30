type Pt = { x: number; y: number };
type Cubic = { p0: Pt; p1: Pt; p2: Pt; p3: Pt };

/**
 * Calculate symmetric bezier arms for a node to ensure C1 continuity.
 * Both the incoming and outgoing arms share the same tangent (180° opposite).
 * This guarantees perfectly smooth curves with no kinks.
 */
export function calculateSymmetricArms(
  prev: Pt,
  curr: Pt, 
  next: Pt,
  softness = 0.4
): { incomingArm: Pt; outgoingArm: Pt } {
  // Calculate tangent through the node (prev → next)
  const tx = next.x - prev.x;
  const ty = next.y - prev.y;
  const tLen = Math.hypot(tx, ty) || 1;
  
  // Normalize tangent
  const nx = tx / tLen;
  const ny = ty / tLen;
  
  // Arm lengths proportional to distances on each side
  const distToPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
  const distToNext = Math.hypot(next.x - curr.x, next.y - curr.y);
  
  const incomingArmLength = distToPrev * softness;
  const outgoingArmLength = distToNext * softness;
  
  // Symmetric arms: point in opposite directions along same tangent
  const incomingArm = {
    x: curr.x - nx * incomingArmLength,  // Points back toward prev
    y: curr.y - ny * incomingArmLength
  };
  
  const outgoingArm = {
    x: curr.x + nx * outgoingArmLength,  // Points forward toward next
    y: curr.y + ny * outgoingArmLength
  };
  
  return { incomingArm, outgoingArm };
}

/**
 * Get cubic bezier segments from the smooth path.
 * Returns array of Cubic segments that match the visual curve.
 */
export function getSmoothSegments(points: Pt[], softness = 0.4): Cubic[] {
  if (points.length < 2) return [];
  
  const segments: Cubic[] = [];
  
  for (let i = 1; i < points.length; i++) {
    const curr = points[i];
    const prev = points[i - 1];
    
    if (i === 1) {
      // First segment
      if (i + 1 < points.length) {
        const next = points[i + 1];
        const { incomingArm } = calculateSymmetricArms(points[0], curr, next, softness);
        segments.push({
          p0: points[0],
          p1: points[0],
          p2: incomingArm,
          p3: curr
        });
      } else {
        segments.push({ p0: prev, p1: prev, p2: curr, p3: curr });
      }
    } else if (i === points.length - 1) {
      // Last segment
      const prevPrev = points[i - 2];
      const { outgoingArm } = calculateSymmetricArms(prevPrev, prev, curr, softness);
      segments.push({
        p0: prev,
        p1: outgoingArm,
        p2: curr,
        p3: curr
      });
    } else {
      // Middle segments
      const prevPrev = points[i - 2];
      const next = points[i + 1];
      
      const prevArms = calculateSymmetricArms(prevPrev, prev, curr, softness);
      const currArms = calculateSymmetricArms(prev, curr, next, softness);
      
      segments.push({
        p0: prev,
        p1: prevArms.outgoingArm,
        p2: currArms.incomingArm,
        p3: curr
      });
    }
  }
  
  return segments;
}

/**
 * Build smooth path with symmetric tangent-aligned arms.
 * Each node has arms that point 180° apart, ensuring smooth C1 continuity.
 */
export function toSmoothCPath(points: Pt[], softness = 0.4): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }
  
  let d = `M ${points[0].x} ${points[0].y}`;
  
  for (let i = 1; i < points.length; i++) {
    const curr = points[i];
    const prev = points[i - 1];
    
    if (i === 1) {
      // First segment: only have outgoing arm from first node
      if (i + 1 < points.length) {
        const next = points[i + 1];
        const { incomingArm } = calculateSymmetricArms(points[0], curr, next, softness);
        d += ` C ${points[0].x} ${points[0].y}, ${incomingArm.x} ${incomingArm.y}, ${curr.x} ${curr.y}`;
      } else {
        d += ` L ${curr.x} ${curr.y}`;
      }
    } else if (i === points.length - 1) {
      // Last segment: only have incoming arm to last node
      const prevPrev = points[i - 2];
      const { outgoingArm } = calculateSymmetricArms(prevPrev, prev, curr, softness);
      d += ` C ${outgoingArm.x} ${outgoingArm.y}, ${curr.x} ${curr.y}, ${curr.x} ${curr.y}`;
    } else {
      // Middle segments: use symmetric arms
      const prevPrev = points[i - 2];
      const next = points[i + 1];
      
      const prevArms = calculateSymmetricArms(prevPrev, prev, curr, softness);
      const currArms = calculateSymmetricArms(prev, curr, next, softness);
      
      // Cubic bezier: prev → prev.outgoingArm, curr.incomingArm → curr
      d += ` C ${prevArms.outgoingArm.x} ${prevArms.outgoingArm.y}, ${currArms.incomingArm.x} ${currArms.incomingArm.y}, ${curr.x} ${curr.y}`;
    }
  }
  
  return d;
}
