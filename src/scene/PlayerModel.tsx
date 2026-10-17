import { useEffect, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { rt } from '../game/rt'
import { clamp } from '../game/math'
import { reflective } from './reflections'

const MODEL_URL = '/models/arissa.glb'
const HEIGHT = 1.8

type Clip = 'idle' | 'walk' | 'jog' | 'sprint' | 'sneak' | 'jump' | 'fall' | 'ride' | 'drink'
// Ground speed at which each in-place locomotion clip's feet stop sliding.
const NOMINAL: Partial<Record<Clip, number>> = { walk: 1.45, jog: 4.3, sprint: 7.4, sneak: 1.3 }
const ONE_SHOT = new Set<Clip>(['jump', 'drink'])

interface Rig {
  root: THREE.Group
  mixer: THREE.AnimationMixer
  actions: Map<string, THREE.AnimationAction>
  current: Clip | null
  hands: THREE.Object3D[]
  hooks: THREE.Mesh[]
}

function loadRig(): Promise<Rig> {
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  return loader.loadAsync(MODEL_URL).then((gltf) => {
    const model = gltf.scene
    model.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      m.castShadow = true
      m.receiveShadow = true
      m.frustumCulled = false
      // Arissa's texture is near-black leather; lift it toward desert-worn cloth.
      const mat = reflective(m.material as THREE.MeshStandardMaterial)
      mat.metalness = 0
      mat.roughness = 0.8
      mat.color.setRGB(2.1, 1.75, 1.4)
      mat.envMapIntensity = 0.6
    })
    const box = new THREE.Box3().setFromObject(model)
    model.scale.setScalar(HEIGHT / Math.max(0.1, box.max.y - box.min.y))
    const root = new THREE.Group()
    root.add(model)
    const mixer = new THREE.AnimationMixer(model)
    const actions = new Map<string, THREE.AnimationAction>()
    for (const clip of gltf.animations) {
      const a = mixer.clipAction(clip)
      if (ONE_SHOT.has(clip.name as Clip)) {
        a.setLoop(THREE.LoopOnce, 1)
        a.clampWhenFinished = true
      }
      actions.set(clip.name, a)
    }
    const hands = ['mixamorigLeftHand', 'mixamorigRightHand']
      .map((n) => model.getObjectByName(n))
      .filter((h): h is THREE.Object3D => !!h)
    const hookMat = reflective(new THREE.MeshStandardMaterial({ color: '#8a7f6e', roughness: 0.35, metalness: 0.75 }))
    const hookGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6)
    const hooks = hands.map(() => {
      const h = new THREE.Mesh(hookGeo, hookMat)
      h.castShadow = true
      h.visible = false
      return h
    })
    return { root, mixer, actions, current: null, hands, hooks }
  })
}

function play(rig: Rig, name: Clip, fade: number) {
  if (rig.current === name) return
  const next = rig.actions.get(name) ?? rig.actions.get('idle')
  if (!next) return
  const prev = rig.current ? rig.actions.get(rig.current) : undefined
  next.reset()
  if (name === 'jump') next.time = next.getClip().duration * 0.28
  if (name === 'drink') next.time = 2.0
  next.setEffectiveWeight(1).fadeIn(fade).play()
  if (prev && prev !== next) prev.fadeOut(fade)
  rig.current = name
}

function pickClip(): Clip {
  const p = rt.player
  if (rt.mode === 'worm') return 'ride'
  if (!p.grounded && (p.vel.y > 2 || p.airTime > 0.25)) return p.vel.y > 2 ? 'jump' : 'fall'
  if (p.speed < 0.6) return rt.time - rt.doseAt < 3.6 ? 'drink' : 'idle'
  if (p.sandwalk) return 'sneak'
  if (p.running) return 'sprint'
  return p.speed < 2.8 ? 'walk' : 'jog'
}

const Y = new THREE.Vector3(0, 1, 0)
const a = new THREE.Vector3()
const b = new THREE.Vector3()
const d = new THREE.Vector3()

// Two maker hooks run from her hands down into the worm's back.
function placeHooks(rig: Rig, riding: boolean) {
  rig.hooks.forEach((h, i) => {
    h.visible = riding
    if (!riding) return
    rig.hands[i].getWorldPosition(a)
    const yaw = rt.player.yaw
    const side = i === 0 ? 1 : -1
    b.set(
      rt.player.pos.x + Math.sin(yaw) * 0.9 - Math.cos(yaw) * side * 0.45,
      rt.player.pos.y - 0.6,
      rt.player.pos.z + Math.cos(yaw) * 0.9 + Math.sin(yaw) * side * 0.45,
    )
    d.subVectors(a, b)
    const len = d.length()
    h.position.addVectors(a, b).multiplyScalar(0.5)
    h.quaternion.setFromUnitVectors(Y, d.divideScalar(len || 1))
    h.scale.set(1, len, 1)
  })
}

// The simple robed figure: shown until the Mixamo character has loaded, or if it fails.
function buildFallback() {
  const root = new THREE.Group()
  const robe = new THREE.MeshStandardMaterial({ color: '#9a7a54', roughness: 0.95, side: THREE.DoubleSide })
  const suit = reflective(new THREE.MeshStandardMaterial({ color: '#4a4038', roughness: 0.6, metalness: 0.25 }))
  const pts = [
    [0.0, 1.62], [0.17, 1.6], [0.27, 1.52], [0.33, 1.38], [0.34, 1.12],
    [0.37, 0.8], [0.42, 0.45], [0.47, 0.16], [0.5, 0.06],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const cloak = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), robe)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), suit)
  head.position.y = 1.8
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 10, Math.PI / 2 + 0.7, Math.PI * 2 - 1.4, 0, Math.PI * 0.6), robe)
  hood.position.y = 1.8
  for (const m of [cloak, head, hood]) {
    m.castShadow = true
    root.add(m)
  }
  return root
}

export function PlayerModel() {
  const fallback = useMemo(buildFallback, [])
  const [rig, setRig] = useState<Rig | null>(null)

  useEffect(() => {
    let alive = true
    loadRig()
      .then((r) => {
        // Without locomotion clips she would glide around in her idle pose; keep the fallback.
        if (alive && r.actions.has('jog')) setRig(r)
      })
      .catch((e) => console.warn('Character failed to load; keeping the fallback figure.', e))
    return () => {
      alive = false
    }
  }, [])

  useFrame((_, delta) => {
    const p = rt.player
    const dead = rt.phase === 'dead' && rt.deathReason === 'worm'
    const visible = rt.mode !== 'thopter' && !dead
    const body = rig ? rig.root : fallback
    fallback.visible = !rig && visible
    if (rig) rig.root.visible = visible
    if (!visible) {
      if (rig) placeHooks(rig, false)
      return
    }
    body.position.copy(p.pos)
    body.rotation.y = p.yaw
    if (!rig) {
      body.position.y += Math.abs(Math.sin(p.walkPhase * Math.PI * 2)) * 0.05 * clamp(p.speed / 6, 0, 1)
      return
    }
    const clip = pickClip()
    play(rig, clip, clip === 'jump' ? 0.1 : 0.22)
    const action = rig.actions.get(clip)
    const nominal = NOMINAL[clip]
    if (action) action.timeScale = nominal ? clamp(p.speed / nominal, 0.6, 1.6) : 1
    rig.mixer.update(Math.min(delta, 0.1))
    rig.root.updateMatrixWorld(true)
    placeHooks(rig, rt.mode === 'worm')
  })

  return (
    <>
      <primitive object={fallback} />
      {rig ? <primitive object={rig.root} /> : null}
      {rig ? rig.hooks.map((h, i) => <primitive key={i} object={h} />) : null}
    </>
  )
}
