import { rt } from './rt'
import { consume, isDown } from './input'
import { rockMask, terrainHeight } from './terrain'
import { damp, dampAngle } from './math'
import { findMount, mountWorm } from './worms'
import { boardThopter, callThopter } from './thopter'
import { plantThumper } from './thumper'
import { audio } from './audio'
import { puff } from './fx'
import { power } from './combat'

const MAX_SLOPE = 1.6 // rise over run; dune slip faces are ~0.9, rock cliffs block

export function updateFoot(dt: number) {
  const p = rt.player
  const yaw = rt.cam.yaw
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)
  const rx = -Math.cos(yaw)
  const rz = Math.sin(yaw)
  let ix = 0
  let iz = 0
  if (isDown('KeyW') || isDown('ArrowUp')) { ix += fx; iz += fz }
  if (isDown('KeyS') || isDown('ArrowDown')) { ix -= fx; iz -= fz }
  if (isDown('KeyD') || isDown('ArrowRight')) { ix += rx; iz += rz }
  if (isDown('KeyA') || isDown('ArrowLeft')) { ix -= rx; iz -= rz }
  const len = Math.hypot(ix, iz)
  if (len > 0) {
    ix /= len
    iz /= len
  }
  p.running = len > 0 && (isDown('ShiftLeft') || isDown('ShiftRight'))
  p.sandwalk = len > 0 && !p.running && isDown('KeyC')
  const swing = rt.combat.attacking ? 0.25 : 1
  const spiced = 1 + 0.3 * power()
  const speed = (len === 0 ? 0 : p.running ? 9.5 : p.sandwalk ? 1.9 : 5.2) * swing * spiced
  const k = p.grounded ? 12 : 2.5
  p.vel.x = damp(p.vel.x, ix * speed, k, dt)
  p.vel.z = damp(p.vel.z, iz * speed, k, dt)
  if (p.grounded && consume('Space')) {
    p.vel.y = 8.5
    p.grounded = false
  }
  p.vel.y -= 24 * dt

  const g0 = terrainHeight(p.pos.x, p.pos.z)
  let nx = p.pos.x + p.vel.x * dt
  let nz = p.pos.z + p.vel.z * dt
  if (p.grounded) {
    const step = Math.hypot(nx - p.pos.x, nz - p.pos.z)
    if (step > 1e-5 && (terrainHeight(nx, nz) - g0) / step > MAX_SLOPE) {
      const sx = Math.abs(nx - p.pos.x)
      const sz = Math.abs(nz - p.pos.z)
      if (sx > 1e-5 && (terrainHeight(nx, p.pos.z) - g0) / sx <= MAX_SLOPE) nz = p.pos.z
      else if (sz > 1e-5 && (terrainHeight(p.pos.x, nz) - g0) / sz <= MAX_SLOPE) nx = p.pos.x
      else {
        nx = p.pos.x
        nz = p.pos.z
      }
    }
  }
  p.pos.x = nx
  p.pos.z = nz
  p.pos.y += p.vel.y * dt
  const g = terrainHeight(p.pos.x, p.pos.z)

  // Dropping onto a surfaced worm's back sets the hooks automatically.
  if (!p.grounded && p.vel.y < 0) {
    const m = findMount(p.pos.x, p.pos.y, p.pos.z, true)
    if (m) {
      mountWorm(m.w, m.s)
      return
    }
  }

  p.onRock = rockMask(p.pos.x, p.pos.z) > 0.5
  if (p.pos.y <= g) {
    if (!p.grounded && p.airTime > 0.3) {
      puff(p.pos.x, g, p.pos.z, 1.2, 8)
      audio.step(0.9, p.onRock)
      if (!p.onRock) rt.wormsign += 0.02
    }
    p.pos.y = g
    p.vel.y = 0
    p.grounded = true
    p.airTime = 0
  } else if (p.grounded && p.vel.y <= 0 && p.pos.y - g < 0.45) {
    p.pos.y = g
    p.vel.y = 0
  } else {
    p.grounded = false
    p.airTime += dt
  }

  const hs = Math.hypot(p.vel.x, p.vel.z)
  p.speed = hs
  if (hs > 0.4 && !rt.combat.attacking) p.yaw = dampAngle(p.yaw, Math.atan2(p.vel.x, p.vel.z), 10, dt)
  p.walkPhase += hs * dt * 1.25

  if (p.grounded && hs > 0.6) {
    p.stepT -= dt
    if (p.stepT <= 0) {
      p.stepT = p.running ? 0.3 : p.sandwalk ? 0.45 + Math.random() * 0.45 : 0.42
      audio.step(p.sandwalk ? 0.35 : p.running ? 1 : 0.7, p.onRock)
      if (!p.onRock) puff(p.pos.x, g, p.pos.z, p.running ? 0.8 : 0.5, p.running ? 4 : 2)
    }
  }

  // Rhythm on open sand draws the maker; even standing still it slowly finds you.
  // Sandwalking (C) barely registers. Only rock is truly quiet.
  if (p.onRock) rt.wormsign -= 0.15 * dt
  else if (p.grounded && hs > 0.6) rt.wormsign += (p.running ? 0.05 : p.sandwalk ? 0.003 : 0.02) * dt
  else if (p.grounded) rt.wormsign += 0.004 * dt
  if (p.sandwalk && p.grounded && !p.onRock) rt.stats.sandwalkDist += hs * dt

  const mount = findMount(p.pos.x, p.pos.y, p.pos.z, false)
  const t = rt.thopter
  const nearThopter = t.alive && Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) < 7.5 && Math.abs(t.pos.y - p.pos.y) < 6
  rt.prompt = mount ? 'E  Set the maker hooks' : nearThopter ? 'E  Board the ornithopter' : ''
  if ((mount || nearThopter) && consume('KeyE')) {
    if (mount) mountWorm(mount.w, mount.s)
    else boardThopter()
  }
  if (consume('KeyT')) plantThumper()
  if (consume('KeyQ')) callThopter()
}
