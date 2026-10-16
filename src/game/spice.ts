import * as THREE from 'three'
import { rt, type SpiceField } from './rt'
import { findSandSpot, terrainHeight } from './terrain'
import { TAU, bearingOf, clamp, rand } from './math'
import { spiceEruption, spiceMote, wake } from './fx'
import { audio } from './audio'
import { toast } from './ui'
import { panFor, volFor } from './actions'

const MAX_FIELDS = 8

export function fieldRadius(f: SpiceField) {
  return f.radius * (0.4 + 0.6 * Math.sqrt(f.amount / f.capacity))
}

export function addField(x: number, z: number, radius: number, capacity: number) {
  rt.fields.push({ id: rt.nextId++, x, z, radius, amount: capacity, capacity, emitAcc: 0 })
  if (rt.fields.length > MAX_FIELDS) {
    const p = rt.player.pos
    let worst = 0
    let wd = -1
    rt.fields.forEach((f, i) => {
      const d = Math.hypot(f.x - p.x, f.z - p.z)
      if (d > wd) {
        wd = d
        worst = i
      }
    })
    rt.fields.splice(worst, 1)
  }
}

export function initFields(cx: number, cz: number) {
  for (let i = 0; i < 4; i++) {
    const s = findSandSpot(cx, cz, 45 + i * 25, 90 + i * 35, 14)
    if (s) addField(s.x, s.z, rand(11, 16), rand(45, 70))
  }
  rt.fields.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))
}

function harvester(): THREE.Vector3 | null {
  if (rt.phase !== 'playing') return null
  if (rt.mode !== 'thopter') return rt.player.pos
  const t = rt.thopter
  return t.pos.y - terrainHeight(t.pos.x, t.pos.z) < 14 ? t.pos : null
}

const blowPos = new THREE.Vector3()

function startBlow() {
  const p = rt.player.pos
  rt.nextBlow = rt.time + rand(50, 85)
  const s = findSandSpot(p.x, p.z, 85, 190, 18, rt.cam.yaw, 1.3)
  if (s) rt.blows.push({ id: rt.nextId++, x: s.x, z: s.z, t: 0, erupted: false })
}

export function updateSpice(dt: number) {
  const h = harvester()
  let harvesting = false
  const cam = rt.cam.pos
  for (const f of rt.fields) {
    const eff = fieldRadius(f)
    if (h && f.amount > 0 && Math.hypot(h.x - f.x, h.z - f.z) < eff) {
      const rate = rt.mode === 'thopter' ? 12 : rt.mode === 'worm' ? 16 : 7
      const take = Math.min(f.amount, rate * dt)
      f.amount -= take
      rt.spice += take
      rt.stats.harvested += take
      harvesting = true
    }
    if (Math.hypot(f.x - cam.x, f.z - cam.z) < 420) {
      f.emitAcc += dt * (5 + f.radius * 1.2) * Math.sqrt(f.amount / f.capacity)
      while (f.emitAcc >= 1) {
        f.emitAcc -= 1
        const a = Math.random() * TAU
        const r = Math.sqrt(Math.random()) * eff
        const x = f.x + Math.cos(a) * r
        const z = f.z + Math.sin(a) * r
        spiceMote(x, terrainHeight(x, z) + 0.15, z)
      }
    }
  }
  if (harvesting) {
    rt.melange = Math.min(1.8, rt.melange + 0.012 * dt)
    if (rt.mode === 'foot') rt.wormsign += 0.03 * dt
    rt.pickupT -= dt
    if (rt.pickupT <= 0) {
      audio.pickup()
      rt.pickupT = 0.45
    }
  }
  rt.harvesting = harvesting
  if (rt.fields.some((f) => f.amount < 0.5)) rt.fields = rt.fields.filter((f) => f.amount >= 0.5)

  if (rt.phase === 'playing' && rt.time > rt.nextBlow) startBlow()
  for (const b of rt.blows) {
    b.t += dt
    const g = terrainHeight(b.x, b.z)
    if (b.erupted) continue
    if (Math.random() < dt * 22) wake(b.x + rand(-6, 6), g, b.z + rand(-6, 6), 2, 2)
    if (b.t > 3.5) {
      b.erupted = true
      spiceEruption(b.x, g, b.z)
      addField(b.x, b.z, rand(16, 22), rand(85, 125))
      blowPos.set(b.x, g, b.z)
      audio.blow(volFor(blowPos, 650), panFor(b.x, b.z))
      const d = cam.distanceTo(blowPos)
      rt.cam.shake = Math.max(rt.cam.shake, clamp(1 - d / 300, 0, 1) * 1.1)
      const p = rt.player.pos
      toast(`Spice blow  ·  bearing ${Math.round(bearingOf(b.x - p.x, b.z - p.z))}°`, 'spice', 6500)
      // The spice draws the maker: harvest fast.
      if (Math.random() < 0.65) rt.pendingWorms.push({ at: rt.time + rand(16, 24), kind: 'lure', target: blowPos.clone() })
    }
  }
  if (rt.blows.length && rt.blows[0].t > 14) rt.blows = rt.blows.filter((b) => b.t <= 14)
}
