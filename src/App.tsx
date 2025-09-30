import React, { useEffect, useState } from 'react'
import CurveKit from './components/CurveKit'
import type { CurveState, NodeModel } from './lib/types'
import { buildParamLUT, pointAtTime, timeAtPoint } from './lib/geometry/ParamMap'

// Nodes ARE the curve control points!
const initialNodes: NodeModel[] = [
  { id: 'wake', time: 21600, label: 'Wake', icon: 'sun', color: '#f59e0b' },      // 6am
  { id: 'work', time: 32400, label: 'Work', icon: 'briefcase', color: '#3b82f6' }, // 9am
  { id: 'lunch', time: 46800, label: 'Lunch', icon: 'utensils', color: '#10b981' }, // 1pm
  { id: 'sleep', time: 79200, label: 'Sleep', icon: 'moon', color: '#8b5cf6' },   // 10pm
]

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  return isMobile;
}

export default function App() {
  const [nodes, setNodes] = useState<NodeModel[]>(() => {
    try {
      const raw = localStorage.getItem('ck_nodes')
      if (raw) return JSON.parse(raw) as NodeModel[]
    } catch {}
    return initialNodes
  })
  
  // Node positions define the curve!
  const [nodePositions, setNodePositions] = React.useState<Record<string, { x: number; y: number }>>(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    nodes.forEach((n, i) => {
      const y = 100 + (n.time / 86400) * 600;
      const x = i % 2 === 0 ? 150 : 250; // Alternate left/right for S-curve
      positions[n.id] = { x, y };
    });
    return positions;
  });
  
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draggingNode, setDraggingNode] = React.useState<string | null>(null);
  const [slideMode, setSlideMode] = React.useState<string | null>(null);
  const [longPressTimer, setLongPressTimer] = React.useState<NodeJS.Timeout | null>(null);
  
  const isMobile = useIsMobile()

  useEffect(() => { try { localStorage.setItem('ck_nodes', JSON.stringify(nodes)) } catch {} }, [nodes])

  if (isMobile) {
    // Build curve from node positions
    const curve: CurveState = {
      controls: nodes.map(n => nodePositions[n.id]),
      tension: 0.5
    };
    
    const lut = buildParamLUT(curve);
    
    // Build curve path from segments
    const curvePath = lut.segments
      .map((c, i) => `${i === 0 ? `M ${c.p0.x},${c.p0.y}` : ""} C ${c.p1.x},${c.p1.y} ${c.p2.x},${c.p2.y} ${c.p3.x},${c.p3.y}`)
      .join(" ");
    
    return (
      <div style={{ 
        position: 'fixed',
        inset: 0,
        background: '#fafafa',
        touchAction: 'none',
        overflow: 'hidden'
      }}>
        <svg 
          width="100%" 
          height="100%" 
          viewBox="0 0 400 800"
          style={{ touchAction: 'none' }}
          onTouchStart={() => {
            // Tap background to exit slide mode
            if (slideMode) {
              setSlideMode(null);
            }
          }}
        >
          {/* Draw the serpentine curve */}
          <path
            d={curvePath}
            fill="none"
            stroke={slideMode ? '#3b82f6' : '#d1d5db'}
            strokeWidth={slideMode ? 5 : 4}
            strokeLinecap="round"
          />
          
          {/* Nodes = Control points (dual purpose!) */}
          {nodes.map((n) => {
            const pos = nodePositions[n.id];
            const isDragging = draggingNode === n.id;
            const isSliding = slideMode === n.id;
            
            // If in slide mode, calculate position on curve based on time
            let displayPos = pos;
            if (isSliding && !isDragging) {
              displayPos = pointAtTime(lut, n.time);
            }
            
            return (
              <g key={n.id}>
                {/* Touch target */}
                <circle
                  cx={displayPos.x}
                  cy={displayPos.y}
                  r={65}
                  fill="transparent"
                  onTouchStart={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    
                    // Start long-press timer for slide mode
                    const timer = setTimeout(() => {
                      setSlideMode(n.id);
                      // Haptic feedback if available
                      if (navigator.vibrate) navigator.vibrate(50);
                    }, 500); // 500ms long press
                    
                    setLongPressTimer(timer);
                    setDraggingNode(n.id);
                  }}
                  onTouchMove={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    
                    // Cancel long-press if moving
                    if (longPressTimer) {
                      clearTimeout(longPressTimer);
                      setLongPressTimer(null);
                    }
                    
                    if (draggingNode !== n.id) return;
                    const touch = e.touches[0];
                    const svg = e.currentTarget.ownerSVGElement;
                    if (!svg) return;
                    const pt = svg.createSVGPoint();
                    pt.x = touch.clientX;
                    pt.y = touch.clientY;
                    const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse());
                    
                    if (isSliding) {
                      // SLIDE MODE: constrained to curve, change time only
                      const newTime = timeAtPoint(lut, svgP);
                      setNodes(ns => ns.map(node => 
                        node.id === n.id ? { ...node, time: newTime } : node
                      ));
                    } else {
                      // SCULPT MODE: free 2D movement, reshape curve
                      setNodePositions(prev => ({
                        ...prev,
                        [n.id]: { x: svgP.x, y: svgP.y }
                      }));
                    }
                  }}
                  onTouchEnd={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    
                    if (longPressTimer) {
                      clearTimeout(longPressTimer);
                      setLongPressTimer(null);
                    }
                    
                    if (draggingNode === n.id && !isSliding) {
                      // Update time based on Y position when sculpting
                      const newTime = Math.max(0, Math.min(86400, ((pos.y - 100) / 600) * 86400));
                      setNodes(ns => ns.map(node => 
                        node.id === n.id ? { ...node, time: newTime } : node
                      ));
                    }
                    
                    setDraggingNode(null);
                  }}
                />
                
                {/* Visual node */}
                <circle
                  cx={displayPos.x}
                  cy={displayPos.y}
                  r={isDragging ? 50 : 45}
                  fill={n.color}
                  stroke={isSliding ? '#3b82f6' : 'white'}
                  strokeWidth={isSliding ? 6 : 4}
                  opacity={isDragging ? 0.8 : 1}
                  style={{ pointerEvents: 'none' }}
                />
                <text
                  x={displayPos.x}
                  y={displayPos.y + 8}
                  textAnchor="middle"
                  fill="white"
                  fontSize={isDragging ? 26 : 24}
                  fontWeight="bold"
                  style={{ pointerEvents: 'none' }}
                >
                  {n.label}
                </text>
              </g>
            );
          })}
          
          {/* Instructions */}
          {!slideMode && (
            <g>
              <rect x={10} y={10} width={380} height={50} rx={8} fill="white" opacity={0.9} />
              <text x={20} y={35} fill="black" fontSize={16}>
                Drag nodes to reshape curve 🎨
              </text>
              <text x={20} y={52} fill="#64748b" fontSize={14}>
                Hold 0.5s to slide along curve 🎯
              </text>
            </g>
          )}
          
          {slideMode && (
            <g>
              <rect x={10} y={10} width={380} height={50} rx={8} fill="#3b82f6" opacity={0.95} />
              <text x={20} y={35} fill="white" fontSize={18} fontWeight="bold">
                SLIDE MODE: Move along curve
              </text>
              <text x={20} y={52} fill="white" fontSize={14}>
                Tap background to exit
              </text>
            </g>
          )}
        </svg>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 12 }}>CurveKit Demo (Desktop)</h1>
      <CurveKit
        curve={{
          controls: nodes.map(n => nodePositions[n.id] || { x: 200, y: 200 }),
          tension: 0.5
        }}
        nodes={nodes}
        mode="view"
        onCurveChange={() => {}}
        onNodeChange={(id, t) => setNodes(ns => ns.map(n => n.id === id ? { ...n, time: t } : n))}
        onNodeTap={(id) => setSelectedId(id)}
      />
    </div>
  )
}
