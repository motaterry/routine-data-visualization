import { cubicPoint, sampleCubic } from './Bezier'
import type { Cubic } from '../types'

describe('Bezier sampling', () => {
  it('sampleCubic covers endpoints and increases t', () => {
    const c: Cubic = {
      p0: { x: 0, y: 0 },
      p1: { x: 50, y: 100 },
      p2: { x: 150, y: -100 },
      p3: { x: 300, y: 0 },
    }
    const { t, pt } = sampleCubic(c, 0.75)
    expect(t[0]).toBe(0)
    expect(t[t.length - 1]).toBe(1)
    expect(pt[0]).toEqual(c.p0)
    expect(pt[pt.length - 1]).toEqual(c.p3)
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i-1])
  })
})


