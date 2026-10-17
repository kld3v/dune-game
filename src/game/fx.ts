import { dust, glow } from './particles'
import { TAU, rand } from './math'
import { WIND_X, WIND_Z } from './terrain'

function sandCol(): [number, number, number] {
  const k = rand(0.85, 1.15)
  return [0.56 * k, 0.38 * k, 0.21 * k]
}

function spiceCol(): [number, number, number] {
  const t = Math.random()
  if (t < 0.55) return [2.6, 0.95, 0.22]
  if (t < 0.85) return [2.2, 0.5, 0.12]
  return [2.8, 1.7, 0.6]
}

// Big eruption of sand: worm breaches, slams, spice blows.
export function sandBurst(x: number, y: number, z: number, scale = 1, count = 380) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU
    const r = rand(0, 4) * scale
    const sp = rand(2, 13) * scale
    const [cr, cg, cb] = sandCol()
    dust.emit(
      x + Math.cos(a) * r, y + rand(-0.5, 2), z + Math.sin(a) * r,
      Math.cos(a) * sp, rand(5, 24) * scale, Math.sin(a) * sp,
      rand(2.2, 5), rand(2, 6) * scale, cr, cg, cb, 0.75, 0.55,
    )
  }
}

// Sand sheeting off a moving body at ground level.
export function wake(x: number, y: number, z: number, spread: number, rate: number) {
  for (let i = 0; i < rate; i++) {
    const a = Math.random() * TAU
    const r = Math.random() * spread
    const [cr, cg, cb] = sandCol()
    dust.emit(
      x + Math.cos(a) * r, y + rand(-0.3, 1.2), z + Math.sin(a) * r,
      Math.cos(a) * rand(0.5, 3) + WIND_X * 2, rand(1.5, 6), Math.sin(a) * rand(0.5, 3) + WIND_Z * 2,
      rand(1.5, 3.5), rand(1.6, 4.2), cr, cg, cb, 0.35, 0.8,
    )
  }
}

export function puff(x: number, y: number, z: number, size = 1, count = 5) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU
    const [cr, cg, cb] = sandCol()
    dust.emit(
      x, y + 0.1, z,
      Math.cos(a) * rand(0.4, 1.6) * size, rand(0.4, 1.4) * size, Math.sin(a) * rand(0.4, 1.6) * size,
      rand(0.6, 1.3), rand(0.4, 0.9) * size, cr, cg, cb, 0.2, 2.2,
    )
  }
}

export function shockRing(x: number, y: number, z: number, speed: number, count: number) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rand(-0.05, 0.05)
    const [cr, cg, cb] = sandCol()
    dust.emit(
      x + Math.cos(a) * 2, y + 0.3, z + Math.sin(a) * 2,
      Math.cos(a) * speed * rand(0.8, 1.2), rand(0.5, 2.5), Math.sin(a) * speed * rand(0.8, 1.2),
      rand(1.6, 2.6), rand(1.5, 3.5), cr, cg, cb, 0.15, 1.1,
    )
  }
}

export function spiceMote(x: number, y: number, z: number) {
  const [r, g, b] = spiceCol()
  glow.emit(
    x, y, z,
    rand(-0.3, 0.3) + WIND_X * 0.6, rand(0.4, 1.5), rand(-0.3, 0.3) + WIND_Z * 0.6,
    rand(2.5, 4.5), rand(0.18, 0.42), r * 0.5, g * 0.5, b * 0.5, -0.02, 0.2,
  )
}

export function spiceEruption(x: number, y: number, z: number) {
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * TAU
    const r = Math.random() * 3
    const sp = rand(0.5, 7)
    const [cr, cg, cb] = spiceCol()
    glow.emit(
      x + Math.cos(a) * r, y + rand(0, 3), z + Math.sin(a) * r,
      Math.cos(a) * sp, rand(16, 48), Math.sin(a) * sp,
      rand(3, 7), rand(0.6, 2.2), cr * 0.6, cg * 0.6, cb * 0.6, 0.45, 0.35,
    )
  }
  for (let i = 0; i < 260; i++) {
    const a = Math.random() * TAU
    const sp = rand(1, 9)
    dust.emit(
      x + Math.cos(a) * 3, y + rand(0, 4), z + Math.sin(a) * 3,
      Math.cos(a) * sp, rand(8, 30), Math.sin(a) * sp,
      rand(4, 8), rand(4, 10), 0.62, 0.3, 0.13, 0.25, 0.4,
    )
  }
  shockRing(x, y, z, 26, 160)
}

export function spiceVortex(cx: number, cy: number, cz: number, trip: number, count: number) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU
    const r = rand(3, 14)
    const tx = Math.cos(a + Math.PI / 2)
    const tz = Math.sin(a + Math.PI / 2)
    const hue = Math.random()
    const r0 = hue < 0.5 ? 0.4 : 1.6
    const g0 = hue < 0.5 ? 0.9 : 0.7
    const b0 = hue < 0.5 ? 2.4 : 0.3
    glow.emit(
      cx + Math.cos(a) * r, cy + rand(-1, 3), cz + Math.sin(a) * r,
      tx * rand(2, 6) * trip, rand(0.3, 2.2), tz * rand(2, 6) * trip,
      rand(2, 4), rand(0.12, 0.35), r0 * 0.6, g0 * 0.6, b0 * 0.6, -0.05, 0.3,
    )
  }
}

// Ambient wind-blown sand skimming the dunes around the camera.
export function windSand(cx: number, cz: number, groundY: (x: number, z: number) => number, count: number) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU
    const r = rand(4, 60)
    const x = cx + Math.cos(a) * r
    const z = cz + Math.sin(a) * r
    const big = Math.random() < 0.07
    const [cr, cg, cb] = sandCol()
    dust.emit(
      x, groundY(x, z) + rand(0.05, big ? 2.5 : 0.9), z,
      WIND_X * rand(4, 9), rand(-0.1, 0.5), WIND_Z * rand(4, 9),
      rand(1.6, 3.2), big ? rand(4, 9) : rand(0.12, 0.35), cr, cg, cb, 0.05, 0.15,
    )
  }
}

// Holtzman shield sparks: a burst of cold blue-white light.
export function sparks(x: number, y: number, z: number, count: number) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU
    const e = rand(-0.4, 1.2)
    const sp = rand(3, 9)
    glow.emit(
      x, y, z,
      Math.cos(a) * sp, e * sp, Math.sin(a) * sp,
      rand(0.25, 0.6), rand(0.08, 0.2), 1.2, 1.8, 3.2, 0.6, 3,
    )
  }
}

// The Voice: a ring of violet light racing out across the sand.
export function voiceRing(x: number, y: number, z: number) {
  for (let i = 0; i < 220; i++) {
    const a = (i / 220) * TAU
    const sp = rand(20, 26)
    glow.emit(
      x + Math.cos(a), y + rand(-0.4, 0.8), z + Math.sin(a),
      Math.cos(a) * sp, rand(0, 1.5), Math.sin(a) * sp,
      rand(0.7, 1.0), rand(0.5, 1.1), 1.4, 0.8, 3, 0, 1.6,
    )
  }
}
