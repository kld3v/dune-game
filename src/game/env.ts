import * as THREE from 'three'
import { rt } from './rt'
import { TAU, clamp, smoothstep } from './math'

interface Key {
  e: number
  zen: THREE.Color
  hor: THREE.Color
  sun: THREE.Color
  light: THREE.Color
  li: number
  hs: THREE.Color
  hg: THREE.Color
  hi: number
}

const key = (e: number, zen: string, hor: string, sun: string, light: string, li: number, hs: string, hg: string, hi: number): Key => ({
  e,
  zen: new THREE.Color(zen),
  hor: new THREE.Color(hor),
  sun: new THREE.Color(sun),
  light: new THREE.Color(light),
  li,
  hs: new THREE.Color(hs),
  hg: new THREE.Color(hg),
  hi,
})

// Keyed by sun elevation (sin of altitude). Light below e=-0.04 is moonlight.
// Night stays readable: a strong blue moon key plus generous sky fill, day-for-night style.
const KEYS: Key[] = [
  key(-0.3, '#040713', '#14203f', '#000000', '#a9bdea', 1.25, '#6f82b8', '#262433', 1.1),
  key(-0.08, '#0e1532', '#3d2f4c', '#401a10', '#a9bdea', 0.8, '#6a6f9a', '#2e2524', 0.95),
  key(0.0, '#22305a', '#c0603a', '#ff7a3a', '#ff8a4a', 0.7, '#7a6a80', '#3e2618', 0.8),
  key(0.08, '#3c4f7a', '#f28c46', '#ffa060', '#ffae6a', 2.3, '#a8887a', '#6a3e1e', 0.9),
  key(0.25, '#6f86ad', '#efc28c', '#ffe0b4', '#ffdcb0', 3.0, '#d8bc98', '#8a5430', 0.95),
  key(0.6, '#86a0c2', '#edd6b0', '#fff3e2', '#fff0dc', 3.4, '#e0ccad', '#9a6438', 0.95),
]

const TRIP_HOR = new THREE.Color('#3c1a6e')
const TRIP_ZEN = new THREE.Color('#090418')
const tmp = new THREE.Color()

function sample(e: number, out: Omit<Key, 'e'>) {
  let i = 0
  while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++
  const a = KEYS[i]
  const b = KEYS[i + 1]
  const t = clamp((e - a.e) / (b.e - a.e), 0, 1)
  out.zen.copy(a.zen).lerp(b.zen, t)
  out.hor.copy(a.hor).lerp(b.hor, t)
  out.sun.copy(a.sun).lerp(b.sun, t)
  out.light.copy(a.light).lerp(b.light, t)
  out.li = a.li + (b.li - a.li) * t
  out.hs.copy(a.hs).lerp(b.hs, t)
  out.hg.copy(a.hg).lerp(b.hg, t)
  out.hi = a.hi + (b.hi - a.hi) * t
}

const scratch = {
  zen: new THREE.Color(),
  hor: new THREE.Color(),
  sun: new THREE.Color(),
  light: new THREE.Color(),
  li: 0,
  hs: new THREE.Color(),
  hg: new THREE.Color(),
  hi: 0,
}

export function sunDirFor(tod: number, out: THREE.Vector3) {
  const th = (tod - 0.25) * TAU
  return out.set(Math.cos(th), Math.sin(th) * 0.92, -0.38).normalize()
}

export function updateEnv(dt: number) {
  const env = rt.env
  const e0 = env.sunDir.y
  const speed = e0 < -0.1 ? 2.2 : 1
  if (rt.phase === 'playing') rt.tod = (rt.tod + (dt / rt.dayLength) * speed) % 1

  // What you see can run ahead of the clock: deep spice trips race through days.
  const tod = rt.tod + rt.visualTod
  sunDirFor(tod, env.sunDir)
  const th = (tod - 0.25) * TAU
  env.moonDir.set(Math.cos(th + Math.PI + 0.35), Math.sin(th + Math.PI + 0.35) * 0.85, 0.3).normalize()
  env.moon2Dir.set(Math.cos(th + Math.PI - 0.6) * 0.95, Math.sin(th + Math.PI - 0.6) * 0.7, -0.45).normalize()
  if (env.moonDir.y < 0.12) env.moonDir.y = 0.12
  env.moonDir.normalize()

  const e = env.sunDir.y
  sample(e, scratch)
  env.zenith.copy(scratch.zen)
  env.horizon.copy(scratch.hor)
  env.sunCol.copy(scratch.sun)
  env.hemiSky.copy(scratch.hs)
  env.hemiGround.copy(scratch.hg)
  env.hemiIntensity = scratch.hi

  // Swap the shadow-casting light from sun to moon while it is dim, so the flip is invisible.
  if (e > -0.04) {
    env.lightDir.copy(env.sunDir)
    env.lightCol.copy(scratch.light)
    env.lightIntensity = scratch.li * smoothstep(-0.04, 0.03, e)
  } else {
    env.lightDir.copy(env.moonDir)
    env.lightCol.copy(scratch.light)
    env.lightIntensity = scratch.li * smoothstep(-0.04, -0.14, e)
  }
  if (env.lightDir.y < 0.06) {
    env.lightDir.y = 0.06
    env.lightDir.normalize()
  }

  env.night = 1 - smoothstep(-0.2, 0.0, e)
  env.day = smoothstep(0.0, 0.2, e)

  const tr = rt.trip
  if (tr > 0.001) {
    env.horizon.lerp(TRIP_HOR, tr * 0.55)
    env.zenith.lerp(TRIP_ZEN, tr * 0.5)
    tmp.setRGB(0.55, 0.65, 1.0)
    env.lightCol.lerp(tmp, tr * 0.35)
  }

  // Inside a Coriolis storm the world goes brown and dark, lit by lightning.
  const st = rt.storm.inside
  if (st > 0.001) {
    env.horizon.lerp(STORM_HOR, st * 0.9)
    env.zenith.lerp(STORM_ZEN, st * 0.85)
    env.lightIntensity *= 1 - 0.7 * st
    env.hemiIntensity *= 1 - 0.35 * st
  }
  const bolt = rt.storm.lightning
  if (bolt > 0.01) {
    env.hemiIntensity += bolt * 2.5
    env.horizon.lerp(BOLT, bolt * 0.35)
  }
}

const STORM_HOR = new THREE.Color('#6a4426')
const STORM_ZEN = new THREE.Color('#2e1e12')
const BOLT = new THREE.Color('#d8d4ff')
