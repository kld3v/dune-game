import * as THREE from 'three'
import { rt, WORM_RINGS } from './rt'
import { input, isDown } from './input'
import { terrainHeight } from './terrain'
import { clamp, damp } from './math'
import { RADII } from './wormShape'

const SENS = 0.0022

// Mouse look runs before the simulation so movement uses this frame's heading.
export function applyLook(dt: number) {
  const c = rt.cam
  if (rt.phase !== 'playing') return
  c.yaw -= input.mdx * SENS
  c.pitch -= input.mdy * SENS
  if (rt.mode === 'worm') {
    if (isDown('KeyA') || isDown('ArrowLeft')) c.yaw += 1.1 * dt
    if (isDown('KeyD') || isDown('ArrowRight')) c.yaw -= 1.1 * dt
  }
}

let dist = 24

// First hit of a ray (origin o, unit dir d) with a sphere, or Infinity.
function raySphere(o: THREE.Vector3, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number) {
  const ox = o.x - cx
  const oy = o.y - cy
  const oz = o.z - cz
  const b = ox * dx + oy * dy + oz * dz
  const c = ox * ox + oy * oy + oz * oz - r * r
  const disc = b * b - c
  if (disc < 0) return Infinity
  const t = -b - Math.sqrt(disc)
  return t > 0 ? t : Infinity
}

// Pull the camera in front of the parked ornithopter or a worm's body instead of
// letting it end up inside them.
function occlusion(target: THREE.Vector3, dx: number, dy: number, dz: number, maxDist: number) {
  let best = maxDist
  const t = rt.thopter
  if (t.alive && rt.mode !== 'thopter') {
    const fx = Math.sin(t.yaw)
    const fz = Math.cos(t.yaw)
    for (const off of [2.5, 0, -2.5, -5.5]) {
      const hit = raySphere(target, dx, dy, dz, t.pos.x + fx * off, t.pos.y, t.pos.z + fz * off, 2.2)
      if (hit < best) best = hit
    }
  }
  if (rt.mode === 'foot') {
    for (const w of rt.worms) {
      for (let i = 0; i < WORM_RINGS; i += 5) {
        const sx = w.spine[i * 3]
        const sy = w.spine[i * 3 + 1]
        const sz = w.spine[i * 3 + 2]
        if (Math.abs(sx - target.x) > 45 || Math.abs(sz - target.z) > 45) continue
        const hit = raySphere(target, dx, dy, dz, sx, sy, sz, RADII[i] + 0.6)
        if (hit < best) best = hit
      }
    }
  }
  return best < maxDist ? Math.max(1.2, best - 0.4) : maxDist
}

export function placeCamera(dt: number, camera: THREE.PerspectiveCamera) {
  const c = rt.cam
  let tx: number
  let ty: number
  let tz: number
  let targetDist: number
  let k: number
  let pmin: number
  let pmax: number
  const p = rt.player.pos
  if (rt.phase === 'title') {
    c.yaw += dt * 0.022
    c.pitch = damp(c.pitch, -0.1, 1, dt)
    tx = p.x
    ty = p.y + 3
    tz = p.z
    targetDist = 24
    k = 2
    pmin = -1
    pmax = 1
  } else if (rt.mode === 'worm') {
    tx = p.x
    ty = p.y + 2.4
    tz = p.z
    targetDist = 30
    k = 6
    pmin = -1.0
    pmax = 0.25
  } else if (rt.mode === 'thopter') {
    const t = rt.thopter.pos
    tx = t.x
    ty = t.y + 2
    tz = t.z
    targetDist = 15
    k = 9
    pmin = -1.2
    pmax = 0.55
  } else {
    tx = p.x
    ty = p.y + 1.65
    tz = p.z
    targetDist = 5.8
    k = 16
    pmin = -1.2
    pmax = 0.5
  }
  c.pitch = clamp(c.pitch, pmin, pmax)
  if (c.snap) {
    c.target.set(tx, ty, tz)
    dist = targetDist
    c.snap = false
  } else {
    c.target.set(damp(c.target.x, tx, k, dt), damp(c.target.y, ty, k, dt), damp(c.target.z, tz, k, dt))
    dist = damp(dist, targetDist, 4, dt)
  }

  const cp = Math.cos(c.pitch)
  const fx = Math.sin(c.yaw) * cp
  const fy = Math.sin(c.pitch)
  const fz = Math.cos(c.yaw) * cp
  const d = rt.phase === 'title' ? dist : occlusion(c.target, -fx, -fy, -fz, dist)
  let px = c.target.x - fx * d
  let py = c.target.y - fy * d
  let pz = c.target.z - fz * d

  const clearance = rt.mode === 'foot' && rt.phase !== 'title' ? 0.7 : 1.6
  const minY = Math.max(
    terrainHeight(px, pz) + clearance,
    terrainHeight((px + c.target.x) * 0.5, (pz + c.target.z) * 0.5) + clearance * 0.5,
  )
  if (py < minY) py = minY

  // Rumble is a slow heave (under 3 Hz); impacts add a short, quicker jolt that fades fast.
  c.rumble = damp(c.rumble, c.rumbleTarget, 3, dt)
  c.impulse = damp(c.impulse, 0, 3.2, dt)
  if (rt.settings.shake) {
    const t = rt.realTime
    const a = c.rumble * 0.08
    const b = c.impulse * 0.22
    px += (Math.sin(t * 9.1) + 0.5 * Math.sin(t * 13.7 + 1.3)) * a + Math.sin(t * 31.0 + 0.4) * b
    py += (Math.sin(t * 10.3 + 0.7) + 0.5 * Math.sin(t * 15.1)) * a + Math.sin(t * 37.0 + 1.9) * b
    pz += (Math.sin(t * 8.3 + 2.1) + 0.5 * Math.sin(t * 12.9 + 0.2)) * a + Math.sin(t * 29.0 + 2.6) * b
  }

  camera.position.set(px, py, pz)
  c.pos.copy(camera.position)
  camera.lookAt(c.target)
  if (rt.trip > 0.15) camera.rotateZ(Math.sin(rt.time * 0.55) * 0.07 * rt.trip)

  const running = rt.mode === 'foot' && rt.player.running
  const boost = (rt.mode === 'thopter' && rt.thopter.boost) || (rt.mode === 'worm' && !!rt.ridden && rt.ridden.speed > 38)
  const fov = 62 + (running ? 5 : 0) + (boost ? 10 : 0) + Math.sin(rt.time * 0.7) * 5 * rt.trip
  c.fov = damp(c.fov, fov, 3, dt)
  if (Math.abs(camera.fov - c.fov) > 0.01) {
    camera.fov = c.fov
    camera.updateProjectionMatrix()
  }
}
