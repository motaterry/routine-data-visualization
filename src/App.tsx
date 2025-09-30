import React, { useEffect, useState } from 'react'
import CurveKit from './components/CurveKit'
import type { CurveState, NodeModel } from './lib/types'

const initialCurve: CurveState = {
  controls: [
    { x: 40, y: 220 },
    { x: 200, y: 80 },
    { x: 420, y: 260 },
    { x: 760, y: 120 },
  ],
  tension: 0.5,
}

const initialNodes: NodeModel[] = [
  { id: 'a', time: 0.1, label: 'A', icon: 'token-a', color: '#06b6d4' },
  { id: 'b', time: 0.4, label: 'B', icon: 'token-b', color: '#f59e0b' },
  { id: 'c', time: 0.7, label: 'C', icon: 'token-c', color: '#ef4444' },
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
  const [sculptEnabled] = useState<boolean>(() => {
    // Force sculpt OFF on mobile
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      try { localStorage.setItem('ff_curve_sculpting', '0'); } catch {}
      return false;
    }
    try { return localStorage.getItem('ff_curve_sculpting') !== '0' } catch { return true }
  })
  const isMobile = useIsMobile()

  useEffect(() => { try { localStorage.setItem('ck_curve', JSON.stringify(curve)) } catch {} }, [curve])
  useEffect(() => { try { localStorage.setItem('ck_nodes', JSON.stringify(nodes)) } catch {} }, [nodes])
  useEffect(() => { try { localStorage.setItem('ck_view', view) } catch {} }, [view])

  // Mobile: Use simple draggable circles with 2D freedom
  const [dragState, setDragState] = React.useState<{ id: string; x: number; y: number } | null>(null);
  const [nodePositions, setNodePositions] = React.useState<Record<string, { x: number; y: number }>>(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    nodes.forEach((n, i) => {
      positions[n.id] = { x: 200, y: 100 + i * 200 };
    });
    return positions;
  });

  // Build the curve path (outside of conditional)
  const curvePath = React.useMemo(() => {
    const segments = [];
    const controls = curve.controls;
    for (let i = 0; i < controls.length - 1; i++) {
      const c0 = controls[i];
      const c1 = controls[i + 1];
      if (i === 0) {
        segments.push(`M ${c0.x},${c0.y}`);
      }
      // Simple quadratic curve between points
      const cpx = (c0.x + c1.x) / 2;
      const cpy = (c0.y + c1.y) / 2 + 50;
      segments.push(`Q ${cpx},${cpy} ${c1.x},${c1.y}`);
    }
    return segments.join(' ');
  }, [curve]);

  if (isMobile) {
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
          {/* Draw nodes with 2D freedom */}
          {nodes.map((n) => {
            const pos = nodePositions[n.id] || { x: 200, y: 200 };
            const isDragging = dragState?.id === n.id;
            const x = isDragging ? dragState.x : pos.x;
            const y = isDragging ? dragState.y : pos.y;
            
            return (
              <g key={n.id}>
                <circle
                  cx={x}
                  cy={y}
                  r={40}
                  fill={isDragging ? '#3b82f6' : '#ef4444'}
                  stroke="white"
                  strokeWidth={4}
                  style={{ cursor: 'pointer' }}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    setDragState({ id: n.id, x: pos.x, y: pos.y });
                  }}
                  onTouchMove={(e) => {
                    e.preventDefault();
                    if (!dragState || dragState.id !== n.id) return;
                    const touch = e.touches[0];
                    const svg = e.currentTarget.ownerSVGElement;
                    if (!svg) return;
                    const pt = svg.createSVGPoint();
                    pt.x = touch.clientX;
                    pt.y = touch.clientY;
                    const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse());
                    setDragState({ id: n.id, x: svgP.x, y: svgP.y });
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    if (dragState && dragState.id === n.id) {
                      setNodePositions(prev => ({
                        ...prev,
                        [n.id]: { x: dragState.x, y: dragState.y }
                      }));
                      // Convert Y position back to time for storage
                      const newTime = Math.max(0, Math.min(86400, ((dragState.y - 100) / 600) * 86400));
                      setNodes(ns => ns.map(node => 
                        node.id === n.id ? { ...node, time: newTime } : node
                      ));
                      setDragState(null);
                    }
                  }}
                />
                <text
                  x={x}
                  y={y + 8}
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
          <text x={20} y={40} fill="black" fontSize={20}>
            Drag nodes ANYWHERE! 🎯
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
          <span style={{ opacity: 0.6 }}>| sculpt: {sculptEnabled ? 'on' : 'off'}</span>
        </div>
      )}
      
      {view === 'timeline' ? (
        <CurveKit
          curve={curve}
          nodes={nodes}
          mode={isMobile ? 'view' : (sculptEnabled ? 'sculpt' : 'view')}
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