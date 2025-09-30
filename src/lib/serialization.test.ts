import type { CurveState, NodeModel } from './types'
import { buildParamLUT, pointAtTime } from './geometry/ParamMap'

describe('Serialization restore tolerance', () => {
  it('restored curve renders within ±1px at sample points', () => {
    const curve: CurveState = {
      controls: [
        { x: 12, y: 220 }, { x: 200, y: 60 }, { x: 420, y: 260 }, { x: 780, y: 140 }
      ], tension: 0.42,
    }
    const nodes: NodeModel[] = [
      { id: 'n1', time: 123, label: 'N1', icon: 'a', color: '#000' },
      { id: 'n2', time: 4567, label: 'N2', icon: 'b', color: '#111' },
      { id: 'n3', time: 80321, label: 'N3', icon: 'c', color: '#222' },
    ]

    const lutA = buildParamLUT(curve)
    const json = JSON.stringify({ curve, nodes })
    const restored = JSON.parse(json) as { curve: CurveState, nodes: NodeModel[] }
    const lutB = buildParamLUT(restored.curve)

    for (const n of nodes) {
      const a = pointAtTime(lutA, n.time)
      const b = pointAtTime(lutB, n.time)
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      expect(d).toBeLessThanOrEqual(1)
    }
  })
})


