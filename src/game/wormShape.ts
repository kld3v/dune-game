import { WORM_L, WORM_R, WORM_RINGS, RING_DS } from './rt'
import { clamp, smoothstep } from './math'

// Radius profile along the body, sampled at the render rings. Plates repeat every
// 4 rings so the grooves always land on the same ring and never alias as it moves.
export const RADII = new Float32Array(WORM_RINGS)
export const DRADII = new Float32Array(WORM_RINGS)
export const PLATE = new Float32Array(WORM_RINGS)

for (let i = 0; i < WORM_RINGS; i++) {
  const s = i * RING_DS
  const u = s / WORM_L
  const taper = (0.84 + 0.16 * smoothstep(0, 0.07, u)) * (1 - 0.72 * smoothstep(0.42, 1.0, u))
  const plate = Math.pow(Math.abs(Math.sin((i * Math.PI) / 4)), 0.5)
  PLATE[i] = plate
  RADII[i] = WORM_R * taper * (0.92 + 0.08 * plate)
}
for (let i = 0; i < WORM_RINGS; i++) {
  const a = Math.max(0, i - 1)
  const b = Math.min(WORM_RINGS - 1, i + 1)
  DRADII[i] = (RADII[b] - RADII[a]) / ((b - a) * RING_DS)
}

export const ringOf = (s: number) => clamp(Math.round(s / RING_DS), 0, WORM_RINGS - 1)
