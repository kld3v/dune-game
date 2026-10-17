import * as THREE from 'three'
import { rt } from './rt'
import { audio } from './audio'
import { releaseLock } from './input'
import { toast } from './ui'
import { clamp, TAU } from './math'
import { findRockSpot, rockMask, terrainHeight } from './terrain'
import { sandBurst } from './fx'

export function panFor(x: number, z: number): number {
  const c = rt.cam.pos
  const dx = x - c.x
  const dz = z - c.z
  const d = Math.hypot(dx, dz) || 1
  const rx = -Math.cos(rt.cam.yaw)
  const rz = Math.sin(rt.cam.yaw)
  return clamp((dx * rx + dz * rz) / d, -1, 1) * 0.85
}

export function volFor(p: THREE.Vector3, maxD: number): number {
  const v = clamp(1 - rt.cam.pos.distanceTo(p) / maxD, 0, 1)
  return v * v
}

// A short camera jolt that fades with distance from the camera.
export function jolt(p: { x: number; z: number }, strength: number, radius: number) {
  const k = clamp(1 - Math.hypot(p.x - rt.cam.pos.x, p.z - rt.cam.pos.z) / radius, 0, 1)
  rt.cam.impulse = Math.min(1.2, rt.cam.impulse + strength * k)
}

export function killPlayer(reason: 'worm' | 'thopter') {
  if (rt.phase !== 'playing') return
  rt.phase = 'dead'
  rt.deathReason = reason
  rt.stats.deaths++
  rt.prompt = ''
  audio.eaten()
  rt.cam.impulse = 1
  if (reason === 'thopter') rt.thopter.alive = false
  releaseLock()
}

export function destroyThopter() {
  const t = rt.thopter
  if (!t.alive) return
  t.alive = false
  t.autopilot = false
  sandBurst(t.pos.x, terrainHeight(t.pos.x, t.pos.z), t.pos.z, 0.8, 160)
  toast('The worm took your ornithopter. Press Q to call another.', 'warn', 6500)
}

export function destroyThumper() {
  const th = rt.thumper
  if (!th.active) return
  th.active = false
  audio.crunch(clamp(1 - rt.cam.pos.distanceTo(th.pos) / 200, 0, 1), panFor(th.pos.x, th.pos.z))
}

export function placeThopterNear(x: number, z: number) {
  const t = rt.thopter
  let px = x + 12
  let pz = z
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU
    const r = 10 + (i % 3) * 3
    const cx = x + Math.cos(a) * r
    const cz = z + Math.sin(a) * r
    const h = terrainHeight(cx, cz)
    let flat = true
    for (const [ox, oz] of [[3, 0], [-3, 0], [0, 4], [0, -4]]) {
      if (Math.abs(terrainHeight(cx + ox, cz + oz) - h) > 1.2) flat = false
    }
    if (flat && rockMask(cx, cz) > 0.9) {
      px = cx
      pz = cz
      break
    }
  }
  t.pos.set(px, terrainHeight(px, pz) + 1.7, pz)
  t.vel.set(0, 0, 0)
  t.yaw = Math.atan2(x - px, z - pz) + Math.PI / 2
  t.alive = true
  t.landed = true
  t.autopilot = false
  t.fold = 1
}

export function respawn() {
  const p = rt.player
  const spot = findRockSpot(p.pos.x, p.pos.z)
  p.pos.set(spot.x, terrainHeight(spot.x, spot.z), spot.z)
  p.vel.set(0, 0, 0)
  p.grounded = true
  p.onRock = true
  rt.mode = 'foot'
  rt.ridden = null
  rt.spice = Math.floor(rt.spice / 2)
  rt.melange = Math.min(rt.melange, 0.15)
  rt.wormsign = 0
  rt.hunted = false
  rt.thumper.active = false
  for (const w of rt.worms) {
    if (w.kind === 'hunter' || w.state === 'surface' || w.state === 'breach') {
      w.state = 'leave'
      w.st = 0
    }
  }
  if (!rt.thopter.alive || rt.thopter.pos.distanceTo(p.pos) > 260) placeThopterNear(spot.x, spot.z)
  rt.deathReason = ''
  rt.phase = 'playing'
  rt.cam.snap = true
}
