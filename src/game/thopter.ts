import { rt } from './rt'
import { isDown, pressed } from './input'
import { rockMask, terrainHeight } from './terrain'
import { TAU, clamp, damp, dampAngle, wrapAngle } from './math'
import { audio } from './audio'
import { toast } from './ui'
import { puff, wake } from './fx'

const SKID = 1.7 // fuselage centre height above the ground when landed

type Thopter = typeof rt.thopter

export function boardThopter() {
  rt.mode = 'thopter'
  rt.thopter.autopilot = false
  rt.prompt = ''
  audio.board()
}

export function exitThopter() {
  const t = rt.thopter
  const p = rt.player
  const g = terrainHeight(t.pos.x, t.pos.z)
  const rx = -Math.cos(t.yaw)
  const rz = Math.sin(t.yaw)
  p.pos.set(t.pos.x - rx * 2.8, Math.max(t.pos.y - 1, g), t.pos.z - rz * 2.8)
  p.vel.copy(t.vel)
  p.grounded = false
  p.airTime = 0
  p.yaw = t.yaw
  rt.mode = 'foot'
  t.boost = false
  audio.board()
}

export function callThopter() {
  const t = rt.thopter
  const p = rt.player.pos
  if (!t.alive) {
    const a = Math.random() * TAU
    const x = p.x + Math.sin(a) * 280
    const z = p.z + Math.cos(a) * 280
    t.pos.set(x, terrainHeight(x, z) + 70, z)
    t.vel.set(0, 0, 0)
    t.alive = true
    toast('A new ornithopter is inbound', 'info')
  } else if (Math.hypot(t.pos.x - p.x, t.pos.z - p.z) < 18) {
    toast('Your ornithopter is right here', 'info', 2500)
    return
  } else {
    toast('Ornithopter inbound', 'info', 3000)
  }
  t.autopilot = true
  t.landed = false
  audio.blip()
}

function pilot(t: Thopter, dt: number) {
  const yaw = rt.cam.yaw
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)
  const rx = -Math.cos(yaw)
  const rz = Math.sin(yaw)
  const thr = (isDown('KeyW') || isDown('ArrowUp') ? 1 : 0) - (isDown('KeyS') || isDown('ArrowDown') ? 1 : 0)
  const str = (isDown('KeyD') || isDown('ArrowRight') ? 1 : 0) - (isDown('KeyA') || isDown('ArrowLeft') ? 1 : 0)
  const lift = (isDown('Space') ? 1 : 0) - (isDown('KeyC') ? 1 : 0)
  t.boost = thr > 0 && (isDown('ShiftLeft') || isDown('ShiftRight'))
  const fwd = thr * (t.boost ? 72 : 38)
  t.vel.x = damp(t.vel.x, fx * fwd + rx * str * 18, 1.6, dt)
  t.vel.z = damp(t.vel.z, fz * fwd + rz * str * 18, 1.6, dt)
  t.vel.y = damp(t.vel.y, lift * 17, 2.4, dt)
  t.pos.addScaledVector(t.vel, dt)

  const g = terrainHeight(t.pos.x, t.pos.z)
  if (t.pos.y < g + SKID) {
    t.pos.y = g + SKID
    if (t.vel.y < 0) t.vel.y = 0
  }
  if (t.pos.y > g + 320) {
    t.pos.y = g + 320
    t.vel.y = Math.min(0, t.vel.y)
  }
  t.landed = t.pos.y <= g + SKID + 0.05 && Math.hypot(t.vel.x, t.vel.z) < 3 && lift <= 0

  t.yaw = dampAngle(t.yaw, yaw, 3.5, dt)
  const turn = wrapAngle(yaw - t.yaw)
  t.bank = damp(t.bank, clamp(-turn * 1.4 + str * 0.28, -0.7, 0.7), 4, dt)
  t.pitch = damp(t.pitch, thr * (t.boost ? 0.26 : 0.16) - t.vel.y * 0.008, 3, dt)
  t.thrust = Math.max(Math.abs(thr), Math.abs(lift), Math.abs(str))

  rt.player.pos.copy(t.pos)
  rt.player.vel.copy(t.vel)
  rt.player.onRock = false
  rt.prompt = ''
  if (pressed('KeyE')) exitThopter()
}

function autopilot(t: Thopter, dt: number) {
  const p = rt.player.pos
  const dx0 = t.pos.x - p.x
  const dz0 = t.pos.z - p.z
  const d0 = Math.hypot(dx0, dz0) || 1
  const tx = p.x + (dx0 / d0) * 9
  const tz = p.z + (dz0 / d0) * 9
  const dx = tx - t.pos.x
  const dz = tz - t.pos.z
  const dist = Math.hypot(dx, dz)
  const g = terrainHeight(t.pos.x, t.pos.z)
  let vx: number
  let vz: number
  let vy: number
  if (dist > 30) {
    const sp = Math.min(58, dist * 0.8)
    vx = (dx / dist) * sp
    vz = (dz / dist) * sp
    vy = (Math.max(g, terrainHeight(tx, tz)) + 30 - t.pos.y) * 1.2
  } else {
    vx = dx * 1.1
    vz = dz * 1.1
    vy = Math.max(-9, (terrainHeight(tx, tz) + SKID - t.pos.y) * 0.9)
  }
  t.vel.x = damp(t.vel.x, vx, 1.5, dt)
  t.vel.z = damp(t.vel.z, vz, 1.5, dt)
  t.vel.y = damp(t.vel.y, vy, 2, dt)
  t.pos.addScaledVector(t.vel, dt)
  const ng = terrainHeight(t.pos.x, t.pos.z)
  if (t.pos.y < ng + SKID) t.pos.y = ng + SKID
  const hs = Math.hypot(t.vel.x, t.vel.z)
  if (hs > 2) {
    const before = t.yaw
    t.yaw = dampAngle(t.yaw, Math.atan2(t.vel.x, t.vel.z), 2.5, dt)
    t.bank = damp(t.bank, clamp(-wrapAngle(t.yaw - before) / Math.max(dt, 1e-3) * 0.6, -0.6, 0.6), 3, dt)
  }
  t.pitch = damp(t.pitch, clamp(hs / 58, 0, 1) * 0.2, 2, dt)
  if (dist < 2.5 && t.pos.y < ng + SKID + 0.6) {
    t.autopilot = false
    t.landed = true
    t.vel.set(0, 0, 0)
    puff(t.pos.x, ng, t.pos.z, 2, 14)
  }
}

function idle(t: Thopter, dt: number) {
  const g = terrainHeight(t.pos.x, t.pos.z)
  t.bank = damp(t.bank, 0, 3, dt)
  t.pitch = damp(t.pitch, 0, 3, dt)
  t.thrust = 0
  t.boost = false
  if (t.landed) {
    t.pos.y = damp(t.pos.y, g + SKID, 6, dt)
    t.vel.set(0, 0, 0)
    return
  }
  t.vel.x = damp(t.vel.x, 0, 0.8, dt)
  t.vel.z = damp(t.vel.z, 0, 0.8, dt)
  t.vel.y = damp(t.vel.y, -6, 1, dt)
  t.pos.addScaledVector(t.vel, dt)
  const ng = terrainHeight(t.pos.x, t.pos.z)
  if (t.pos.y <= ng + SKID) {
    t.pos.y = ng + SKID
    t.landed = true
    t.vel.set(0, 0, 0)
    puff(t.pos.x, ng, t.pos.z, 2, 14)
  }
}

export function updateThopter(dt: number) {
  const t = rt.thopter
  if (!t.alive) return
  const occupied = rt.mode === 'thopter' && rt.phase === 'playing'
  if (occupied) pilot(t, dt)
  else if (t.autopilot) autopilot(t, dt)
  else idle(t, dt)
  const parked = t.landed && !occupied && !t.autopilot
  const speed = t.vel.length()
  const targetRate = parked ? 0 : 13 + speed * 0.14 + (t.boost ? 6 : 0)
  t.wingRate = damp(t.wingRate, targetRate, 2.5, dt)
  t.wingPhase += t.wingRate * TAU * dt
  t.fold = damp(t.fold, parked ? 1 : 0, 2.2, dt)

  // Rotor wash: wings beating close to the sand throw it up in a ring.
  const g = terrainHeight(t.pos.x, t.pos.z)
  const alt = t.pos.y - g
  if (alt < 16 && t.wingRate > 4 && rockMask(t.pos.x, t.pos.z) < 0.3) {
    const n = Math.floor((1 - alt / 16) * t.wingRate * dt * 3 + Math.random())
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU
      wake(t.pos.x + Math.cos(a) * 5, g, t.pos.z + Math.sin(a) * 5, 2, 1)
    }
  }
}
