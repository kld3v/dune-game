import { useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { initInput } from './game/input'
import { pauseGame, update } from './game/sim'
import { Terrain } from './scene/Terrain'
import { Sky } from './scene/Sky'
import { Lighting } from './scene/Lighting'
import { PlayerModel } from './scene/PlayerModel'
import { Thopter } from './scene/Thopter'
import { Worms } from './scene/Worms'
import { Thumper } from './scene/Thumper'
import { Particles } from './scene/Particles'
import { Visions } from './scene/Visions'
import { Harkonnens } from './scene/Harkonnens'
import { Carrier } from './scene/Carrier'
import { Storm } from './scene/Storm'
import { Future } from './scene/Future'
import { Sietches } from './scene/Sietches'
import { City } from './scene/City'
import { Cave } from './scene/Cave'
import { PostFX } from './scene/PostFX'
import { HUD } from './ui/HUD'
import { Screens } from './ui/Screens'

// Must stay the first useFrame subscriber: it runs the whole simulation, then every
// render component reads the fresh state in its own useFrame.
function GameLoop() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, unknown>).__scene = scene
  }, [scene])
  useFrame((_, delta) => update(delta, camera))
  return null
}

export default function App() {
  return (
    <>
      <Canvas
        flat
        shadows="percentage"
        dpr={[1, 1.5]}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: 62, near: 0.3, far: 5000, position: [0, 40, 0] }}
        onCreated={({ gl }) => initInput(gl.domElement, { onUnlock: pauseGame, onEscape: pauseGame })}
      >
        <GameLoop />
        <Lighting />
        <Sky />
        <Terrain />
        <PlayerModel />
        <Thopter />
        <Worms />
        <Thumper />
        <Harkonnens />
        <Carrier />
        <Storm />
        <Future />
        <Sietches />
        <City />
        <Cave />
        <Particles />
        <Visions />
        <PostFX />
      </Canvas>
      <HUD />
      <Screens />
    </>
  )
}
