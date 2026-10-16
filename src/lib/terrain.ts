import { createNoise2D } from 'simplex-noise'

export const TERRAIN_SIZE = 300
export const TERRAIN_SEGS = 127
const GRID = TERRAIN_SEGS + 1

export const heightData = new Float32Array(GRID * GRID)

const noise2D = createNoise2D(() => 0.6173)

function fbm(x: number, z: number): number {
  let h = 0, amp = 1, freq = 0.018
  for (let o = 0; o < 5; o++) {
    h += noise2D(x * freq, z * freq) * amp
    amp *= 0.48
    freq *= 2.1
  }
  // Add large-scale dune ridges
  h += noise2D(x * 0.005, z * 0.005) * 3
  return h
}

// Pre-compute heightmap
for (let i = 0; i < GRID; i++) {
  for (let j = 0; j < GRID; j++) {
    const wx = (i / TERRAIN_SEGS - 0.5) * TERRAIN_SIZE
    const wz = (j / TERRAIN_SEGS - 0.5) * TERRAIN_SIZE
    heightData[i * GRID + j] = fbm(wx, wz) * 5.5
  }
}

export function getTerrainHeight(wx: number, wz: number): number {
  const nx = (wx / TERRAIN_SIZE + 0.5) * TERRAIN_SEGS
  const nz = (wz / TERRAIN_SIZE + 0.5) * TERRAIN_SEGS
  const ix = Math.max(0, Math.min(TERRAIN_SEGS - 1, Math.floor(nx)))
  const iz = Math.max(0, Math.min(TERRAIN_SEGS - 1, Math.floor(nz)))
  const fx = nx - ix
  const fz = nz - iz
  const h00 = heightData[ix * GRID + iz]
  const h10 = heightData[(ix + 1) * GRID + iz]
  const h01 = heightData[ix * GRID + (iz + 1)]
  const h11 = heightData[(ix + 1) * GRID + (iz + 1)]
  return h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz
}
