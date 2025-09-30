import React, { useEffect, useState } from 'react'
import CurveKit from './components/CurveKit'
import type { CurveState, NodeModel } from './lib/types'
import { buildParamLUT, pointAtTime, timeAtPoint } from './lib/geometry/ParamMap'

const initialCurve: CurveState = {
  controls: [
    { x: 200, y: 80 },   // top
    { x: 100, y: 250 },  // left
    { x: 300, y: 450 },  // right
    { x: 200, y: 720 },  // bottom
  ],
  tension: 0.5,
}

const initialNodes: NodeModel[] = [
  { id: 'a', time: 7200, label: 'A', icon: 'token-a', color: '#06b6d4' },   // 2h = 7200s
  { id: 'b', time: 43200, label: 'B', icon: 'token-b', color: '#f59e0b' },  // 12h = 43200s
  { id: 'c', time: 64800, label: 'C', icon: 'token-c', color: '#ef4444' },  // 18h = 64800s
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
  const [curve, setCurve] = useState<CurveState>(() => {
    try {
      const raw = localStorage.getItem('ck_curve')
      if (raw) return JSON.parse(raw) as CurveState
    } catch {}
    return initialCurve
  })
  const [nodes, setNodes] = useState<NodeModel[]>(() => {
    try {
      const raw = localStorage.getItem('ck_nodes')
      if (raw) return JSON.parse(raw) as NodeModel[]
    } catch {}
    return initialNodes
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<'timeline' | 'list'>(() => (localStorage.getItem('ck_view') as any) || 'timeline')
  const isMobile = useIsMobile()

  useEffect(() => { try { localStorage.setItem('ck_curve', JSON.stringify(curve)) } catch {} }, [curve])
  useEffect(() => { try { localStorage.setItem('ck_nodes', JSON.stringify(nodes)) } catch {} }, [nodes])
  useEffect(() => { try { localStorage.setItem('ck_view', view) } catch {} }, [view])

  // Mobile: Store node positions in 2D space
  const [nodePositions, setNodePositions] = React.useState<Record<string, { x: number; y: number }>>(() => {
    const lut = buildParamLUT(initialCurve);
    const positions: Record<string, { x: number; y: number }> = {};
    initialNodes.forEach((n) => {
      positions[n.id] = pointAtTime(lut, n.time);
    });
    return positions;
  });
  
  const [draggingNode, setDraggingNode] = React.useState<string | null>(null);
  const [draggingControl, setDraggingControl] = React.useState<number | null>(null);

  if (isMobile) {
    const lut = buildParamLUT(curve);
    
    // Build curve path from segments
    const curvePath = lut.segments
      .map((c, i) => `${i === 0 ? `M ${c.p0.x},${c.p0.y}` : ""} C ${c.p1.x},${c.p1.y} ${c.p2.x},${c.p2.y} ${c.p3.x},${c.p3.y}`)
      .join(" ");
    
    return (
      <div style={{ 
        position: 'fixed',
        inset: 0,
        background: 'white',
        touchAction: 'none',
        overflow: 'hidden'
      }}>
        <svg 
          width="100%" 
          height="100%" 
          viewBox="0 0 400 800"
          style={{ touchAction: 'none' }}
        >
          {/* Draw the serpentine curve */}
          <path
            d={curvePath}
            fill="none"
            stroke="#d1d5db"
            strokeWidth={4}
            strokeLinecap="round"
          />
          
          {/* Curve control points (gray dots) */}
          {curve.controls.map((ctrl, i) => (
            <circle
              key={`ctrl-${i}`}
              cx={ctrl.x}
              cy={ctrl.y}
              r={draggingControl === i ? 20 : 12}
              fill={draggingControl === i ? '#06b6d4' : '#94a3b8'}
              stroke="white"
              strokeWidth={2}
              opacity={0.7}
              onTouchStart={(e) => {
                e.preventDefault();
                setDraggingControl(i);
              }}
              onTouchMove={(e) => {
                e.preventDefault();
                if (draggingControl !== i) return;
                const touch = e.touches[0];
                const svg = e.currentTarget.ownerSVGElement;
                if (!svg) return;
                const pt = svg.createSVGPoint();
                pt.x = touch.clientX;
                pt.y = touch.clientY;
                const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse());
                
                setCurve(prev => ({
                  ...prev,
                  controls: prev.controls.map((c, idx) => 
                    idx === i ? { x: svgP.x, y: svgP.y } : c
                  )
                }));
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                setDraggingControl(null);
              }}
            />
          ))}
          
          {/* Colored nodes with 2D freedom (same as gray dots) */}
          {nodes.map((n) => {
            const pos = nodePositions[n.id];
            const isDragging = draggingNode === n.id;
            
            return (
              <g key={n.id}>
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={isDragging ? 50 : 45}
                  fill={n.color}
                  stroke="white"
                  strokeWidth={4}
                  opacity={isDragging ? 0.8 : 1}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    setDraggingNode(n.id);
                  }}
                  onTouchMove={(e) => {
                    e.preventDefault();
                    if (draggingNode !== n.id) return;
                    const touch = e.touches[0];
                    const svg = e.currentTarget.ownerSVGElement;
                    if (!svg) return;
                    const pt = svg.createSVGPoint();
                    pt.x = touch.clientX;
                    pt.y = touch.clientY;
                    const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse());
                    
                    setNodePositions(prev => ({
                      ...prev,
                      [n.id]: { x: svgP.x, y: svgP.y }
                    }));
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    if (draggingNode === n.id) {
                      // Convert Y position to time when releasing
                      const pos = nodePositions[n.id];
                      const newTime = Math.max(0, Math.min(86400, ((pos.y - 80) / 640) * 86400));
                      setNodes(ns => ns.map(node => 
                        node.id === n.id ? { ...node, time: newTime } : node
                      ));
                      setDraggingNode(null);
                    }
                  }}
                />
                <text
                  x={pos.x}
                  y={pos.y + 8}
                  textAnchor="middle"
                  fill="white"
                  fontSize={24}
                  fontWeight="bold"
                  style={{ pointerEvents: 'none' }}
                >
                  {n.label}
                </text>
              </g>
            );
          })}
          
          <text x={20} y={40} fill="black" fontSize={18}>
            Drag ANYTHING - total freedom! 🎯
          </text>
          <text x={20} y={770} fill="#94a3b8" fontSize={14}>
            Gray dots = curve shape | Colored = nodes
          </text>
        </svg>
      </div>
    );
  }

  return (
    <div style={{ 
      padding: isMobile ? 0 : 24,
      minHeight: isMobile ? '100vh' : 'auto',
      position: isMobile ? 'relative' : 'static'
    }}>
      {!isMobile && <h1 style={{ marginBottom: 12 }}>CurveKit Demo</h1>}
      {!isMobile && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <button onClick={() => setView(v => {
            const next = v === 'timeline' ? 'list' : 'timeline'
            // eslint-disable-next-line no-console
            console.log('telemetry: view_toggle', { next })
            return next
          })}>
            {view === 'timeline' ? 'Switch to List' : 'Switch to Timeline'}
          </button>
        </div>
      )}
      
      {view === 'timeline' ? (
        <CurveKit
          curve={curve}
          nodes={nodes}
          mode="view"
          onCurveChange={setCurve}
          onNodeChange={(id, t) => setNodes(ns => ns.map(n => n.id === id ? { ...n, time: t } : n))}
          onNodeTap={(id) => setSelectedId(id)}
        />
      ) : (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
          {nodes.map(n => (
            <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', cursor: 'pointer', background: selectedId === n.id ? '#f1f5f9' : 'transparent' }} onClick={() => setSelectedId(n.id)}>
              <div style={{ width: 8, height: 8, borderRadius: 9999, background: n.color }} />
              <div style={{ flex: 1 }}>{n.label}</div>
              <div style={{ opacity: 0.6 }}>{Math.round(n.time)}</div>
            </div>
          ))}
        </div>
      )}

      {selectedId && (
        <div style={{ 
          position: 'fixed', 
          right: isMobile ? 8 : 16, 
          top: isMobile ? 8 : 16, 
          width: isMobile ? 'calc(100vw - 16px)' : 280, 
          background: 'white', 
          border: '1px solid #e5e7eb', 
          borderRadius: 12, 
          padding: 12, 
          boxShadow: '0 6px 24px rgba(0,0,0,0.08)',
          zIndex: 20
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>Edit node</strong>
            <button onClick={() => setSelectedId(null)}>✕</button>
          </div>
          {(() => {
            const idx = nodes.findIndex(n => n.id === selectedId)
            if (idx < 0) return null
            const n = nodes[idx]
            return (
              <form onSubmit={(e) => e.preventDefault()}>
                <label style={{ display: 'block', fontSize: 12, opacity: 0.7 }}>Label</label>
                <input value={n.label} onChange={e => setNodes(ns => ns.map(m => m.id === n.id ? { ...m, label: e.target.value } : m))} style={{ width: '100%', marginBottom: 8 }} />
                <label style={{ display: 'block', fontSize: 12, opacity: 0.7 }}>Icon</label>
                <input value={n.icon} onChange={e => setNodes(ns => ns.map(m => m.id === n.id ? { ...m, icon: e.target.value } : m))} style={{ width: '100%', marginBottom: 8 }} />
                <label style={{ display: 'block', fontSize: 12, opacity: 0.7 }}>Color</label>
                <input value={n.color} onChange={e => setNodes(ns => ns.map(m => m.id === n.id ? { ...m, color: e.target.value } : m))} style={{ width: '100%', marginBottom: 8 }} />
                <label style={{ display: 'block', fontSize: 12, opacity: 0.7 }}>Time (sec)</label>
                <input type="number" value={Math.round(n.time)} onChange={e => setNodes(ns => ns.map(m => m.id === n.id ? { ...m, time: Math.max(0, Math.min(86400, Number(e.target.value))) } : m))} style={{ width: '100%' }} />
              </form>
            )
          })()}
        </div>
      )}
    </div>
  )
}
