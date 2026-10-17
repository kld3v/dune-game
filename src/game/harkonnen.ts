import * as THREE from 'three'
import { rt, type Foe, MAX_WORMS } from './rt'
import { FOE_HP, SHIELD_MAX, alertSquad, hitPlayer, power, setFoe } from './combat'
import { rockMask, terrainHeight } from './terrain'
import { TAU, damp, dampAngle, rand, wrapAngle } from './math'
import { audio } from './audio'
import { toast } from './ui'
import { panFor } from './actions'
import { puff } from './fx'
import { spawnWorm } from './worms'

const CHASE_SPEED = 5.6
const tmp = new THREE.Vector3()
let spottedByLight = false

function createFoe(x: number, y: number, z: number, home: THREE.Vector3): Foe {
  return {
    id: rt.nextId++,
    pos: new THREE.Vector3(x, y, z),
    vel: new THREE.Vector3(),
    yaw: Math.random() * TAU,
    state: 'drop',
    st: 0,
    hp: FOE_HP,
    shield: SHIELD_MAX,
    shieldT: 99,
    flash: 0,
    suspicion: 0,
    home: home.clone(),
    waypoint: home.clone(),
    lastSeen: home.clone(),
    seenT: 99,
    attackCD: 0,
    struck: false,
    stunFor: 0,
    pause: 0,
    speed: 0,
    anim: 'idle',
    animKey: 0,
    screenX: 0,
    screenY: 0,
    onScreen: false,
    gone: false,
  }
}

function pickWaypoint(f: Foe) {
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * TAU
    const r = rand(8, 28)
    const x = f.home.x + Math.sin(a) * r
    const z = f.home.z + Math.cos(a) * r
    if (Math.abs(terrainHeight(x, z) - f.pos.y) < 14) {
      f.waypoint.set(x, 0, z)
      return
    }
  }
  f.waypoint.copy(f.home)
}

function lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
  const ay = a.y + 1.6
  const by = b.y + 1.2
  for (let i = 1; i < 8; i++) {
    const t = i / 8
    if (terrainHeight(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) > ay + (by - ay) * t + 0.2) return false
  }
  return true
}

// How fast this soldier's suspicion grows right now (0 = can't see or hear you). Dunes
// block sight, the night shortens it, and sandwalking is nearly silent.
function perceive(f: Foe): number {
  const p = rt.player
  if (rt.mode === 'thopter') {
    const t = rt.thopter.pos
    if (t.y - terrainHeight(t.x, t.z) > 15) return 0
  }
  const dx = p.pos.x - f.pos.x
  const dz = p.pos.z - f.pos.z
  const d = Math.hypot(dx, dz)
  let range = 44 - rt.env.night * 18
  if (p.sandwalk) range *= 0.55
  if (p.running) range *= 1.15
  const hear = p.running ? 14 : p.sandwalk ? 2.5 : 7
  if (d > Math.max(range, hear)) return 0
  const inCone = Math.abs(wrapAngle(Math.atan2(dx, dz) - f.yaw)) < 1.0 && d < range
  if (!inCone && d > hear) return 0
  if (!lineOfSight(f.pos, p.pos)) return d < hear * 0.6 ? 0.5 : 0
  return 1.2 + 40 / Math.max(d, 4)
}

function updateFoe(f: Foe, dt: number) {
  if (f.gone) return
  f.st += dt
  f.attackCD -= dt
  f.flash = Math.max(0, f.flash - dt * 2.5)
  f.shieldT += dt
  if (f.state !== 'dead' && f.state !== 'stunned' && f.shieldT > 4) f.shield = Math.min(SHIELD_MAX, f.shield + 12 * dt)

  const p = rt.player
  const dx = p.pos.x - f.pos.x
  const dz = p.pos.z - f.pos.z
  const dist = Math.hypot(dx, dz)
  const toP = Math.atan2(dx, dz)
  const canFight = rt.phase === 'playing' && rt.mode === 'foot'

  if (f.state === 'search' || f.state === 'investigate' || f.state === 'chase' || f.state === 'alert' || f.state === 'attack') {
    const rate = rt.phase === 'playing' && rt.mode !== 'worm' ? perceive(f) : 0
    if (rate > 0) {
      f.suspicion = Math.min(1.2, f.suspicion + rate * dt * 0.5)
      f.lastSeen.copy(p.pos)
      f.seenT = 0
    } else {
      f.seenT += dt
      if (f.state === 'search') f.suspicion = Math.max(0, f.suspicion - 0.12 * dt)
    }
  }

  let move = 0
  let face = f.yaw
  switch (f.state) {
    case 'drop': {
      f.vel.y = Math.max(-7, f.vel.y - 9 * dt)
      f.pos.y += f.vel.y * dt
      const g = terrainHeight(f.pos.x, f.pos.z)
      if (f.pos.y <= g) {
        f.pos.y = g
        f.vel.set(0, 0, 0)
        puff(f.pos.x, g, f.pos.z, 1.4, 8)
        pickWaypoint(f)
        setFoe(f, 'search')
      }
      return
    }
    case 'search': {
      if (f.suspicion >= 1) {
        setFoe(f, 'alert')
        alertSquad(f, f.lastSeen)
        break
      }
      if (f.suspicion > 0.45) {
        setFoe(f, 'investigate')
        break
      }
      if (f.pause > 0) {
        f.pause -= dt
        f.anim = 'look'
        break
      }
      const wx = f.waypoint.x - f.pos.x
      const wz = f.waypoint.z - f.pos.z
      if (Math.hypot(wx, wz) < 1.5) {
        pickWaypoint(f)
        f.pause = rand(1.5, 4)
        break
      }
      face = Math.atan2(wx, wz)
      move = 1.7
      f.anim = 'walk'
      break
    }
    case 'investigate': {
      if (f.suspicion >= 1) {
        setFoe(f, 'alert')
        alertSquad(f, f.lastSeen)
        break
      }
      const lx = f.lastSeen.x - f.pos.x
      const lz = f.lastSeen.z - f.pos.z
      if (Math.hypot(lx, lz) < 2 || f.st > 15) {
        f.suspicion = Math.min(f.suspicion, 0.3)
        f.home.copy(f.pos)
        f.pause = rand(2, 4)
        setFoe(f, 'search')
        break
      }
      face = Math.atan2(lx, lz)
      move = 2.6
      f.anim = 'walk'
      break
    }
    case 'alert': {
      face = toP
      if (f.st > 0.9) setFoe(f, 'chase')
      break
    }
    case 'chase': {
      if (rt.mode === 'worm' || rt.phase !== 'playing') {
        // Nobody chases a worm rider; regroup and keep searching.
        f.home.copy(f.pos)
        f.suspicion = 0.3
        setFoe(f, 'search')
        break
      }
      if (f.seenT > 8) {
        setFoe(f, 'investigate')
        break
      }
      const tx = f.seenT < 0.5 ? p.pos.x : f.lastSeen.x
      const tz = f.seenT < 0.5 ? p.pos.z : f.lastSeen.z
      face = Math.atan2(tx - f.pos.x, tz - f.pos.z)
      if (canFight && dist < 2.4 && f.attackCD <= 0) {
        setFoe(f, 'attack')
        f.struck = false
        if (power() > 0.45 && rt.presT <= 0) rt.presT = 1.1
        audio.swing(false, panFor(f.pos.x, f.pos.z), 0.4)
        break
      }
      move = dist > 2 ? CHASE_SPEED : 0
      f.anim = dist > 2 ? 'run' : 'idle'
      break
    }
    case 'attack': {
      if (f.st < 0.45) face = toP
      if (!f.struck && f.st >= 0.6) {
        f.struck = true
        const fx = Math.sin(f.yaw)
        const fz = Math.cos(f.yaw)
        const cos = dist > 0.01 ? (dx * fx + dz * fz) / dist : 1
        if (dist < 2.7 && cos > 0.5 && Math.abs(p.pos.y - f.pos.y) < 1.6) hitPlayer(f.pos.x, f.pos.z, 13)
      }
      if (f.st > 1.15) {
        f.attackCD = rand(0.6, 1.4)
        setFoe(f, 'chase')
      }
      break
    }
    case 'hit': {
      if (f.st > 0.5) setFoe(f, 'chase')
      break
    }
    case 'stunned': {
      if (f.st > f.stunFor) setFoe(f, 'chase')
      break
    }
    case 'dead': {
      if (f.st > 2.5) f.pos.y -= dt * 0.7
      if (f.st > 5.5) f.gone = true
      return
    }
  }

  f.yaw = dampAngle(f.yaw, face, 8, dt)
  let vx = Math.sin(f.yaw) * move + f.vel.x
  let vz = Math.cos(f.yaw) * move + f.vel.z
  f.vel.x = damp(f.vel.x, 0, 6, dt)
  f.vel.z = damp(f.vel.z, 0, 6, dt)
  for (const o of rt.foes) {
    if (o === f || o.state === 'dead' || o.gone) continue
    const sx = f.pos.x - o.pos.x
    const sz = f.pos.z - o.pos.z
    const sd = Math.hypot(sx, sz)
    if (sd < 1.4 && sd > 1e-3) {
      vx += (sx / sd) * (1.4 - sd) * 5
      vz += (sz / sd) * (1.4 - sd) * 5
    }
  }
  if (rt.mode === 'foot' && dist < 1.1 && dist > 1e-3) {
    vx -= (dx / dist) * (1.1 - dist) * 6
    vz -= (dz / dist) * (1.1 - dist) * 6
  }
  const nx = f.pos.x + vx * dt
  const nz = f.pos.z + vz * dt
  const step = Math.hypot(nx - f.pos.x, nz - f.pos.z)
  const g0 = terrainHeight(f.pos.x, f.pos.z)
  const g1 = terrainHeight(nx, nz)
  if (step < 1e-5 || (g1 - g0) / step < 1.4) {
    f.pos.x = nx
    f.pos.z = nz
    f.pos.y = g1
  } else {
    f.pos.y = g0
    if (f.state === 'search') pickWaypoint(f)
  }
  f.speed = move
}

// The drop zone is chosen when the raid is scheduled so prescience can foresee it.
export function planRaid(delay: number) {
  const p = rt.player.pos
  const a = rand(0, TAU)
  const d = rand(60, 90)
  rt.nextRaid = rt.time + delay
  const x = p.x + Math.sin(a) * d
  const z = p.z + Math.cos(a) * d
  rt.nextRaidPos.set(x, terrainHeight(x, z), z)
}

function launchCarrier() {
  const p = rt.player.pos
  let tx = rt.nextRaidPos.x
  let tz = rt.nextRaidPos.z
  if (Math.hypot(tx - p.x, tz - p.z) > 200) {
    const a = rand(0, TAU)
    tx = p.x + Math.sin(a) * 75
    tz = p.z + Math.cos(a) * 75
  }
  const a = Math.atan2(tx - p.x, tz - p.z)
  const c = rt.carrier
  c.active = true
  c.state = 'inbound'
  c.st = 0
  c.dropped = 0
  c.target.set(tx, terrainHeight(tx, tz), tz)
  const from = a + rand(-0.6, 0.6)
  c.pos.set(tx + Math.sin(from) * 650, c.target.y + 130, tz + Math.cos(from) * 650)
  c.vel.set(0, 0, 0)
  c.yaw = Math.atan2(tx - c.pos.x, tz - c.pos.z)
  spottedByLight = false
  planRaid(rand(120, 170))
  toast('A Harkonnen carrier is sweeping the dunes. Keep low.', 'warn', 6500)
}

function updateCarrier(dt: number) {
  const c = rt.carrier
  if (!c.active) {
    c.beamOn = damp(c.beamOn, 0, 2, dt)
    return
  }
  c.st += dt
  c.wingPhase += dt * 9 * TAU
  const squad = 3 + Math.min(2, Math.floor(rt.stats.kills / 6))
  switch (c.state) {
    case 'inbound': {
      const dx = c.target.x - c.pos.x
      const dz = c.target.z - c.pos.z
      const d = Math.hypot(dx, dz)
      const sp = Math.min(55, d * 0.6 + 6)
      c.vel.set((dx / (d || 1)) * sp, (c.target.y + 30 - c.pos.y) * 0.8, (dz / (d || 1)) * sp)
      if (d < 4) {
        c.state = 'drop'
        c.st = 0
      }
      break
    }
    case 'drop': {
      c.vel.x *= 0.9
      c.vel.z *= 0.9
      c.vel.y = (c.target.y + 26 - c.pos.y) * 1.5
      if (c.dropped < squad && c.st > 1 + c.dropped * 0.8) {
        const a = (c.dropped / squad) * TAU
        const f = createFoe(c.pos.x + Math.sin(a) * 2, c.pos.y - 3, c.pos.z + Math.cos(a) * 2, c.target)
        rt.foes.push(f)
        c.dropped++
      }
      if (c.dropped >= squad && c.st > squad * 0.8 + 2.5) {
        c.state = 'search'
        c.st = 0
      }
      break
    }
    case 'search': {
      const ang = c.st * 0.22
      const cx = c.target.x + Math.sin(ang) * 60
      const cz = c.target.z + Math.cos(ang) * 60
      const dx = cx - c.pos.x
      const dz = cz - c.pos.z
      const d = Math.hypot(dx, dz) || 1
      c.vel.x = damp(c.vel.x, (dx / d) * 20, 1, dt)
      c.vel.z = damp(c.vel.z, (dz / d) * 20, 1, dt)
      c.vel.y = (terrainHeight(c.pos.x, c.pos.z) + 40 - c.pos.y) * 0.8
      if (c.st > 40) {
        c.state = 'leave'
        c.st = 0
      }
      break
    }
    case 'leave': {
      c.vel.x = damp(c.vel.x, Math.sin(c.yaw) * 55, 0.8, dt)
      c.vel.z = damp(c.vel.z, Math.cos(c.yaw) * 55, 0.8, dt)
      c.vel.y = 10
      if (c.st > 14) c.active = false
      break
    }
  }
  c.pos.addScaledVector(c.vel, dt)
  const g = terrainHeight(c.pos.x, c.pos.z)
  if (c.pos.y < g + 12) c.pos.y = g + 12
  if (Math.hypot(c.vel.x, c.vel.z) > 3) c.yaw = dampAngle(c.yaw, Math.atan2(c.vel.x, c.vel.z), 1.5, dt)

  // The searchlight sweeps ahead and to the sides of the carrier.
  c.beamOn = damp(c.beamOn, c.state === 'search' || c.state === 'drop' ? 1 : 0, 1.5, dt)
  const sweep = c.st * 0.9
  const bx = c.pos.x + Math.sin(c.yaw) * 22 + Math.sin(sweep) * 18
  const bz = c.pos.z + Math.cos(c.yaw) * 22 + Math.cos(sweep * 0.7) * 18
  c.beam.set(bx, terrainHeight(bx, bz), bz)
  if (c.beamOn > 0.5 && rt.mode === 'foot' && rt.phase === 'playing') {
    const p = rt.player.pos
    if (Math.hypot(p.x - c.beam.x, p.z - c.beam.z) < 8) {
      for (const f of rt.foes) {
        if (f.state !== 'search' && f.state !== 'investigate') continue
        f.lastSeen.copy(p)
        f.seenT = 0
        f.suspicion = 1
        setFoe(f, 'alert')
      }
      if (!spottedByLight) {
        spottedByLight = true
        toast('The searchlight found you. They are coming.', 'warn', 4500)
        audio.yell(panFor(c.pos.x, c.pos.z), 0.6)
      }
    }
  }
}

export function updateHarkonnens(dt: number, foeDt: number) {
  if (rt.phase !== 'playing') return
  const alive = rt.foes.reduce((n, f) => n + (f.state !== 'dead' ? 1 : 0), 0)
  if (!rt.carrier.active && rt.time > rt.nextRaid && alive < 3) launchCarrier()
  updateCarrier(dt)
  for (const f of rt.foes) {
    const before = f.state
    updateFoe(f, foeDt)
    if (before !== 'alert' && f.state === 'alert') audio.yell(panFor(f.pos.x, f.pos.z), 1)
  }
  if (rt.foes.some((f) => f.gone)) rt.foes = rt.foes.filter((f) => !f.gone)

  // Harkonnen boots on open sand have rhythm too, and the maker hears it.
  let n = 0
  tmp.set(0, 0, 0)
  for (const f of rt.foes) {
    if (f.state === 'dead' || f.speed < 0.5 || rockMask(f.pos.x, f.pos.z) > 0.3) continue
    tmp.add(f.pos)
    n++
  }
  rt.foeSign += n * 0.005 * dt
  if (rt.foeSign > 1 && n > 0) {
    rt.foeSign = 0
    if (rt.worms.length < MAX_WORMS) {
      tmp.divideScalar(n)
      if (spawnWorm('lure', tmp.clone(), 170)) toast('The Harkonnen march has drawn the maker.', 'spice', 5000)
    }
  }
}

export function debugRaid() {
  planRaid(0)
  launchCarrier()
}
