import * as THREE from 'three'
import { rt, type Cave, type Sietch } from './rt'
import { consume } from './input'
import { setGroundHook, terrainHeight, vnoise } from './terrain'
import { TAU, pick, smoothstep } from './math'
import { prophecy, toast, useUI } from './ui'
import { audio } from './audio'
import { glow } from './particles'
import { addXP } from './progress'
import { closeTalk, openTalk, talkKeys } from './sietch'

// Beneath every sietch, a cavern the Fremen have lived in for generations: a hidden
// cistern, glowglobes adrift in the dark, light falling through cracks far overhead.
// Each one is shaped from its sietch's key, so Sietch Tabr's cave is always its own.

const DEPTH = -900

function hashKey(key: string) {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return h >>> 0
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// The cavern floor: rolling sand and stone, a cistern sunk behind a low lip, and walls
// that rise too steeply to climb wherever the floor meets the dome.
export function caveFloor(c: Cave, x: number, z: number): number {
  const lx = x - c.x
  const lz = z - c.z
  const o = (c.seed % 997) * 0.37
  let h = vnoise(lx * 0.018 + o, lz * 0.018, 41) * 7 + vnoise(lx * 0.06 + o, lz * 0.06, 42) * 1.6
  const dp = Math.hypot(x - c.pool.x, z - c.pool.z)
  h -= smoothstep(c.pool.r + 1, c.pool.r - 3, dp) * 4.5
  h += Math.exp(-((dp - c.pool.r - 1.2) ** 2) / 1.2) * 1.4
  h += smoothstep(c.radius * 0.8, c.radius, Math.hypot(lx, lz)) * 70
  return c.y + h
}

export function buildCave(s: Sietch): Cave {
  const seed = hashKey(s.key)
  const rand = rng(seed)
  const radius = 190 + rand() * 60
  const height = 95 + rand() * 40
  const pa = rand() * TAU
  const pd = radius * (0.12 + rand() * 0.18)
  const c: Cave = {
    key: s.key, name: s.name, naib: s.naib, x: s.x, y: DEPTH, z: s.z, radius, height, seed, waterY: 0,
    pool: { x: s.x + Math.sin(pa) * pd, z: s.z + Math.cos(pa) * pd, r: 26 + rand() * 14 },
    exit: { x: 0, z: 0, yaw: 0 }, naibAt: { x: 0, z: 0, yaw: 0 }, mother: { x: 0, z: 0, yaw: 0 }, shafts: [],
  }
  // The way out is across the cavern from the water; you arrive there facing in.
  const ea = pa + Math.PI + (rand() - 0.5) * 0.8
  c.exit = { x: s.x + Math.sin(ea) * radius * 0.76, z: s.z + Math.cos(ea) * radius * 0.76, yaw: ea + Math.PI }
  const fx = Math.sin(c.exit.yaw)
  const fz = Math.cos(c.exit.yaw)
  c.naibAt = { x: c.exit.x + fx * 16, z: c.exit.z + fz * 16, yaw: c.exit.yaw + Math.PI }
  const dx = c.exit.x - c.pool.x
  const dz = c.exit.z - c.pool.z
  const dd = Math.hypot(dx, dz) || 1
  c.mother = { x: c.pool.x + (dx / dd) * (c.pool.r + 5), z: c.pool.z + (dz / dd) * (c.pool.r + 5), yaw: Math.atan2(dx, dz) }
  for (let k = 0; k < 5; k++) {
    const a = rand() * TAU
    const r = radius * (0.15 + rand() * 0.5)
    c.shafts.push({ x: s.x + Math.sin(a) * r, z: s.z + Math.cos(a) * r, r: 2.5 + rand() * 3 })
  }
  let rim = Infinity
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * TAU
    rim = Math.min(rim, caveFloor(c, c.pool.x + Math.sin(a) * (c.pool.r + 3), c.pool.z + Math.cos(a) * (c.pool.r + 3)))
  }
  c.waterY = rim - 0.5
  return c
}

// ---------- the people of the cave ----------

export interface CaveWalker {
  pos: THREE.Vector3
  yaw: number
  a: number
  r: number
  speed: number
  wait: number
  dir: number
}

export const caveWalkers: CaveWalker[] = []

function initFolk(c: Cave) {
  caveWalkers.length = 0
  const rand = rng(c.seed + 7)
  for (let i = 0; i < 4; i++) {
    caveWalkers.push({
      pos: new THREE.Vector3(), yaw: 0, a: rand() * TAU, r: c.pool.r + 9 + rand() * 14,
      speed: 0, wait: rand() * 3, dir: rand() < 0.5 ? 1 : -1,
    })
  }
}

function updateFolk(c: Cave, dt: number) {
  for (const w of caveWalkers) {
    if (w.wait > 0) {
      w.wait -= dt
      w.speed = Math.max(0, w.speed - dt * 3)
    } else {
      w.speed = Math.min(1.3, w.speed + dt * 2)
      if (Math.random() < dt * 0.06) w.wait = 2 + Math.random() * 4
    }
    w.a += (w.speed / w.r) * w.dir * dt
    const x = c.pool.x + Math.sin(w.a) * w.r
    const z = c.pool.z + Math.cos(w.a) * w.r
    w.pos.set(x, caveFloor(c, x, z), z)
    w.yaw = Math.atan2(Math.cos(w.a) * w.dir, -Math.sin(w.a) * w.dir)
  }
}

// ---------- going in and out ----------

let after: (() => void) | null = null
let fadeDir = 0

function fadeThen(fn: () => void) {
  after = fn
  fadeDir = 1
}

export function updateFade(dt: number) {
  if (fadeDir > 0) {
    rt.fade = Math.min(1, rt.fade + dt * 2.4)
    if (rt.fade >= 1) {
      const fn = after
      after = null
      fadeDir = -1
      fn?.()
    }
  } else if (fadeDir < 0) {
    rt.fade = Math.max(0, rt.fade - dt * 1.3)
    if (rt.fade <= 0) fadeDir = 0
  }
}

export function enterCave(s: Sietch) {
  if (fadeDir !== 0) return
  closeTalk()
  audio.board()
  fadeThen(() => {
    const c = buildCave(s)
    rt.cave = c
    setGroundHook((x, z) => caveFloor(c, x, z))
    initFolk(c)
    const x = c.exit.x + Math.sin(c.exit.yaw) * 6
    const z = c.exit.z + Math.cos(c.exit.yaw) * 6
    const p = rt.player
    p.pos.set(x, caveFloor(c, x, z), z)
    p.vel.set(0, 0, 0)
    p.grounded = true
    p.yaw = c.exit.yaw
    rt.cam.yaw = c.exit.yaw
    rt.cam.pitch = -0.02
    rt.cam.snap = true
    rt.wormsign = 0
    toast(`${s.name}. Water, voices, glowglobes adrift in the dark: a whole people hidden in the rock.`, 'spice', 7500)
  })
}

export function leaveCave() {
  const c = rt.cave
  if (!c || fadeDir !== 0) return
  closeTalk()
  closeMother()
  audio.board()
  fadeThen(() => {
    const s = rt.sietches.find((k) => k.key === c.key)
    rt.cave = null
    setGroundHook(null)
    caveWalkers.length = 0
    const p = rt.player
    if (s) {
      const x = s.x - Math.sin(s.yaw) * 4
      const z = s.z - Math.cos(s.yaw) * 4
      p.pos.set(x, terrainHeight(x, z), z)
      p.yaw = s.yaw
      rt.cam.yaw = s.yaw
    }
    p.vel.set(0, 0, 0)
    p.grounded = true
    rt.cam.snap = true
  })
}

// ---------- the Sayyadina and the Water of Life ----------

let line = ''

interface Choice {
  label: string
  ok: boolean
  note?: string
  act: () => void
}

function drink() {
  rt.upgrades.waterOfLife = true
  rt.melange = 1.8
  rt.trip = 1
  rt.whiteout = 1
  rt.progress.dirty = true
  addXP(300)
  audio.prescience()
  audio.levelUp()
  line = 'Breathe. ...You live. Then you are one of us, and more than us.'
  prophecy('The sleeper has awakened. Every path lies open to you now.')
  toast('You drank the Water of Life and lived. You see the future even without spice, and the Voice returns faster.', 'spice', 9000)
}

function choices(c: Cave): Choice[] {
  const t = rt.trust[c.key] ?? 0
  const drunk = rt.upgrades.waterOfLife
  return [
    {
      label: 'Ask about the Water of Life', ok: true,
      act: () => {
        line = 'The bile of a drowned maker. It kills nearly all who drink it. Those it spares see every path at once.'
      },
    },
    {
      label: drunk ? 'You have drunk the Water of Life' : 'Drink the Water of Life', ok: !drunk && t >= 50,
      note: drunk ? 'It does not ask twice' : t >= 50 ? 'Permanent: the future, even sober; a faster Voice' : 'Needs Trusted (50 trust)',
      act: drink,
    },
    {
      label: 'Ask for a blessing', ok: true, note: 'Heals you',
      act: () => {
        rt.combat.hp = rt.combat.maxHp
        audio.consume()
        line = pick(['May your water be clean and your knife sharp.', 'Go with the maker. It knows your name now.', 'The desert takes the weak. You are not weak.'])
      },
    },
    { label: 'Leave', ok: true, act: () => closeMother() },
  ]
}

function show(c: Cave) {
  useUI.setState({
    dialogue: {
      title: `Sayyadina of ${c.name}`,
      subtitle: 'Reverend Mother of the sietch',
      line,
      options: choices(c).map((o) => ({ label: o.label, enabled: o.ok, note: o.note })),
    },
  })
}

function openMother(c: Cave) {
  rt.talking = 'mother'
  const p = rt.player.pos
  rt.cam.yaw = Math.atan2(c.mother.x - p.x, c.mother.z - p.z)
  rt.player.yaw = rt.cam.yaw
  rt.player.vel.set(0, 0, 0)
  line = pick(['Come closer, child of the desert. Let me see your eyes.', 'You smell of spice and outworld water. Sit.', 'The water here is the tribe. Every drop of it.'])
  audio.blip()
  show(c)
}

export function closeMother() {
  if (rt.talking !== 'mother') return
  rt.talking = null
  useUI.setState({ dialogue: null })
}

let dripT = 0

export function updateCave(dt: number) {
  const c = rt.cave
  if (!c) return
  updateFolk(c, dt)
  // Dust drifting down the shafts of light.
  for (const s of c.shafts) {
    if (Math.random() < dt * 8) {
      const a = Math.random() * TAU
      const r = Math.random() * s.r
      glow.emit(s.x + Math.cos(a) * r, c.y + 8 + Math.random() * c.height * 0.5, s.z + Math.sin(a) * r, 0, -0.3, 0, 4, 0.12, 0.9, 0.75, 0.45, 0, 0)
    }
  }
  dripT -= dt
  if (dripT <= 0) {
    dripT = 0.6 + Math.random() * 2.2
    audio.drip(Math.random() * 1.6 - 0.8, 0.4 + Math.random() * 0.6)
  }
  if (rt.phase !== 'playing' || rt.mode !== 'foot') return
  const p = rt.player.pos
  const s = rt.sietches.find((k) => k.key === c.key)
  if (rt.talking === 'mother') {
    rt.prompt = ''
    if (Math.hypot(p.x - c.mother.x, p.z - c.mother.z) > 6 || rt.combat.hurtT < 0.1) {
      closeMother()
      return
    }
    for (let k = 1; k <= 4; k++) {
      if (!consume(`Digit${k}`)) continue
      const o = choices(c)[k - 1]
      if (!o) continue
      if (!o.ok) {
        audio.blip()
        line = o.note ? `Not yet. ${o.note}.` : 'Not yet.'
      } else {
        o.act()
        rt.progress.dirty = true
      }
      if (rt.talking === 'mother') show(c)
    }
    if (rt.talking === 'mother' && consume('KeyE')) closeMother()
    return
  }
  if (rt.talking && s) {
    rt.prompt = ''
    if (Math.hypot(p.x - c.naibAt.x, p.z - c.naibAt.z) > 6) {
      closeTalk()
      return
    }
    talkKeys(s)
    return
  }
  if (Math.hypot(p.x - c.exit.x, p.z - c.exit.z) < 5) {
    rt.prompt = 'E  Return to the desert'
    if (consume('KeyE')) leaveCave()
  } else if (s && Math.hypot(p.x - c.naibAt.x, p.z - c.naibAt.z) < 4.5) {
    rt.prompt = `E  Speak with ${c.naib}, Naib of ${c.name}`
    if (consume('KeyE')) openTalk(s, c.naibAt)
  } else if (Math.hypot(p.x - c.mother.x, p.z - c.mother.z) < 4.5) {
    rt.prompt = 'E  Speak with the Sayyadina'
    if (consume('KeyE')) openMother(c)
  }
}
