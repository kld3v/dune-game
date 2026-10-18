import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rt, type Cave as CaveData } from '../game/rt'
import { caveFloor, caveWalkers } from '../game/cave'
import { vnoise } from '../game/terrain'
import { TAU, clamp, dampAngle, smoothstep } from '../game/math'
import { reflective } from './reflections'
import { castFor, hideEyes, leaderRole, makePerson, placeEyes, playClip, useCast, type Person, type Role } from './people'

// The cavern beneath a sietch, built when you walk in and torn down when you leave.

const rock = reflective(new THREE.MeshStandardMaterial({ color: '#3b2d23', roughness: 0.96, metalness: 0, flatShading: true }))
const domeMat = reflective(new THREE.MeshStandardMaterial({ color: '#4d3c30', roughness: 0.97, metalness: 0, flatShading: true, side: THREE.BackSide }))
const floorMat = reflective(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }))
const dark = new THREE.MeshBasicMaterial({ color: '#070504' })
const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.5, 0.6) })
const globeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.8, 0.95) })
const dayMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.6, 1.8), side: THREE.DoubleSide })

const WATER_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const WATER_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vW;
float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 p = vW.xz * 0.35;
  float n = vn(p + vec2(uTime * 0.12, uTime * 0.07)) + 0.5 * vn(p * 2.3 - vec2(uTime * 0.09, uTime * 0.15));
  float caustic = pow(clamp(1.0 - abs(sin(n * 6.2831)), 0.0, 1.0), 6.0);
  vec3 deep = vec3(0.005, 0.03, 0.045);
  vec3 glowc = vec3(0.12, 0.55, 0.62);
  float d = length(vW - cameraPosition);
  vec3 col = deep + glowc * caustic * 0.55 + vec3(0.02, 0.09, 0.1) * smoothstep(60.0, 5.0, d);
  gl_FragColor = vec4(col, 1.0);
}
`

const SHAFT_VERT = /* glsl */ `
varying float vH;
void main() {
  vH = uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const SHAFT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
varying float vH;
void main() {
  float a = (0.03 + 0.11 * vH) * (0.8 + 0.2 * sin(uTime * 0.5 + uSeed));
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * a, a);
}
`

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const tmpS = new THREE.Vector3()
const tmpP = new THREE.Vector3()
const Y = new THREE.Vector3(0, 1, 0)

function instances(geo: THREE.BufferGeometry, mat: THREE.Material, list: { x: number; y: number; z: number; yaw?: number; sx: number; sy: number; sz: number; flip?: boolean }[]) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length))
  list.forEach((it, i) => {
    tmpQ.setFromAxisAngle(Y, it.yaw ?? 0)
    if (it.flip) tmpQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI))
    m.setMatrixAt(i, tmpM.compose(tmpP.set(it.x, it.y, it.z), tmpQ, tmpS.set(it.sx, it.sy, it.sz)))
  })
  m.count = list.length
  m.computeBoundingSphere()
  return m
}

interface Built {
  group: THREE.Group
  globes: THREE.InstancedMesh
  globeBase: Float32Array
  shafts: THREE.ShaderMaterial[]
  water: THREE.ShaderMaterial
}

function buildCave(c: CaveData): Built {
  const g = new THREE.Group()
  g.position.set(c.x, c.y, c.z)
  const rand = rng(c.seed + 11)
  const R = c.radius
  const local = (x: number, z: number) => caveFloor(c, c.x + x, c.z + z) - c.y
  const ceiling = (r: number) => c.height * Math.sqrt(Math.max(0, 1 - (r / (R * 1.02)) ** 2))

  // The floor, sampled from the very function the player walks on.
  const N = 180
  const floorGeo = new THREE.PlaneGeometry(R * 2.1, R * 2.1, N, N)
  floorGeo.rotateX(-Math.PI / 2)
  const pos = floorGeo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const sand = new THREE.Color('#6b5236')
  const stone = new THREE.Color('#3a2e25')
  const wet = new THREE.Color('#231d19')
  const col = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    pos.setY(i, local(x, z))
    const r = Math.hypot(x, z)
    const dp = Math.hypot(x + c.x - c.pool.x, z + c.z - c.pool.z)
    col.copy(sand).lerp(stone, smoothstep(R * 0.7, R * 0.86, r)).lerp(wet, (1 - smoothstep(c.pool.r, c.pool.r + 7, dp)) * 0.75)
    col.multiplyScalar(0.85 + 0.3 * vnoise(x * 0.15, z * 0.15, 61))
    colors[i * 3] = col.r
    colors[i * 3 + 1] = col.g
    colors[i * 3 + 2] = col.b
  }
  floorGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  floorGeo.computeVertexNormals()
  const floor = new THREE.Mesh(floorGeo, floorMat)
  floor.receiveShadow = true
  g.add(floor)

  // The dome: a hemisphere pushed in and out by noise, seen from inside.
  const domeGeo = new THREE.SphereGeometry(R * 1.02, 128, 48, 0, TAU, 0, Math.PI / 2)
  const dp = domeGeo.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < dp.count; i++) {
    v.set(dp.getX(i), dp.getY(i), dp.getZ(i))
    const n = (vnoise(v.x * 0.02, v.z * 0.02 + v.y * 0.03, 51) * 2 - 1) + (vnoise(v.x * 0.07, v.z * 0.07 + v.y * 0.05, 52) * 2 - 1) * 0.4
    v.multiplyScalar(1 - 0.07 * n)
    v.y *= c.height / R
    dp.setXYZ(i, v.x, v.y, v.z)
  }
  domeGeo.computeVertexNormals()
  g.add(new THREE.Mesh(domeGeo, domeMat))

  // Stone teeth from the roof and the floor.
  const cone = new THREE.ConeGeometry(1, 1, 7)
  const tites = []
  for (let i = 0; i < 260; i++) {
    const r = Math.sqrt(rand()) * R * 0.9
    const a = rand() * TAU
    const len = 4 + rand() * rand() * 26
    const w = len * (0.12 + rand() * 0.08)
    tites.push({ x: Math.sin(a) * r, y: ceiling(r) - len / 2 + 2, z: Math.cos(a) * r, sx: w, sy: len, sz: w, flip: true })
  }
  g.add(instances(cone, rock, tites))
  const mites = []
  for (let i = 0; i < 140; i++) {
    const r = Math.sqrt(rand()) * R * 0.78
    const a = rand() * TAU
    const x = Math.sin(a) * r
    const z = Math.cos(a) * r
    const wx = c.x + x
    const wz = c.z + z
    if (Math.hypot(wx - c.pool.x, wz - c.pool.z) < c.pool.r + 9) continue
    if (Math.hypot(wx - c.exit.x, wz - c.exit.z) < 30 || Math.hypot(wx - c.naibAt.x, wz - c.naibAt.z) < 10 || Math.hypot(wx - c.mother.x, wz - c.mother.z) < 10) continue
    const len = 2 + rand() * rand() * 12
    const w = len * (0.18 + rand() * 0.1)
    mites.push({ x, y: local(x, z) + len / 2 - 0.4, z, sx: w, sy: len, sz: w })
  }
  g.add(instances(cone, rock, mites))

  // Dwellings carved into the walls in three tiers, many of them lamplit.
  const doors = []
  const lamps = []
  const exitA = Math.atan2(c.exit.x - c.x, c.exit.z - c.z)
  for (const tier of [0.8, 0.845, 0.89]) {
    const r = R * tier
    const step = 12 / r
    for (let a = rand() * step; a < TAU; a += step * (0.8 + rand() * 0.6)) {
      if (Math.abs(Math.atan2(Math.sin(a - exitA), Math.cos(a - exitA))) < 0.22) continue
      const x = Math.sin(a) * r
      const z = Math.cos(a) * r
      const y = local(x, z)
      doors.push({ x, y: y + 1.5, z, yaw: a + Math.PI, sx: 2.2, sy: 3, sz: 1 })
      if (rand() < 0.45) {
        const side = rand() < 0.5 ? -1 : 1
        lamps.push({ x: x + Math.cos(a) * side * 1.8, y: y + 3.2, z: z - Math.sin(a) * side * 1.8, sx: 0.22, sy: 0.22, sz: 0.22 })
      }
    }
  }
  const box = new THREE.BoxGeometry(1, 1, 1)
  g.add(instances(box, dark, doors))
  const ball = new THREE.SphereGeometry(1, 10, 8)
  g.add(instances(ball, lampMat, lamps))

  // Glowglobes adrift in the dark.
  const globeList = []
  const globeBase = new Float32Array(160 * 4)
  for (let i = 0; i < 160; i++) {
    const r = Math.sqrt(rand()) * R * 0.74
    const a = rand() * TAU
    const x = Math.sin(a) * r
    const z = Math.cos(a) * r
    const y = local(x, z) + 3 + rand() * 17
    globeBase.set([x, y, z, rand() * TAU], i * 4)
    globeList.push({ x, y, z, sx: 0.45, sy: 0.45, sz: 0.45 })
  }
  const globes = instances(new THREE.SphereGeometry(1, 12, 8), globeMat, globeList)
  globes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  g.add(globes)

  // Daylight falling through cracks far overhead.
  const shafts: THREE.ShaderMaterial[] = []
  c.shafts.forEach((s, i) => {
    const x = s.x - c.x
    const z = s.z - c.z
    const top = ceiling(Math.hypot(x, z))
    const bottom = local(x, z)
    const h = top - bottom
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSeed: { value: i * 1.7 } },
      vertexShader: SHAFT_VERT,
      fragmentShader: SHAFT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    shafts.push(mat)
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.6, s.r * 1.7, h, 24, 1, true), mat)
    beam.position.set(x, bottom + h / 2, z)
    g.add(beam)
    const hole = new THREE.Mesh(new THREE.CircleGeometry(s.r * 0.7, 20), dayMat)
    hole.position.set(x, top - 0.5, z)
    hole.rotation.x = Math.PI / 2
    g.add(hole)
  })

  // The cistern: still dark water behind a ring of cut stone.
  const water = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG })
  const pool = new THREE.Mesh(new THREE.CircleGeometry(c.pool.r + 1.5, 72), water)
  pool.rotation.x = -Math.PI / 2
  pool.position.set(c.pool.x - c.x, c.waterY - c.y, c.pool.z - c.z)
  g.add(pool)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(c.pool.r + 1.3, 0.55, 6, 96), rock)
  ring.rotation.x = Math.PI / 2
  ring.position.set(c.pool.x - c.x, c.waterY - c.y + 0.5, c.pool.z - c.z)
  g.add(ring)

  // The way out: an arch full of daylight.
  const arch = new THREE.Group()
  arch.position.set(c.exit.x - c.x, local(c.exit.x - c.x, c.exit.z - c.z), c.exit.z - c.z)
  arch.rotation.y = c.exit.yaw
  const pillar = new THREE.BoxGeometry(1.6, 9, 1.6)
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(pillar, rock)
    m.position.set(side * 3.2, 3.8, 0)
    arch.add(m)
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(8.2, 1.5, 2.2), rock)
  lintel.position.set(0, 8.6, 0)
  arch.add(lintel)
  const day = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 8), dayMat)
  day.position.set(0, 3.6, -1.2)
  arch.add(day)
  g.add(arch)

  return { group: g, globes, globeBase, shafts, water }
}

function dispose(b: Built) {
  b.group.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.geometry) m.geometry.dispose()
  })
  b.shafts.forEach((s) => s.dispose())
  b.water.dispose()
}

export function Cave() {
  const holder = useMemo(() => ({ root: new THREE.Group(), built: null as Built | null, key: '' }), [])
  const lights = useMemo(() => [
    new THREE.PointLight(new THREE.Color('#4fd6d0'), 0, 0, 2),
    new THREE.PointLight(new THREE.Color('#ffb36b'), 0, 0, 2),
    new THREE.PointLight(new THREE.Color('#ffcf8a'), 0, 0, 2),
  ], [])
  const assets = useCast()
  const crew = useMemo(() => {
    if (!assets) return null
    const make = (role: Role, i: number) => {
      const a = castFor(assets, role)
      const lead = role === 'naib' || role === 'elder'
      return a ? makePerson(a, role, { scale: lead ? 1.06 : 0.94 + 0.12 * ((i * 0.618) % 1), eyes: true }) : null
    }
    return {
      naib: make('naib', 0),
      elder: make('elder', 6),
      mother: make('mother', 1),
      walkers: [make('fremen', 2), make('fremenWoman', 3), make('fremen', 4), make('fremenWoman', 5)],
    }
  }, [assets])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    const c = rt.cave
    if ((c?.key ?? '') !== holder.key) {
      if (holder.built) {
        holder.root.remove(holder.built.group)
        dispose(holder.built)
        holder.built = null
      }
      holder.key = c?.key ?? ''
      if (c) {
        holder.built = buildCave(c)
        holder.root.add(holder.built.group)
      }
    }
    const people = crew ? [crew.naib, crew.elder, crew.mother, ...crew.walkers] : []
    if (!c || !holder.built) {
      lights.forEach((l) => (l.intensity = 0))
      for (const v of people) {
        if (!v) continue
        v.root.visible = false
        hideEyes(v)
      }
      return
    }
    const b = holder.built
    const t = rt.time
    for (let i = 0; i < b.globes.count; i++) {
      const o = i * 4
      const ph = b.globeBase[o + 3]
      tmpQ.identity()
      b.globes.setMatrixAt(i, tmpM.compose(
        tmpP.set(b.globeBase[o] + Math.sin(t * 0.13 + ph) * 1.5, b.globeBase[o + 1] + Math.sin(t * 0.4 + ph) * 0.6, b.globeBase[o + 2] + Math.cos(t * 0.11 + ph) * 1.5),
        tmpQ, tmpS.setScalar(0.45),
      ))
    }
    b.globes.instanceMatrix.needsUpdate = true
    b.shafts.forEach((s) => (s.uniforms.uTime.value = t))
    b.water.uniforms.uTime.value = t

    lights[0].position.set(c.pool.x, c.waterY + 7, c.pool.z)
    lights[0].intensity = 2600
    lights[1].position.set(c.exit.x + Math.sin(c.exit.yaw) * 6, caveFloor(c, c.exit.x, c.exit.z) + 6, c.exit.z + Math.cos(c.exit.yaw) * 6)
    lights[1].intensity = 650
    lights[2].position.set(c.naibAt.x, caveFloor(c, c.naibAt.x, c.naibAt.z) + 7, c.naibAt.z)
    lights[2].intensity = 500

    if (!crew) return
    const p = rt.player.pos
    const stand = (v: Person | null, at: { x: number; z: number; yaw: number }, watch: boolean) => {
      if (!v) return
      const d = Math.hypot(p.x - at.x, p.z - at.z)
      v.yaw = dampAngle(v.yaw, watch && d < 20 ? Math.atan2(p.x - at.x, p.z - at.z) : at.yaw, 2.5, dt)
      v.root.visible = true
      v.root.position.set(at.x, caveFloor(c, at.x, at.z), at.z)
      v.root.rotation.y = v.yaw
      playClip(v, 'idle')
      v.mixer.update(dt * 0.85)
      v.root.updateMatrixWorld(true)
      placeEyes(v, v.yaw)
    }
    const leader = leaderRole(c.naib, c.key) === 'elder' ? crew.elder : crew.naib
    const other = leader === crew.naib ? crew.elder : crew.naib
    if (other) {
      other.root.visible = false
      hideEyes(other)
    }
    stand(leader, c.naibAt, true)
    stand(crew.mother, c.mother, true)
    crew.walkers.forEach((v, i) => {
      const w = caveWalkers[i]
      if (!v) return
      v.root.visible = !!w
      if (!w) {
        hideEyes(v)
        return
      }
      v.root.position.copy(w.pos)
      v.root.rotation.y = w.yaw
      playClip(v, w.speed > 0.3 ? 'walk' : 'idle', 0.3)
      const a = v.actions.get('walk')
      if (a) a.timeScale = clamp(w.speed / 1.45, 0.5, 1.2)
      v.mixer.update(dt)
      v.root.updateMatrixWorld(true)
      placeEyes(v, w.yaw)
    })
  })

  const people = crew ? [crew.naib, crew.elder, crew.mother, ...crew.walkers].filter((v): v is Person => !!v) : []
  return (
    <>
      <primitive object={holder.root} />
      {lights.map((l, i) => (
        <primitive key={`l${i}`} object={l} />
      ))}
      {people.map((v, i) => (
        <group key={`c${i}`}>
          <primitive object={v.root} />
          {v.eyes.map((e, k) => (
            <primitive key={k} object={e} />
          ))}
        </group>
      ))}
    </>
  )
}
