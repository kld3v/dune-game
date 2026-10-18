import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rt, type Sietch } from '../game/rt'
import { clamp, dampAngle } from '../game/math'
import { reflective } from './reflections'
import { castFor, hideEyes, leaderRole, makePerson, placeEyes, playClip, useCast, type Person, type Role } from './people'

const SITES = 3

const stone = reflective(new THREE.MeshStandardMaterial({ color: '#6e5641', roughness: 0.95, metalness: 0, flatShading: true }))
const doorway = new THREE.MeshBasicMaterial({ color: new THREE.Color() })
const metal = reflective(new THREE.MeshStandardMaterial({ color: '#4d433a', roughness: 0.5, metalness: 0.6, flatShading: true }))
const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color() })
const LAMP = new THREE.Color(2.4, 1.3, 0.5)
const DOOR = new THREE.Color(0.16, 0.08, 0.03)

// The gate of a sietch: pillars and a lintel over a walled way into the rock, with
// windtraps pulling water from the air behind it. Forward (+Z) faces out over the sand.
function buildSite() {
  const g = new THREE.Group()
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.rotation.y = ry
    m.castShadow = true
    m.receiveShadow = true
    g.add(m)
    return m
  }
  const pillar = new THREE.BoxGeometry(1.4, 7.4, 1.4)
  add(pillar, stone, -2.5, 2.0, 0)
  add(pillar, stone, 2.5, 2.0, 0)
  add(new THREE.BoxGeometry(6.8, 1.1, 1.9), stone, 0, 6.2, 0)
  const wall = new THREE.BoxGeometry(0.6, 2.4, 7.4)
  add(wall, stone, -2.1, 0.5, -3.6)
  add(wall, stone, 2.1, 0.5, -3.6)
  // At the end of the walled way, the door into the rock, warm with the light inside.
  add(new THREE.BoxGeometry(6.2, 5.2, 2.2), stone, 0, 1.6, -8.4)
  add(new THREE.PlaneGeometry(2.4, 3.3), doorway, 0, 1.55, -7.28)
  const trap = new THREE.CylinderGeometry(0.35, 0.65, 8, 6)
  const fin = new THREE.BoxGeometry(0.08, 5, 0.9)
  const cap = new THREE.ConeGeometry(0.75, 1.2, 6)
  for (const [x, z] of [[-9, -6], [9.5, -7], [13, 1.5]]) {
    add(trap, metal, x, 2.2, z)
    for (let k = 0; k < 4; k++) add(fin, metal, x + Math.sin((k * Math.PI) / 2) * 0.45, 3.4, z + Math.cos((k * Math.PI) / 2) * 0.45, (k * Math.PI) / 2)
    add(cap, metal, x, 6.8, z)
  }
  const lamp = new THREE.SphereGeometry(0.22, 10, 8)
  add(lamp, lampMat, -2.5, 5.9, 0.8)
  add(lamp, lampMat, 2.5, 5.9, 0.8)
  add(lamp, lampMat, -1.6, 3.6, -7.1)
  add(lamp, lampMat, 1.6, 3.6, -7.1)
  g.visible = false
  return g
}

function nearestSites(px: number, pz: number, n: number, range: number): Sietch[] {
  return rt.sietches
    .map((s) => ({ s, d: Math.hypot(s.x - px, s.z - pz) }))
    .filter((e) => e.d < range)
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((e) => e.s)
}

const ROLE_OF: Record<string, Role> = { naib: 'naib', guard: 'fremen', water: 'fremenWoman' }

export function Sietches() {
  const sites = useMemo(() => Array.from({ length: SITES }, buildSite), [])
  const assets = useCast()
  const crew = useMemo(() => {
    if (!assets) return null
    const make = (role: Role, i: number, knife: boolean) => {
      const a = castFor(assets, role)
      const lead = role === 'naib' || role === 'elder'
      return a ? makePerson(a, role, { scale: lead ? 1.06 : 0.94 + 0.12 * ((i * 0.618) % 1), knife, eyes: true }) : null
    }
    return {
      naib: make('naib', 0, false),
      elder: make('elder', 6, false),
      guards: [make('fremen', 1, true), make('fremen', 2, true)],
      water: make('fremenWoman', 3, false),
      allies: [make('fedaykin', 4, true), make('fedaykin', 5, true)],
    }
  }, [assets])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    const p = rt.player.pos
    lampMat.color.copy(LAMP).multiplyScalar(0.35 + 1.8 * rt.env.night)
    doorway.color.copy(DOOR).multiplyScalar(1 + 2.5 * rt.env.night)
    const near = rt.cave ? [] : nearestSites(p.x, p.z, SITES, 900)
    sites.forEach((g, i) => {
      const s = near[i]
      g.visible = !!s
      if (!s) return
      g.position.set(s.x, s.y, s.z)
      g.rotation.y = s.yaw
    })
    if (!crew) return

    // The people of the nearest sietch: they turn to watch you come.
    const home = near[0] && Math.hypot(near[0].x - p.x, near[0].z - p.z) < 300 ? near[0] : null
    const used = new Set<Person>()
    let guard = 0
    const leader = home && leaderRole(home.naib, home.key) === 'elder' ? crew.elder : crew.naib
    for (const n of home?.npcs ?? []) {
      const v = n.role === 'naib' ? leader : n.role === 'water' ? crew.water : crew.guards[guard++]
      if (!v || used.has(v) || !home) continue
      used.add(v)
      const slot = `${home.key}:${n.role}:${guard}`
      if (v.slot !== slot) {
        v.slot = slot
        v.yaw = n.yaw
      }
      const d = Math.hypot(p.x - n.x, p.z - n.z)
      v.yaw = dampAngle(v.yaw, d < 24 ? Math.atan2(p.x - n.x, p.z - n.z) : n.yaw, 2.5, dt)
      v.root.visible = true
      v.root.position.set(n.x, n.y, n.z)
      v.root.rotation.y = v.yaw
      playClip(v, 'idle')
      v.mixer.update(dt * (ROLE_OF[n.role] === 'naib' ? 0.8 : 0.9))
      v.root.updateMatrixWorld(true)
      placeEyes(v, v.yaw)
    }
    for (const v of [crew.naib, crew.elder, crew.water, ...crew.guards]) {
      if (!v || used.has(v)) continue
      v.root.visible = false
      hideEyes(v)
    }

    crew.allies.forEach((v, i) => {
      if (!v) return
      const a = rt.allies[i]
      v.root.visible = !!a && !rt.cave
      hideEyes(v)
      if (!a || rt.cave) return
      v.root.position.copy(a.pos)
      v.root.rotation.y = a.yaw
      playClip(v, a.anim)
      const act = v.actions.get(a.anim)
      const nominal = a.anim === 'sprint' ? 7.4 : a.anim === 'jog' ? 4.3 : a.anim === 'walk' ? 1.45 : 0
      if (act) act.timeScale = nominal ? clamp(a.speed / nominal, 0.6, 1.6) : 1
      v.mixer.update(dt)
      v.root.updateMatrixWorld(true)
      placeEyes(v, a.yaw)
    })
  })

  const people = crew ? [crew.naib, crew.elder, crew.water, ...crew.guards, ...crew.allies].filter((v): v is Person => !!v) : []
  return (
    <>
      {sites.map((g, i) => (
        <primitive key={`s${i}`} object={g} />
      ))}
      {people.map((v, i) => (
        <group key={`p${i}`}>
          <primitive object={v.root} />
          {v.eyes.map((e, k) => (
            <primitive key={k} object={e} />
          ))}
        </group>
      ))}
    </>
  )
}
