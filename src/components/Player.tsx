import { useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { getTerrainHeight } from '../lib/terrain'
import { useGameStore } from '../store/gameStore'
import { useControls } from '../hooks/useControls'

const SPEED_WALK = 8
const SPEED_RUN  = 16
const GRAVITY    = -25
const JUMP_VEL   = 12
const MOUSE_SENSITIVITY = 0.002

export default function Player() {
  const { camera } = useThree()
  const mode = useGameStore(s => s.mode)
  const playerPos = useGameStore(s => s.playerPosition)
  const {
    setPlayerTransform, setMode, activateWorm, setThumping, setThumpProgress,
    tick,
  } = useGameStore.getState()

  const ctrl = useControls()
  const pos = useRef(new THREE.Vector3(0, 5, 0))
  const vel = useRef(new THREE.Vector3())
  const yaw = useRef(0)
  const pitch = useRef(-0.2)
  const grounded = useRef(false)
  const thumpTimer = useRef(0)
  const camOffset = useRef(new THREE.Vector3())

  useEffect(() => {
    pos.current.copy(playerPos)
  }, [])

  useFrame((_, dt) => {
    tick(dt)
    const c = ctrl.current
    const store = useGameStore.getState()

    // Mouse look
    yaw.current   -= c.mouseDX * MOUSE_SENSITIVITY
    pitch.current -= c.mouseDY * MOUSE_SENSITIVITY
    pitch.current  = Math.max(-1.2, Math.min(0.6, pitch.current))
    c.mouseDX = 0
    c.mouseDY = 0

    if (mode === 'foot') {
      // Movement relative to yaw
      const moveDir = new THREE.Vector3()
      if (c.forward) moveDir.z -= 1
      if (c.back)    moveDir.z += 1
      if (c.left)    moveDir.x -= 1
      if (c.right)   moveDir.x += 1
      moveDir.normalize()

      const rotated = moveDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw.current)
      const speed = c.sprint ? SPEED_RUN : SPEED_WALK
      vel.current.x = rotated.x * speed
      vel.current.z = rotated.z * speed

      // Gravity
      const gnd = getTerrainHeight(pos.current.x, pos.current.z)
      if (grounded.current && c.up) {
        vel.current.y = JUMP_VEL
        grounded.current = false
      }
      vel.current.y += GRAVITY * dt

      pos.current.addScaledVector(vel.current, dt)

      // Terrain collision
      const groundY = gnd + 1.8
      if (pos.current.y < groundY) {
        pos.current.y = groundY
        vel.current.y = 0
        grounded.current = true
      } else {
        grounded.current = false
      }

      // Bound to terrain area
      pos.current.x = Math.max(-145, Math.min(145, pos.current.x))
      pos.current.z = Math.max(-145, Math.min(145, pos.current.z))

      setPlayerTransform(pos.current, yaw.current)

      // Thumping mechanic
      if (c.thump && grounded.current && !store.wormActive) {
        thumpTimer.current += dt
        setThumping(true)
        setThumpProgress(Math.min(1, thumpTimer.current / 3))
        if (thumpTimer.current >= 3) {
          // Summon worm
          const wormSpawnPos = pos.current.clone()
          wormSpawnPos.x += Math.sin(yaw.current) * 15
          wormSpawnPos.z += Math.cos(yaw.current) * 15
          wormSpawnPos.y = getTerrainHeight(wormSpawnPos.x, wormSpawnPos.z)
          activateWorm(wormSpawnPos)
          setMode('worm')
          setThumping(false)
          thumpTimer.current = 0
          setThumpProgress(0)
        }
      } else if (!c.thump) {
        thumpTimer.current = Math.max(0, thumpTimer.current - dt * 2)
        setThumping(false)
        setThumpProgress(Math.max(0, thumpTimer.current / 3))
      }

    } else {
      // Worm/ortho mode: sync from store
      pos.current.copy(store.playerPosition)
      yaw.current = store.playerYaw
    }

    // --- Camera ---
    const eyePos = pos.current.clone()
    if (mode === 'ornithopter') {
      eyePos.y += 0.5
    }

    if (mode === 'foot') {
      // Third person follow cam
      const camDist = 7
      const camHeight = 3.5
      const idealCam = new THREE.Vector3(
        eyePos.x - Math.sin(yaw.current) * camDist,
        eyePos.y + camHeight,
        eyePos.z - Math.cos(yaw.current) * camDist
      )
      camOffset.current.lerp(idealCam, 0.12)
      // Don't clip into terrain
      const camGnd = getTerrainHeight(camOffset.current.x, camOffset.current.z)
      if (camOffset.current.y < camGnd + 1.5) camOffset.current.y = camGnd + 1.5
      camera.position.copy(camOffset.current)
      camera.lookAt(
        eyePos.x,
        eyePos.y + 1.2,
        eyePos.z
      )
    } else if (mode === 'worm') {
      // High dramatic cam behind worm
      const wormYaw = store.wormDirection
      const camDist = 18
      const camH = 12
      const idealCam = new THREE.Vector3(
        eyePos.x - Math.sin(wormYaw) * camDist,
        eyePos.y + camH,
        eyePos.z - Math.cos(wormYaw) * camDist
      )
      camOffset.current.lerp(idealCam, 0.06)
      camera.position.copy(camOffset.current)
      camera.lookAt(eyePos.x, eyePos.y + 2, eyePos.z)
    } else if (mode === 'ornithopter') {
      // First-person ish cockpit view
      camera.position.copy(eyePos)
      camera.position.y += 0.8
      const lookDir = new THREE.Vector3(
        Math.sin(store.orthoDirection),
        pitch.current * 0.5,
        Math.cos(store.orthoDirection)
      )
      camera.lookAt(camera.position.clone().add(lookDir))
    }
  })

  // Player mesh (only visible in foot mode from worm/ortho cams)
  return (
    <group position={playerPos}>
      {/* Body */}
      <mesh position={[0, 0, 0]} castShadow>
        <capsuleGeometry args={[0.4, 1.2, 4, 8]} />
        <meshStandardMaterial color="#3d4a2e" roughness={0.8} metalness={0.1} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.3, 0]} castShadow>
        <sphereGeometry args={[0.35, 8, 8]} />
        <meshStandardMaterial color="#d4a373" roughness={0.9} />
      </mesh>
      {/* Stillsuit wrap */}
      {mode === 'foot' && (
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.5, 0.45, 1.0, 8]} />
          <meshStandardMaterial color="#2c3020" roughness={0.9} />
        </mesh>
      )}
    </group>
  )
}
