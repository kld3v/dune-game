import * as THREE from 'three'
import { rt } from './rt'
import { endFrame, pressed, requestLock } from './input'
import { updateEnv } from './env'
import { updateFoot } from './player'
import { updateThopter } from './thopter'
import { dismount, riderPose, spawnHunter, spawnWild, spawnWorm, updateWorms } from './worms'
import { updateThumper } from './thumper'
import { initFields, updateSpice } from './spice'
import { takeSpice, updateTrip } from './trip'
import { applyLook, placeCamera } from './camera'
import { audio } from './audio'
import { syncUI, toast, useUI } from './ui'
import { clamp, damp, rand } from './math'
import { findRockSpot, findSandSpot, terrainHeight } from './terrain'
import { panFor, placeThopterNear, respawn } from './actions'
import { windSand } from './fx'

const HINTS = [
  'Walk without rhythm. The sand listens. Hold C to sandwalk.',
  'Orange sand is spice. Walk through it to harvest.',
  'F takes the spice. See what it shows you.',
  'T plants a thumper. Stand clear, then E to set your hooks on the worm.',
  'E boards the ornithopter. Q calls it to you from anywhere.',
]

let audioT = 0
let wasHunted = false
let nextWild = 90

export function initGame() {
  const spot = findRockSpot(0, 0)
  rt.player.pos.set(spot.x, terrainHeight(spot.x, spot.z), spot.z)
  placeThopterNear(spot.x, spot.z)
  initFields(spot.x, spot.z)
  const f = rt.fields[0]
  if (f) rt.cam.yaw = Math.atan2(f.x - spot.x, f.z - spot.z)
  rt.player.yaw = rt.cam.yaw
  rt.cam.snap = true
  updateEnv(0)
}

export function startGame() {
  audio.init()
  void requestLock()
  if (!rt.started) {
    rt.started = true
    rt.hintT = 1.5
    rt.cam.yaw = rt.player.yaw
    rt.cam.pitch = -0.18
  }
  rt.phase = 'playing'
}

export function resumeGame() {
  audio.init()
  void requestLock()
  rt.phase = 'playing'
}

export function rise() {
  audio.init()
  respawn()
  void requestLock()
}

export function pauseGame() {
  if (rt.phase === 'playing') rt.phase = 'paused'
}

export function toggleMute() {
  audio.setMuted(!audio.muted)
  useUI.setState({ muted: audio.muted })
}

const riderTmp = new THREE.Vector3()

function updateRiding() {
  const w = rt.ridden
  if (!w || w.dead) {
    rt.mode = 'foot'
    rt.ridden = null
    return
  }
  rt.player.yaw = riderPose(riderTmp)
  rt.player.pos.copy(riderTmp)
  rt.player.vel.set(Math.sin(w.yaw) * w.speed, 0, Math.cos(w.yaw) * w.speed)
  rt.player.grounded = true
  rt.player.onRock = false
  rt.prompt = ''
  if (pressed('KeyE')) dismount()
}

function updateThreats(dt: number) {
  rt.wormsign = clamp(rt.wormsign, 0, 1)
  if (rt.hunted) {
    rt.wormsign = 1
  } else {
    if (wasHunted) rt.wormsign = Math.min(rt.wormsign, 0.4)
    if (rt.wormsign >= 1 && rt.mode === 'foot' && !rt.player.onRock) {
      spawnHunter()
      if (rt.worms.some((w) => w.kind === 'hunter')) {
        toast('WORMSIGN. Something is hunting your rhythm. Get to rock.', 'warn', 6500)
      } else {
        rt.wormsign = 0.9
      }
    }
  }
  wasHunted = rt.hunted
  nextWild -= dt
  if (nextWild <= 0) {
    nextWild = rand(70, 120)
    if (rt.worms.length === 0) spawnWild(rt.player.pos)
  }
}

const titleTarget = new THREE.Vector3()

function updateTitle(dt: number) {
  rt.nextTitleWorm -= dt
  if (rt.nextTitleWorm > 0 || rt.worms.some((w) => w.state !== 'leave')) return
  rt.nextTitleWorm = 26
  const p = rt.player.pos
  const s = findSandSpot(p.x, p.z, 70, 115, 16, rt.cam.yaw + 0.25, 0.35)
  if (!s) return
  titleTarget.set(s.x, terrainHeight(s.x, s.z), s.z)
  spawnWorm('lure', titleTarget, 140)
}

function hints(dt: number) {
  if (rt.phase !== 'playing' || rt.hintStep >= HINTS.length) return
  rt.hintT -= dt
  if (rt.hintT <= 0) {
    toast(HINTS[rt.hintStep], 'info', 7000)
    rt.hintStep++
    rt.hintT = 10
  }
}

function updateAudio() {
  if (!audio.ctx) return
  let rumble = 0
  for (const w of rt.worms) rumble = Math.max(rumble, w.rumble)
  const t = rt.thopter
  const tv = t.alive ? clamp(1 - rt.cam.pos.distanceTo(t.pos) / 220, 0, 1) : 0
  const thopOn = t.alive && t.wingRate > 1
  const alt = rt.mode === 'thopter' ? t.pos.y - terrainHeight(t.pos.x, t.pos.z) : 0
  const quiet = rt.phase === 'paused'
  audio.update({
    wind: quiet ? 0.15 : 0.45 + clamp(alt / 120, 0, 0.5) + (rt.mode === 'worm' ? 0.35 : 0),
    rumble: quiet ? 0 : clamp(rumble, 0, 1.2),
    grind: quiet ? 0 : clamp(rumble, 0, 1),
    thop: quiet || !thopOn ? 0 : rt.mode === 'thopter' ? 0.9 : tv * tv,
    thopRate: t.wingRate,
    thopPitch: 48 + t.vel.length() * 0.35,
    thopPan: rt.mode === 'thopter' ? 0 : panFor(t.pos.x, t.pos.z),
    trip: quiet ? 0 : rt.trip,
  })
}

export function update(rawDt: number, camera: THREE.PerspectiveCamera) {
  const dt = Math.min(rawDt, 0.05)
  rt.realTime += dt
  rt.fps = damp(rt.fps, 1 / Math.max(rawDt, 1e-3), 3, dt)
  const playing = rt.phase === 'playing'
  const live = playing || rt.phase === 'title'
  if (live) rt.time += dt
  updateEnv(live ? dt : 0)
  applyLook(dt)

  if (playing) {
    if (pressed('KeyM')) toggleMute()
    if (pressed('KeyF')) takeSpice()
    if (rt.mode === 'foot') updateFoot(dt)
  }
  if (live) {
    updateThopter(dt)
    updateWorms(dt)
    if (playing && rt.mode === 'worm') updateRiding()
    updateThumper(dt)
    updateSpice(dt)
    updateTrip(dt)
    if (playing) updateThreats(dt)
    if (rt.phase === 'title') updateTitle(dt)
    const c = rt.cam.pos
    windSand(c.x, c.z, terrainHeight, Math.floor(dt * 70 + Math.random()))
    hints(dt)
  }
  placeCamera(dt, camera)
  audioT -= dt
  if (audioT <= 0) {
    audioT = 0.05
    updateAudio()
  }
  endFrame()
  syncUI()
}

export function installDebug() {
  const q = new URLSearchParams(location.search)
  if (!q.has('debug')) return
  const w = window as unknown as Record<string, unknown>
  w.__rt = rt
  w.__dbg = {
    play: () => {
      rt.started = true
      rt.phase = 'playing'
      rt.hintStep = 99
    },
    trip: (v: number) => {
      rt.melange = v
      rt.trip = Math.min(1, v)
      rt.eye = v > 0.55 ? 1 : 0
    },
    tod: (v: number) => {
      rt.tod = v
    },
    lure: (dist = 70) => {
      const p = rt.player.pos
      const s = findSandSpot(p.x, p.z, dist * 0.8, dist * 1.2, 16, rt.cam.yaw, 0.4)
      if (s) spawnWorm('lure', new THREE.Vector3(s.x, terrainHeight(s.x, s.z), s.z), 120)
      return s
    },
    hunter: () => spawnHunter(),
    wild: () => spawnWild(rt.player.pos),
    cam: (yaw: number, pitch: number) => {
      rt.cam.yaw = yaw
      rt.cam.pitch = pitch
    },
    tp: (x: number, z: number) => {
      rt.player.pos.set(x, terrainHeight(x, z), z)
      rt.cam.snap = true
    },
    blow: () => {
      rt.nextBlow = rt.time
    },
    thopter: () => {
      rt.mode = 'thopter'
    },
    sand: (minR = 30, maxR = 60) => findSandSpot(rt.player.pos.x, rt.player.pos.z, minR, maxR, 10),
  }
  if (q.has('tod')) rt.tod = Number(q.get('tod'))
  if (q.has('autoplay')) {
    rt.started = true
    rt.phase = 'playing'
    rt.hintStep = 99
  }
}
