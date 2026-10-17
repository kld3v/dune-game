import * as THREE from 'three'
import { rt } from './rt'
import { consume, endFrame, requestLock } from './input'
import { updateEnv } from './env'
import { updateFoot } from './player'
import { updateThopter } from './thopter'
import { dismount, playerSafe, riderPose, spawnHunter, spawnWild, spawnWorm, updateWorms } from './worms'
import { updateThumper } from './thumper'
import { initFields, planBlow, updateSpice } from './spice'
import { takeSpice, updateTrip } from './trip'
import { applyLook, placeCamera } from './camera'
import { audio } from './audio'
import { syncUI, toast, useUI } from './ui'
import { clamp, damp, rand } from './math'
import { findRockSpot, findSandSpot, terrainHeight } from './terrain'
import { panFor, placeThopterNear, respawn } from './actions'
import { windSand } from './fx'
import { updateCombat } from './combat'
import { debugRaid, planRaid, updateHarkonnens } from './harkonnen'
import { scheduleStorm, updateStorm } from './storm'
import { updateTrials } from './trials'

const HINTS = [
  'Walk without rhythm. The sand listens. Hold C to sandwalk.',
  'Orange sand is spice. Walk through it to harvest.',
  'F takes the spice. It heals, it strengthens, and it shows you what is coming.',
  'T plants a thumper. Stand clear, then E to set your hooks on the worm.',
  'Left click swings your blade. The third strike is slow enough to pierce a shield.',
]

let audioT = 0
let nextWild = 90
let stalkerAnnounced = false

export function initGame() {
  const spot = findRockSpot(0, 0)
  rt.spawn.x = spot.x
  rt.spawn.z = spot.z
  rt.player.pos.set(spot.x, terrainHeight(spot.x, spot.z), spot.z)
  placeThopterNear(spot.x, spot.z)
  initFields(spot.x, spot.z)
  const f = rt.fields[0]
  if (f) rt.cam.yaw = Math.atan2(f.x - spot.x, f.z - spot.z)
  rt.player.yaw = rt.cam.yaw
  rt.cam.snap = true
  planBlow(40)
  planRaid(60)
  scheduleStorm(rand(190, 240))
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

export function toggleShake() {
  rt.settings.shake = !rt.settings.shake
  useUI.setState({ shake: rt.settings.shake })
  try {
    localStorage.setItem('arrakis.shake', rt.settings.shake ? '1' : '0')
  } catch {
    // storage unavailable (private mode); the toggle still works for this visit
  }
}

export function loadSettings() {
  try {
    rt.settings.shake = localStorage.getItem('arrakis.shake') !== '0'
  } catch {
    rt.settings.shake = true
  }
  useUI.setState({ shake: rt.settings.shake })
}

const riderTmp = new THREE.Vector3()
let wasRiding = false

function updateRiding(dt: number) {
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
  rt.stats.rideDist += w.speed * dt
  audio.musicIntensity(clamp((w.speed - 12) / 34, 0, 1) * 0.8 + (rt.riding.mountT < 6 ? 0.25 : 0))
  if (consume('KeyE')) dismount()
}

let warned = false

function updateThreats(dt: number) {
  if (rt.mode !== 'foot') rt.wormsign -= 0.1 * dt
  rt.wormsign = clamp(rt.wormsign, 0, 1)
  if (rt.wormsign < 0.5) warned = false
  if (rt.wormsign > 0.75 && !warned && !playerSafe()) {
    warned = true
    toast('The sand trembles. The maker has heard your rhythm.', 'warn', 5000)
  }
  // The stalker: once it has found you, a worm is always out there.
  if (rt.time > 30 && rt.mode !== 'worm' && !rt.worms.some((w) => w.kind === 'hunter')) {
    spawnHunter()
    if (!stalkerAnnounced && rt.worms.some((w) => w.kind === 'hunter')) {
      stalkerAnnounced = true
      toast('Something vast has begun to follow you beneath the sand. It will strike when your rhythm fills the wormsign.', 'warn', 8000)
    }
  }
  nextWild -= dt
  if (nextWild <= 0) {
    nextWild = rand(80, 130)
    if (rt.worms.length < 2) spawnWild(rt.player.pos)
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
    rt.hintT = 11
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
  const c = rt.carrier
  const cv = c.active ? clamp(1 - rt.cam.pos.distanceTo(c.pos) / 400, 0, 1) : 0
  audio.update({
    wind: quiet ? 0.15 : 0.45 + clamp(alt / 120, 0, 0.5) + (rt.mode === 'worm' ? 0.35 : 0) + rt.storm.inside * 1.6,
    rumble: quiet ? 0 : clamp(rumble, 0, 1.2),
    grind: quiet ? 0 : clamp(rumble, 0, 1),
    thop: quiet || !thopOn ? 0 : rt.mode === 'thopter' ? 0.9 : tv * tv,
    thopRate: t.wingRate,
    thopPitch: 48 + t.vel.length() * 0.35,
    thopPan: rt.mode === 'thopter' ? 0 : panFor(t.pos.x, t.pos.z),
    trip: quiet ? 0 : rt.trip,
    carrier: quiet ? 0 : cv * cv,
    carrierPan: panFor(c.pos.x, c.pos.z),
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

  // Impact hitstop and spice prescience bend time for everyone but you.
  rt.hitstop = Math.max(0, rt.hitstop - dt)
  const presBefore = rt.presT > 0
  rt.presT = Math.max(0, rt.presT - dt)
  if (!presBefore && rt.presT > 0) audio.prescience()
  rt.slowmo = damp(rt.slowmo, rt.presT > 0 ? 1 : 0, 10, dt)
  const foeDt = rt.hitstop > 0 ? 0 : dt * (1 - 0.65 * rt.slowmo)

  // Setting the hooks: a beat of slow motion while the worm rears and the score hits.
  const riding = rt.mode === 'worm'
  if (riding && !wasRiding) {
    rt.riding.mountT = 0
    audio.musicStart()
  }
  if (!riding && wasRiding) audio.musicStop()
  wasRiding = riding
  rt.riding.mountT += dt
  rt.riding.epic = damp(rt.riding.epic, riding ? 1 : 0, 1.5, dt)
  const wormDt = riding && rt.riding.mountT < 1.6 ? dt * 0.35 : dt

  if (playing) {
    if (consume('KeyM')) toggleMute()
    if (consume('KeyF')) takeSpice()
    if (rt.mode === 'foot') updateFoot(dt)
    updateCombat(dt)
  }
  if (live) {
    updateThopter(dt)
    updateWorms(wormDt)
    if (playing && rt.mode === 'worm') updateRiding(dt)
    updateHarkonnens(dt, foeDt)
    updateStorm(dt)
    updateThumper(dt)
    updateSpice(dt)
    updateTrip(dt)
    if (playing) {
      updateThreats(dt)
      updateTrials(dt)
    }
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
    raid: () => debugRaid(),
    storm: () => {
      rt.nextStorm = rt.time
    },
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
