import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rt } from '../game/rt'
import { clamp } from '../game/math'
import { reflective } from './reflections'

function robeGeometry() {
  const pts = [
    [0.0, 1.62], [0.17, 1.6], [0.27, 1.52], [0.33, 1.38], [0.34, 1.12],
    [0.37, 0.8], [0.42, 0.45], [0.47, 0.16], [0.5, 0.06],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  return new THREE.LatheGeometry(pts, 18)
}

function build() {
  const root = new THREE.Group()
  const robe = new THREE.MeshStandardMaterial({ color: '#9a7a54', roughness: 0.95, side: THREE.DoubleSide })
  const sash = new THREE.MeshStandardMaterial({ color: '#6e5238', roughness: 0.9 })
  const suit = reflective(new THREE.MeshStandardMaterial({ color: '#4a4038', roughness: 0.6, metalness: 0.25 }))
  const eyes = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.3, 3.2) })
  const hookMat = reflective(new THREE.MeshStandardMaterial({ color: '#8a7f6e', roughness: 0.35, metalness: 0.75 }))

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.y = y
    m.castShadow = true
    return m
  }
  const legGeo = new THREE.CapsuleGeometry(0.1, 0.62, 4, 8)
  const armGeo = new THREE.CapsuleGeometry(0.075, 0.48, 4, 8)
  const limb = (x: number, y: number, geo: THREE.BufferGeometry, off: number, mat: THREE.Material) => {
    const g = new THREE.Group()
    g.position.set(x, y, 0)
    g.add(mesh(geo, mat, off))
    root.add(g)
    return g
  }
  const legL = limb(0.12, 0.92, legGeo, -0.43, suit)
  const legR = limb(-0.12, 0.92, legGeo, -0.43, suit)
  const armL = limb(0.36, 1.48, armGeo, -0.3, robe)
  const armR = limb(-0.36, 1.48, armGeo, -0.3, robe)
  const body = new THREE.Group()
  const cloak = mesh(robeGeometry(), robe, 0)
  const belt = mesh(new THREE.TorusGeometry(0.345, 0.035, 6, 20), sash, 1.12)
  belt.rotation.x = Math.PI / 2
  const head = mesh(new THREE.SphereGeometry(0.15, 14, 12), suit, 1.8)
  // SphereGeometry phi = PI/2 faces +Z (forward): the hood leaves that side open, the mask covers it.
  const hood = mesh(new THREE.SphereGeometry(0.21, 16, 10, Math.PI / 2 + 0.7, Math.PI * 2 - 1.4, 0, Math.PI * 0.6), robe, 1.8)
  hood.rotation.x = -0.2
  const mask = mesh(new THREE.SphereGeometry(0.155, 12, 8, Math.PI / 2 - 0.9, 1.8, Math.PI * 0.45, Math.PI * 0.3), sash, 1.79)
  body.add(cloak, belt, head, hood, mask)
  const eyeGeo = new THREE.SphereGeometry(0.022, 8, 6)
  for (const x of [-0.052, 0.052]) {
    const e = new THREE.Mesh(eyeGeo, eyes)
    e.position.set(x, 1.83, 0.135)
    body.add(e)
  }
  root.add(body)
  const hooks = new THREE.Group()
  const hookGeo = new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6)
  for (const x of [-0.45, 0.45]) {
    const h = new THREE.Mesh(hookGeo, hookMat)
    h.position.set(x, 0.6, 0.55)
    h.rotation.x = 0.6
    h.castShadow = true
    hooks.add(h)
  }
  root.add(hooks)
  return { root, legL, legR, armL, armR, body, hooks }
}

export function PlayerModel() {
  const m = useMemo(build, [])

  useFrame(() => {
    const p = rt.player
    const dead = rt.phase === 'dead' && rt.deathReason === 'worm'
    m.root.visible = rt.mode !== 'thopter' && !dead
    if (!m.root.visible) return
    m.root.position.copy(p.pos)
    m.root.rotation.y = p.yaw
    const riding = rt.mode === 'worm'
    m.hooks.visible = riding
    const walk = riding ? 0 : clamp(p.speed / 6, 0, 1.4)
    const ph = p.walkPhase * Math.PI * 2
    const swing = Math.sin(ph) * 0.6 * walk
    if (!p.grounded && !riding) {
      m.legL.rotation.x = -0.5
      m.legR.rotation.x = 0.2
    } else if (riding) {
      m.legL.rotation.x = -0.35
      m.legR.rotation.x = 0.35
    } else {
      m.legL.rotation.x = swing
      m.legR.rotation.x = -swing
    }
    m.armL.rotation.x = riding ? -0.9 : -swing * 0.8
    m.armR.rotation.x = riding ? -0.9 : swing * 0.8
    m.root.position.y += Math.abs(Math.sin(ph)) * 0.05 * walk - (riding ? 0.12 : 0)
    m.body.rotation.x = (p.running ? 0.14 : riding ? 0.22 : 0) + Math.sin(rt.time * 2.3) * 0.01
    m.body.rotation.z = Math.sin(rt.time * 1.7) * 0.012
  })

  return <primitive object={m.root} />
}
