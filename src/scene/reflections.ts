import * as THREE from 'three'

// Metal and glass need something to reflect or they render black. Lighting regenerates a
// small PMREM of the current sky every few seconds and hands it to registered materials.
const materials = new Set<THREE.MeshStandardMaterial>()
let current: THREE.Texture | null = null

export function reflective<T extends THREE.MeshStandardMaterial>(m: T): T {
  materials.add(m)
  if (current) {
    m.envMap = current
    m.needsUpdate = true
  }
  return m
}

export function setReflections(tex: THREE.Texture) {
  const first = current === null
  current = tex
  for (const m of materials) {
    m.envMap = tex
    if (first) m.needsUpdate = true
  }
}
