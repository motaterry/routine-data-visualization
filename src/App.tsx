import React, { useEffect, useState } from 'react'
import CurveKit from './components/CurveKit'
import type { CurveState, NodeModel } from './lib/types'
import { buildParamLUT, pointAtTime, timeAtPoint } from './lib/geometry/ParamMap'
import { toSmoothCPath, getSmoothSegments } from './lib/geometry/SmoothPath'
import { buildLUT, accumulateLengths } from './lib/geometry/Bezier'

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
  const [longPressTimer, setLongPressTimer] = React.useState<number | null>(null);
  const [slidePendingTime, setSlidePendingTime] = React.useState<number | null>(null);
  
  const isMobile = useIsMobile()

  useEffect(() => { try { localStorage.setItem('ck_nodes', JSON.stringify(nodes)) } catch {} }, [nodes])

  if (isMobile) {
    // Build smooth curve from node positions with symmetric arms
    const nodePoints = nodes.map(n => nodePositions[n.id]);
    const curvePath = toSmoothCPath(nodePoints, 0.5);
    
    // Build arc-length LUT for the ACTUAL smooth curve (for sliding)
    const smoothSegments = getSmoothSegments(nodePoints, 0.5);
    const lutBase = buildLUT(smoothSegments, 0.75);
    const s = accumulateLengths(lutBase.pt);
    const lut = { ...lutBase, s, length: s[s.length - 1], segments: smoothSegments };
    
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
          style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
          onTouchStart={() => {
            // Tap background to SAVE and exit slide mode
            if (slideMode && slidePendingTime !== null) {
              // Save the time - position is already correct from live preview
              setNodes(ns => ns.map(node => 
                node.id === slideMode ? { ...node, time: slidePendingTime } : node
              ));
              
              // Keep the node position where it visually is on the curve
              // Don't recalculate - it's already at pointAtTime(lut, slidePendingTime)
              const finalPos = pointAtTime(lut, slidePendingTime);
              setNodePositions(prev => ({
                ...prev,
                [slideMode]: finalPos
              }));
              
              setSlideMode(null);
              setSlidePendingTime(null);
            }
          }}
        >
          {/* Draw the smooth serpentine curve */}
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
            
            // If in slide mode, show live position on curve
            let displayPos = pos;
            let displayTime = n.time;
            if (isSliding) {
              displayTime = slidePendingTime !== null ? slidePendingTime : n.time;
              displayPos = pointAtTime(lut, displayTime);
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
                    
                    // Don't allow slide mode for wake/sleep - they're anchored
                    const isAnchor = n.id === 'wake' || n.id === 'sleep';
                    if (isAnchor) {
                      setDraggingNode(n.id);
                      return; // Can sculpt but not slide
                    }
                    
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
                      // SLIDE MODE: constrained to curve, update pending time (not saved yet)
                      const newTime = timeAtPoint(lut, svgP);
                      setSlidePendingTime(newTime);
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
                      // Sculpt mode: Update time based on Y position immediately
                      const newTime = Math.max(0, Math.min(86400, ((pos.y - 100) / 600) * 86400));
                      setNodes(ns => ns.map(node => 
                        node.id === n.id ? { ...node, time: newTime } : node
                      ));
                    }
                    // Note: In slide mode, don't save on release - wait for background tap
                    
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
                Tap background to save
              </text>
            </g>
          )}
        </svg>
      </div>
    );
  }

  return (
    <div style={{ 
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: 24
    }}>
      <div style={{
        maxWidth: 600,
        background: 'white',
        borderRadius: 16,
        padding: 48,
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>📱</div>
        <h1 style={{ fontSize: 32, marginBottom: 16, color: '#1a202c' }}>
          Serpentime
        </h1>
        <p style={{ fontSize: 18, color: '#4a5568', marginBottom: 24, lineHeight: 1.6 }}>
          This experience is designed for <strong>mobile devices only</strong>.
        </p>
        <p style={{ fontSize: 16, color: '#718096', marginBottom: 32, lineHeight: 1.6 }}>
          The serpentine timeline interaction with drag-to-sculpt and hold-to-slide 
          is optimized for touch and portrait orientation.
        </p>
        <div style={{
          background: '#f7fafc',
          padding: 24,
          borderRadius: 12,
          border: '2px solid #e2e8f0'
        }}>
          <p style={{ fontSize: 14, color: '#2d3748', marginBottom: 12, fontWeight: 600 }}>
            📲 To experience Serpentime:
          </p>
          <p style={{ fontSize: 14, color: '#4a5568', lineHeight: 1.8 }}>
            1. Open this URL on your phone<br/>
            2. Or resize your browser to &lt;768px width<br/>
            3. Enjoy the serpentine timeline! 🌊
          </p>
        </div>
        <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid #e2e8f0' }}>
          <a href="https://github.com/motaterry/routine-data-visualization" 
             style={{ 
               color: '#667eea', 
               textDecoration: 'none',
               fontSize: 14,
               fontWeight: 600
             }}>
            View on GitHub →
          </a>
        </div>
      </div>
    </div>
  )
}
