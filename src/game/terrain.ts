import { TAU, rand, smoothstep } from './math'

// The desert is a pure function of position, evaluated twice: here on the CPU for
// collision, and in the terrain vertex shader (TERRAIN_GLSL) for rendering. Both use
// the same 32-bit integer hash, so the two agree bit-for-bit on lattice values and the
// player stands exactly on the sand they see. Any change here must be mirrored below.

const OFF = 1048576 // keeps lattice coords positive so uint conversion is well defined in GLSL

function hu(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0
  x = Math.imul(x, 0x7feb352d) >>> 0
  x = (x ^ (x >>> 15)) >>> 0
  x = Math.imul(x, 0x846ca68b) >>> 0
  return (x ^ (x >>> 16)) >>> 0
}

function h2(ix: number, iy: number, seed: number): number {
  return (hu((ix + hu((iy + seed) >>> 0)) >>> 0) >>> 8) / 16777216
}

export function vnoise(x: number, y: number, seed: number): number {
  const fx = Math.floor(x)
  const fy = Math.floor(y)
  const tx = x - fx
  const ty = y - fy
  const ux = tx * tx * tx * (tx * (tx * 6 - 15) + 10)
  const uy = ty * ty * ty * (ty * (ty * 6 - 15) + 10)
  const ix = fx + OFF
  const iy = fy + OFF
  const a = h2(ix, iy, seed)
  const b = h2(ix + 1, iy, seed)
  const c = h2(ix, iy + 1, seed)
  const d = h2(ix + 1, iy + 1, seed)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

// Asymmetric dune profile: long windward rise, short steep slip face, rounded crest.
function dune(t: number): number {
  t -= Math.floor(t)
  const h = t < 0.78 ? t / 0.78 : (1 - t) / 0.22
  return h * h * (3 - 2 * h)
}

export const WIND_X = 0.8944272
export const WIND_Z = 0.4472136

export function sandHeight(x: number, z: number): number {
  const base = vnoise(x * 0.0021, z * 0.0021, 11) * 24 + vnoise(x * 0.0067, z * 0.0067, 12) * 7
  const along = x * WIND_X + z * WIND_Z
  const warp = vnoise(x * 0.0043, z * 0.0043, 13) * 2.4 + vnoise(x * 0.013, z * 0.013, 14) * 0.45
  const amp = vnoise(x * 0.0031, z * 0.0031, 15)
  const d1 = dune(along * 0.0108695652 + warp) * (2.5 + 13 * amp * amp)
  const along2 = x * 0.53 - z * 0.848
  const warp2 = vnoise(x * 0.011, z * 0.011, 16) * 1.3
  const d2 = dune(along2 * 0.037037 + warp2) * (0.5 + 2.4 * vnoise(x * 0.008, z * 0.008, 17))
  return base + d1 + d2 - 14
}

function naturalRock(x: number, z: number): number {
  const n = vnoise(x * 0.0042, z * 0.0042, 21) * 0.72 + vnoise(x * 0.017, z * 0.017, 22) * 0.28
  return smoothstep(0.62, 0.68, n)
}

// Arrakeen stands on a levelled plateau of stone: flat inside CITY_R, ramping down to
// the desert over CITY_EDGE. Mirrored in TERRAIN_GLSL below.
export const CITY_X = -1500
export const CITY_Z = 1100
export const CITY_R = 380
export const CITY_H = 34
const CITY_EDGE = 90

export function cityMask(x: number, z: number): number {
  return 1 - smoothstep(CITY_R, CITY_R + CITY_EDGE, Math.hypot(x - CITY_X, z - CITY_Z))
}

// Solid ground for gameplay: natural rock and the city plateau. Worms will not cross it.
export function rockMask(x: number, z: number): number {
  return Math.max(naturalRock(x, z), cityMask(x, z))
}

// The ground under your feet: the desert, or a cavern floor while you are inside one.
let groundHook: ((x: number, z: number) => number) | null = null
export function setGroundHook(fn: ((x: number, z: number) => number) | null) {
  groundHook = fn
}
export function groundHeight(x: number, z: number): number {
  return groundHook ? groundHook(x, z) : terrainHeight(x, z)
}

export function terrainHeight(x: number, z: number): number {
  const s = sandHeight(x, z)
  const r = naturalRock(x, z)
  let h = s
  if (r > 0) {
    let top = 20 + vnoise(x * 0.011, z * 0.011, 23) * 16 + vnoise(x * 0.047, z * 0.047, 24) * 3.2
    top = Math.max(top, s + 4)
    h = s + (top - s) * r
  }
  const c = cityMask(x, z)
  if (c > 0) h += (CITY_H - h) * c
  return h
}

export const TERRAIN_GLSL = /* glsl */ `
uint tHash(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
float tH2(ivec2 i, uint seed) {
  return float(tHash(uint(i.x) + tHash(uint(i.y) + seed)) >> 8u) / 16777216.0;
}
float vnoise(vec2 p, uint seed) {
  vec2 f = floor(p);
  vec2 t = p - f;
  vec2 u = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  ivec2 i = ivec2(f) + ivec2(1048576);
  float a = tH2(i, seed);
  float b = tH2(i + ivec2(1, 0), seed);
  float c = tH2(i + ivec2(0, 1), seed);
  float d = tH2(i + ivec2(1, 1), seed);
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
float tDune(float t) {
  t = fract(t);
  float h = t < 0.78 ? t / 0.78 : (1.0 - t) / 0.22;
  return h * h * (3.0 - 2.0 * h);
}
// lod 0 = full detail (what the CPU uses); lod 1 drops the small dunes far away so the
// sparse distant vertices don't shimmer.
float sandHeight(vec2 p, float lod) {
  float base = vnoise(p * 0.0021, 11u) * 24.0 + vnoise(p * 0.0067, 12u) * 7.0;
  float along = p.x * 0.8944272 + p.y * 0.4472136;
  float warp = vnoise(p * 0.0043, 13u) * 2.4 + vnoise(p * 0.013, 14u) * 0.45;
  float amp = vnoise(p * 0.0031, 15u);
  float d1 = tDune(along * 0.0108695652 + warp) * (2.5 + 13.0 * amp * amp);
  float d2 = 0.0;
  if (lod < 1.0) {
    float along2 = p.x * 0.53 - p.y * 0.848;
    float warp2 = vnoise(p * 0.011, 16u) * 1.3;
    d2 = tDune(along2 * 0.037037 + warp2) * (0.5 + 2.4 * vnoise(p * 0.008, 17u)) * (1.0 - lod);
  }
  return base + d1 + d2 - 14.0;
}
float rockMask(vec2 p) {
  float n = vnoise(p * 0.0042, 21u) * 0.72 + vnoise(p * 0.017, 22u) * 0.28;
  return smoothstep(0.62, 0.68, n);
}
float cityMask(vec2 p) {
  return 1.0 - smoothstep(380.0, 470.0, length(p - vec2(-1500.0, 1100.0)));
}
float terrainHeight(vec2 p, float lod, out float rock) {
  float s = sandHeight(p, lod);
  rock = rockMask(p);
  float h = s;
  if (rock > 0.0) {
    float top = 20.0 + vnoise(p * 0.011, 23u) * 16.0 + vnoise(p * 0.047, 24u) * 3.2 * (1.0 - lod);
    top = max(top, s + 4.0);
    h = s + (top - s) * rock;
  }
  float c = cityMask(p);
  if (c > 0.0) {
    h += (34.0 - h) * c;
    rock = max(rock, c);
  }
  return h;
}
`

function isFlat(x: number, z: number, r: number, tol: number): boolean {
  const h = terrainHeight(x, z)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU
    if (Math.abs(terrainHeight(x + Math.cos(a) * r, z + Math.sin(a) * r) - h) > tol) return false
  }
  return true
}

// Spiral search outward for solid, flat rock: a safe place to stand.
export function findRockSpot(cx: number, cz: number, maxR = 2400): { x: number; z: number } {
  for (let r = 0; r <= maxR; r += 10) {
    const steps = Math.max(1, Math.floor((TAU * r) / 10))
    const phase = Math.random() * TAU
    for (let i = 0; i < steps; i++) {
      const a = phase + (i / steps) * TAU
      const x = cx + Math.cos(a) * r
      const z = cz + Math.sin(a) * r
      if (rockMask(x, z) > 0.985 && rockMask(x + 9, z) > 0.9 && rockMask(x - 9, z) > 0.9 &&
          rockMask(x, z + 9) > 0.9 && rockMask(x, z - 9) > 0.9 && isFlat(x, z, 3, 1.4)) {
        return { x, z }
      }
    }
  }
  return { x: cx, z: cz }
}

export function isOpenSand(x: number, z: number, clearance: number): boolean {
  if (rockMask(x, z) > 0.001) return false
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU
    if (rockMask(x + Math.cos(a) * clearance, z + Math.sin(a) * clearance) > 0.001) return false
  }
  return true
}

export function findSandSpot(cx: number, cz: number, minR: number, maxR: number, clearance = 16, dirYaw?: number, spread = Math.PI) {
  for (let tries = 0; tries < 60; tries++) {
    const a = dirYaw === undefined ? Math.random() * TAU : dirYaw + rand(-spread, spread)
    const r = rand(minR, maxR)
    const x = cx + Math.sin(a) * r
    const z = cz + Math.cos(a) * r
    if (isOpenSand(x, z, clearance)) return { x, z }
  }
  return null
}
