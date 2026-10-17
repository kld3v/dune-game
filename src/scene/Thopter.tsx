import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rt } from '../game/rt'
import { clamp } from '../game/math'
import { reflective } from './reflections'

export interface Palette {
  hull: string
  trim: string
  glass: string
  membrane: string
  rib: string
  engine: THREE.Color
  navLeft: THREE.Color
  navRight: THREE.Color
}

export const ATREIDES: Palette = {
  hull: '#9a9384',
  trim: '#3b3732',
  glass: '#1a2630',
  membrane: '#d6cbb4',
  rib: '#5a554c',
  engine: new THREE.Color(2.2, 1.0, 0.35),
  navLeft: new THREE.Color(3, 0.2, 0.15),
  navRight: new THREE.Color(0.2, 3, 0.4),
}

export interface Ornithopter {
  root: THREE.Group
  wings: { pivot: THREE.Group; phase: number }[]
  blurMat: THREE.MeshBasicMaterial
  glow: THREE.MeshBasicMaterial
}

function wingGeometry() {
  const s = new THREE.Shape()
  s.moveTo(0, -0.34)
  s.lineTo(1.2, -0.52)
  s.bezierCurveTo(3.6, -0.6, 6.2, -0.42, 8.1, -0.04)
  s.lineTo(8.4, 0.02)
  s.lineTo(8.0, 0.16)
  s.bezierCurveTo(6.0, 0.5, 3.0, 0.62, 1.2, 0.5)
  s.lineTo(0, 0.38)
  s.closePath()
  const g = new THREE.ShapeGeometry(s, 24)
  g.rotateX(-Math.PI / 2)
  return g
}

function finGeometry(points: [number, number][], depth: number) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false })
  g.translate(0, 0, -depth / 2)
  return g
}

// A faceted, hard-surface ornithopter. Hull detail comes from flat-shaded low-segment
// lathes and edge lines rather than textures, which keeps it crisp at any distance.
export function buildOrnithopter(pal: Palette, scale = 1): Ornithopter {
  const root = new THREE.Group()
  const body = new THREE.Group()
  body.scale.setScalar(scale)
  root.add(body)
  const hull = reflective(new THREE.MeshStandardMaterial({ color: pal.hull, roughness: 0.32, metalness: 0.75, flatShading: true }))
  const trim = reflective(new THREE.MeshStandardMaterial({ color: pal.trim, roughness: 0.5, metalness: 0.6, flatShading: true }))
  const glass = reflective(new THREE.MeshPhysicalMaterial({
    color: pal.glass, roughness: 0.04, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, flatShading: true,
  }))
  const membrane = new THREE.MeshStandardMaterial({
    color: pal.membrane, roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false,
  })
  const rib = reflective(new THREE.MeshStandardMaterial({ color: pal.rib, roughness: 0.4, metalness: 0.7 }))
  const frameMat = new THREE.LineBasicMaterial({ color: '#16130f' })
  const blurMat = new THREE.MeshBasicMaterial({ color: '#efe6d6', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  const glow = new THREE.MeshBasicMaterial({ color: pal.engine.clone() })

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], r: [number, number, number] = [0, 0, 0], s: [number, number, number] = [1, 1, 1]) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(...p)
    m.rotation.set(...r)
    m.scale.set(...s)
    m.castShadow = true
    body.add(m)
    return m
  }

  // Octagonal fuselage, tapering to a sharp nose and a narrow tail.
  const profile = [
    [0.02, -3.4], [0.42, -3.0], [0.78, -2.2], [1.0, -0.8], [1.04, 0.4], [0.98, 1.6], [0.8, 2.6], [0.48, 3.4], [0.08, 3.9],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const fuselage = new THREE.LatheGeometry(profile, 8)
  fuselage.rotateX(Math.PI / 2)
  fuselage.rotateZ(Math.PI / 8)
  fuselage.scale(1, 0.8, 1)
  add(fuselage, hull, [0, 0, 0])

  // Paned canopy: a faceted dome with its edges drawn in as the frame.
  const canopyGeo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5)
  const canopy = add(canopyGeo, glass, [0, 0.3, 1.9], [0, 0, 0], [0.82, 0.62, 1.55])
  canopy.add(new THREE.LineSegments(new THREE.EdgesGeometry(canopyGeo, 1), frameMat))
  add(new THREE.BoxGeometry(0.12, 0.1, 4.6), trim, [0, 0.84, -0.9])

  // Tail boom and swept fins.
  add(new THREE.CylinderGeometry(0.16, 0.34, 4.4, 6), hull, [0, 0.12, -5.4], [Math.PI / 2, 0, 0])
  add(finGeometry([[0, 0], [1.6, 0], [2.0, 1.8], [1.4, 1.8]], 0.08), trim, [0, 0.3, -6.6], [0, Math.PI / 2, 0])
  for (const side of [-1, 1]) {
    add(finGeometry([[0, 0], [1.3, 0], [1.5, 0.9], [0.9, 0.9]], 0.06), trim, [side * 0.5, 0.2, -6.9], [Math.PI / 2, 0, side > 0 ? -Math.PI / 2 : Math.PI / 2])
  }

  // Nacelles with intake rings and glowing exhausts.
  const nacelle = new THREE.CylinderGeometry(0.42, 0.52, 2.6, 6)
  const ring = new THREE.TorusGeometry(0.46, 0.06, 6, 12)
  const disc = new THREE.CircleGeometry(0.36, 12)
  const skid = new THREE.CylinderGeometry(0.06, 0.06, 6.6, 6)
  const strut = new THREE.CylinderGeometry(0.045, 0.045, 1.2, 5)
  const nav = new THREE.SphereGeometry(0.09, 6, 4)
  for (const side of [-1, 1]) {
    add(nacelle, trim, [side * 1.22, 0.42, -0.5], [Math.PI / 2, 0, 0])
    add(ring, rib, [side * 1.22, 0.42, 0.82])
    add(disc, glow, [side * 1.22, 0.42, -1.82], [0, Math.PI, 0])
    add(skid, trim, [side * 0.95, -1.12, 0.2], [Math.PI / 2, 0, 0])
    for (const z of [-1.6, 1.8]) add(strut, trim, [side * 0.8, -0.62, z], [0, 0, side * 0.4])
    add(nav, new THREE.MeshBasicMaterial({ color: side < 0 ? pal.navLeft : pal.navRight }), [side * 1.25, 0.95, -0.2])
  }
  add(nav, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3) }), [0, 2.05, -7.0])

  // Wings: membrane, leading-edge spar and ribs. Right-hand wings are mirrored by their
  // anchor, so every pivot animates identically.
  const wingGeo = wingGeometry()
  const spar = new THREE.BoxGeometry(8.2, 0.08, 0.1)
  spar.translate(4.1, 0, 0.42)
  const ribGeo = new THREE.BoxGeometry(0.05, 0.05, 1.0)
  const blurGeo = new THREE.RingGeometry(0.9, 8.2, 20, 1, -0.6, 1.2)
  const wings: Ornithopter['wings'] = []
  for (const [z, phase] of [[0.85, 0], [-1.2, Math.PI]] as const) {
    for (const side of [1, -1]) {
      const anchor = new THREE.Group()
      anchor.position.set(side * 0.92, 0.82, z)
      anchor.scale.x = side
      const pivot = new THREE.Group()
      pivot.add(new THREE.Mesh(wingGeo, membrane))
      const sp = new THREE.Mesh(spar, rib)
      sp.castShadow = true
      pivot.add(sp)
      for (let i = 1; i <= 5; i++) {
        const r = new THREE.Mesh(ribGeo, rib)
        const x = i * 1.35
        r.position.set(x, 0, 0.05)
        r.scale.z = 1 - (x / 8.2) * 0.65
        pivot.add(r)
      }
      anchor.add(pivot, new THREE.Mesh(blurGeo, blurMat))
      body.add(anchor)
      wings.push({ pivot, phase })
    }
  }
  return { root, wings, blurMat, glow }
}

// Pose an ornithopter: attitude, flapping (folded when parked) and engine glow.
export function poseOrnithopter(o: Ornithopter, pos: THREE.Vector3, pitch: number, yaw: number, bank: number, wingPhase: number, wingRate: number, fold: number, thrust: number, engine: THREE.Color) {
  o.root.position.copy(pos)
  o.root.rotation.set(pitch, yaw, bank, 'YXZ')
  const amp = 0.55 * (1 - fold)
  for (const w of o.wings) w.pivot.rotation.set(0, fold * 1.25, Math.sin(wingPhase + w.phase) * amp + 0.06 * (1 - fold))
  o.blurMat.opacity = clamp((wingRate - 8) / 20, 0, 1) * 0.04
  o.glow.color.copy(engine).multiplyScalar(0.45 + thrust * 0.8)
}

export function Thopter() {
  const t = useMemo(() => buildOrnithopter(ATREIDES), [])
  useFrame(() => {
    const s = rt.thopter
    t.root.visible = s.alive
    if (!s.alive) return
    poseOrnithopter(t, s.pos, s.pitch, s.yaw, s.bank, s.wingPhase, s.wingRate, s.fold, s.thrust, ATREIDES.engine)
  })
  return <primitive object={t.root} />
}
