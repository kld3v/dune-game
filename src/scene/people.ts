import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { reflective } from './reflections'

// Everyone who is not the player: which model plays each part, and how they are dressed.

export type Role = 'naib' | 'elder' | 'fremen' | 'fremenWoman' | 'mother' | 'fedaykin' | 'townsman' | 'townswoman' | 'merchant' | 'guard'

interface CastEntry {
  url: string
  // Dyes Arissa when she stands in for the part: her leathers are near black.
  tint: THREE.Color
  // A lighter dye over a real model's own colours, so one model can play several parts.
  dye?: THREE.Color
}

const FALLBACK = '/models/arissa.glb'

// Mixamo characters (see public/models/cast). Heraklios, hooded and masked, is the Fremen
// who lead and fight; Survivor the desert hands; the city has its own people.
export const CAST: Record<Role, CastEntry> = {
  naib: { url: '/models/cast/heraklios.glb', tint: new THREE.Color(1.15, 1.02, 0.88), dye: new THREE.Color(1.12, 0.98, 0.84) },
  elder: { url: '/models/cast/heraklios.glb', tint: new THREE.Color(1.15, 1.02, 0.88), dye: new THREE.Color(0.82, 0.84, 0.95) },
  fremen: { url: '/models/cast/survivor.glb', tint: new THREE.Color(0.85, 0.8, 0.74), dye: new THREE.Color(1.0, 0.95, 0.88) },
  fremenWoman: { url: FALLBACK, tint: new THREE.Color(1.3, 1.0, 0.78) },
  mother: { url: FALLBACK, tint: new THREE.Color(0.55, 0.5, 0.58) },
  fedaykin: { url: '/models/cast/heraklios.glb', tint: new THREE.Color(0.95, 0.95, 0.98), dye: new THREE.Color(0.9, 0.88, 0.86) },
  townsman: { url: '/models/cast/abe.glb', tint: new THREE.Color(1.9, 1.75, 1.5) },
  townswoman: { url: '/models/cast/peasant-girl.glb', tint: new THREE.Color(1.6, 1.3, 1.0) },
  merchant: { url: '/models/cast/peasant-man.glb', tint: new THREE.Color(2.0, 1.3, 0.9) },
  guard: { url: '/models/cast/castle-guard.glb', tint: new THREE.Color(0.75, 0.95, 0.8) },
}

// Stilgar is always Stilgar; elsewhere the Naib is one of two old desert hands.
export function leaderRole(naib: string, key: string): Role {
  if (naib === 'Stilgar') return 'naib'
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return h & 1 ? 'elder' : 'naib'
}

export interface CharacterAsset {
  url: string
  scene: THREE.Object3D
  clips: THREE.AnimationClip[]
}

const cache = new Map<string, Promise<CharacterAsset>>()

export function loadCharacter(url: string): Promise<CharacterAsset> {
  let p = cache.get(url)
  if (!p) {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    p = loader.loadAsync(url).then((g) => {
      const box = new THREE.Box3().setFromObject(g.scene)
      g.scene.scale.setScalar(1.8 / Math.max(0.1, box.max.y - box.min.y))
      return { url, scene: g.scene, clips: g.animations }
    })
    cache.set(url, p)
  }
  return p
}

// Loads every model in the cast once; resolves a role to its model, or to the fallback.
export function useCast() {
  const [assets, setAssets] = useState<Map<string, CharacterAsset> | null>(null)
  useEffect(() => {
    let alive = true
    const urls = [...new Set(Object.values(CAST).map((c) => c.url))]
    Promise.allSettled(urls.map((u) => loadCharacter(u))).then((res) => {
      if (!alive) return
      const m = new Map<string, CharacterAsset>()
      res.forEach((r, i) => {
        if (r.status === 'fulfilled') m.set(urls[i], r.value)
        else console.warn(`Character ${urls[i]} failed to load; using the fallback.`, r.reason)
      })
      setAssets(m)
    })
    return () => {
      alive = false
    }
  }, [])
  return assets
}

export function castFor(assets: Map<string, CharacterAsset>, role: Role): CharacterAsset | null {
  return assets.get(CAST[role].url) ?? assets.get(FALLBACK) ?? null
}

export interface Person {
  root: THREE.Group
  mixer: THREE.AnimationMixer
  actions: Map<string, THREE.AnimationAction>
  current: string
  head: THREE.Object3D | null
  eyes: THREE.Mesh[]
  yaw: number
  slot: string
}

const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.95, 3.4) })
const eyeGeo = new THREE.SphereGeometry(0.013, 6, 4)
const bladeMat = reflective(new THREE.MeshStandardMaterial({ color: '#efe8d8', roughness: 0.3 }))

export function makePerson(asset: CharacterAsset, role: Role, opts: { scale?: number; knife?: boolean; eyes?: boolean } = {}): Person {
  const model = cloneSkinned(asset.scene)
  model.scale.multiplyScalar(opts.scale ?? 1)
  // Arissa's leathers are near black, so roles she stands in for are dyed; real models keep
  // their colours, under a light dye where one model plays several parts.
  const fallback = asset.url === FALLBACK
  const tint = fallback ? CAST[role].tint : CAST[role].dye ?? null
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.castShadow = true
    m.frustumCulled = false
    const mat = (m.material as THREE.MeshStandardMaterial).clone()
    if (tint) mat.color.copy(tint)
    if (fallback) {
      mat.metalness = 0
      mat.roughness = 0.85
    }
    m.material = reflective(mat)
  })
  const root = new THREE.Group()
  root.add(model)
  const mixer = new THREE.AnimationMixer(model)
  const actions = new Map<string, THREE.AnimationAction>()
  for (const c of asset.clips) actions.set(c.name, mixer.clipAction(c))
  actions.get('idle')?.play()
  if (opts.knife) {
    const hand = model.getObjectByName('mixamorigRightHand')
    if (hand) {
      const s = new THREE.Vector3()
      model.updateMatrixWorld(true)
      hand.getWorldScale(s)
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 0.012), bladeMat)
      blade.scale.setScalar(1 / s.x)
      blade.position.set(0, 0.28 / s.x, 0.04 / s.x)
      blade.castShadow = true
      hand.add(blade)
    }
  }
  const eyes = opts.eyes ? [new THREE.Mesh(eyeGeo, eyeMat), new THREE.Mesh(eyeGeo, eyeMat)] : []
  eyes.forEach((e) => (e.visible = false))
  root.visible = false
  return { root, mixer, actions, current: 'idle', head: model.getObjectByName('mixamorigHead') ?? null, eyes, yaw: 0, slot: '' }
}

export function playClip(p: Person, name: string, fade = 0.25) {
  if (p.current === name) return
  const next = p.actions.get(name) ?? p.actions.get('idle')
  const prev = p.actions.get(p.current)
  if (!next) return
  next.reset().fadeIn(fade).play()
  if (prev && prev !== next) prev.fadeOut(fade)
  p.current = name
}

const hp = new THREE.Vector3()

// The Ibad: eyes blue with a lifetime of spice, glowing under the hood.
export function placeEyes(p: Person, yaw: number) {
  if (!p.head || !p.eyes.length) return
  p.head.getWorldPosition(hp)
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? 1 : -1
    p.eyes[k].position.set(hp.x + fx * 0.085 - fz * side * 0.032, hp.y + 0.075, hp.z + fz * 0.085 + fx * side * 0.032)
    p.eyes[k].visible = true
  }
}

export function hideEyes(p: Person) {
  for (const e of p.eyes) e.visible = false
}
