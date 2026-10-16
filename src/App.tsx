import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import * as THREE from 'three'
import Terrain from './components/Terrain'
import Player from './components/Player'
import Sandworm from './components/Sandworm'
import Ornithopter from './components/Ornithopter'
import SpiceFields from './components/SpiceField'
import { Sky, SandDust, Sandstorm, ThumpRipples } from './components/Environment'
import { HallucinationPostFX, HallucinationOverlayObjects } from './components/HallucinationEffects'
import HUD from './components/HUD'

function Scene() {
  return (
    <>
      <Sky />
      <SandDust />
      <Sandstorm />

      <ambientLight intensity={0.4} color="#ffe8aa" />
      <directionalLight
        position={[60, 80, -200]}
        intensity={2.5}
        color="#fff4cc"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={500}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
      />
      <hemisphereLight args={['#c45b00', '#4a2a00', 0.5]} />
      <fog attach="fog" args={['#c45b00', 80, 260]} />

      <Terrain />
      <SpiceFields />
      <ThumpRipples />
      <Player />
      <Sandworm />
      <Ornithopter />
      <HallucinationOverlayObjects />
      <HallucinationPostFX />
    </>
  )
}

export default function App() {
  return (
    <>
      <Canvas
        camera={{ fov: 70, near: 0.1, far: 600, position: [0, 10, 15] }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
        }}
        shadows
        style={{ position: 'fixed', inset: 0 }}
      >
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
      <HUD />
    </>
  )
}
