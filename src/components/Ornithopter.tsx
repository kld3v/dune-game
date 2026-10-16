import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getTerrainHeight } from '../lib/terrain'
import { useGameStore } from '../store/gameStore'
import { useControls } from '../hooks/useControls'

const ORTHO_SPEED = 22
const TURN_SPEED = 1.4

export default function Ornithopter() {
  const mode = useGameStore(s => s.mode)
  const orthoPos = useGameStore(s => s.orthoPosition)
  const { setMode, setOrthoTransform, setPlayerTransform } = useGameStore.getState()

  const groupRef = useRef<THREE.Group>(null!)
  const wingLRef = useRef<THREE.Mesh>(null!)
  const wingRRef = useRef<THREE.Mesh>(null!)
  const yawRef = useRef(0)
  const pitchRef = useRef(0)
  const velRef = useRef(new THREE.Vector3())
  const ctrl = useControls()
  const timeRef = useRef(0)

  const wingMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#7ab8d4',
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.1,
    metalness: 0.6,
  }), [])

  const bodyMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#4a3f2f',
    roughness: 0.3,
    metalness: 0.7,
  }), [])

  const glassMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#88ccee',
    transparent: true,
    opacity: 0.35,
    roughness: 0.05,
    metalness: 0.5,
  }), [])

  useFrame((_, dt) => {
    if (!groupRef.current) return
    timeRef.current += dt

    const pos = groupRef.current.position
    const playerPos = useGameStore.getState().playerPosition

    if (mode === 'ornithopter') {
      const c = ctrl.current

      // Turn
      if (c.left)  yawRef.current += TURN_SPEED * dt
      if (c.right) yawRef.current -= TURN_SPEED * dt

      // Pitch
      if (c.forward) pitchRef.current = Math.min(0.4, pitchRef.current + dt * 1.5)
      else if (c.back) pitchRef.current = Math.max(-0.4, pitchRef.current - dt * 1.5)
      else pitchRef.current *= 0.95

      // Altitude
      const altChange = c.up ? 1 : c.down ? -1 : 0

      const forward = new THREE.Vector3(
        Math.sin(yawRef.current), pitchRef.current, Math.cos(yawRef.current)
      ).normalize()

      const speed = ORTHO_SPEED * (c.sprint ? 1.8 : 1)
      velRef.current.lerp(forward.multiplyScalar(speed), 0.08)
      velRef.current.y += altChange * 10 * dt

      pos.addScaledVector(velRef.current, dt)

      // Hover above terrain
      const gnd = getTerrainHeight(pos.x, pos.z)
      const minAlt = gnd + 5
      if (pos.y < minAlt) {
        pos.y = minAlt
        velRef.current.y = Math.max(0, velRef.current.y)
      }
      // Cap height
      if (pos.y > 60) { pos.y = 60; velRef.current.y = 0 }

      groupRef.current.rotation.y = yawRef.current
      groupRef.current.rotation.z = -pitchRef.current * 0.3

      setOrthoTransform(pos, yawRef.current)

      // Player inside cockpit
      const ridePos = pos.clone()
      ridePos.y += 0.5
      setPlayerTransform(ridePos, yawRef.current + Math.PI)

      // E to disembark (when low enough)
      if (c.interact && pos.y < gnd + 8) {
        ctrl.current.interact = false
        setMode('foot')
        const landPos = pos.clone()
        landPos.y = gnd + 2
        setPlayerTransform(landPos, yawRef.current)
      }

      // Wing beat fast when flying
      const beatFreq = 8 + velRef.current.length() * 0.3
      const beatAmp = 0.6
      if (wingLRef.current) wingLRef.current.rotation.y = Math.sin(timeRef.current * beatFreq) * beatAmp
      if (wingRRef.current) wingRRef.current.rotation.y = -Math.sin(timeRef.current * beatFreq) * beatAmp

    } else {
      // Idle hover on ground
      const gnd = getTerrainHeight(orthoPos.x, orthoPos.z)
      pos.set(orthoPos.x, gnd + 0.4 + Math.sin(timeRef.current * 0.5) * 0.2, orthoPos.z)
      if (wingLRef.current) wingLRef.current.rotation.y = Math.sin(timeRef.current * 1.5) * 0.15
      if (wingRRef.current) wingRRef.current.rotation.y = -Math.sin(timeRef.current * 1.5) * 0.15

      // Check if player walks up to board
      const dx = playerPos.x - pos.x
      const dz = playerPos.z - pos.z
      const dist = Math.sqrt(dx * dx + dz * dz)

      if (dist < 6 && ctrl.current.interact) {
        ctrl.current.interact = false
        setMode('ornithopter')
      }
    }
  })

  return (
    <group ref={groupRef} position={[orthoPos.x, 5, orthoPos.z]}>
      {/* Main fuselage */}
      <mesh material={bodyMat} castShadow>
        <boxGeometry args={[1.5, 0.8, 5]} />
      </mesh>
      {/* Nose cone */}
      <mesh position={[0, 0, 2.8]} material={bodyMat} castShadow>
        <coneGeometry args={[0.75, 1.5, 8]} />
      </mesh>
      {/* Cockpit glass */}
      <mesh position={[0, 0.5, 1.2]} material={glassMat}>
        <sphereGeometry args={[0.9, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
      </mesh>
      {/* Left wing */}
      <mesh ref={wingLRef} position={[-3.5, 0, 0]} rotation={[0, 0, 0.1]} material={wingMat}>
        <planeGeometry args={[5, 2.5]} />
      </mesh>
      {/* Right wing */}
      <mesh ref={wingRRef} position={[3.5, 0, 0]} rotation={[0, 0, -0.1]} material={wingMat}>
        <planeGeometry args={[5, 2.5]} />
      </mesh>
      {/* Tail fins */}
      <mesh position={[0, 0.5, -2.5]} rotation={[0, 0, 0]} material={bodyMat}>
        <boxGeometry args={[0.15, 1.2, 1.2]} />
      </mesh>
      <mesh position={[0, 0, -2.5]} rotation={[Math.PI / 2, 0, 0]} material={bodyMat}>
        <boxGeometry args={[2, 0.1, 1]} />
      </mesh>
      {/* Engine exhaust glow */}
      <pointLight position={[0, 0, -2.8]} color="#ff6600" intensity={mode === 'ornithopter' ? 3 : 0.5} distance={8} />
    </group>
  )
}
