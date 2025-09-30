import { buildParamLUT, pointAtTime, timeAtPoint } from './ParamMap'
import type { CurveState, Vec2 } from '../types'

const curve: CurveState = {
  controls: [
    { x: 0, y: 0 },
    { x: 100, y: 50 },
    { x: 200, y: 0 },
    { x: 300, y: 50 },
  ],
  tension: 0.5,
}

function jitter(p: Vec2, eps = 0.5): Vec2 { return { x: p.x + eps, y: p.y - eps } }

describe('ParamMap invariants', () => {
  it('time -> position monotonicity (samples increase along arc-length)', () => {
    const lut = buildParamLUT(curve)
    let lastX = -Infinity
    for (let t = 0; t <= 86400; t += 86400 / 20) {
      const p = pointAtTime(lut, t)
      expect(p.x).toBeGreaterThanOrEqual(lastX)
      lastX = p.x
    }
  })

  it('nearest-point solver stable near inflections', () => {
    const c: CurveState = { ...curve, controls: [
      { x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: -100 }, { x: 300, y: 0 }
    ] }
    const lut = buildParamLUT(c)
    const p = pointAtTime(lut, 0.5 * 86400)
    const tNear = timeAtPoint(lut, jitter(p))
    expect(tNear).toBeGreaterThan(0)
    expect(tNear).toBeLessThan(86400)
  })
})


