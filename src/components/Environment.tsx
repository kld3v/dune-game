import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'

// Thump ripple rings
export function ThumpRipples() {
  const thumping = useGameStore(s => s.thumping)
  const progress = useGameStore(s => s.thumpProgress)
  const playerPos = useGameStore(s => s.playerPosition)
  const ring1 = useRef<THREE.Mesh>(null!)
  const ring2 = useRef<THREE.Mesh>(null!)
  const timeRef = useRef(0)

  useFrame((_, dt) => {
    timeRef.current += dt
    const t = timeRef.current
    if (ring1.current) {
      ring1.current.visible = thumping
      if (thumping) {
        ring1.current.position.set(playerPos.x, playerPos.y - 1.5, playerPos.z)
        const s = 1 + Math.sin(t * 8) * 0.2
        ring1.current.scale.set(s + progress * 4, 1, s + progress * 4)
        ;(ring1.current.material as THREE.MeshBasicMaterial).opacity = 0.5 * progress
      }
    }
    if (ring2.current) {
      ring2.current.visible = thumping
      if (thumping) {
        ring2.current.position.set(playerPos.x, playerPos.y - 1.5, playerPos.z)
        const s = 1 + Math.sin(t * 8 + Math.PI) * 0.2
        ring2.current.scale.set((s + progress * 6) * 0.7, 1, (s + progress * 6) * 0.7)
        ;(ring2.current.material as THREE.MeshBasicMaterial).opacity = 0.35 * progress
      }
    }
  })

  return (
    <>
      <mesh ref={ring1} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1, 1.5, 32]} />
        <meshBasicMaterial color="#d4a853" transparent side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring2} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1, 2, 32]} />
        <meshBasicMaterial color="#ff8c00" transparent side={THREE.DoubleSide} />
      </mesh>
    </>
  )
}

// Sand dust particles drifting
export function SandDust() {
  const count = 600
  const geo = useMemo(() => {
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 200
      positions[i * 3 + 1] = Math.random() * 15
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return g
  }, [])

  const mat = useMemo(() => new THREE.PointsMaterial({
    color: '#c8a96e',
    size: 0.12,
    transparent: true,
    opacity: 0.3,
    sizeAttenuation: true,
    depthWrite: false,
  }), [])

  useFrame((_, dt) => {
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < count; i++) {
      let x = pos.getX(i)
      x += dt * 1.5 // Wind from west
      if (x > 100) x -= 200
      pos.setX(i, x)
    }
    pos.needsUpdate = true
  })

  return <points geometry={geo} material={mat} />
}

// Arrakis sky dome
export function Sky() {
  const hallucinationLevel = useGameStore(s => s.hallucinationLevel)
  const mat = useRef<THREE.MeshBasicMaterial>(null!)
  const timeRef = useRef(0)

  useFrame((_, dt) => {
    timeRef.current += dt
    if (!mat.current) return
    // Hallucination tints sky purple
    const base = new THREE.Color('#c45b00')
    const hallucColor = new THREE.Color('#4a0080')
    const current = base.clone().lerp(hallucColor, hallucinationLevel * 0.7)
    mat.current.color = current
  })

  return (
    <group>
      {/* Sky dome */}
      <mesh rotation={[0, 0, 0]}>
        <sphereGeometry args={[280, 32, 16]} />
        <meshBasicMaterial
          ref={mat}
          color="#c45b00"
          side={THREE.BackSide}
        />
      </mesh>
      {/* Horizon band */}
      <mesh rotation={[0, 0, 0]}>
        <cylinderGeometry args={[275, 275, 60, 32, 1, true]} />
        <meshBasicMaterial color="#ff6600" side={THREE.BackSide} transparent opacity={0.4} />
      </mesh>
      {/* Arrakis sun */}
      <mesh position={[60, 80, -200]}>
        <sphereGeometry args={[12, 16, 16]} />
        <meshBasicMaterial color="#fff4cc" />
      </mesh>
      <pointLight position={[60, 80, -200]} color="#fff4cc" intensity={3} distance={1000} />
    </group>
  )
}

// Sandstorm wall
export function Sandstorm() {
  const count = 3000
  const geo = useMemo(() => {
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 400
      positions[i * 3 + 1] = Math.random() * 60
      positions[i * 3 + 2] = (Math.random() - 0.5) * 400
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return g
  }, [])

  const mat = useMemo(() => new THREE.PointsMaterial({
    color: '#c47a2a',
    size: 0.4,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    sizeAttenuation: true,
  }), [])

  useFrame((_, dt) => {
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < count; i++) {
      let x = pos.getX(i) + dt * 3.5
      let y = pos.getY(i)
      y += Math.sin(x * 0.01) * dt * 0.5
      if (x > 200) x -= 400
      if (y > 60) y = 0
      pos.setX(i, x)
      pos.setY(i, y)
    }
    pos.needsUpdate = true
  })

  return <points geometry={geo} material={mat} />
}
