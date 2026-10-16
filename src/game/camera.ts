import * as THREE from 'three'
import { rt } from './rt'
import { input, isDown } from './input'
import { terrainHeight } from './terrain'
import { clamp, damp } from './math'

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
  let px = c.target.x - fx * dist
  let py = c.target.y - fy * dist
  let pz = c.target.z - fz * dist

  const clearance = rt.mode === 'foot' && rt.phase !== 'title' ? 0.7 : 1.6
  const minY = Math.max(
    terrainHeight(px, pz) + clearance,
    terrainHeight((px + c.target.x) * 0.5, (pz + c.target.z) * 0.5) + clearance * 0.5,
  )
  if (py < minY) py = minY

  const s = Math.min(c.shake, 1.6)
  c.shake = damp(c.shake, 0, 2.2, dt)
  if (s > 0.001) {
    const t = rt.realTime
    px += (Math.sin(t * 37.1) + 0.6 * Math.sin(t * 23.7 + 1.3)) * s * 0.3
    py += (Math.sin(t * 41.3 + 0.7) + 0.6 * Math.sin(t * 19.1)) * s * 0.3
    pz += (Math.sin(t * 29.9 + 2.1) + 0.6 * Math.sin(t * 31.7)) * s * 0.3
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
