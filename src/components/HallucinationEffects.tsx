import { useRef, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, Bloom, ChromaticAberration, Vignette, Noise } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import { Vector2 } from 'three'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'

// Floating worm vision during hallucination
function WormVision({ level }: { level: number }) {
  const groupRef = useRef<THREE.Group>(null!)
  const timeRef = useRef(0)
  const { camera } = useThree()

  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color('#8844aa'),
    transparent: true,
    opacity: 0,
    wireframe: true,
  }), [])

  useFrame((_, dt) => {
    if (!groupRef.current) return
    timeRef.current += dt
    const t = timeRef.current

    if (level > 0.4) {
      // Float vision in front of camera
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
      groupRef.current.position.copy(camera.position).addScaledVector(dir, 15)
      groupRef.current.position.y += Math.sin(t * 0.7) * 3
      groupRef.current.rotation.y = t * 0.5
      groupRef.current.rotation.x = Math.sin(t * 0.3) * 0.3
      mat.opacity = (level - 0.4) * 0.8 * Math.abs(Math.sin(t * 0.5))
    } else {
      mat.opacity = 0
    }
  })

  return (
    <group ref={groupRef}>
      {/* Ghost worm segments */}
      {[0, 1, 2, 3].map(i => (
        <mesh key={i} position={[0, i * -3, 0]} material={mat}>
          <torusGeometry args={[3 - i * 0.4, 0.5, 6, 20]} />
        </mesh>
      ))}
    </group>
  )
}

// Spice fractals
function SpiceFractals({ level }: { level: number }) {
  const ref = useRef<THREE.Points>(null!)
  const timeRef = useRef(0)

  const geo = useMemo(() => {
    const count = 500
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const phi = Math.acos(1 - 2 * (i / count))
      const theta = Math.sqrt(count * Math.PI) * phi
      pos[i * 3]     = Math.sin(phi) * Math.cos(theta) * 8
      pos[i * 3 + 1] = Math.cos(phi) * 8
      pos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * 8
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [])

  const mat = useMemo(() => new THREE.PointsMaterial({
    color: '#ffaa00',
    size: 0.15,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), [])

  const { camera } = useThree()

  useFrame((_, dt) => {
    if (!ref.current) return
    timeRef.current += dt
    if (level > 0.3) {
      ref.current.position.copy(camera.position)
      ref.current.rotation.y = timeRef.current * 0.3
      ref.current.rotation.x = timeRef.current * 0.15
      mat.opacity = (level - 0.3) * 0.7
    } else {
      mat.opacity = 0
    }
  })

  return <points ref={ref} geometry={geo} material={mat} />
}

export function HallucinationOverlayObjects() {
  const level = useGameStore(s => s.hallucinationLevel)
  return (
    <>
      <WormVision level={level} />
      <SpiceFractals level={level} />
    </>
  )
}

export function HallucinationPostFX() {
  const level = useGameStore(s => s.hallucinationLevel)
  const bloomStrength = Math.max(0.3, level * 2.5)
  const aberration = level * 0.015
  const noiseOpacity = level * 0.18

  return (
    <EffectComposer>
      <Bloom
        luminanceThreshold={0.2}
        luminanceSmoothing={0.4}
        intensity={bloomStrength}
        mipmapBlur
      />
      {level > 0.1 && (
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={new Vector2(aberration, aberration * 0.7)}
          radialModulation={false}
          modulationOffset={0}
        />
      )}
      {level > 0.05 && (
        <Noise
          blendFunction={BlendFunction.SOFT_LIGHT}
          opacity={noiseOpacity}
          premultiply={false}
        />
      )}
      <Vignette
        eskil={false}
        offset={0.1 + level * 0.3}
        darkness={0.5 + level * 0.4}
        blendFunction={BlendFunction.NORMAL}
      />
    </EffectComposer>
  )
}
