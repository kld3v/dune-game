import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rt } from '../game/rt'
import { CITY_H, CITY_X, CITY_Z } from '../game/terrain'
import { cityLayout, walkers } from '../game/city'
import { clamp, dampAngle } from '../game/math'
import { reflective } from './reflections'
import { castFor, makePerson, playClip, useCast, type Person, type Role } from './people'

const night = { value: 0 }

// Concrete with window slits: dark by day, warm at night, a few lit per floor at random.
function concrete(windows: boolean) {
  const mat = reflective(new THREE.MeshStandardMaterial({ color: '#8b7b68', roughness: 0.92, metalness: 0, flatShading: true }))
  if (!windows) return mat
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCityPos;\nvarying float vSeed;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vCityPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying vec3 vCityPos;\nvarying float vSeed;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fy = fract(vCityPos.y / 4.2);
        float fc = fract((vCityPos.x + vCityPos.z) / 3.1);
        float slit = step(0.62, fy) * step(fy, 0.82) * step(0.22, fc) * step(fc, 0.78) * step(${CITY_H.toFixed(1)} + 3.0, vCityPos.y);
        float cell = floor(vCityPos.y / 4.2) * 7.0 + floor((vCityPos.x + vCityPos.z) / 3.1);
        float lit = step(0.58, fract(sin(cell * 12.9898 + vSeed * 78.233) * 43758.5453));
        diffuseColor.rgb *= 1.0 - slit * 0.6;
        totalEmissiveRadiance += slit * lit * uNight * vec3(1.7, 1.0, 0.45);`)
  }
  return mat
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: { m: THREE.Matrix4 }[]) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length))
  items.forEach((it, i) => mesh.setMatrixAt(i, it.m))
  mesh.count = items.length
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.computeBoundingSphere()
  return mesh
}

const q = new THREE.Quaternion()
const Y = new THREE.Vector3(0, 1, 0)
const box = (x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number) =>
  ({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(Y, yaw).clone(), new THREE.Vector3(sx, sy, sz)) })

function buildCity() {
  const L = cityLayout()
  const group = new THREE.Group()
  const unit = new THREE.BoxGeometry(1, 1, 1)
  unit.translate(0, 0.5, 0)
  const base = CITY_H - 2
  group.add(instanced(unit, concrete(true), L.buildings.map((b) => box(b.x, base, b.z, b.yaw, b.w, b.h + 2, b.d))))
  const plain = concrete(false)
  group.add(instanced(unit, plain, L.wall.filter((w) => !w.tower).map((w) => box(w.x, base, w.z, w.yaw + Math.PI / 2, w.len, 20, 6))))
  group.add(instanced(unit, plain, L.wall.filter((w) => w.tower).map((w) => box(w.x, base, w.z, w.yaw, 14, 30, 14))))

  // The Residency: a vast stepped monolith at the heart of the city.
  const frustum = new THREE.CylinderGeometry(30, 54, 70, 4, 1)
  frustum.rotateY(Math.PI / 4)
  frustum.translate(0, 35, 0)
  group.add(instanced(frustum, concrete(true), [box(CITY_X, base, CITY_Z, L.gateYaw, 1, 1, 1)]))
  const crown = new THREE.CylinderGeometry(9, 14, 34, 4, 1)
  crown.rotateY(Math.PI / 4)
  crown.translate(0, 17, 0)
  group.add(instanced(crown, plain, [box(CITY_X, base + 70, CITY_Z, L.gateYaw, 1, 1, 1)]))

  // Landing pad, ringed with lights.
  const padMat = reflective(new THREE.MeshStandardMaterial({ color: '#4a4440', roughness: 0.7, metalness: 0.2 }))
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(22, 23, 0.8, 40), padMat)
  pad.position.set(L.pad.x, CITY_H + 0.1, L.pad.z)
  pad.receiveShadow = true
  group.add(pad)
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color() })
  const bulb = new THREE.SphereGeometry(0.3, 8, 6)
  const padLights = []
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2
    padLights.push(box(L.pad.x + Math.sin(a) * 21, CITY_H + 0.7, L.pad.z + Math.cos(a) * 21, 0, 1, 1, 1))
  }
  const padBulbs = instanced(bulb, lightMat, padLights)
  padBulbs.castShadow = false
  group.add(padBulbs)

  // Lamps down the avenue.
  const pole = new THREE.CylinderGeometry(0.12, 0.16, 6, 6)
  pole.translate(0, 3, 0)
  group.add(instanced(pole, plain, L.lamps.map((l) => box(l.x, CITY_H, l.z, 0, 1, 1, 1))))
  const heads = instanced(new THREE.SphereGeometry(0.4, 10, 8), lightMat, L.lamps.map((l) => box(l.x, CITY_H + 6.2, l.z, 0, 1, 1, 1)))
  heads.castShadow = false
  group.add(heads)

  // Market stalls: posts and dyed cloth.
  const cloths = ['#8c3b22', '#b3802f', '#2e3f6b', '#6b2e4a'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide }))
  const post = new THREE.CylinderGeometry(0.08, 0.08, 3, 5)
  L.stalls.forEach((s, i) => {
    const g = new THREE.Group()
    g.position.set(s.x, CITY_H, s.z)
    g.rotation.y = s.yaw
    for (const [x, z] of [[-2.2, -1.6], [2.2, -1.6], [-2.2, 1.6], [2.2, 1.6]]) {
      const m = new THREE.Mesh(post, plain)
      m.position.set(x, 1.5, z)
      g.add(m)
    }
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 4), cloths[i % cloths.length])
    roof.rotation.x = -Math.PI / 2 + 0.18
    roof.position.y = 3.05
    roof.castShadow = true
    g.add(roof)
    const table = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.9, 1.2), plain)
    table.position.set(0, 0.45, 0.6)
    table.castShadow = true
    g.add(table)
    group.add(g)
  })
  return { group, lightMat }
}

export function City() {
  const city = useMemo(buildCity, [])
  const assets = useCast()
  const people = useMemo(() => {
    if (!assets) return null
    const make = (role: Role, scale: number) => {
      const a = castFor(assets, role)
      return a ? makePerson(a, role, { scale }) : null
    }
    const all = (list: (Person | null)[]) => list.filter((v): v is Person => !!v)
    return {
      walkers: all(Array.from({ length: 6 }, (_, i) => make(i % 2 ? 'townswoman' : 'townsman', 0.93 + 0.1 * ((i * 0.618) % 1)))),
      guards: all([make('guard', 1.04), make('guard', 1.02)]),
      trader: make('merchant', 0.98),
    }
  }, [assets])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    night.value = rt.env.night
    city.lightMat.color.setRGB(2.4, 1.4, 0.6).multiplyScalar(0.3 + 1.7 * rt.env.night)
    if (!people) return
    const p = rt.player.pos
    const near = Math.hypot(p.x - CITY_X, p.z - CITY_Z) < 650
    const L = cityLayout()
    people.walkers.forEach((v, i) => {
      const w = walkers[i]
      v.root.visible = near && !!w
      if (!v.root.visible || !w) return
      v.root.position.set(w.pos.x, CITY_H, w.pos.z)
      v.root.rotation.y = w.yaw
      playClip(v, w.speed > 0.4 ? 'walk' : 'idle', 0.3)
      const a = v.actions.get('walk')
      if (a) a.timeScale = clamp(w.speed / 1.45, 0.6, 1.3)
      v.mixer.update(dt)
    })
    people.guards.forEach((v, i) => {
      const g = L.guards[i]
      v.root.visible = near
      if (!near) return
      v.root.position.set(g.x, CITY_H, g.z)
      v.root.rotation.y = g.yaw
      v.mixer.update(dt * 0.8)
    })
    const t = people.trader
    if (t) t.root.visible = near
    if (t && near) {
      const d = Math.hypot(p.x - L.trader.x, p.z - L.trader.z)
      const want = d < 15 ? Math.atan2(p.x - L.trader.x, p.z - L.trader.z) : L.trader.yaw
      t.root.rotation.y = dampAngle(t.root.rotation.y, want, 3, dt)
      t.root.position.set(L.trader.x, CITY_H, L.trader.z)
      t.mixer.update(dt)
    }
  })

  return (
    <>
      <primitive object={city.group} />
      {people
        ? [...people.walkers, ...people.guards, ...(people.trader ? [people.trader] : [])].map((v, i) => <primitive key={i} object={v.root} />)
        : null}
    </>
  )
}
