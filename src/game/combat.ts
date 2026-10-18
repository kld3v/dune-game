import { rt, type Foe, type FoeState } from './rt'
import { consume } from './input'
import { clamp, dampAngle } from './math'
import { groundHeight } from './terrain'
import { audio } from './audio'
import { toast, voiceFlash } from './ui'
import { jolt, killPlayer, panFor } from './actions'
import { puff, sparks, voiceRing } from './fx'

export const FOE_HP = 70
export const SHIELD_MAX = 36

// Melange in the blood is power: 0 sober, 1 fully under.
export const power = () => clamp(rt.trip * 1.1, 0, 1)

interface Attack {
  dur: number
  hitAt: number
  range: number
  arc: number
  dmg: number
  lunge: number
  pierce: boolean
}

// Two quick slashes, then the slow thrust. Holtzman shields stop fast blades; the slow
// blade slips through, so the third strike of the combo breaks a shield outright.
export const ATTACKS: Attack[] = [
  { dur: 0.6, hitAt: 0.28, range: 2.8, arc: 2.2, dmg: 16, lunge: 1.4, pierce: false },
  { dur: 0.6, hitAt: 0.28, range: 2.8, arc: 2.2, dmg: 16, lunge: 1.4, pierce: false },
  { dur: 0.95, hitAt: 0.52, range: 3.2, arc: 1.4, dmg: 30, lunge: 2.6, pierce: true },
]

const ANIM: Partial<Record<FoeState, string>> = {
  drop: 'idle', search: 'walk', investigate: 'walk', alert: 'yell', chase: 'run',
  attack: 'slash', hit: 'hit', stunned: 'kneel', dead: 'death',
}

export function setFoe(f: Foe, s: FoeState) {
  f.state = s
  f.st = 0
  f.anim = ANIM[s] ?? 'idle'
  f.animKey++
}

export function alertSquad(source: Foe, at: { x: number; y: number; z: number }) {
  for (const f of rt.foes) {
    if (f.state === 'dead' || f.state === 'stunned' || f.gone) continue
    if (Math.hypot(f.pos.x - source.pos.x, f.pos.z - source.pos.z) > 50) continue
    f.lastSeen.set(at.x, at.y, at.z)
    f.seenT = 0
    f.suspicion = Math.max(f.suspicion, 1)
    if (f.state === 'search' || f.state === 'investigate') setFoe(f, 'alert')
  }
}

export function killFoe(f: Foe, how: 'blade' | 'worm') {
  if (f.state === 'dead') return
  setFoe(f, 'dead')
  f.hp = 0
  f.shield = 0
  rt.stats.kills++
  if (how === 'worm') {
    rt.stats.wormKills++
    f.gone = true
    return
  }
  rt.spice += 6
  audio.foeDeath(panFor(f.pos.x, f.pos.z))
  puff(f.pos.x, f.pos.y, f.pos.z, 1.5, 10)
  if (rt.stats.kills === 1) toast('A Harkonnen falls. They carry spice: +6 each.', 'spice', 4500)
}

export function damageFoe(f: Foe, dmg: number, pierce: boolean, nx: number, nz: number) {
  const pan = panFor(f.pos.x, f.pos.z)
  f.shieldT = 0
  if (f.shield > 0) {
    f.flash = 1
    if (pierce) {
      f.shield = 0
      audio.shieldBreak(pan)
      sparks(f.pos.x, f.pos.y + 1.2, f.pos.z, 30)
    } else {
      const absorbed = Math.min(f.shield, dmg * 0.75)
      f.shield -= absorbed
      dmg -= absorbed
      audio.shieldHit(pan)
      sparks(f.pos.x, f.pos.y + 1.2, f.pos.z, 12)
    }
  }
  f.hp -= dmg
  const kb = pierce ? 5 : 2.5
  f.vel.x += nx * kb
  f.vel.z += nz * kb
  if (dmg > 1) audio.hit(pan)
  alertSquad(f, rt.player.pos)
  if (f.hp <= 0) killFoe(f, 'blade')
  else if (f.state !== 'stunned' && dmg > 4) setFoe(f, 'hit')
}

export function hitPlayer(fromX: number, fromZ: number, dmg: number) {
  const c = rt.combat
  if (c.iframes > 0 || rt.mode !== 'foot' || rt.phase !== 'playing') return false
  dmg *= 1 - 0.5 * power()
  if (rt.upgrades.shield && rt.shieldOn) dmg *= 0.6
  c.hp -= dmg
  c.hurtT = 0
  c.hurtAt = rt.time
  c.iframes = 0.5
  c.attacking = false
  const p = rt.player
  const dx = p.pos.x - fromX
  const dz = p.pos.z - fromZ
  const d = Math.hypot(dx, dz) || 1
  p.vel.x += (dx / d) * 5
  p.vel.z += (dz / d) * 5
  p.vel.y = 3
  p.grounded = false
  jolt(p.pos, 0.5, 10)
  audio.hurt()
  if (c.hp <= 0) killPlayer('harkonnen')
  return true
}

function lockTarget(): Foe | null {
  const p = rt.player
  const camYaw = rt.cam.yaw
  let best: Foe | null = null
  let bestScore = Infinity
  for (const f of rt.foes) {
    if (f.state === 'dead' || f.state === 'drop' || f.gone) continue
    const dx = f.pos.x - p.pos.x
    const dz = f.pos.z - p.pos.z
    const d = Math.hypot(dx, dz)
    if (d > 7) continue
    const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - camYaw), Math.cos(Math.atan2(dx, dz) - camYaw)))
    if (off > 1.8 && d > 2.5) continue
    const score = d + off * 2
    if (score < bestScore) {
      bestScore = score
      best = f
    }
  }
  return best
}

function beginAttack(idx: number) {
  const c = rt.combat
  c.attacking = true
  c.atkIdx = idx
  c.atkT = 0
  c.atkHit = false
  c.atkQueued = false
  c.lockId = lockTarget()?.id ?? 0
}

function strike(a: Attack) {
  const p = rt.player
  const fx = Math.sin(p.yaw)
  const fz = Math.cos(p.yaw)
  const pw = power()
  let hits = 0
  for (const f of rt.foes) {
    if (f.state === 'dead' || f.state === 'drop' || f.gone) continue
    const dx = f.pos.x - p.pos.x
    const dz = f.pos.z - p.pos.z
    const d = Math.hypot(dx, dz)
    if (d > a.range * (1 + 0.25 * pw) || Math.abs(f.pos.y - p.pos.y) > 2.5) continue
    if (d > 1 && Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1)) > a.arc / 2) continue
    damageFoe(f, a.dmg * rt.upgrades.dmg * (1 + 1.6 * pw), a.pierce || f.state === 'stunned', dx / (d || 1), dz / (d || 1))
    hits++
  }
  if (hits) {
    rt.hitstop = a.pierce ? 0.09 : 0.055
    jolt(p.pos, a.pierce ? 0.35 : 0.2, 30)
  }
  audio.swing(a.pierce)
}

function theVoice() {
  const c = rt.combat
  if (!rt.upgrades.voice) {
    toast('You have not learned the Voice yet. Taste the future first.', 'info', 3000)
    return
  }
  if (c.voiceCD > 0) {
    toast(`The Voice returns in ${Math.ceil(c.voiceCD)}s`, 'info', 1500)
    return
  }
  if (rt.melange < 0.25) {
    toast('The Voice needs the spice in your blood. Press F first.', 'warn', 3000)
    audio.blip()
    return
  }
  rt.melange -= 0.2
  c.voiceCD = rt.upgrades.waterOfLife ? 6 : 9
  c.voiceAt = rt.time
  c.attacking = false
  const p = rt.player.pos
  const pw = power()
  audio.voice()
  voiceFlash()
  voiceRing(p.x, p.y + 1, p.z)
  jolt(p, 0.6, 10)
  for (const f of rt.foes) {
    if (f.state === 'dead' || f.gone) continue
    const dx = f.pos.x - p.x
    const dz = f.pos.z - p.z
    const d = Math.hypot(dx, dz)
    if (d > 22) continue
    f.shield = 0
    f.flash = 1
    f.stunFor = 4 + 3 * pw
    setFoe(f, 'stunned')
    if (d < 8) {
      f.vel.x += (dx / (d || 1)) * 6
      f.vel.z += (dz / (d || 1)) * 6
    }
  }
}

export function updateCombat(dt: number) {
  const c = rt.combat
  c.iframes = Math.max(0, c.iframes - dt)
  c.hurtT += dt
  c.voiceCD = Math.max(0, c.voiceCD - dt)
  if (c.hurtT > 6 && c.hp < c.maxHp) c.hp = Math.min(c.maxHp, c.hp + 7 * dt)
  if (rt.talking) {
    c.attacking = false
    consume('Mouse0')
    return
  }
  if (rt.mode !== 'foot' || rt.phase !== 'playing') {
    c.attacking = false
    consume('Mouse0')
    return
  }
  if (consume('KeyV')) theVoice()
  if (consume('Mouse0')) {
    if (!c.attacking) beginAttack(0)
    else c.atkQueued = true
  }
  if (!c.attacking) return

  const a = ATTACKS[c.atkIdx]
  const spd = 1 + 0.6 * power()
  c.atkT += dt * spd
  const p = rt.player
  const target = c.lockId ? rt.foes.find((f) => f.id === c.lockId && f.state !== 'dead') : undefined
  if (target) p.yaw = dampAngle(p.yaw, Math.atan2(target.pos.x - p.pos.x, target.pos.z - p.pos.z), 18, dt)
  if (c.atkT < a.hitAt) {
    // Lunge into the strike, stopping short of the target.
    const room = target ? Math.hypot(target.pos.x - p.pos.x, target.pos.z - p.pos.z) - 1.3 : 99
    const step = Math.min(room, ((a.lunge * (1 + 0.6 * power())) / a.hitAt) * dt * spd)
    if (step > 0) {
      const nx = p.pos.x + Math.sin(p.yaw) * step
      const nz = p.pos.z + Math.cos(p.yaw) * step
      if (groundHeight(nx, nz) - groundHeight(p.pos.x, p.pos.z) < step * 1.6) {
        p.pos.x = nx
        p.pos.z = nz
      }
    }
  }
  if (!c.atkHit && c.atkT >= a.hitAt) {
    c.atkHit = true
    strike(a)
  }
  if (c.atkT >= a.dur) {
    if (c.atkQueued && c.atkIdx < ATTACKS.length - 1) beginAttack(c.atkIdx + 1)
    else c.attacking = false
  }
}
