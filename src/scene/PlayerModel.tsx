import { useEffect, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { rt } from '../game/rt'
import { clamp, damp, smoothstep } from '../game/math'
import { ATTACKS, power } from '../game/combat'
import { reflective } from './reflections'

const MODEL_URL = '/models/arissa.glb'
const HEIGHT = 1.8

type Clip = 'idle' | 'walk' | 'jog' | 'sprint' | 'sneak' | 'jump' | 'fall' | 'ride' | 'drink'
// Ground speed at which each in-place locomotion clip's feet stop sliding.
const NOMINAL: Partial<Record<Clip, number>> = { walk: 1.45, jog: 4.3, sprint: 7.4, sneak: 1.3 }
const ONE_SHOT = new Set<Clip>(['jump', 'drink'])

interface Arm {
  spine: THREE.Object3D
  upper: THREE.Object3D
  fore: THREE.Object3D
  hand: THREE.Object3D
  middle: THREE.Object3D
  index: THREE.Object3D
  pinky: THREE.Object3D
  hips: THREE.Object3D
  fingers: THREE.Object3D[][]
}

interface Rig {
  root: THREE.Group
  mixer: THREE.AnimationMixer
  actions: Map<string, THREE.AnimationAction>
  current: Clip | null
  hands: THREE.Object3D[]
  hooks: THREE.Mesh[]
  arm: Arm | null
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
    const bone = (n: string) => model.getObjectByName('mixamorig' + n)
    const found = ['Spine1', 'RightArm', 'RightForeArm', 'RightHand', 'RightHandMiddle1', 'RightHandIndex1', 'RightHandPinky1', 'Hips'].map(bone)
    let arm: Arm | null = null
    if (found.every((b) => !!b)) {
      const [spine, upper, fore, hand, middle, index, pinky, hips] = found as THREE.Object3D[]
      const fingers = ['Index', 'Middle', 'Ring', 'Pinky'].map((f) =>
        [1, 2, 3].map((i) => bone(`RightHand${f}${i}`)).filter((b): b is THREE.Object3D => !!b))
      arm = { spine, upper, fore, hand, middle, index, pinky, hips, fingers }
    }
    return { root, mixer, actions, current: null, hands, hooks, arm }
  })
}

// The crysknife: a curved, milky blade ground from a sandworm's tooth.
function buildKnife() {
  const group = new THREE.Group()
  const s = new THREE.Shape()
  s.moveTo(-0.026, 0)
  s.bezierCurveTo(-0.034, 0.16, -0.012, 0.33, 0.05, 0.43)
  s.bezierCurveTo(0.03, 0.3, 0.036, 0.14, 0.026, 0)
  s.closePath()
  const bladeGeo = new THREE.ExtrudeGeometry(s, {
    depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 16,
  })
  bladeGeo.translate(0, 0, -0.004)
  const bladeMat = reflective(new THREE.MeshPhysicalMaterial({
    color: '#efe8d8', roughness: 0.25, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.15,
  }))
  const leather = new THREE.MeshStandardMaterial({ color: '#2b1e15', roughness: 0.85 })
  const fitting = reflective(new THREE.MeshStandardMaterial({ color: '#5a4836', roughness: 0.4, metalness: 0.6 }))
  const parts: [THREE.BufferGeometry, THREE.Material, number][] = [
    [bladeGeo, bladeMat, 0],
    [new THREE.BoxGeometry(0.075, 0.014, 0.024), fitting, -0.005],
    [new THREE.CylinderGeometry(0.014, 0.016, 0.11, 8), leather, -0.065],
    [new THREE.SphereGeometry(0.019, 8, 6), fitting, -0.125],
  ]
  for (const [geo, mat, y] of parts) {
    const m = new THREE.Mesh(geo, mat)
    m.position.y = y
    m.castShadow = true
    group.add(m)
  }
  return { group, bladeMat }
}

// A ribbon of light behind the blade: the last few frames of its base and tip.
const TRAIL = 14

function buildTrail() {
  const pos = new Float32Array(TRAIL * 6)
  const age = new Float32Array(TRAIL * 2)
  const side = new Float32Array(TRAIL * 2)
  const index: number[] = []
  for (let i = 0; i < TRAIL; i++) {
    age[i * 2] = age[i * 2 + 1] = i / (TRAIL - 1)
    side[i * 2 + 1] = 1
    if (i < TRAIL - 1) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
  }
  const geo = new THREE.BufferGeometry()
  const posAttr = new THREE.BufferAttribute(pos, 3)
  posAttr.setUsage(THREE.DynamicDrawUsage)
  geo.setAttribute('position', posAttr)
  geo.setAttribute('aT', new THREE.BufferAttribute(age, 1))
  geo.setAttribute('aS', new THREE.BufferAttribute(side, 1))
  geo.setIndex(index)
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aT;
      attribute float aS;
      varying float vT;
      varying float vS;
      void main() {
        vT = aT;
        vS = aS;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      varying float vT;
      varying float vS;
      void main() {
        float a = pow(clamp(1.0 - vT, 0.0, 1.0), 1.5) * smoothstep(0.0, 0.7, vS) * uAlpha;
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  return { mesh, pos, posAttr, mat, acc: 0 }
}

// Each strike as keys of [time 0-1, swing angle right of forward, elevation, torso twist
// to the right, forward lean]. The blade crosses the centre line exactly at the hit.
type Key = [number, number, number, number, number]
const SWINGS: Key[][] = [
  [[0, 0.35, -0.55, 0.05, 0], [0.26, 1.45, 0.3, 0.45, 0], [0.467, 0, 0.05, 0, 0.08], [0.7, -0.9, -0.2, -0.45, 0.04], [1, -0.6, -0.5, -0.25, 0]],
  [[0, -0.6, -0.5, -0.25, 0], [0.26, -1.0, 0.35, -0.5, 0], [0.467, 0, 0, 0, 0.08], [0.7, 1.25, -0.1, 0.45, 0.04], [1, 0.5, -0.45, 0.2, 0]],
  [[0, 0.5, -0.45, 0.2, 0], [0.35, 0.35, 1.25, 0.35, -0.12], [0.547, 0, -0.08, -0.1, 0.3], [0.75, 0, -0.12, -0.05, 0.25], [1, 0.3, -0.6, 0.1, 0]],
]

function sampleSwing(keys: Key[], u: number, out: number[]) {
  let i = 0
  while (i < keys.length - 2 && u > keys[i + 1][0]) i++
  const a = keys[i]
  const b = keys[i + 1]
  const t = smoothstep(a[0], b[0], u)
  for (let k = 1; k < 5; k++) out[k - 1] = a[k] + (b[k] - a[k]) * t
}

const qa = new THREE.Quaternion()
const qb = new THREE.Quaternion()
const qDelta = new THREE.Quaternion()
const va = new THREE.Vector3()
const vb = new THREE.Vector3()
const vc = new THREE.Vector3()

// Rotate a bone by a world-space rotation, whatever its local axes are.
function rotateWorld(bone: THREE.Object3D, q: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(qa)
  qb.copy(qa).invert()
  bone.quaternion.premultiply(qa).premultiply(q).premultiply(qb)
  bone.updateMatrixWorld(true)
}

// Turn a bone so the line to its child points (partly, by w) along dir.
function aim(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3, w: number) {
  bone.getWorldPosition(va)
  child.getWorldPosition(vb)
  vb.sub(va).normalize()
  vc.copy(vb).lerp(dir, w).normalize()
  rotateWorld(bone, qDelta.setFromUnitVectors(vb, vc))
}

const CURL = [1.25, 1.5, 0.9]

function curlFist(arm: Arm, k: number) {
  arm.index.getWorldPosition(va)
  arm.pinky.getWorldPosition(vb)
  const lateral = va.sub(vb).normalize()
  for (const finger of arm.fingers) finger.forEach((b, j) => rotateWorld(b, qDelta.setFromAxisAngle(lateral, CURL[j] * k)))
}

const U = new THREE.Vector3(0, 1, 0)
const fwd = new THREE.Vector3()
const right = new THREE.Vector3()
const dir = new THREE.Vector3()
const bladeDir = new THREE.Vector3()
const grip = new THREE.Vector3()
const bx = new THREE.Vector3()
const bz = new THREE.Vector3()
const basis = new THREE.Matrix4()
const pose = [0, 0, 0, 0]

// Blade along the knife's +Y, its flat facing ref, so a level slash cuts edge first.
function placeKnife(knife: THREE.Object3D, at: THREE.Vector3, blade: THREE.Vector3, ref: THREE.Vector3) {
  bz.copy(ref).addScaledVector(blade, -ref.dot(blade))
  if (bz.lengthSq() < 1e-6) bz.copy(fwd).addScaledVector(blade, -fwd.dot(blade))
  bz.normalize()
  bx.crossVectors(blade, bz).normalize()
  basis.makeBasis(bx, blade, bz)
  knife.quaternion.setFromRotationMatrix(basis)
  knife.position.copy(at)
  knife.updateMatrixWorld()
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

const COLD = new THREE.Color(0.9, 1.0, 1.3)
const GOLD = new THREE.Color(2.0, 1.3, 0.45)

function updateTrail(t: ReturnType<typeof buildTrail>, active: boolean, heavy: boolean, pw: number, dt: number, knife: THREE.Object3D) {
  knife.localToWorld(va.set(0, 0.05, 0))
  knife.localToWorld(vb.set(0.04, 0.43, 0))
  const alpha = t.mat.uniforms.uAlpha
  if (active) {
    t.acc += dt
    if (t.acc >= 1 / 60) {
      t.pos.copyWithin(6, 0, (TRAIL - 1) * 6)
      t.acc = 0
    }
    t.pos.set([va.x, va.y, va.z, vb.x, vb.y, vb.z], 0)
    t.posAttr.needsUpdate = true
  } else if (alpha.value < 0.02) {
    for (let i = 0; i < TRAIL; i++) t.pos.set([va.x, va.y, va.z, vb.x, vb.y, vb.z], i * 6)
    t.posAttr.needsUpdate = true
  }
  alpha.value = damp(alpha.value, active ? 1 : 0, active ? 30 : 7, dt)
  t.mat.uniforms.uColor.value.copy(COLD).lerp(GOLD, pw).multiplyScalar(heavy ? 1.6 : 1)
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
  const knife = useMemo(buildKnife, [])
  const trail = useMemo(buildTrail, [])
  const st = useMemo(() => ({ swing: 0, drawn: 0, fightT: -99 }), [])
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
    const dt = Math.min(delta, 0.1)
    fallback.visible = !rig && visible
    if (rig) rig.root.visible = visible
    knife.group.visible = visible
    trail.mesh.visible = visible && rt.mode === 'foot'
    if (!visible) {
      if (rig) placeHooks(rig, false)
      return
    }
    body.position.copy(p.pos)
    body.rotation.y = p.yaw

    // Where the blade is in the current strike, and whether it is drawn at all.
    const c = rt.combat
    const attacking = c.attacking && rt.mode === 'foot'
    if (attacking) {
      sampleSwing(SWINGS[c.atkIdx], clamp(c.atkT / ATTACKS[c.atkIdx].dur, 0, 1), pose)
      st.fightT = rt.time
    }
    st.swing = damp(st.swing, attacking ? 1 : 0, attacking ? 28 : 8, dt)
    const near = rt.foes.some((f) => !f.gone && f.state !== 'dead' && f.state !== 'drop' && Math.hypot(f.pos.x - p.pos.x, f.pos.z - p.pos.z) < 30)
    st.drawn = damp(st.drawn, rt.mode === 'foot' && (near || rt.time - st.fightT < 4) ? 1 : 0, 10, dt)
    fwd.set(Math.sin(p.yaw), 0, Math.cos(p.yaw))
    right.set(-Math.cos(p.yaw), 0, Math.sin(p.yaw))
    const [th, el, twist, lean] = pose
    dir.copy(fwd).multiplyScalar(Math.cos(el) * Math.cos(th)).addScaledVector(right, Math.cos(el) * Math.sin(th)).addScaledVector(U, Math.sin(el)).normalize()
    const pw = power()
    knife.bladeMat.emissive.setRGB(0.3 + 0.9 * pw, 0.45 + 0.5 * pw, 1.2 - 0.6 * pw).multiplyScalar(0.12 + 0.5 * pw * st.drawn)

    if (!rig) {
      body.position.y += Math.abs(Math.sin(p.walkPhase * Math.PI * 2)) * 0.05 * clamp(p.speed / 6, 0, 1)
      grip.copy(p.pos).addScaledVector(U, 1.1).addScaledVector(right, 0.34).addScaledVector(dir, 0.45 * st.swing)
      bladeDir.set(0, -1, 0).lerp(dir, st.swing).normalize()
      placeKnife(knife.group, grip, bladeDir, U)
      updateTrail(trail, attacking && st.swing > 0.35, c.atkIdx === 2, pw, dt, knife.group)
      return
    }
    const clip = pickClip()
    play(rig, clip, clip === 'jump' ? 0.1 : 0.22)
    const action = rig.actions.get(clip)
    const nominal = NOMINAL[clip]
    if (action) action.timeScale = nominal ? clamp(p.speed / nominal, 0.6, 1.6) : 1
    rig.mixer.update(dt)
    rig.root.updateMatrixWorld(true)

    // Layer the strike over whatever she is doing: twist and lean the torso, swing the
    // arm out along the blade's path, and close the hand around the knife.
    const arm = rig.arm
    const w = st.swing
    const flinch = clamp(1 - (rt.time - c.hurtAt) / 0.35, 0, 1)
    if (arm) {
      if (w > 0.002 || flinch > 0) {
        rotateWorld(arm.spine, qDelta.setFromAxisAngle(U, -twist * w))
        rotateWorld(arm.spine, qDelta.setFromAxisAngle(right, -lean * w + Math.sin(flinch * Math.PI) * 0.3))
      }
      if (w > 0.002) {
        aim(arm.upper, arm.fore, dir, w)
        aim(arm.fore, arm.hand, dir, w)
        aim(arm.hand, arm.middle, dir, w * 0.8)
      }
      if (st.drawn > 0.02) curlFist(arm, st.drawn)
      if (st.drawn > 0.5) {
        arm.hand.getWorldPosition(grip)
        arm.middle.getWorldPosition(vc)
        grip.addScaledVector(vc.sub(grip).normalize(), 0.07)
        arm.fore.getWorldPosition(va)
        bladeDir.subVectors(grip, va).normalize()
        bladeDir.lerp(vb.copy(dir).addScaledVector(U, 0.12), w).normalize()
        placeKnife(knife.group, grip.addScaledVector(bladeDir, 0.065), bladeDir, U)
      } else {
        arm.hips.getWorldPosition(grip)
        grip.addScaledVector(right, 0.19).addScaledVector(U, -0.06).addScaledVector(fwd, 0.05)
        bladeDir.copy(U).multiplyScalar(-0.92).addScaledVector(fwd, -0.38).normalize()
        placeKnife(knife.group, grip, bladeDir, right)
      }
    }
    updateTrail(trail, attacking && w > 0.35, c.atkIdx === 2, pw, dt, knife.group)
    placeHooks(rig, rt.mode === 'worm')
  })

  return (
    <>
      <primitive object={fallback} />
      <primitive object={knife.group} />
      <primitive object={trail.mesh} />
      {rig ? <primitive object={rig.root} /> : null}
      {rig ? rig.hooks.map((h, i) => <primitive key={i} object={h} />) : null}
    </>
  )
}
