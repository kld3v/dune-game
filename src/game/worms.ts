import * as THREE from 'three'
import {
  rt, type Worm, type WormKind, type WormState,
  WORM_R as R, WORM_L as L, WORM_RINGS, RING_DS, PATH_SP as SP, MAX_WORMS,
} from './rt'
import { terrainHeight, rockMask } from './terrain'
import { TAU, approachAngle, clamp, damp, rand, wrapAngle } from './math'
import { RADII, ringOf } from './wormShape'
import { audio } from './audio'
import { sandBurst, shockRing, wake } from './fx'
import { destroyThopter, destroyThumper, killPlayer, panFor, volFor } from './actions'
import { isDown } from './input'
import { toast } from './ui'

// A worm is a head that moves, plus the trail it leaves. The body is sampled along that
// trail at fixed arc lengths, so every ring follows exactly where the head has been and
// a breach leaves a standing arch that the rest of the body slides through.

const DEPTH_DEEP = -R * 2.2
const DEPTH_SURF = -R * 0.45

export function createWorm(kind: WormKind, x: number, z: number, yaw: number, depth: number): Worm {
  const cap = Math.ceil(L / SP) + 24
  const path = new Float32Array(cap * 3)
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)
  for (let k = 0; k < cap; k++) {
    const back = (cap - k) * SP
    const px = x - fx * back
    const pz = z - fz * back
    path[k * 3] = px
    path[k * 3 + 1] = terrainHeight(px, pz) + depth
    path[k * 3 + 2] = pz
  }
  const w: Worm = {
    id: rt.nextId++,
    kind,
    state: 'approach',
    st: 0,
    life: 0,
    head: new THREE.Vector3(x, terrainHeight(x, z) + depth, z),
    yaw,
    speed: 12,
    path,
    cap,
    count: cap,
    end: cap - 1,
    spine: new Float32Array(WORM_RINGS * 3),
    target: new THREE.Vector3(),
    breachA: new THREE.Vector3(),
    breachLen: 1,
    breachDur: 1,
    breachH: 24,
    mouth: 0,
    mouthTarget: 0,
    attempts: 0,
    resume: false,
    lostT: 0,
    circleDir: Math.random() < 0.5 ? 1 : -1,
    baseYaw: yaw,
    surfaceAt: rand(6, 12),
    splashUp: false,
    splashDown: false,
    rumble: 0,
    dead: false,
  }
  sampleAll(w)
  return w
}

function pathPush(w: Worm, x: number, y: number, z: number) {
  w.end = (w.end + 1) % w.cap
  const i = w.end * 3
  w.path[i] = x
  w.path[i + 1] = y
  w.path[i + 2] = z
  if (w.count < w.cap) w.count++
}

function moveHead(w: Worm, x: number, y: number, z: number) {
  w.head.set(x, y, z)
  const i = w.end * 3
  let lx = w.path[i]
  let ly = w.path[i + 1]
  let lz = w.path[i + 2]
  let dx = x - lx
  let dy = y - ly
  let dz = z - lz
  let d = Math.sqrt(dx * dx + dy * dy + dz * dz)
  let guard = 0
  while (d >= SP && guard++ < 400) {
    const k = SP / d
    lx += dx * k
    ly += dy * k
    lz += dz * k
    pathPush(w, lx, ly, lz)
    dx = x - lx
    dy = y - ly
    dz = z - lz
    d = Math.sqrt(dx * dx + dy * dy + dz * dz)
  }
}

function sampleSpine(w: Worm, s: number, out: Float32Array, o: number) {
  const i0 = w.end * 3
  const lx = w.path[i0]
  const ly = w.path[i0 + 1]
  const lz = w.path[i0 + 2]
  const hx = w.head.x
  const hy = w.head.y
  const hz = w.head.z
  const dx = lx - hx
  const dy = ly - hy
  const dz = lz - hz
  const d0 = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (s <= d0) {
    const f = d0 > 1e-6 ? s / d0 : 0
    out[o] = hx + dx * f
    out[o + 1] = hy + dy * f
    out[o + 2] = hz + dz * f
    return
  }
  const k = (s - d0) / SP
  let j = Math.floor(k)
  let f = k - j
  if (j >= w.count - 1) {
    j = w.count - 2
    f = 1
  }
  const a = (((w.end - j) % w.cap) + w.cap) % w.cap * 3
  const b = (((w.end - j - 1) % w.cap) + w.cap) % w.cap * 3
  out[o] = w.path[a] + (w.path[b] - w.path[a]) * f
  out[o + 1] = w.path[a + 1] + (w.path[b + 1] - w.path[a + 1]) * f
  out[o + 2] = w.path[a + 2] + (w.path[b + 2] - w.path[a + 2]) * f
}

function sampleAll(w: Worm) {
  for (let i = 0; i < WORM_RINGS; i++) sampleSpine(w, i * RING_DS, w.spine, i * 3)
}

function setState(w: Worm, s: WormState) {
  w.state = s
  w.st = 0
}

function safeHeading(w: Worm, desired: number): number {
  const offsets = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.9, -1.9, 2.5, -2.5]
  for (const off of offsets) {
    const a = desired + off * w.circleDir
    let ok = true
    for (const dist of [12, 24, 36]) {
      if (rockMask(w.head.x + Math.sin(a) * dist, w.head.z + Math.cos(a) * dist) > 0.05) {
        ok = false
        break
      }
    }
    if (ok) return a
  }
  return w.yaw + Math.PI
}

function steer(w: Worm, desired: number, rate: number, dt: number) {
  w.yaw = approachAngle(w.yaw, safeHeading(w, desired), rate * dt)
}

function advance(w: Worm, speed: number, depth: number, kY: number, dt: number) {
  let nx = w.head.x + Math.sin(w.yaw) * speed * dt
  let nz = w.head.z + Math.cos(w.yaw) * speed * dt
  if (rockMask(nx, nz) > 0.15) {
    nx = w.head.x
    nz = w.head.z
    w.yaw += 1.4 * dt * w.circleDir
  }
  const g = terrainHeight(nx, nz)
  moveHead(w, nx, damp(w.head.y, g + depth, kY, dt), nz)
}

export function playerSafe(): boolean {
  if (rt.mode === 'worm') return true
  if (rt.mode === 'thopter') {
    const t = rt.thopter
    return t.pos.y - terrainHeight(t.pos.x, t.pos.z) > 8
  }
  return rt.player.onRock
}

const mouthPt = new THREE.Vector3()

function eatCheck(w: Worm) {
  if (rt.phase !== 'playing') return
  const s = w.spine
  let tx = s[0] - s[12]
  let ty = s[1] - s[13]
  let tz = s[2] - s[14]
  const tl = Math.hypot(tx, ty, tz) || 1
  tx /= tl
  ty /= tl
  tz /= tl
  mouthPt.set(w.head.x + tx * R * 0.6, w.head.y + ty * R * 0.6, w.head.z + tz * R * 0.6)
  const reach = R * (1.0 + 0.45 * w.mouth)
  if (rt.mode === 'foot' && !rt.player.onRock) {
    const p = rt.player.pos
    if (Math.hypot(p.x - mouthPt.x, p.y + 0.9 - mouthPt.y, p.z - mouthPt.z) < reach) {
      killPlayer('worm')
      return
    }
  }
  const t = rt.thopter
  if (t.alive && t.pos.distanceTo(mouthPt) < reach + 1.5) {
    if (rt.mode === 'thopter') killPlayer('thopter')
    else destroyThopter()
  }
  const th = rt.thumper
  if (th.active && Math.hypot(th.pos.x - mouthPt.x, th.pos.z - mouthPt.z) < reach + 1 &&
      mouthPt.y < th.pos.y + R * 1.2) {
    destroyThumper()
  }
}

function slam(w: Worm, x: number, g: number, z: number) {
  sandBurst(x, g, z, 1.6, 520)
  shockRing(x, g, z, 22, 140)
  audio.crash(volFor(w.head, 450), panFor(x, z))
  if (rt.phase !== 'playing') return
  const radius = R * 1.6
  if (rt.mode === 'foot' && !rt.player.onRock) {
    const p = rt.player.pos
    if (Math.hypot(p.x - x, p.z - z) < radius && p.y < g + R * 2) killPlayer('worm')
  }
  const t = rt.thopter
  if (t.alive && Math.hypot(t.pos.x - x, t.pos.z - z) < radius + 2 && t.pos.y < g + 6) {
    if (rt.mode === 'thopter') killPlayer('thopter')
    else destroyThopter()
  }
}

function startBreach(w: Worm) {
  const dx = w.target.x - w.head.x
  const dz = w.target.z - w.head.z
  const d = Math.hypot(dx, dz)
  w.yaw = Math.atan2(dx, dz)
  w.breachA.copy(w.head)
  // Parabola from depth D back to depth D. Its length is chosen so the head re-enters the
  // sand, on the way down, exactly on the target.
  const D = -DEPTH_DEEP
  w.breachH = rand(32, 42)
  const uT = 0.5 + Math.sqrt(0.25 - D / (4 * (w.breachH + D)))
  w.breachLen = d / uT
  w.breachDur = clamp(w.breachLen / 9, 3.2, 5.2)
  w.splashUp = false
  w.splashDown = false
  setState(w, 'breach')
  audio.breach(volFor(w.head, 480), panFor(w.head.x, w.head.z))
}

function approach(w: Worm, dt: number) {
  const pl = rt.player
  if (w.kind === 'hunter') {
    if (playerSafe()) {
      w.lostT += dt
      if (w.lostT > 5) {
        setState(w, 'leave')
        toast('The worm has lost your trail', 'info')
        rt.wormsign = 0.45
        return
      }
    } else {
      w.lostT = 0
      w.target.set(pl.pos.x + pl.vel.x * 1.4, 0, pl.pos.z + pl.vel.z * 1.4)
    }
  }
  const dx = w.target.x - w.head.x
  const dz = w.target.z - w.head.z
  const dist = Math.hypot(dx, dz)
  const desired = w.kind === 'wild' ? w.baseYaw + Math.sin(w.life * 0.17) * 0.5 : Math.atan2(dx, dz)
  steer(w, desired, 1.5, dt)
  w.speed = damp(w.speed, w.kind === 'wild' ? 15 : w.kind === 'hunter' ? 24 : 26, 0.8, dt)
  advance(w, w.speed, DEPTH_DEEP, 3, dt)
  w.mouthTarget = 0

  if (w.kind === 'wild') {
    if (w.st > w.surfaceAt) setState(w, 'surface')
    return
  }
  const aligned = Math.abs(wrapAngle(desired - w.yaw)) < 0.35
  if (dist < 42 && dist > 20 && aligned && rockMask(w.target.x, w.target.z) < 0.05) {
    if (w.kind === 'hunter' && playerSafe()) return
    startBreach(w)
  }
}

function breach(w: Worm) {
  const t = clamp(w.st / w.breachDur, 0, 1)
  const s = w.breachLen * t
  const x = w.breachA.x + Math.sin(w.yaw) * s
  const z = w.breachA.z + Math.cos(w.yaw) * s
  const g = terrainHeight(x, z)
  const D = -DEPTH_DEEP
  const yRel = -D + 4 * (w.breachH + D) * t * (1 - t)
  moveHead(w, x, g + yRel, z)
  w.mouthTarget = t > 0.06 && t < 0.82 ? 1 : 0
  if (!w.splashUp && yRel > -R) {
    w.splashUp = true
    sandBurst(x, g, z, 1.3, 420)
    audio.crash(volFor(w.head, 420) * 0.8, panFor(x, z))
  }
  if (w.splashUp && !w.splashDown && t > 0.55 && yRel < R * 0.4) {
    w.splashDown = true
    slam(w, x, g, z)
  }
  eatCheck(w)
  if (t > 0.6 && yRel <= DEPTH_SURF) setState(w, 'surface')
}

function surface(w: Worm, dt: number) {
  let desired = w.yaw
  let speed = 9
  let rate = 0.6
  if (w.kind === 'lure') {
    const dx = w.head.x - w.target.x
    const dz = w.head.z - w.target.z
    const r = Math.hypot(dx, dz)
    desired = Math.atan2(dx, dz) + w.circleDir * (Math.PI / 2 + clamp((r - 34) / 20, -0.7, 0.7))
    w.mouthTarget = 0.12 + 0.1 * Math.sin(w.life * 0.7)
  } else if (w.kind === 'hunter') {
    const p = rt.player.pos
    desired = Math.atan2(p.x - w.head.x, p.z - w.head.z)
    speed = 12.5
    rate = 0.75
    w.mouthTarget = 0.7
  } else {
    desired = w.baseYaw + Math.sin(w.life * 0.21) * 0.6
    speed = 10
    w.mouthTarget = 0.12 + 0.1 * Math.sin(w.life * 0.7)
  }
  steer(w, desired, rate, dt)
  w.speed = damp(w.speed, speed, 0.7, dt)
  advance(w, w.speed, DEPTH_SURF, 8, dt)
  eatCheck(w)
  const dur = w.kind === 'lure' ? 24 : w.kind === 'hunter' ? 6 : 26
  if (w.st > dur) {
    if (w.kind === 'hunter') {
      w.attempts++
      w.resume = w.attempts < 3
    }
    setState(w, 'dive')
  }
}

function dive(w: Worm, dt: number) {
  w.mouthTarget = 0
  steer(w, w.yaw, 0.4, dt)
  w.speed = damp(w.speed, 15, 0.8, dt)
  advance(w, w.speed, -R * 3.2, 1.2, dt)
  if (w.kind === 'hunter' && w.resume && w.st > 3 && !playerSafe()) {
    setState(w, 'approach')
    return
  }
  if (w.st > 5) setState(w, 'leave')
}

function leave(w: Worm, dt: number) {
  const p = rt.player.pos
  steer(w, Math.atan2(w.head.x - p.x, w.head.z - p.z), 0.5, dt)
  w.speed = damp(w.speed, 22, 0.5, dt)
  advance(w, w.speed, -R * 3.4, 1.2, dt)
  if (w.st > 30 || Math.hypot(w.head.x - p.x, w.head.z - p.z) > 380) w.dead = true
}

function ridden(w: Worm, dt: number) {
  let target = 20
  if (isDown('KeyW')) target = 32
  if (isDown('KeyS')) target = 9
  if (isDown('ShiftLeft') || isDown('ShiftRight')) target = 46
  w.speed = damp(w.speed, target, 0.9, dt)
  steer(w, rt.cam.yaw, 0.9, dt)
  advance(w, w.speed, DEPTH_SURF, 8, dt)
  w.mouthTarget = target > 40 ? 0.75 : 0.1
}

function effects(w: Worm, dt: number) {
  const cam = rt.cam.pos
  const dist = Math.hypot(w.head.x - cam.x, w.head.z - cam.z)
  const near = clamp(1 - dist / 260, 0, 1)
  let level = near * near
  if (w.state === 'approach' || w.state === 'leave' || w.state === 'dive') level *= 0.75
  if (w.state === 'breach') level = Math.min(1.3, Math.max(level, near) * 1.25)
  if (w.state === 'ridden') level = 0.5
  w.rumble = level
  const shake = w.state === 'ridden' ? 0.06 : level * (w.state === 'breach' ? 1.3 : 0.55)
  if (shake > rt.cam.shake) rt.cam.shake = shake

  if (dist > 360) return
  const g = terrainHeight(w.head.x, w.head.z)
  const depth = w.head.y - g
  // Underground travel throws up a plume above the head: the sand wave.
  if ((w.state === 'approach' || w.state === 'leave' || w.state === 'dive') && depth > -R * 3.6) {
    const n = Math.min(6, Math.floor(w.speed * dt * 9 + Math.random()))
    wake(w.head.x, g, w.head.z, 5, n)
  }
  if (w.state === 'surface' || w.state === 'ridden') {
    const n = Math.min(5, Math.floor(w.speed * dt * 7 + Math.random()))
    wake(w.head.x + Math.sin(w.yaw) * 4, g, w.head.z + Math.cos(w.yaw) * 4, R * 1.1, n)
    for (let k = 0; k < 2; k++) {
      const i = Math.floor(rand(4, WORM_RINGS * 0.6))
      const sx = w.spine[i * 3]
      const sz = w.spine[i * 3 + 2]
      const gy = terrainHeight(sx, sz)
      if (Math.abs(w.spine[i * 3 + 1] + RADII[i] * 0.3 - gy) < RADII[i]) wake(sx, gy, sz, RADII[i], 1)
    }
  }
}

function updateWorm(w: Worm, dt: number) {
  w.st += dt
  w.life += dt
  if (w.state === 'ridden' && rt.ridden !== w) {
    setState(w, 'dive')
    w.kind = 'wild'
  }
  switch (w.state) {
    case 'approach': approach(w, dt); break
    case 'breach': breach(w); break
    case 'surface': surface(w, dt); break
    case 'dive': dive(w, dt); break
    case 'leave': leave(w, dt); break
    case 'ridden': ridden(w, dt); break
  }
  sampleAll(w)
  w.mouth = damp(w.mouth, w.mouthTarget, 3.2, dt)
  effects(w, dt)
}

export function updateWorms(dt: number) {
  for (let i = rt.pendingWorms.length - 1; i >= 0; i--) {
    const pw = rt.pendingWorms[i]
    if (rt.time >= pw.at) {
      rt.pendingWorms.splice(i, 1)
      spawnWorm(pw.kind, pw.target, 170)
    }
  }
  for (const w of rt.worms) updateWorm(w, dt)
  if (rt.worms.some((w) => w.dead)) rt.worms = rt.worms.filter((w) => !w.dead)
  rt.hunted = rt.worms.some((w) => w.kind === 'hunter' && w.state !== 'leave' && w.state !== 'ridden')

  // Threat for the HUD: the closest worm that is coming for the player's patch of sand.
  let threat = 0
  let bearingX = 0
  let bearingZ = 0
  const p = rt.player.pos
  for (const w of rt.worms) {
    if (w.state === 'ridden' || w.state === 'leave') continue
    const d = Math.hypot(w.head.x - p.x, w.head.z - p.z)
    const coming = w.kind === 'hunter' || Math.hypot(w.target.x - p.x, w.target.z - p.z) < 60
    if (!coming && d > 90) continue
    const v = clamp(1 - d / 220, 0, 1)
    if (v > threat) {
      threat = v
      bearingX = w.head.x - p.x
      bearingZ = w.head.z - p.z
    }
  }
  rt.threat = rt.mode === 'worm' ? 0 : threat
  rt.threatBearing = Math.atan2(bearingX, bearingZ)
}

export function spawnWorm(kind: WormKind, target: THREE.Vector3, dist: number): Worm | null {
  if (rt.worms.length >= MAX_WORMS) {
    const victim = rt.worms.find((w) => w !== rt.ridden && (w.state === 'leave' || w.state === 'dive'))
      ?? rt.worms.find((w) => w !== rt.ridden && w.kind === 'wild')
    if (!victim) return null
    victim.dead = true
    rt.worms = rt.worms.filter((w) => !w.dead)
  }
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * TAU
    const x = target.x + Math.sin(a) * dist
    const z = target.z + Math.cos(a) * dist
    if (rockMask(x, z) > 0.01) continue
    if (i < 16) {
      let blocked = false
      for (const f of [0.25, 0.5, 0.75]) {
        if (rockMask(x + (target.x - x) * f, z + (target.z - z) * f) > 0.01) blocked = true
      }
      if (blocked) continue
    }
    const w = createWorm(kind, x, z, Math.atan2(target.x - x, target.z - z), DEPTH_DEEP)
    w.target.copy(target)
    rt.worms.push(w)
    return w
  }
  return null
}

export function spawnWild(near: THREE.Vector3) {
  if (rt.worms.length >= MAX_WORMS) return
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * TAU
    const x = near.x + Math.sin(a) * 240
    const z = near.z + Math.cos(a) * 240
    if (rockMask(x, z) > 0.01) continue
    const toward = Math.atan2(near.x - x, near.z - z)
    const yaw = toward + rand(0.25, 0.5) * (Math.random() < 0.5 ? 1 : -1)
    const w = createWorm('wild', x, z, yaw, DEPTH_DEEP)
    w.baseYaw = yaw
    w.surfaceAt = rand(6, 9)
    rt.worms.push(w)
    return
  }
}

export function spawnHunter() {
  const w = spawnWorm('hunter', rt.player.pos, 240)
  if (!w) return
  w.target.copy(rt.player.pos)
  audio.breach(0.15, panFor(w.head.x, w.head.z))
}

// ---------- riding ----------

export function findMount(px: number, py: number, pz: number, landing: boolean) {
  let best: { w: Worm; s: number } | null = null
  let bestD = Infinity
  const i0 = Math.ceil((R * 2) / RING_DS)
  const i1 = Math.floor((L * 0.6) / RING_DS)
  for (const w of rt.worms) {
    const ok = w.state === 'surface' ||
      (w.state === 'breach' && w.st / w.breachDur > 0.85) ||
      (w.state === 'dive' && w.st < 1.5)
    if (!ok) continue
    for (let i = i0; i <= i1; i += 2) {
      const sx = w.spine[i * 3]
      const sy = w.spine[i * 3 + 1]
      const sz = w.spine[i * 3 + 2]
      const r = RADII[i]
      const top = sy + r
      const d = Math.hypot(px - sx, pz - sz)
      if (landing) {
        if (d < r * 0.85 && py <= top + 0.8 && py >= top - 2.5 && d < bestD) {
          best = { w, s: i * RING_DS }
          bestD = d
        }
      } else if (d < r + 4.5 && Math.abs(py - top) < 9 && d < bestD) {
        if (top < terrainHeight(sx, sz) + 0.8) continue
        best = { w, s: i * RING_DS }
        bestD = d
      }
    }
  }
  return best
}

export function mountWorm(w: Worm, s: number) {
  rt.ridden = w
  rt.riderS = clamp(s, R * 2.2, L * 0.35)
  setState(w, 'ridden')
  w.kind = 'wild'
  rt.mode = 'worm'
  rt.stats.rides++
  rt.wormsign = 0
  rt.cam.yaw = w.yaw
  rt.cam.pitch = -0.32
  audio.hook()
  toast(rt.stats.rides === 1 ? 'Hooks set. The maker is yours. Look where you want to go.' : 'Hooks set.', 'spice', 5200)
}

export function dismount() {
  const w = rt.ridden
  if (!w) return
  const p = rt.player
  const rx = -Math.cos(w.yaw)
  const rz = Math.sin(w.yaw)
  const side = rockMask(p.pos.x + rx * 10, p.pos.z + rz * 10) > 0.2 ? -1 : 1
  p.vel.set(rx * side * 8 + Math.sin(w.yaw) * w.speed * 0.25, 7.5, rz * side * 8 + Math.cos(w.yaw) * w.speed * 0.25)
  p.grounded = false
  rt.mode = 'foot'
  rt.ridden = null
  setState(w, 'dive')
  w.resume = false
}

const tmpPose = new THREE.Vector3()

export function riderPose(out: THREE.Vector3): number {
  const w = rt.ridden
  if (!w) return 0
  const i = ringOf(rt.riderS)
  out.set(w.spine[i * 3], w.spine[i * 3 + 1] + RADII[i] * 0.97, w.spine[i * 3 + 2])
  const a = Math.max(0, i - 2) * 3
  const b = Math.min(WORM_RINGS - 1, i + 2) * 3
  tmpPose.set(w.spine[a] - w.spine[b], 0, w.spine[a + 2] - w.spine[b + 2])
  return Math.atan2(tmpPose.x, tmpPose.z)
}
