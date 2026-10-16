import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rt } from '../game/rt'
import { clamp } from '../game/math'
import { reflective } from './reflections'

interface Wing {
  pivot: THREE.Group
  phase: number
}

function wingGeometry() {
  const s = new THREE.Shape()
  s.moveTo(0, -0.32)
  s.bezierCurveTo(2.2, -0.62, 5.4, -0.5, 7.4, -0.06)
  s.bezierCurveTo(7.7, 0.02, 7.7, 0.12, 7.3, 0.18)
  s.bezierCurveTo(5.2, 0.62, 2.2, 0.66, 0, 0.36)
  s.closePath()
  const g = new THREE.ShapeGeometry(s, 24)
  g.rotateX(-Math.PI / 2)
  return g
}

function build() {
  const root = new THREE.Group()
  const metal = reflective(new THREE.MeshStandardMaterial({ color: '#948d80', roughness: 0.38, metalness: 0.7 }))
  const dark = reflective(new THREE.MeshStandardMaterial({ color: '#3a3631', roughness: 0.55, metalness: 0.5 }))
  const glass = reflective(new THREE.MeshStandardMaterial({ color: '#1a2630', roughness: 0.05, metalness: 0.9 }))
  const membrane = new THREE.MeshStandardMaterial({
    color: '#cfc4ad', roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.58,
    side: THREE.DoubleSide, depthWrite: false,
  })
  const blurMat = new THREE.MeshBasicMaterial({
    color: '#efe6d6', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
  })
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.1, 0.35) })
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], r: [number, number, number] = [0, 0, 0], s: [number, number, number] = [1, 1, 1]) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(...p)
    m.rotation.set(...r)
    m.scale.set(...s)
    m.castShadow = true
    root.add(m)
    return m
  }

  add(new THREE.CapsuleGeometry(0.95, 4.4, 8, 16), metal, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 0.82])
  add(new THREE.SphereGeometry(1.05, 24, 16), glass, [0, 0.22, 2.55], [0, 0, 0], [0.95, 0.86, 1.28])
  const rib = new THREE.TorusGeometry(1.0, 0.045, 6, 24, Math.PI)
  for (const z of [2.0, 2.55, 3.1]) add(rib, dark, [0, 0.22, z], [0, 0, 0], [0.97 - Math.abs(z - 2.55) * 0.3, 0.9, 1])
  add(new THREE.CylinderGeometry(0.22, 0.42, 5.2, 10), metal, [0, 0.15, -4.6], [Math.PI / 2, 0, 0])
  add(new THREE.BoxGeometry(0.1, 1.5, 1.4), dark, [0, 0.85, -6.7])
  add(new THREE.BoxGeometry(2.8, 0.08, 0.9), dark, [0, 0.25, -6.6])
  const pod = new THREE.CylinderGeometry(0.42, 0.5, 2.4, 12)
  const disc = new THREE.CircleGeometry(0.34, 16)
  const skid = new THREE.CylinderGeometry(0.07, 0.07, 6.2, 6)
  const strut = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6)
  for (const side of [-1, 1]) {
    add(pod, dark, [side * 1.15, 0.55, -0.3], [Math.PI / 2, 0, 0])
    add(disc, glow, [side * 1.15, 0.55, -1.52], [0, Math.PI, 0])
    add(skid, dark, [side * 0.95, -1.18, 0.2], [Math.PI / 2, 0, 0])
    for (const z of [-1.4, 1.6]) add(strut, dark, [side * 0.82, -0.72, z], [0, 0, side * 0.35])
  }

  const wingGeo = wingGeometry()
  const spar = new THREE.BoxGeometry(7.2, 0.07, 0.09)
  spar.translate(3.6, 0, 0.3)
  const blurGeo = new THREE.RingGeometry(0.9, 7.4, 20, 1, -0.6, 1.2)
  // Right-hand wings are mirrored by their anchor, so every pivot animates identically.
  const wings: Wing[] = []
  for (const [z, phase] of [[0.9, 0], [-1.1, Math.PI]] as const) {
    for (const side of [1, -1]) {
      const anchor = new THREE.Group()
      anchor.position.set(side * 0.9, 0.78, z)
      anchor.scale.x = side
      const pivot = new THREE.Group()
      const w = new THREE.Mesh(wingGeo, membrane)
      const sp = new THREE.Mesh(spar, metal)
      sp.castShadow = true
      pivot.add(w, sp)
      anchor.add(pivot, new THREE.Mesh(blurGeo, blurMat))
      root.add(anchor)
      wings.push({ pivot, phase })
    }
  }
  return { root, wings, blurMat, glow }
}

export function Thopter() {
  const t = useMemo(build, [])

  useFrame(() => {
    const s = rt.thopter
    t.root.visible = s.alive
    if (!s.alive) return
    t.root.position.copy(s.pos)
    t.root.rotation.set(s.pitch, s.yaw, s.bank, 'YXZ')
    const amp = 0.55 * (1 - s.fold)
    for (const w of t.wings) {
      const flap = Math.sin(s.wingPhase + w.phase) * amp + 0.06 * (1 - s.fold)
      w.pivot.rotation.set(0, s.fold * 1.25, flap)
    }
    t.blurMat.opacity = clamp((s.wingRate - 8) / 20, 0, 1) * 0.04
    t.glow.color.setRGB(0.9 + s.thrust * 1.6, 0.4 + s.thrust * 0.6, 0.12 + s.thrust * 0.18)
  })

  return <primitive object={t.root} />
}
