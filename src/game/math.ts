export const TAU = Math.PI * 2

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const damp = (a: number, b: number, k: number, dt: number) => lerp(a, b, 1 - Math.exp(-k * dt))
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

export const wrapAngle = (a: number) => {
  a = (a + Math.PI) % TAU
  if (a < 0) a += TAU
  return a - Math.PI
}
export const dampAngle = (a: number, b: number, k: number, dt: number) =>
  a + wrapAngle(b - a) * (1 - Math.exp(-k * dt))
export const approachAngle = (a: number, b: number, maxStep: number) =>
  a + clamp(wrapAngle(b - a), -maxStep, maxStep)

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a)
export const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]

// Yaw convention: forward = (sin yaw, 0, cos yaw). Compass north = +Z, east = -X,
// so turning right (yaw decreasing) increases the bearing.
export const bearingOf = (dx: number, dz: number) => {
  let b = (-Math.atan2(dx, dz) * 180) / Math.PI
  if (b < 0) b += 360
  return b
}
export const yawToBearing = (yaw: number) => {
  let b = ((-yaw * 180) / Math.PI) % 360
  if (b < 0) b += 360
  return b
}
export const wrap180 = (d: number) => {
  d = (d + 180) % 360
  if (d < 0) d += 360
  return d - 180
}
