import { useEffect, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { rt, type Sietch } from '../game/rt'
import { clamp, dampAngle } from '../game/math'
import { reflective } from './reflections'

const MODEL_URL = '/models/arissa.glb'
const SITES = 3
const PEOPLE = 4
const ALLIES = 2

const stone = reflective(new THREE.MeshStandardMaterial({ color: '#6e5641', roughness: 0.95, metalness: 0, flatShading: true }))
const dark = new THREE.MeshBasicMaterial({ color: '#060403' })
const metal = reflective(new THREE.MeshStandardMaterial({ color: '#4d433a', roughness: 0.5, metalness: 0.6, flatShading: true }))
const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color() })
const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.95, 3.4) })
const LAMP = new THREE.Color(2.4, 1.3, 0.5)

// The gate of a sietch: pillars and a lintel over a stair cut down into the rock, with
// windtraps pulling water from the air behind it. Forward (+Z) faces out over the sand.
function buildSite() {
  const g = new THREE.Group()
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.rotation.y = ry
    m.castShadow = true
    m.receiveShadow = true
    g.add(m)
    return m
  }
  const pillar = new THREE.BoxGeometry(1.4, 7.4, 1.4)
  add(pillar, stone, -2.5, 2.0, 0)
  add(pillar, stone, 2.5, 2.0, 0)
  add(new THREE.BoxGeometry(6.8, 1.1, 1.9), stone, 0, 6.2, 0)
  const wall = new THREE.BoxGeometry(0.6, 2.4, 7.4)
  add(wall, stone, -2.1, 0.5, -3.6)
  add(wall, stone, 2.1, 0.5, -3.6)
  // At the end of the walled way, the door into the rock.
  add(new THREE.BoxGeometry(6.2, 5.2, 2.2), stone, 0, 1.6, -8.4)
  add(new THREE.PlaneGeometry(2.4, 3.3), dark, 0, 1.55, -7.28)
  const trap = new THREE.CylinderGeometry(0.35, 0.65, 8, 6)
  const fin = new THREE.BoxGeometry(0.08, 5, 0.9)
  const cap = new THREE.ConeGeometry(0.75, 1.2, 6)
  for (const [x, z] of [[-9, -6], [9.5, -7], [13, 1.5]]) {
    add(trap, metal, x, 2.2, z)
    for (let k = 0; k < 4; k++) add(fin, metal, x + Math.sin((k * Math.PI) / 2) * 0.45, 3.4, z + Math.cos((k * Math.PI) / 2) * 0.45, (k * Math.PI) / 2)
    add(cap, metal, x, 6.8, z)
  }
  const lamp = new THREE.SphereGeometry(0.22, 10, 8)
  add(lamp, lampMat, -2.5, 5.9, 0.8)
  add(lamp, lampMat, 2.5, 5.9, 0.8)
  g.visible = false
  return g
}

interface Person {
  root: THREE.Group
  mixer: THREE.AnimationMixer
  actions: Map<string, THREE.AnimationAction>
  current: string
  head: THREE.Object3D | null
  eyes: THREE.Mesh[]
  yaw: number
  slot: string
}

// Stillsuit greys and browns over Arissa's leathers; each Fremen a little different.
const TINTS = [new THREE.Color(1.15, 1.02, 0.88), new THREE.Color(0.85, 0.8, 0.74), new THREE.Color(1.3, 1.0, 0.78), new THREE.Color(0.95, 0.95, 0.98)]

function makePerson(tmpl: THREE.Object3D, clips: THREE.AnimationClip[], i: number, knife: boolean): Person {
  const model = cloneSkinned(tmpl)
  model.scale.multiplyScalar(0.94 + 0.12 * ((i * 0.618) % 1))
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.castShadow = true
    m.frustumCulled = false
    const mat = (m.material as THREE.MeshStandardMaterial).clone()
    mat.color.copy(TINTS[i % TINTS.length])
    mat.metalness = 0
    mat.roughness = 0.85
    m.material = reflective(mat)
  })
  const root = new THREE.Group()
  root.add(model)
  const mixer = new THREE.AnimationMixer(model)
  const actions = new Map<string, THREE.AnimationAction>()
  for (const c of clips) actions.set(c.name, mixer.clipAction(c))
  actions.get('idle')?.play()
  if (knife) {
    const hand = model.getObjectByName('mixamorigRightHand')
    if (hand) {
      const s = new THREE.Vector3()
      model.updateMatrixWorld(true)
      hand.getWorldScale(s)
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 0.012), reflective(new THREE.MeshStandardMaterial({ color: '#efe8d8', roughness: 0.3 })))
      blade.scale.setScalar(1 / s.x)
      blade.position.set(0, 0.28 / s.x, 0.04 / s.x)
      blade.castShadow = true
      hand.add(blade)
    }
  }
  const eyeGeo = new THREE.SphereGeometry(0.013, 6, 4)
  const eyes = [new THREE.Mesh(eyeGeo, eyeMat), new THREE.Mesh(eyeGeo, eyeMat)]
  root.visible = false
  return { root, mixer, actions, current: 'idle', head: model.getObjectByName('mixamorigHead') ?? null, eyes, yaw: 0, slot: '' }
}

function play(p: Person, name: string) {
  if (p.current === name) return
  const next = p.actions.get(name) ?? p.actions.get('idle')
  const prev = p.actions.get(p.current)
  if (!next) return
  next.reset().fadeIn(0.25).play()
  if (prev && prev !== next) prev.fadeOut(0.25)
  p.current = name
}

const hp = new THREE.Vector3()

// The Ibad: eyes blue with a lifetime of spice, glowing under the hood.
function placeEyes(p: Person, yaw: number) {
  if (!p.head) return
  p.head.getWorldPosition(hp)
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? 1 : -1
    p.eyes[k].position.set(hp.x + fx * 0.085 - fz * side * 0.032, hp.y + 0.075, hp.z + fz * 0.085 + fx * side * 0.032)
    p.eyes[k].visible = true
  }
}

function nearestSites(px: number, pz: number, n: number, range: number): Sietch[] {
  return rt.sietches
    .map((s) => ({ s, d: Math.hypot(s.x - px, s.z - pz) }))
    .filter((e) => e.d < range)
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((e) => e.s)
}

export function Sietches() {
  const sites = useMemo(() => Array.from({ length: SITES }, buildSite), [])
  const [gltf, setGltf] = useState<{ scene: THREE.Object3D; clips: THREE.AnimationClip[] } | null>(null)
  const people = useMemo(() => (gltf ? Array.from({ length: PEOPLE }, (_, i) => makePerson(gltf.scene, gltf.clips, i, i > 0)) : []), [gltf])
  const allies = useMemo(() => (gltf ? Array.from({ length: ALLIES }, (_, i) => makePerson(gltf.scene, gltf.clips, i + 1, true)) : []), [gltf])

  useEffect(() => {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.load(MODEL_URL, (g) => {
      const box = new THREE.Box3().setFromObject(g.scene)
      g.scene.scale.setScalar(1.8 / Math.max(0.1, box.max.y - box.min.y))
      setGltf({ scene: g.scene, clips: g.animations })
    }, undefined, () => {
      // Without the model the sietch still stands; its people stay inside.
    })
  }, [])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    const p = rt.player.pos
    lampMat.color.copy(LAMP).multiplyScalar(0.35 + 1.8 * rt.env.night)
    const near = nearestSites(p.x, p.z, SITES, 900)
    sites.forEach((g, i) => {
      const s = near[i]
      g.visible = !!s
      if (!s) return
      g.position.set(s.x, s.y, s.z)
      g.rotation.y = s.yaw
    })

    // The people of the nearest sietch: they turn to watch you come.
    const home = near[0] && Math.hypot(near[0].x - p.x, near[0].z - p.z) < 300 ? near[0] : null
    people.forEach((v, i) => {
      const n = home?.npcs[i]
      v.root.visible = !!n
      v.eyes.forEach((e) => (e.visible = false))
      if (!n || !home) return
      const slot = `${home.key}:${i}`
      if (v.slot !== slot) {
        v.slot = slot
        v.yaw = n.yaw
      }
      const d = Math.hypot(p.x - n.x, p.z - n.z)
      const want = d < 24 ? Math.atan2(p.x - n.x, p.z - n.z) : n.yaw
      v.yaw = dampAngle(v.yaw, want, 2.5, dt)
      v.root.position.set(n.x, n.y, n.z)
      v.root.rotation.y = v.yaw
      play(v, 'idle')
      v.mixer.update(dt * (0.8 + 0.1 * i))
      v.root.updateMatrixWorld(true)
      placeEyes(v, v.yaw)
    })

    allies.forEach((v, i) => {
      const a = rt.allies[i]
      v.root.visible = !!a
      v.eyes.forEach((e) => (e.visible = false))
      if (!a) return
      v.root.position.copy(a.pos)
      v.root.rotation.y = a.yaw
      play(v, a.anim)
      const act = v.actions.get(a.anim)
      const nominal = a.anim === 'sprint' ? 7.4 : a.anim === 'jog' ? 4.3 : a.anim === 'walk' ? 1.45 : 0
      if (act) act.timeScale = nominal ? clamp(a.speed / nominal, 0.6, 1.6) : 1
      v.mixer.update(dt)
      v.root.updateMatrixWorld(true)
      placeEyes(v, a.yaw)
    })
  })

  return (
    <>
      {sites.map((g, i) => (
        <primitive key={`s${i}`} object={g} />
      ))}
      {[...people, ...allies].map((v, i) => (
        <group key={`p${i}`}>
          <primitive object={v.root} />
          <primitive object={v.eyes[0]} />
          <primitive object={v.eyes[1]} />
        </group>
      ))}
    </>
  )
}
