import React, { useState } from 'react'
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

export default function App() {
  const [curve, setCurve] = useState<CurveState>(initialCurve)
  const [nodes, setNodes] = useState<NodeModel[]>(initialNodes)

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 12 }}>CurveKit Demo</h1>
      <CurveKit
        curve={curve}
        nodes={nodes}
        mode="sculpt"
        onCurveChange={setCurve}
        onNodeChange={(id, t) => setNodes(ns => ns.map(n => n.id === id ? { ...n, time: t } : n))}
        onNodeTap={(id) => console.log('tap', id)}
      />
    </div>
  )
}


