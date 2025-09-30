## Routine Data Visualization

An interactive SVG curve sculpting and node-mapping demo built with React + Vite. Sculpt the path, drag labeled nodes along true arc-length, and explore a smooth routine/time visualization.

### What it does

- **Sculpt the curve**: drag cyan handles to shape the path without creating loops (rails clamp movement).
- **Place and move nodes**: drag labeled nodes; their time value is mapped along the curve by arc-length.
- **Accessible motion**: respects reduced motion preferences.
- **Responsive canvas**: automatic `viewBox` derived from control points with padding.

### Tech stack

- **React + TypeScript** (component-driven UI)
- **Vite** (fast dev server and build)
- **SVG** (resolution-independent rendering)
- Custom geometry utilities in `src/lib/geometry` for param/arc-length mapping

### Quick start

1. Install dependencies
   - `npm i`
2. Start the dev server
   - `npm run dev`
3. Open the app
   - `http://localhost:5173`

### Key files

- `src/components/CurveKit.tsx` — interactive curve + nodes component
- `src/lib/geometry/ParamMap.ts` — LUT generation and arc-length mapping helpers
- `src/lib/geometry/Bezier.ts` — cubic utilities used by the LUT

### Using the component

You can render the component with your own data (see `src/App.tsx` for a working example):

```tsx
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
    <CurveKit
      curve={curve}
      nodes={nodes}
      mode="sculpt"
      onCurveChange={setCurve}
      onNodeChange={(id, t) => setNodes(ns => ns.map(n => n.id === id ? { ...n, time: t } : n))}
      onNodeTap={(id) => console.log('tap', id)}
    />
  )
}
```

### Scripts

- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run preview` — preview production build
- `npm run typecheck` — TypeScript check

