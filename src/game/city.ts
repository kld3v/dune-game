import * as THREE from 'three'
import { rt } from './rt'
import { consume } from './input'
import { CITY_H, CITY_R, CITY_X, CITY_Z } from './terrain'
import { TAU, clamp, damp, dampAngle, pick } from './math'
import { toast, useUI } from './ui'
import { audio } from './audio'

// Arrakeen: the city of the spice. A walled plateau of brutalist blocks around the
// Residency, with a market where spice becomes solari and solari becomes gear. Its
// layout is fixed, so it is the same city on every visit.

export interface Building {
  x: number
  z: number
  w: number
  d: number
  h: number
  yaw: number
}

export interface Spot {
  x: number
  z: number
  yaw: number
}

export interface CityLayout {
  gateYaw: number
  buildings: Building[]
  wall: { x: number; z: number; yaw: number; len: number; tower: boolean }[]
  lamps: { x: number; z: number }[]
  stalls: Spot[]
  pad: Spot
  trader: Spot
  guards: Spot[]
  nodes: { x: number; z: number; links: number[] }[]
}

export const inCity = (x: number, z: number, margin = 60) => Math.hypot(x - CITY_X, z - CITY_Z) < CITY_R + margin

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Polar placement around the centre, in this codebase's yaw convention.
const at = (r: number, a: number) => ({ x: CITY_X + Math.sin(a) * r, z: CITY_Z + Math.cos(a) * r })

function buildLayout(): CityLayout {
  const rand = rng(1984)
  const gateYaw = Math.atan2(-CITY_X, -CITY_Z)
  const wallR = CITY_R - 8
  const ringR = 211
  const padSpot = { ...at(300, gateYaw + 0.16), yaw: gateYaw }
  const marketA = gateYaw - 0.17
  const stalls: Spot[] = [0, 1, 2, 3].map((k) => ({ ...at(104 + k * 12, marketA), yaw: gateYaw + Math.PI / 2 }))
  // Ammar stands at his stall facing out across the avenue.
  const trader = { ...at(116, gateYaw - 0.11), yaw: gateYaw - 0.11 + Math.PI / 2 }
  const buildings: Building[] = []
  for (let r = 92; r < 350; r += 28 + rand() * 6) {
    let a = rand() * TAU
    const end = a + TAU
    while (a < end) {
      const w = 12 + rand() * 16
      const d = 12 + rand() * 14
      const step = (w + 6 + rand() * 6) / r
      const ca = a + step / 2
      a += step
      const lateral = r * Math.sin(ca - gateYaw)
      const along = r * Math.cos(ca - gateYaw)
      if (along > 0 && Math.abs(lateral) < 24 + w / 2) continue
      if (Math.abs(r - ringR) < 16 + d / 2) continue
      if (r + d / 2 > wallR - 14) continue
      const p = at(r, ca)
      if (Math.hypot(p.x - padSpot.x, p.z - padSpot.z) < 36) continue
      if (stalls.some((s) => Math.hypot(p.x - s.x, p.z - s.z) < 26)) continue
      const tall = Math.pow(clamp(1 - (r - 90) / 260, 0, 1), 1.4)
      let h = 10 + 46 * tall * (0.55 + rand() * 0.7)
      if (rand() < 0.06) h *= 1.8
      buildings.push({ x: p.x, z: p.z, w, d, h, yaw: ca })
    }
  }
  const wall: CityLayout['wall'] = []
  const SEGS = 72
  for (let k = 0; k < SEGS; k++) {
    const a = (k / SEGS) * TAU
    const off = Math.abs(Math.atan2(Math.sin(a - gateYaw), Math.cos(a - gateYaw)))
    const step = TAU / SEGS
    if (off < step * 0.9) continue
    const p = at(wallR, a)
    wall.push({ x: p.x, z: p.z, yaw: a, len: wallR * step + 1, tower: k % 6 === 0 || off < step * 2 })
  }
  const lamps: { x: number; z: number }[] = []
  for (let r = 90; r < wallR - 10; r += 30) {
    for (const side of [-1, 1]) {
      const p = at(r, gateYaw)
      lamps.push({ x: p.x - Math.cos(gateYaw) * side * 15, z: p.z + Math.sin(gateYaw) * side * 15 })
    }
  }
  // Townsfolk walk a graph of the roads: the avenue, the ring, the market, the pad.
  const nodes: CityLayout['nodes'] = []
  const avenue = [345, 290, 211, 150, 95].map((r) => nodes.push({ ...at(r, gateYaw), links: [] }) - 1)
  for (let i = 0; i < avenue.length - 1; i++) {
    nodes[avenue[i]].links.push(avenue[i + 1])
    nodes[avenue[i + 1]].links.push(avenue[i])
  }
  const RING = 12
  const ring: number[] = []
  for (let k = 0; k < RING; k++) ring.push(nodes.push({ ...at(ringR, gateYaw + (k / RING) * TAU), links: [] }) - 1)
  for (let k = 0; k < RING; k++) {
    const a = ring[k]
    const b = ring[(k + 1) % RING]
    nodes[a].links.push(b)
    nodes[b].links.push(a)
  }
  const join = (a: number, b: number) => {
    nodes[a].links.push(b)
    nodes[b].links.push(a)
  }
  join(avenue[2], ring[0])
  const market = nodes.push({ ...at(124, gateYaw - 0.06), links: [] }) - 1
  join(market, avenue[3])
  const pad = nodes.push({ ...at(300, gateYaw + 0.08), links: [] }) - 1
  join(pad, avenue[1])
  const guards = [-1, 1].map((side) => {
    const p = at(wallR - 6, gateYaw)
    return { x: p.x - Math.cos(gateYaw) * side * 12, z: p.z + Math.sin(gateYaw) * side * 12, yaw: gateYaw }
  })
  return { gateYaw, buildings, wall, lamps, stalls, pad: padSpot, trader, guards, nodes }
}

let layout: CityLayout | null = null
export function cityLayout(): CityLayout {
  if (!layout) layout = buildLayout()
  return layout
}

// ---------- townsfolk ----------

export interface Walker {
  pos: THREE.Vector3
  yaw: number
  node: number
  next: number
  wait: number
  speed: number
}

export const walkers: Walker[] = []

function initWalkers() {
  const L = cityLayout()
  for (let i = 0; i < 6; i++) {
    const node = (i * 5) % L.nodes.length
    const n = L.nodes[node]
    walkers.push({ pos: new THREE.Vector3(n.x, CITY_H, n.z), yaw: 0, node, next: node, wait: i * 1.3, speed: 0 })
  }
}

function updateWalkers(dt: number) {
  const L = cityLayout()
  for (const w of walkers) {
    if (w.wait > 0) {
      w.wait -= dt
      w.speed = damp(w.speed, 0, 6, dt)
      if (w.wait <= 0) w.next = pick(L.nodes[w.node].links)
      continue
    }
    const t = L.nodes[w.next]
    const dx = t.x - w.pos.x
    const dz = t.z - w.pos.z
    const d = Math.hypot(dx, dz)
    if (d < 0.8) {
      w.node = w.next
      w.wait = 1.5 + Math.random() * 5
      continue
    }
    w.speed = damp(w.speed, 1.4, 4, dt)
    w.pos.x += (dx / d) * w.speed * dt
    w.pos.z += (dz / d) * w.speed * dt
    w.yaw = dampAngle(w.yaw, Math.atan2(dx, dz), 6, dt)
  }
}

// ---------- Ammar, spice merchant ----------

const TRADER = 'Ammar'
let line = ''

interface Choice {
  label: string
  ok: boolean
  note?: string
  act: () => void
}

function buy(cost: number, then: () => void, text: string) {
  rt.solari -= cost
  then()
  audio.hook()
  line = text
}

function choices(): Choice[] {
  const u = rt.upgrades
  const lots = Math.floor(rt.spice / 10)
  return [
    {
      label: 'Sell 10 spice', ok: rt.spice >= 10, note: rt.spice >= 10 ? '+30 solari' : 'You carry too little spice',
      act: () => {
        rt.spice -= 10
        rt.solari += 30
        rt.stats.spiceSold += 10
        line = pick(['Good spice. Sharp. The Guild will pay well for this.', 'Thirty solari. Do not spend it all on water.', 'Fresh from the deep desert, I can smell it.'])
      },
    },
    {
      label: 'Sell all your spice', ok: lots >= 2, note: lots >= 2 ? `+${lots * 30} solari` : 'Bring more than 20',
      act: () => {
        rt.spice -= lots * 10
        rt.solari += lots * 30
        rt.stats.spiceSold += lots * 10
        line = 'All of it? You are either very brave or very foolish. Either way, here is your money.'
      },
    },
    {
      label: 'Holtzman shield belt', ok: !u.shield && rt.solari >= 150,
      note: u.shield ? 'Owned (X to switch)' : '150 · blades bite 40% less; worms hear it on open sand',
      act: () => buy(150, () => {
        u.shield = true
        rt.shieldOn = true
      }, 'A good belt. Remember: on the open sand its hum calls the makers. Switch it off with X.'),
    },
    {
      label: 'Ornithopter engine refit', ok: u.thopter <= 1 && rt.solari >= 200, note: u.thopter > 1 ? 'Owned' : '200 · thopter flies 25% faster',
      act: () => buy(200, () => {
        u.thopter = 1.25
      }, 'My cousin rebuilt it himself. It will outrun a carrier, if you do not mind the noise.'),
    },
    {
      label: 'Paracompass', ok: !u.paracompass && rt.solari >= 120, note: u.paracompass ? 'Owned' : '120 · points to sietches you have not found',
      act: () => buy(120, () => {
        u.paracompass = true
      }, 'It finds what the Fremen hide. Do not tell them where you got it.'),
    },
    {
      label: 'Water rings', ok: u.rings < 3 && rt.solari >= 80, note: u.rings >= 3 ? 'You wear all three' : '80 · +15 life',
      act: () => buy(80, () => {
        u.rings++
        rt.combat.maxHp += 15
        rt.combat.hp = rt.combat.maxHp
      }, 'Water rings. A promise of water owed to you. Wear them with pride.'),
    },
    { label: 'Leave', ok: true, act: () => closeTrade() },
  ]
}

function show() {
  useUI.setState({
    dialogue: {
      title: `${TRADER}, spice merchant`,
      subtitle: `Arrakeen market  ·  ${rt.solari} solari`,
      line,
      options: choices().map((c) => ({ label: c.label, enabled: c.ok, note: c.note })),
    },
  })
}

function openTrade() {
  rt.talking = 'trader'
  const t = cityLayout().trader
  const p = rt.player.pos
  rt.cam.yaw = Math.atan2(t.x - p.x, t.z - p.z)
  rt.player.yaw = rt.cam.yaw
  rt.player.vel.set(0, 0, 0)
  line = pick(['Spice for solari, solari for anything. Arrakeen asks no questions.', 'Ah, a desert walker. You have something for me?', 'Come, come. The Guild buys, and Ammar pays fair.'])
  audio.blip()
  show()
}

export function closeTrade() {
  if (rt.talking === 'trader') rt.talking = null
  useUI.setState({ dialogue: null })
}

let welcomed = false

export function updateCity(dt: number) {
  const p = rt.player.pos
  const d = Math.hypot(p.x - CITY_X, p.z - CITY_Z)
  if (d < 900) {
    if (!walkers.length) initWalkers()
    updateWalkers(dt)
  }
  if (rt.phase !== 'playing') return
  if (!welcomed && d < 900) {
    welcomed = true
    toast('Arrakeen. The city of the spice. Sell your spice to Ammar in the market for solari.', 'spice', 7500)
  }
  if (rt.upgrades.shield && consume('KeyX')) {
    rt.shieldOn = !rt.shieldOn
    toast(rt.shieldOn ? 'Shield on. The makers will hear it on open sand.' : 'Shield off.', 'info', 2500)
    audio.blip()
  }
  if (rt.mode !== 'foot') {
    if (rt.talking === 'trader') closeTrade()
    return
  }
  const t = cityLayout().trader
  const near = Math.hypot(t.x - p.x, t.z - p.z) < 4
  if (rt.talking === 'trader') {
    rt.prompt = ''
    if (!near || rt.combat.hurtT < 0.1) {
      closeTrade()
      return
    }
    for (let k = 1; k <= 7; k++) {
      if (!consume(`Digit${k}`)) continue
      const c = choices()[k - 1]
      if (!c) continue
      if (!c.ok) {
        audio.blip()
        line = c.note ? `Not today. ${c.note}.` : 'Not today.'
      } else {
        c.act()
        rt.progress.dirty = true
      }
      if (rt.talking === 'trader') show()
    }
    if (rt.talking === 'trader' && consume('KeyE')) closeTrade()
    return
  }
  if (near && !rt.talking) {
    rt.prompt = `E  Trade with ${TRADER}, spice merchant`
    if (consume('KeyE')) openTrade()
  }
}
