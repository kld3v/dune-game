import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getTerrainHeight } from '../lib/terrain'
import { useGameStore } from '../store/gameStore'
import { useControls } from '../hooks/useControls'

const SEGMENTS = 22
const SEG_LEN = 3.5
const WORM_RADIUS = 2.2
const WORM_SPEED = 18

// Segment positions for worm chain
const segPositions: THREE.Vector3[] = Array.from({ length: SEGMENTS }, () => new THREE.Vector3())

function WormSegment({ index, material }: {
  index: number
  material: THREE.Material
}) {
  const meshRef = useRef<THREE.Mesh>(null!)

  useFrame(() => {
    if (!meshRef.current) return
    const pos = segPositions[index]
    if (!pos) return
    meshRef.current.position.copy(pos)
    if (index < SEGMENTS - 1) {
      const next = segPositions[index + 1]
      meshRef.current.lookAt(next)
      meshRef.current.rotateX(Math.PI / 2)
    }
    // Scale down tail segments
    const scale = 1 - (index / SEGMENTS) * 0.4
    meshRef.current.scale.setScalar(scale)
    // Rings slightly visible above sand
    meshRef.current.visible = pos.y > getTerrainHeight(pos.x, pos.z) - WORM_RADIUS * 0.5
  })

  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(WORM_RADIUS, WORM_RADIUS * 0.85, SEG_LEN * 0.9, 16)
    return g
  }, [])

  return <mesh ref={meshRef} geometry={geo} material={material} castShadow />
}

function WormHead({ material }: { material: THREE.Material }) {
  const meshRef = useRef<THREE.Mesh>(null!)
  const mouthRef = useRef<THREE.Mesh>(null!)

  useFrame((state) => {
    if (!meshRef.current) return
    const pos = segPositions[0]
    meshRef.current.position.copy(pos)
    if (segPositions[1]) {
      meshRef.current.lookAt(segPositions[1])
      meshRef.current.rotateX(Math.PI / 2)
    }
    // Animate mouth opening
    const mouthOpen = Math.abs(Math.sin(state.clock.elapsedTime * 2)) * 0.3 + 0.7
    if (mouthRef.current) mouthRef.current.scale.set(mouthOpen, mouthOpen, 1)
  })

  const headGeo = useMemo(() => new THREE.SphereGeometry(WORM_RADIUS * 1.2, 16, 12), [])
  const toothMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#e8d5b0', roughness: 0.4, metalness: 0.1
  }), [])

  return (
    <group ref={meshRef}>
      <mesh geometry={headGeo} material={material} castShadow />
      <mesh ref={mouthRef}>
        <torusGeometry args={[WORM_RADIUS * 0.7, 0.5, 6, 32]} />
        <primitive object={toothMat} />
      </mesh>
      {/* Teeth rings */}
      {[0.3, 0.7, 1.1].map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <torusGeometry args={[WORM_RADIUS * 0.75, 0.2, 4, 20]} />
          <primitive object={toothMat} />
        </mesh>
      ))}
    </group>
  )
}

export default function Sandworm() {
  const wormActive = useGameStore(s => s.wormActive)
  const mode = useGameStore(s => s.mode)
  const wormPos = useGameStore(s => s.wormPosition)
  const wormDir = useRef(0)
  const emergenceTime = useRef(0)
  const ctrl = useControls()
  const { setWormTransform, setPlayerTransform, deactivateWorm } = useGameStore.getState()

  // Sand disturbance ring
  const ringRef = useRef<THREE.Mesh>(null!)
  const sandRef = useRef<THREE.Points>(null!)

  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color('#2a1a0a'),
    roughness: 0.7,
    metalness: 0.35,
    envMapIntensity: 0.8,
  }), [])

  const sandGeo = useMemo(() => {
    const count = 200
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * 6
      positions[i * 3]     = Math.cos(a) * r
      positions[i * 3 + 1] = Math.random() * 3
      positions[i * 3 + 2] = Math.sin(a) * r
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return geo
  }, [])

  const sandMat = useMemo(() => new THREE.PointsMaterial({
    color: '#d4a853',
    size: 0.15,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), [])

  // Initialize segment positions underground
  useEffect(() => {
    const base = wormPos
    for (let i = 0; i < SEGMENTS; i++) {
      segPositions[i].set(
        base.x, base.y - 15 - i * SEG_LEN, base.z
      )
    }
  }, [wormPos])

  useFrame((state, dt) => {
    if (!wormActive) return

    emergenceTime.current += dt
    const emerged = Math.min(1, emergenceTime.current / 2.5)

    // Update worm direction from controls
    if (mode === 'worm') {
      const c = ctrl.current
      if (c.left)  wormDir.current += dt * 1.2
      if (c.right) wormDir.current -= dt * 1.2

      const speed = WORM_SPEED * (c.sprint ? 1.6 : 1)
      const dx = Math.sin(wormDir.current) * speed * dt
      const dz = Math.cos(wormDir.current) * speed * dt

      segPositions[0].x += dx
      segPositions[0].z += dz

      // Bound to terrain
      const gnd = getTerrainHeight(segPositions[0].x, segPositions[0].z)
      const targetY = gnd + WORM_RADIUS * 1.4 * emerged - (1 - emerged) * 8
      segPositions[0].y += (targetY - segPositions[0].y) * 0.15

      // Chain segments follow head
      for (let i = 1; i < SEGMENTS; i++) {
        const prev = segPositions[i - 1]
        const curr = segPositions[i]
        const dx = prev.x - curr.x
        const dy = prev.y - curr.y
        const dz = prev.z - curr.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist > SEG_LEN) {
          const factor = (dist - SEG_LEN) / dist * 0.5
          curr.x += dx * factor
          curr.y += dy * factor
          curr.z += dz * factor
        }
        // Segments go underground toward tail
        const segGnd = getTerrainHeight(curr.x, curr.z)
        const segTargetY = segGnd - (i / SEGMENTS) * WORM_RADIUS * 3 + WORM_RADIUS * emerged
        curr.y += (segTargetY - curr.y) * 0.05
      }

      setWormTransform(segPositions[0], wormDir.current)

      // Player rides on worm back
      const ridePos = segPositions[2].clone()
      ridePos.y = segPositions[0].y + WORM_RADIUS * 1.1
      setPlayerTransform(ridePos, wormDir.current + Math.PI)

      // E to dismount
      if (c.interact) {
        ctrl.current.interact = false
        deactivateWorm()
        emergenceTime.current = 0
      }
    }

    // Sand spray particles at head
    if (sandRef.current) {
      sandRef.current.position.copy(segPositions[0])
      const ppos = sandRef.current.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < ppos.count; i++) {
        let y = ppos.getY(i)
        y -= dt * 4
        if (y < -1) y = Math.random() * 2
        ppos.setY(i, y)
      }
      ppos.needsUpdate = true
      sandMat.opacity = emerged * 0.6
    }

    // Disturbance ring
    if (ringRef.current) {
      ringRef.current.position.copy(segPositions[0])
      ringRef.current.position.y = getTerrainHeight(segPositions[0].x, segPositions[0].z) + 0.1
      const s = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.3
      ringRef.current.scale.set(s, 1, s)
    }
  })

  if (!wormActive) return null

  return (
    <group>
      {/* Segments */}
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <WormSegment key={i} index={i} material={material} />
      ))}
      <WormHead material={material} />
      {/* Sand spray */}
      <points ref={sandRef} geometry={sandGeo} material={sandMat} />
      {/* Ground disturbance */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[WORM_RADIUS + 0.5, WORM_RADIUS + 2, 24]} />
        <meshBasicMaterial color="#d4a853" transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}
