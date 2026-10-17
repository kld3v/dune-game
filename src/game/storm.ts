import { rt } from './rt'
import { WIND_X, WIND_Z, terrainHeight } from './terrain'
import { TAU, bearingOf, clamp, damp, rand, smoothstep } from './math'
import { toast } from './ui'
import { audio } from './audio'
import { killPlayer } from './actions'
import { power } from './combat'
import { dust, glow } from './particles'

// A Coriolis storm is a band of sand hundreds of metres deep, sweeping across the
// desert along its direction. Its leading edge is the plane dot(p, dir) = front.
export const STORM_CEILING = 150

export function stormDepthAt(x: number, z: number): number {
  const s = rt.storm
  if (!s.active) return 0
  const d = x * s.dirX + z * s.dirZ
  return clamp(Math.min(s.front - d, d - (s.front - s.depth)) / 40, 0, 1)
}

export function scheduleStorm(delay: number) {
  rt.nextStorm = rt.time + delay
  rt.nextStormDir = Math.atan2(WIND_X, WIND_Z) + rand(-0.6, 0.6)
}

function startStorm() {
  const s = rt.storm
  s.dirX = Math.sin(rt.nextStormDir)
  s.dirZ = Math.cos(rt.nextStormDir)
  const p = rt.player.pos
  s.front = p.x * s.dirX + p.z * s.dirZ - 700
  s.depth = rand(380, 480)
  s.speed = rand(15, 19)
  s.active = true
  s.t = 0
  scheduleStorm(rand(220, 340))
  const from = Math.round(bearingOf(-s.dirX, -s.dirZ))
  toast(`Coriolis storm rising, bearing ${from}°. Shelter on rock, fly above it, or take the spice and flow with it.`, 'warn', 9000)
}

export function updateStorm(dt: number) {
  const s = rt.storm
  if (!s.active) {
    s.inside = damp(s.inside, 0, 1.5, dt)
    s.flowing = false
    if (rt.phase === 'playing' && rt.time > rt.nextStorm) startStorm()
    return
  }
  s.t += dt
  s.front += s.speed * dt
  const inThopter = rt.mode === 'thopter'
  const p = inThopter ? rt.thopter.pos : rt.player.pos
  const g = terrainHeight(p.x, p.z)
  const above = smoothstep(g + STORM_CEILING - 30, g + STORM_CEILING + 10, p.y)
  s.inside = damp(s.inside, stormDepthAt(p.x, p.z) * (1 - above), 2, dt)

  if (s.front - s.depth > p.x * s.dirX + p.z * s.dirZ + 80 && s.t > 30) {
    s.active = false
    if (rt.phase === 'playing') toast('The storm has passed.', 'info', 3500)
    return
  }
  if (s.inside < 0.04 || rt.phase !== 'playing') {
    s.flowing = false
    return
  }

  // Flow: high enough on spice, moving with the wind instead of against it.
  const v = inThopter ? rt.thopter.vel : rt.player.vel
  const along = v.x * s.dirX + v.z * s.dirZ
  const was = s.flowing
  s.flowing = power() >= 0.45 && along > 3
  if (s.flowing && !was) toast('You stop fighting it. The storm carries you.', 'spice', 3500)
  if (s.flowing) rt.stats.flowTime += dt

  const push = (inThopter ? 11 : rt.mode === 'foot' ? 3.5 : 0) * s.inside * (s.flowing ? 1.8 : 1)
  if (inThopter) {
    rt.thopter.vel.x += s.dirX * push * dt
    rt.thopter.vel.z += s.dirZ * push * dt
    if (!s.flowing) rt.thopter.vel.y += (Math.random() - 0.5) * 30 * s.inside * dt
  } else if (rt.mode === 'foot') {
    rt.player.pos.x += s.dirX * push * dt
    rt.player.pos.z += s.dirZ * push * dt
  }

  if (!s.flowing) {
    const shelter = rt.mode === 'foot' && rt.player.onRock ? 0.5 : 1
    rt.combat.hp -= (inThopter ? 9 : 7) * s.inside * shelter * (rt.upgrades.stillsuit ? 0.5 : 1) * dt
    rt.combat.hurtT = 0
    if (rt.combat.hp <= 0) killPlayer('storm')
  }

  s.nextBolt -= dt
  if (s.nextBolt <= 0 && s.inside > 0.3) {
    s.lightning = 1
    s.nextBolt = rand(1.5, 5)
    audio.thunder(rand(0.5, 1))
  }
  s.lightning = damp(s.lightning, 0, 6, dt)
  rt.cam.rumbleTarget = Math.max(rt.cam.rumbleTarget, s.inside * (s.flowing ? 0.15 : 0.55))

  // Sand blasting past the camera; golden streams when you're flowing.
  const c = rt.cam.pos
  const n = Math.floor(s.inside * 90 * dt + Math.random())
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU
    const r = rand(2, 28)
    const x = c.x + Math.cos(a) * r - s.dirX * 15
    const z = c.z + Math.sin(a) * r - s.dirZ * 15
    const y = c.y + rand(-6, 6)
    if (s.flowing) {
      glow.emit(x, y, z, s.dirX * rand(26, 40), rand(-1, 2), s.dirZ * rand(26, 40), rand(0.8, 1.6), rand(0.12, 0.3), 1.6, 1.0, 0.35, 0, 0.1)
    } else {
      dust.emit(x, y, z, s.dirX * rand(24, 38), rand(-1, 3), s.dirZ * rand(24, 38), rand(0.8, 1.6), rand(0.6, 2.2), 0.55, 0.36, 0.2, 0.05, 0.1)
    }
  }
}
