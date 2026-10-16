import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rt } from '../game/rt'
import { lerp, smoothstep } from '../game/math'
import { reflective } from './reflections'

function build() {
  const root = new THREE.Group()
  const metal = reflective(new THREE.MeshStandardMaterial({ color: '#6b6258', roughness: 0.5, metalness: 0.7 }))
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.9, 0.2) })
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.y = y
    m.castShadow = true
    root.add(m)
    return m
  }
  part(new THREE.CylinderGeometry(0.22, 0.32, 0.5, 10), metal, 0.1)
  part(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6), metal, 1.0)
  const weight = part(new THREE.CylinderGeometry(0.21, 0.21, 0.36, 10), metal, 0.6)
  const light = part(new THREE.SphereGeometry(0.07, 8, 6), lamp, 1.95)
  return { root, weight, light, lamp }
}

export function Thumper() {
  const t = useMemo(build, [])
  useFrame(() => {
    const th = rt.thumper
    t.root.visible = th.active
    if (!th.active) return
    t.root.position.copy(th.pos)
    const ph = th.phase
    t.weight.position.y = ph < 0.8 ? lerp(0.45, 1.55, smoothstep(0, 0.8, ph)) : lerp(1.55, 0.45, (ph - 0.8) / 0.2)
    const flash = ph < 0.15 ? 1 : 0.2
    t.lamp.color.setRGB(3 * flash, 0.9 * flash, 0.2 * flash)
  })
  return <primitive object={t.root} />
}
