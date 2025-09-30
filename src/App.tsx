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