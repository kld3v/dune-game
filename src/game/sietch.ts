import * as THREE from 'three'
import { rt, type Foe, type Sietch, type SietchNpc } from './rt'
import { consume } from './input'
import { rockMask, terrainHeight } from './terrain'
import { TAU, clamp, damp, dampAngle, pick } from './math'
import { toast, useUI } from './ui'
import { audio } from './audio'
import { damageFoe, power } from './combat'
import { foretell } from './trip'
import { panFor } from './actions'

// Fremen sietches: hidden communities in the rock, at most one per cell of desert. Where
// they stand is decided by the terrain alone, so the trust you earn with one is still
// there on your next visit.

const CELL = 1500
const SEEN_FROM = 160
const TALK_RANGE = 4.5

const NAMES = [
  'Sietch Tabr', 'Habbanya Ridge', 'Red Wall Sietch', 'Sietch Jacurutu', 'False Wall Sietch', 'Sietch Abbir',
  'Cave of Ridges', 'Tuono Sietch', 'Sietch Gara', 'Windsack Sietch', 'Sietch Umbu', 'Old Gap Sietch',
]
const NAIBS = ['Stilgar', 'Heinar', 'Farok', 'Korba', 'Otheym', 'Turok', 'Shishakli', 'Ramallo', 'Harah', 'Tharthar', 'Mapes', 'Jamis']

export const standing = (t: number) => (t >= 80 ? 'Of the tribe' : t >= 50 ? 'Trusted' : t >= 20 ? 'Known' : 'Wary')

const PERKS: Record<string, string> = {
  Wary: '',
  Known: 'Their water and counsel are yours.',
  Trusted: 'They have gifts for you.',
  'Of the tribe': 'Their fighters will walk with you.',
}

const GREET: Record<string, string[]> = {
  Wary: [
    'Outworlder. You stand on our rock. Give us one reason not to take your water.',
    'The desert tests everyone who comes. Show us what you are.',
  ],
  Known: ['You have been seen, friend. The sietch remembers.', 'Sit. The sand is long and you look thirsty.'],
  Trusted: ['Our water is your water.', 'The young ones tell stories about you now.'],
  'Of the tribe': ['Ya hya chouhada. You are of the sietch.', 'Our fighters ask when you will lead them.'],
}

function hash(i: number, j: number, s: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(s + 1, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function solidRock(x: number, z: number) {
  if (rockMask(x, z) < 0.985) return false
  if (rockMask(x + 9, z) < 0.9 || rockMask(x - 9, z) < 0.9 || rockMask(x, z + 9) < 0.9 || rockMask(x, z - 9) < 0.9) return false
  return Math.abs(terrainHeight(x + 3, z) - terrainHeight(x - 3, z)) < 1.4 &&
    Math.abs(terrainHeight(x, z + 3) - terrainHeight(x, z - 3)) < 1.4
}

// A fixed spiral (no random phase), so the same cell always finds the same rock.
function rockNear(cx: number, cz: number, maxR: number) {
  if (solidRock(cx, cz)) return { x: cx, z: cz }
  for (let r = 12; r <= maxR; r += 12) {
    const steps = Math.max(6, Math.floor((TAU * r) / 12))
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * TAU
      const x = cx + Math.cos(a) * r
      const z = cz + Math.sin(a) * r
      if (solidRock(x, z)) return { x, z }
    }
  }
  return null
}

function build(i: number, j: number): Sietch | null {
  const odds = Math.abs(i + 0.5) < 2 && Math.abs(j + 0.5) < 2 ? 1 : 0.7
  if (hash(i, j, 0) > odds) return null
  const cx = (i + 0.5 + (hash(i, j, 1) - 0.5) * 0.5) * CELL
  const cz = (j + 0.5 + (hash(i, j, 2) - 0.5) * 0.5) * CELL
  const spot = rockNear(cx, cz, 600)
  if (!spot || Math.hypot(spot.x, spot.z) < 300) return null
  // Face the gate toward the nearest cliff edge, set back from it, looking out over the sand.
  let bestA = 0
  let bestD = Infinity
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * TAU
    for (let d = 8; d < 200; d += 4) {
      if (rockMask(spot.x + Math.sin(a) * d, spot.z + Math.cos(a) * d) < 0.5) {
        if (d < bestD) {
          bestD = d
          bestA = a
        }
        break
      }
    }
  }
  const back = Number.isFinite(bestD) ? Math.max(0, bestD - 10) : 0
  let x = spot.x + Math.sin(bestA) * back
  let z = spot.z + Math.cos(bestA) * back
  if (rockMask(x, z) < 0.97) {
    x = spot.x
    z = spot.z
  }
  const yaw = bestA
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)
  const rx = -fz
  const rz = fx
  const npcs: SietchNpc[] = []
  const place: [number, number, SietchNpc['role'], number][] = [
    [0, 4.2, 'naib', 0], [-3.4, 2.4, 'guard', 0.25], [3.6, 2.0, 'guard', -0.3], [7.4, -2.6, 'water', 1.9],
  ]
  for (const [r, f, role, turn] of place) {
    const nx = x + rx * r + fx * f
    const nz = z + rz * r + fz * f
    if (rockMask(nx, nz) < 0.85) continue
    npcs.push({ x: nx, y: terrainHeight(nx, nz), z: nz, yaw: yaw + turn, role })
  }
  if (!npcs.some((n) => n.role === 'naib')) npcs.unshift({ x, y: terrainHeight(x, z), z, yaw, role: 'naib' })
  return {
    key: `${i},${j}`,
    // Strided by cell so no two neighbouring sietches share a name or a Naib.
    name: NAMES[(((i * 7 + j * 3) % NAMES.length) + NAMES.length) % NAMES.length],
    naib: NAIBS[(((i * 5 + j * 3) % NAIBS.length) + NAIBS.length) % NAIBS.length],
    x, y: terrainHeight(x, z), z, yaw, npcs,
  }
}

const cells = new Set<string>()

// One cell per call, so walking into new desert never stalls a frame.
function ensureCells(): boolean {
  const p = rt.player.pos
  const ci = Math.floor(p.x / CELL)
  const cj = Math.floor(p.z / CELL)
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const key = `${ci + di},${cj + dj}`
      if (cells.has(key)) continue
      cells.add(key)
      const s = build(ci + di, cj + dj)
      if (s) rt.sietches.push(s)
      return true
    }
  }
  return false
}

export function initSietches() {
  for (let n = 0; n < 9 && ensureCells(); n++) {
    // fill the neighbourhood of the start before the first frame
  }
  lastKills = rt.stats.kills
  lastRides = rt.stats.rides
  lastGrand = rt.stats.grandRides
}

const found = (s: Sietch) => s.key in rt.trust

function nearestFound(x: number, z: number) {
  let best: Sietch | null = null
  let bestD = Infinity
  for (const s of rt.sietches) {
    if (!found(s)) continue
    const d = Math.hypot(s.x - x, s.z - z)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best ? { s: best, d: bestD } : null
}

export function maxTrust() {
  let m = 0
  for (const k in rt.trust) m = Math.max(m, rt.trust[k])
  return m
}

function discover(s: Sietch) {
  rt.trust[s.key] = 0
  rt.stats.sietchesFound++
  rt.progress.dirty = true
  audio.hook()
  toast(`You have found ${s.name}, hidden in the rock. Its Fremen are watching you. Speak with ${s.naib}, their Naib.`, 'spice', 8000)
}

let deedToastT = -99

function gainTrust(s: Sietch, amount: number, why: string) {
  const before = rt.trust[s.key] ?? 0
  const after = clamp(before + amount, 0, 100)
  if (after === before) return
  rt.trust[s.key] = after
  rt.progress.dirty = true
  if (standing(after) !== standing(before)) {
    audio.hook()
    toast(`${s.name} now counts you as ${standing(after)}. ${PERKS[standing(after)]}`, 'spice', 7500)
  } else if (why && rt.time - deedToastT > 12) {
    deedToastT = rt.time
    toast(`${why} +${amount} trust with ${s.name}.`, 'info', 4500)
  }
}

let lastKills = 0
let lastRides = 0
let lastGrand = 0

// The Fremen notice what you do near them: Harkonnen dead, a maker ridden.
function deeds() {
  const p = rt.player.pos
  const near = nearestFound(p.x, p.z)
  const kills = rt.stats.kills - lastKills
  if (kills > 0 && near && near.d < 450) gainTrust(near.s, 4 * kills, `${near.s.name} saw that.`)
  lastKills = rt.stats.kills
  if (rt.stats.rides > lastRides && near && near.d < 700) gainTrust(near.s, 8, 'They watched you take the maker.')
  lastRides = rt.stats.rides
  if (rt.stats.grandRides > lastGrand) {
    for (const s of rt.sietches) if (found(s)) gainTrust(s, 12, '')
    if (rt.sietches.some(found)) toast('Word of your grandfather ride runs through every sietch you know.', 'spice', 6000)
  }
  lastGrand = rt.stats.grandRides
}

// ---------- talking with the Naib ----------

let line = ''

interface Choice {
  label: string
  ok: boolean
  note?: string
  act: () => void
}

function naibOf(s: Sietch) {
  return s.npcs.find((n) => n.role === 'naib') ?? s.npcs[0]
}

function choices(s: Sietch): Choice[] {
  const t = rt.trust[s.key] ?? 0
  const gifts = rt.gifts[s.key] ?? 0
  const gift: Choice = gifts === 0
    ? {
        label: 'Ask for a crysknife of the sietch', ok: t >= 50, note: t >= 50 ? '+15% blade damage' : 'Needs Trusted (50 trust)',
        act: () => {
          rt.upgrades.dmg *= 1.15
          rt.gifts[s.key] = 1
          line = 'Take it. A crysknife made from the tooth of a maker is never sheathed until it has drawn blood.'
        },
      }
    : gifts === 1
      ? rt.upgrades.stillsuit
        ? {
            label: 'Ask to learn the water discipline', ok: t >= 65, note: t >= 65 ? '+20 life' : 'Needs 65 trust',
            act: () => {
              rt.combat.maxHp += 20
              rt.combat.hp = rt.combat.maxHp
              rt.gifts[s.key] = 2
              line = 'Breathe through the nose. Waste nothing. The desert will find you harder to kill.'
            },
          }
        : {
            label: 'Ask for a stillsuit', ok: t >= 65, note: t >= 65 ? 'Storms hurt you half as much' : 'Needs 65 trust',
            act: () => {
              rt.upgrades.stillsuit = true
              rt.gifts[s.key] = 2
              line = 'Wear it as we do. Keep the seals tight and the storm will take less of you.'
            },
          }
      : { label: 'They have given you all they can spare', ok: false, act: () => {} }
  return [
    {
      label: 'Offer 20 spice to the sietch', ok: rt.spice >= 20, note: rt.spice >= 20 ? '+8 trust' : 'You carry too little spice',
      act: () => {
        rt.spice -= 20
        gainTrust(s, 8, '')
        line = pick(['The spice will feed the sietch. We remember gifts.', 'Generous. The children will eat well tonight.', 'You give freely. That is rare, for an outworlder.'])
      },
    },
    {
      label: 'Ask for water', ok: t >= 20, note: t >= 20 ? 'Heals you fully' : 'Needs Known (20 trust)',
      act: () => {
        rt.combat.hp = rt.combat.maxHp
        audio.consume()
        line = 'Drink. Water is life, and you have earned a share of ours.'
      },
    },
    {
      label: 'Ask what they have seen', ok: t >= 20, note: t >= 20 ? 'A true warning' : 'Needs Known (20 trust)',
      act: () => {
        line = foretell() ?? 'The desert is quiet. For now.'
      },
    },
    gift,
    {
      label: 'Ask for fighters to walk with you', ok: t >= 80 && rt.allies.length === 0,
      note: t < 80 ? 'Needs Of the tribe (80 trust)' : rt.allies.length ? 'Fremen already walk with you' : 'Two Fedaykin join you',
      act: () => {
        spawnAllies(s)
        line = 'Two of our Fedaykin will walk with you. Do not waste them.'
      },
    },
    { label: 'Leave', ok: true, act: () => closeTalk() },
  ]
}

function show(s: Sietch) {
  const t = Math.round(rt.trust[s.key] ?? 0)
  useUI.setState({
    dialogue: {
      sietch: s.name,
      naib: s.naib,
      standing: standing(t),
      trust: t,
      line,
      options: choices(s).map((c) => ({ label: c.label, enabled: c.ok, note: c.note })),
    },
  })
}

function openTalk(s: Sietch) {
  rt.talking = s.key
  const n = naibOf(s)
  const p = rt.player.pos
  rt.cam.yaw = Math.atan2(n.x - p.x, n.z - p.z)
  rt.player.yaw = rt.cam.yaw
  rt.player.vel.set(0, 0, 0)
  line = pick(GREET[standing(rt.trust[s.key] ?? 0)])
  audio.blip()
  show(s)
}

export function closeTalk() {
  rt.talking = null
  useUI.setState({ dialogue: null })
}

function choose(s: Sietch, k: number) {
  const list = choices(s)
  const c = list[k]
  if (!c) return
  if (!c.ok) {
    audio.blip()
    line = c.note ? `Not yet. ${c.note}.` : 'Not yet.'
    show(s)
    return
  }
  c.act()
  rt.progress.dirty = true
  if (rt.talking) show(s)
}

// ---------- Fedaykin who walk with you ----------

let allyId = 1
const FIGHTING = new Set(['alert', 'chase', 'attack', 'hit', 'stunned', 'investigate'])

function spawnAllies(s: Sietch) {
  for (let k = 0; k < 2; k++) {
    const n = s.npcs[k + 1] ?? naibOf(s)
    rt.allies.push({
      id: allyId++, pos: new THREE.Vector3(n.x, n.y, n.z), vel: new THREE.Vector3(), yaw: n.yaw,
      slot: k, strikeT: 0, hits: 0, lungeT: 0, speed: 0, anim: 'idle',
    })
  }
}

function updateAllies(dt: number) {
  const p = rt.player
  const fx = Math.sin(p.yaw)
  const fz = Math.cos(p.yaw)
  for (const a of rt.allies) {
    a.strikeT -= dt
    a.lungeT = Math.max(0, a.lungeT - dt)
    let foe: Foe | null = null
    let best = Infinity
    for (const f of rt.foes) {
      if (f.gone || f.state === 'dead' || f.state === 'drop') continue
      const d = Math.hypot(f.pos.x - a.pos.x, f.pos.z - a.pos.z)
      const engaged = FIGHTING.has(f.state) || Math.hypot(f.pos.x - p.pos.x, f.pos.z - p.pos.z) < 18
      if (engaged && d < 40 && d < best) {
        best = d
        foe = f
      }
    }
    let tx: number
    let tz: number
    let run: number
    if (foe) {
      tx = foe.pos.x
      tz = foe.pos.z
      run = best < 2.3 ? 0 : 8.5
      if (best < 2.3 && a.strikeT <= 0) {
        a.strikeT = 0.95
        a.hits++
        a.lungeT = 0.22
        const heavy = a.hits % 3 === 0
        damageFoe(foe, 14 * (1 + 0.5 * power()), heavy, (foe.pos.x - a.pos.x) / (best || 1), (foe.pos.z - a.pos.z) / (best || 1))
        audio.swing(heavy, panFor(a.pos.x, a.pos.z), 0.6)
      }
    } else {
      const side = a.slot === 0 ? -1 : 1
      tx = p.pos.x - fx * 3.4 - Math.cos(p.yaw) * side * 2.4
      tz = p.pos.z - fz * 3.4 + Math.sin(p.yaw) * side * 2.4
      const d = Math.hypot(tx - a.pos.x, tz - a.pos.z)
      run = d > 12 ? 9 : d > 1.5 ? Math.min(5.2, d * 1.5) : 0
      // Left far behind (a worm ride, a flight): they find you again when you land.
      if (rt.mode === 'foot' && Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z) > 160) {
        a.pos.set(tx - fx * 6, terrainHeight(tx - fx * 6, tz - fz * 6), tz - fz * 6)
      }
    }
    const dx = tx - a.pos.x
    const dz = tz - a.pos.z
    const dd = Math.hypot(dx, dz)
    a.vel.x = damp(a.vel.x, dd > 0.3 ? (dx / dd) * run : 0, 6, dt)
    a.vel.z = damp(a.vel.z, dd > 0.3 ? (dz / dd) * run : 0, 6, dt)
    let nx = a.pos.x + a.vel.x * dt
    let nz = a.pos.z + a.vel.z * dt
    if (a.lungeT > 0) {
      nx += Math.sin(a.yaw) * 3 * dt
      nz += Math.cos(a.yaw) * 3 * dt
    }
    a.pos.set(nx, terrainHeight(nx, nz), nz)
    a.speed = Math.hypot(a.vel.x, a.vel.z)
    const face = foe ? Math.atan2(foe.pos.x - a.pos.x, foe.pos.z - a.pos.z) : a.speed > 0.5 ? Math.atan2(a.vel.x, a.vel.z) : a.yaw
    a.yaw = dampAngle(a.yaw, face, 10, dt)
    a.anim = a.speed > 6 ? 'sprint' : a.speed > 2.4 ? 'jog' : a.speed > 0.5 ? 'walk' : 'idle'
  }
}

export function updateSietches(dt: number) {
  ensureCells()
  if (rt.phase !== 'playing') return
  const p = rt.player.pos
  for (const s of rt.sietches) {
    if (!found(s) && Math.hypot(s.x - p.x, s.z - p.z) < SEEN_FROM) discover(s)
  }
  deeds()
  updateAllies(dt)
  if (rt.mode !== 'foot') {
    if (rt.talking) closeTalk()
    return
  }
  let near: Sietch | null = null
  for (const s of rt.sietches) {
    const n = naibOf(s)
    if (n && Math.hypot(n.x - p.x, n.z - p.z) < TALK_RANGE && found(s)) near = s
  }
  if (rt.talking) {
    rt.prompt = ''
    if (!near || near.key !== rt.talking || rt.combat.hurtT < 0.1) {
      closeTalk()
      return
    }
    for (let k = 1; k <= 6; k++) if (consume(`Digit${k}`)) choose(near, k - 1)
    if (rt.talking && consume('KeyE')) closeTalk()
    return
  }
  if (near) {
    rt.prompt = `E  Speak with ${near.naib}, Naib of ${near.name}`
    if (consume('KeyE')) openTalk(near)
  }
}
