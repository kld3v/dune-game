import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rt } from '../game/rt'
import { smoothstep } from '../game/math'

// Worms of light circling the sky when the spice runs deep: rings strung along a path.
const COUNT = 3
const RINGS = 34

const Z = new THREE.Vector3(0, 0, 1)
const p = new THREE.Vector3()
const n = new THREE.Vector3()
const q = new THREE.Quaternion()
const s = new THREE.Vector3()
const m = new THREE.Matrix4()
const c = new THREE.Color()

function pathAt(g: number, u: number, out: THREE.Vector3) {
  const rad = (95 + 30 * g) * (1 + 0.15 * Math.sin(3 * u + g))
  const centre = rt.player.pos
  return out.set(
    centre.x + Math.cos(u) * rad,
    centre.y + 35 + 18 * g + 14 * Math.sin(2.3 * u + g),
    centre.z + Math.sin(u) * rad,
  )
}

export function Visions() {
  const { mesh, mat } = useMemo(() => {
    const geo = new THREE.TorusGeometry(1, 0.09, 6, 32)
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
    const mesh = new THREE.InstancedMesh(geo, mat, COUNT * RINGS)
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * RINGS * 3), 3)
    mesh.frustumCulled = false
    mesh.visible = false
    return { mesh, mat }
  }, [])

  useFrame(() => {
    const trip = rt.trip
    mesh.visible = trip > 0.25
    if (!mesh.visible) return
    mat.opacity = smoothstep(0.25, 0.75, trip)
    const t = rt.time
    let i = 0
    for (let g = 0; g < COUNT; g++) {
      const dirSign = g % 2 === 0 ? 1 : -1
      for (let k = 0; k < RINGS; k++) {
        const u = dirSign * (t * (0.11 + g * 0.03) - k * 0.018) + g * 2.1
        pathAt(g, u, p)
        pathAt(g, u + 0.01 * dirSign, n).sub(p).normalize()
        q.setFromUnitVectors(Z, n)
        s.setScalar((5.5 - k * 0.12) * (1 + 0.1 * Math.sin(t * 3 + k * 0.5)))
        m.compose(p, q, s)
        mesh.setMatrixAt(i, m)
        c.setHSL((g * 0.33 + k * 0.02 + t * 0.05) % 1, 0.9, 0.6).multiplyScalar(1.6)
        mesh.setColorAt(i, c)
        i++
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return <primitive object={mesh} />
}
