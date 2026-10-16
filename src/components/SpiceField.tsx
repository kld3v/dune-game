import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getTerrainHeight } from '../lib/terrain'
import { useGameStore } from '../store/gameStore'

const SPICE_FIELDS = [
  { x: -30, z: 20, radius: 12 },
  { x: 50,  z: -15, radius: 9 },
  { x: -60, z: -40, radius: 14 },
  { x: 25,  z: 55, radius: 10 },
  { x: -10, z: -60, radius: 8 },
  { x: 70,  z: 30, radius: 11 },
]

function SpiceParticles({ x, z, radius }: { x: number; z: number; radius: number }) {
  const meshRef = useRef<THREE.Points>(null!)
  const timeRef = useRef(Math.random() * 100)
  const collected = useRef(false)
  const collectTimer = useRef(0)
  const collectSpice = useGameStore(s => s.collectSpice)
  const playerPos = useGameStore(s => s.playerPosition)

  const [geometry, material] = useMemo(() => {
    const count = 80
    const positions = new Float32Array(count * 3)
    const ground = getTerrainHeight(x, z)
    for (let i = 0; i < count; i++) {
      const r = Math.random() * radius
      const a = Math.random() * Math.PI * 2
      positions[i * 3]     = x + Math.cos(a) * r
      positions[i * 3 + 1] = ground + Math.random() * 3
      positions[i * 3 + 2] = z + Math.sin(a) * r
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.PointsMaterial({
      color: new THREE.Color('#ff8c00'),
      size: 0.5,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    return [geo, mat]
  }, [x, z, radius])

  useFrame((_, dt) => {
    if (collected.current) return
    timeRef.current += dt
    const pos = geometry.attributes.position as THREE.BufferAttribute
    const ground = getTerrainHeight(x, z)
    for (let i = 0; i < pos.count; i++) {
      const t = timeRef.current + i * 0.3
      pos.setY(i, ground + (Math.sin(t * 0.8 + i) * 0.5 + 0.5) * 2.5 + 0.5)
    }
    pos.needsUpdate = true

    // Pulse opacity
    material.opacity = 0.6 + Math.sin(timeRef.current * 2) * 0.25

    // Check if player is in range
    const dx = playerPos.x - x
    const dz = playerPos.z - z
    if (Math.sqrt(dx * dx + dz * dz) < radius + 2) {
      collectTimer.current += dt
      if (collectTimer.current > 0.5) {
        collectSpice(0.006)
        collectTimer.current = 0
      }
    } else {
      collectTimer.current = 0
    }
  })

  return <points ref={meshRef} geometry={geometry} material={material} />
}

export default function SpiceFields() {
  return (
    <>
      {SPICE_FIELDS.map((f, i) => (
        <SpiceParticles key={i} {...f} />
      ))}
    </>
  )
}
