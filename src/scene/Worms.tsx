import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rt, MAX_WORMS, WORM_R as R, WORM_RINGS, type Worm } from '../game/rt'
import { DRADII, PLATE, RADII } from '../game/wormShape'
import { terrainHeight } from '../game/terrain'
import { TAU, smoothstep } from '../game/math'
import { reflective } from './reflections'

const SEG = 22
const ROW = SEG + 1
const VERTS = WORM_RINGS * ROW
const COS = new Float32Array(ROW)
const SIN = new Float32Array(ROW)
for (let j = 0; j < ROW; j++) {
  COS[j] = Math.cos((j / SEG) * TAU)
  SIN[j] = Math.sin((j / SEG) * TAU)
}
const PLATE_K = Float32Array.from(PLATE, (p) => Math.pow(p, 0.7))

const SKIN = new THREE.Color('#6d6152')
const GROOVE = new THREE.Color('#2a231d')
const DUST = new THREE.Color('#c49a68')

const GHOST_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
void main() {
  vN = normal;
  vW = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`
const GHOST_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uTime;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float fr = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
  float band = 0.5 + 0.5 * sin(dot(vW, vec3(0.21, 0.13, 0.17)) - uTime * 3.0);
  vec3 c = mix(vec3(0.2, 0.55, 1.7), vec3(1.5, 0.45, 2.1), band);
  gl_FragColor = vec4(c * (0.12 + fr * 1.5) * uOpacity, 1.0);
}
`

interface WormView {
  group: THREE.Group
  body: THREE.Mesh
  ghost: THREE.Mesh
  mouth: THREE.Group
  petals: THREE.Group[]
  geo: THREE.BufferGeometry
  ghostMat: THREE.ShaderMaterial
}

function buildBodyGeometry() {
  const geo = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'color']) {
    const attr = new THREE.BufferAttribute(new Float32Array(VERTS * 3), 3)
    attr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute(name, attr)
  }
  const idx = new Uint32Array((WORM_RINGS - 1) * SEG * 6)
  let o = 0
  for (let i = 0; i < WORM_RINGS - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * ROW + j
      const b = a + 1
      const c = a + ROW
      const d = c + 1
      idx[o++] = a
      idx[o++] = c
      idx[o++] = b
      idx[o++] = b
      idx[o++] = c
      idx[o++] = d
    }
  }
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  return geo
}

function buildMouth(): { mouth: THREE.Group; petals: THREE.Group[] } {
  const mouth = new THREE.Group()
  const ph = R * 1.75
  const rb = R * 0.86
  const petalGeo = new THREE.CylinderGeometry(R * 0.12, rb, ph, 12, 5, true, -0.92, 1.84)
  petalGeo.translate(0, ph / 2, -rb)
  const outer = new THREE.MeshStandardMaterial({ color: '#5f5447', roughness: 0.85 })
  const inner = new THREE.MeshStandardMaterial({ color: '#7a2c1e', emissive: '#3a0b04', roughness: 0.55, side: THREE.BackSide })
  const petals: THREE.Group[] = []
  for (let k = 0; k < 3; k++) {
    const slice = new THREE.Group()
    slice.rotation.y = (k * TAU) / 3
    const pivot = new THREE.Group()
    pivot.position.set(0, 0, rb)
    const o = new THREE.Mesh(petalGeo, outer)
    o.castShadow = true
    pivot.add(o, new THREE.Mesh(petalGeo, inner))
    slice.add(pivot)
    mouth.add(slice)
    petals.push(pivot)
  }

  const toothGeo = new THREE.ConeGeometry(0.3, 2.0, 6)
  const toothMat = reflective(new THREE.MeshStandardMaterial({ color: '#ece2c8', roughness: 0.3, metalness: 0.2, emissive: '#2a2212' }))
  const perRing = 28
  const teeth = new THREE.InstancedMesh(toothGeo, toothMat, perRing * 3)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const Y = new THREE.Vector3(0, 1, 0)
  const dir = new THREE.Vector3()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()
  let n = 0
  for (let k = 0; k < 3; k++) {
    const radius = R * (0.78 - 0.17 * k)
    for (let t = 0; t < perRing; t++) {
      const phi = (t / perRing) * TAU + k * 0.11
      const cx = Math.cos(phi)
      const cz = Math.sin(phi)
      dir.set(-cx * 0.85, 0.55, -cz * 0.85).normalize()
      q.setFromUnitVectors(Y, dir)
      p.set(cx * radius, -0.5 - 1.3 * k, cz * radius).addScaledVector(dir, 0.9)
      s.setScalar(1 - 0.15 * k)
      m.compose(p, q, s)
      teeth.setMatrixAt(n++, m)
    }
  }

  const th = R * 3.2
  const throatGeo = new THREE.ConeGeometry(R * 0.82, th, 24, 6, true)
  throatGeo.rotateX(Math.PI)
  throatGeo.translate(0, -th / 2 - 0.2, 0)
  const tp = throatGeo.attributes.position
  const tc = new Float32Array(tp.count * 3)
  for (let i = 0; i < tp.count; i++) {
    const t = Math.pow(Math.min(1, Math.max(0, (-0.2 - tp.getY(i)) / th)), 1.4)
    tc[i * 3] = 0.22 + (2.4 - 0.22) * t
    tc[i * 3 + 1] = 0.03 + (0.8 - 0.03) * t
    tc[i * 3 + 2] = 0.01 + (0.15 - 0.01) * t
  }
  throatGeo.setAttribute('color', new THREE.BufferAttribute(tc, 3))
  const throat = new THREE.Mesh(throatGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }))
  mouth.add(teeth, throat)
  return { mouth, petals }
}

function buildView(): WormView {
  const group = new THREE.Group()
  const geo = buildBodyGeometry()
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 }))
  body.castShadow = true
  body.receiveShadow = true
  body.frustumCulled = false
  const ghostMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
    vertexShader: GHOST_VERT,
    fragmentShader: GHOST_FRAG,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const ghost = new THREE.Mesh(geo, ghostMat)
  ghost.frustumCulled = false
  ghost.renderOrder = 20
  const { mouth, petals } = buildMouth()
  group.add(body, ghost, mouth)
  group.visible = false
  return { group, body, ghost, mouth, petals, geo, ghostMat }
}

const Y = new THREE.Vector3(0, 1, 0)
const T0 = new THREE.Vector3()

function writeBody(w: Worm, geo: THREE.BufferGeometry) {
  const sp = w.spine
  const pos = (geo.attributes.position as THREE.BufferAttribute).array as Float32Array
  const nrm = (geo.attributes.normal as THREE.BufferAttribute).array as Float32Array
  const col = (geo.attributes.color as THREE.BufferAttribute).array as Float32Array
  let nx = 0
  let ny = 1
  let nz = 0
  let ptx = 0
  let pty = 0
  let ptz = 1
  for (let i = 0; i < WORM_RINGS; i++) {
    const a = (i > 0 ? i - 1 : 0) * 3
    const b = (i < WORM_RINGS - 1 ? i + 1 : WORM_RINGS - 1) * 3
    let tx = sp[a] - sp[b]
    let ty = sp[a + 1] - sp[b + 1]
    let tz = sp[a + 2] - sp[b + 2]
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz)
    if (tl < 1e-6) {
      tx = ptx
      ty = pty
      tz = ptz
    } else {
      tx /= tl
      ty /= tl
      tz /= tl
    }
    if (i === 0) {
      nx = -tx * ty
      ny = 1 - ty * ty
      nz = -tz * ty
      if (nx * nx + ny * ny + nz * nz < 0.0025) {
        nx = 1 - tx * tx
        ny = -ty * tx
        nz = -tz * tx
      }
    } else {
      const d = nx * tx + ny * ty + nz * tz
      nx -= tx * d
      ny -= ty * d
      nz -= tz * d
    }
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    nx /= nl
    ny /= nl
    nz /= nl
    const bx = ty * nz - tz * ny
    const by = tz * nx - tx * nz
    const bz = tx * ny - ty * nx
    const r = RADII[i]
    const dr = DRADII[i]
    const pk = PLATE_K[i]
    const cx = sp[i * 3]
    const cy = sp[i * 3 + 1]
    const cz = sp[i * 3 + 2]
    const baseR = GROOVE.r + (SKIN.r - GROOVE.r) * pk
    const baseG = GROOVE.g + (SKIN.g - GROOVE.g) * pk
    const baseB = GROOVE.b + (SKIN.b - GROOVE.b) * pk
    for (let j = 0; j < ROW; j++) {
      const c = COS[j]
      const s = SIN[j]
      const rx = nx * c + bx * s
      const ry = ny * c + by * s
      const rz = nz * c + bz * s
      const k = (i * ROW + j) * 3
      pos[k] = cx + rx * r
      pos[k + 1] = cy + ry * r
      pos[k + 2] = cz + rz * r
      let ox = rx + tx * dr
      let oy = ry + ty * dr
      let oz = rz + tz * dr
      const ol = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1
      ox /= ol
      oy /= ol
      oz /= ol
      nrm[k] = ox
      nrm[k + 1] = oy
      nrm[k + 2] = oz
      const dust = smoothstep(0.25, 0.9, oy) * 0.55 * PLATE[i]
      const shade = 0.72 + 0.28 * (oy * 0.5 + 0.5)
      col[k] = (baseR + (DUST.r - baseR) * dust) * shade
      col[k + 1] = (baseG + (DUST.g - baseG) * dust) * shade
      col[k + 2] = (baseB + (DUST.b - baseB) * dust) * shade
    }
    ptx = tx
    pty = ty
    ptz = tz
  }
  geo.attributes.position.needsUpdate = true
  geo.attributes.normal.needsUpdate = true
  geo.attributes.color.needsUpdate = true
}

function bodyAboveGround(w: Worm): boolean {
  const sp = w.spine
  for (let i = 0; i < WORM_RINGS; i += 6) {
    if (sp[i * 3 + 1] + RADII[i] > terrainHeight(sp[i * 3], sp[i * 3 + 2]) - 0.5) return true
  }
  return false
}

export function Worms() {
  const views = useMemo(() => Array.from({ length: MAX_WORMS }, buildView), [])

  useFrame(() => {
    const ghostOpacity = smoothstep(0.3, 0.7, rt.trip)
    for (let i = 0; i < MAX_WORMS; i++) {
      const v = views[i]
      const w = rt.worms[i]
      if (!w) {
        v.group.visible = false
        continue
      }
      const above = bodyAboveGround(w)
      const showGhost = ghostOpacity > 0.01
      v.group.visible = above || showGhost
      if (!v.group.visible) continue
      writeBody(w, v.geo)
      v.body.visible = above
      v.ghost.visible = showGhost
      v.ghostMat.uniforms.uOpacity.value = ghostOpacity
      v.ghostMat.uniforms.uTime.value = rt.time
      const sp = w.spine
      const headY = sp[1]
      v.mouth.visible = above && headY > terrainHeight(sp[0], sp[2]) - R * 2.2
      if (v.mouth.visible) {
        v.mouth.position.set(sp[0], sp[1], sp[2])
        T0.set(sp[0] - sp[6], sp[1] - sp[7], sp[2] - sp[8]).normalize()
        v.mouth.quaternion.setFromUnitVectors(Y, T0)
        for (const p of v.petals) p.rotation.x = w.mouth * 1.15
      }
    }
  })

  return (
    <>
      {views.map((v, i) => (
        <primitive key={i} object={v.group} />
      ))}
    </>
  )
}
