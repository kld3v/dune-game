import { useEffect, useMemo, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { rt, type Foe } from '../game/rt'
import { SHIELD_MAX } from '../game/combat'
import { clamp } from '../game/math'
import { reflective } from './reflections'

const POOL = 10
const MODEL_URL = '/models/harkonnen.glb'

const SHIELD_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`
const SHIELD_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
void main() {
  float rim = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.5);
  float shimmer = 0.75 + 0.25 * sin(uTime * 9.0 + vN.y * 14.0);
  vec3 c = mix(vec3(0.45, 0.65, 1.6), vec3(1.4, 1.5, 1.8), rim);
  gl_FragColor = vec4(c * (0.25 + rim * 1.6) * shimmer * uAlpha, 1.0);
}
`

interface View {
  root: THREE.Group
  shield: THREE.Mesh
  shieldMat: THREE.ShaderMaterial
  // procedural rig
  parts?: { body: THREE.Group; legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group }
  // Mixamo rig
  mixer?: THREE.AnimationMixer
  actions?: Map<string, THREE.AnimationAction>
  current?: string
  key?: number
}

function shieldFor(): { shield: THREE.Mesh; shieldMat: THREE.ShaderMaterial } {
  const shieldMat = new THREE.ShaderMaterial({
    uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 } },
    vertexShader: SHIELD_VERT,
    fragmentShader: SHIELD_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), shieldMat)
  shield.scale.set(0.95, 1.25, 0.95)
  shield.position.y = 1.05
  return { shield, shieldMat }
}

const armour = reflective(new THREE.MeshStandardMaterial({ color: '#1e1c1b', roughness: 0.45, metalness: 0.55 }))
const plate = reflective(new THREE.MeshStandardMaterial({ color: '#2f2b29', roughness: 0.35, metalness: 0.7 }))
const visor = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.25, 0.1) })
const blade = reflective(new THREE.MeshStandardMaterial({ color: '#8f9296', roughness: 0.2, metalness: 0.95 }))

function proceduralSoldier(): View {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, p: [number, number, number], s: [number, number, number] = [1, 1, 1]) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(...p)
    m.scale.set(...s)
    m.castShadow = true
    parent.add(m)
    return m
  }
  const limb = (parent: THREE.Object3D, x: number, y: number, len: number, r: number) => {
    const g = new THREE.Group()
    g.position.set(x, y, 0)
    mesh(new THREE.CapsuleGeometry(r, len, 4, 8), armour, g, [0, -len / 2 - r, 0])
    parent.add(g)
    return g
  }
  const legL = limb(body, 0.13, 0.95, 0.62, 0.12)
  const legR = limb(body, -0.13, 0.95, 0.62, 0.12)
  mesh(new THREE.CapsuleGeometry(0.27, 0.48, 4, 10), armour, body, [0, 1.3, 0], [1, 1, 0.8])
  mesh(new THREE.BoxGeometry(0.62, 0.22, 0.34), plate, body, [0, 1.58, 0])
  mesh(new THREE.SphereGeometry(0.19, 12, 10), plate, body, [0, 1.86, 0], [1, 1.1, 1])
  mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), visor, body, [0, 1.88, 0.17])
  const armL = limb(body, 0.36, 1.55, 0.48, 0.085)
  const armR = limb(body, -0.36, 1.55, 0.48, 0.085)
  mesh(new THREE.BoxGeometry(0.05, 0.05, 1.15), blade, armR, [0, -0.72, 0.5])
  mesh(new THREE.BoxGeometry(0.16, 0.05, 0.08), plate, armR, [0, -0.72, -0.02])
  const { shield, shieldMat } = shieldFor()
  root.add(shield)
  return { root, shield, shieldMat, parts: { body, legL, legR, armL, armR } }
}

function poseProcedural(v: View, f: Foe) {
  const p = v.parts!
  const t = rt.time
  const run = f.anim === 'run'
  const walk = f.anim === 'walk' || run
  const freq = run ? 9 : 5.5
  const sw = walk ? Math.sin(t * freq + f.id) * (run ? 0.8 : 0.45) : 0
  p.legL.rotation.x = sw
  p.legR.rotation.x = -sw
  p.armL.rotation.x = -sw * 0.7
  p.armR.rotation.x = run ? -0.4 : sw * 0.4
  p.body.rotation.set(run ? 0.18 : 0, 0, 0)
  p.body.position.y = walk ? Math.abs(Math.sin(t * freq + f.id)) * 0.06 : 0
  if (f.anim === 'slash') {
    const k = clamp(f.st / 0.6, 0, 1)
    const swing = f.st < 0.6 ? -2.4 * k : -2.4 + clamp((f.st - 0.6) / 0.15, 0, 1) * 3.2
    p.armR.rotation.set(swing, 0, f.st < 0.6 ? -0.3 : 0.4)
    p.body.rotation.y = f.st < 0.6 ? 0.3 * k : -0.35
  } else {
    p.armR.rotation.z = 0
    p.body.rotation.y = 0
  }
  if (f.anim === 'hit') p.body.rotation.x = -0.35 * Math.sin(Math.min(1, f.st / 0.5) * Math.PI)
  if (f.anim === 'yell') {
    p.armL.rotation.x = -2.6
    p.armR.rotation.x = -2.6
    p.body.rotation.x = -0.15
  }
  if (f.anim === 'kneel') {
    const k = clamp(f.st / 0.5, 0, 1)
    p.body.position.y = -0.45 * k
    p.legL.rotation.x = -1.4 * k
    p.legR.rotation.x = 0.2 * k
    p.armL.rotation.x = -0.3 * k
    p.armR.rotation.x = -0.3 * k
    p.body.rotation.x = 0.35 * k
  }
  if (f.anim === 'death') {
    const k = clamp(f.st / 0.8, 0, 1)
    p.body.rotation.x = 1.5 * k * k
    p.body.position.y = -0.1 * k
  }
  if (f.anim === 'look') p.body.rotation.y = Math.sin(t * 1.3 + f.id) * 0.6
}

function rigFromGltf(template: THREE.Object3D, clips: THREE.AnimationClip[]): View {
  const model = cloneSkinned(template)
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      m.castShadow = true
      m.frustumCulled = false
    }
  })
  const root = new THREE.Group()
  root.add(model)
  const mixer = new THREE.AnimationMixer(model)
  const actions = new Map<string, THREE.AnimationAction>()
  for (const c of clips) {
    const a = mixer.clipAction(c)
    if (['slash', 'hit', 'death', 'kneel', 'yell'].includes(c.name)) {
      a.setLoop(THREE.LoopOnce, 1)
      a.clampWhenFinished = true
    }
    actions.set(c.name, a)
  }
  const hand = model.getObjectByName('mixamorigRightHand')
  if (hand) {
    const s = new THREE.Vector3()
    model.updateMatrixWorld(true)
    hand.getWorldScale(s)
    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.15, 0.05), blade)
    sword.scale.setScalar(1 / s.x)
    sword.position.set(0, 0.5 / s.x, 0)
    sword.castShadow = true
    hand.add(sword)
  }
  const { shield, shieldMat } = shieldFor()
  root.add(shield)
  return { root, shield, shieldMat, mixer, actions }
}

function poseRig(v: View, f: Foe, dt: number) {
  const name = v.actions!.has(f.anim) ? f.anim : 'idle'
  if (v.current !== name || (v.key !== f.animKey && ['slash', 'hit', 'kneel', 'yell'].includes(name))) {
    const next = v.actions!.get(name)
    const prev = v.current ? v.actions!.get(v.current) : undefined
    if (next) {
      next.reset().fadeIn(0.15).play()
      if (prev && prev !== next) prev.fadeOut(0.15)
    }
    v.current = name
    v.key = f.animKey
  }
  const a = v.actions!.get(name)
  if (a) a.timeScale = name === 'walk' ? clamp(f.speed / 1.7, 0.6, 1.6) : name === 'run' ? clamp(f.speed / 5.6, 0.7, 1.4) : 1
  v.mixer!.update(dt)
}

const head = new THREE.Vector3()

export function Harkonnens() {
  const size = useThree((s) => s.size)
  const [gltf, setGltf] = useState<{ scene: THREE.Object3D; clips: THREE.AnimationClip[] } | null>(null)
  const procedural = useMemo(() => Array.from({ length: POOL }, proceduralSoldier), [])
  const rigs = useMemo(() => (gltf ? Array.from({ length: POOL }, () => rigFromGltf(gltf.scene, gltf.clips)) : null), [gltf])

  useEffect(() => {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.load(MODEL_URL, (g) => {
      const box = new THREE.Box3().setFromObject(g.scene)
      g.scene.scale.setScalar(1.85 / Math.max(0.1, box.max.y - box.min.y))
      setGltf({ scene: g.scene, clips: g.animations })
    }, undefined, () => {
      // No Harkonnen model shipped yet: the procedural soldiers stand in.
    })
  }, [])

  useFrame(({ camera }, delta) => {
    const views = rigs ?? procedural
    const foeDt = rt.hitstop > 0 ? 0 : Math.min(delta, 0.1) * (1 - 0.65 * rt.slowmo)
    for (let i = 0; i < POOL; i++) {
      const v = views[i]
      const f = rt.foes[i]
      if (!f || f.gone) {
        v.root.visible = false
        if (f) f.onScreen = false
        continue
      }
      v.root.visible = true
      v.root.position.copy(f.pos)
      v.root.rotation.y = f.yaw
      if (v.parts) poseProcedural(v, f)
      else poseRig(v, f, foeDt)
      const shieldUp = f.shield > 0 && f.state !== 'dead'
      v.shield.visible = shieldUp || f.flash > 0.05
      v.shieldMat.uniforms.uAlpha.value = (shieldUp ? 0.05 + 0.1 * (f.shield / SHIELD_MAX) : 0) + f.flash * 0.7
      v.shieldMat.uniforms.uTime.value = rt.time
      head.set(f.pos.x, f.pos.y + 2.35, f.pos.z).project(camera)
      f.onScreen = head.z < 1 && Math.abs(head.x) < 1.1 && Math.abs(head.y) < 1.1
      f.screenX = (head.x * 0.5 + 0.5) * size.width
      f.screenY = (-head.y * 0.5 + 0.5) * size.height
    }
    if (rigs) for (const p of procedural) p.root.visible = false
  })

  return (
    <>
      {procedural.map((v, i) => (
        <primitive key={`p${i}`} object={v.root} />
      ))}
      {rigs?.map((v, i) => (
        <primitive key={`r${i}`} object={v.root} />
      ))}
    </>
  )
}
