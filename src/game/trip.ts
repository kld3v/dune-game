import { rt } from './rt'
import { audio } from './audio'
import { toast, vision } from './ui'
import { damp, pick, rand } from './math'
import { spiceVortex } from './fx'

const LINES = [
  'The sleeper must awaken',
  'Fear is the mind-killer',
  'I must not fear',
  'The spice must flow',
  'Walk without rhythm',
  'Bless the Maker and His water',
  'Shai-Hulud',
  'Lisan al-Gaib',
  'Usul',
  'Many futures. One path.',
  'Time is a dune. It moves.',
  'Long live the fighters',
  'Desert power',
  'Your eyes are turning blue',
  'The worm is the spice',
  'Kwisatz Haderach',
  'Water is life',
  'The sand remembers you',
]

const RUSH = ['The spice takes you', 'Melange floods your blood', 'Your eyes burn blue', 'The future opens']

function placeEye() {
  const yaw = rt.cam.yaw
  const el = 0.42
  rt.eyeDir.set(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el)).normalize()
}

export function takeSpice() {
  if (rt.spice < 10) {
    toast('Not enough spice. Harvest the orange sand first.', 'warn', 3000)
    audio.blip()
    return
  }
  rt.spice -= 10
  rt.melange = Math.min(1.8, rt.melange + 0.38)
  rt.stats.doses++
  rt.doseAt = rt.time
  audio.consume()
  if (rt.eye < 0.05) placeEye()
  toast(pick(RUSH), 'spice', 3000)
}

export function updateTrip(dt: number) {
  rt.melange = Math.max(0, rt.melange - 0.0075 * dt)
  const target = Math.min(1, rt.melange)
  rt.trip = damp(rt.trip, target, target > rt.trip ? 0.45 : 0.22, dt)
  rt.eye = damp(rt.eye, rt.trip > 0.55 ? 1 : 0, 0.6, dt)
  if (rt.trip < 0.02 && rt.eye < 0.01) placeEye()

  // The golden path: prescience shows the way to the nearest spice.
  const p = rt.player.pos
  let best = Infinity
  let bx = p.x + Math.sin(rt.cam.yaw) * 300
  let bz = p.z + Math.cos(rt.cam.yaw) * 300
  for (const f of rt.fields) {
    const d = Math.hypot(f.x - p.x, f.z - p.z)
    if (d < best && d > 12) {
      best = d
      bx = f.x
      bz = f.z
    }
  }
  rt.path.ax = p.x
  rt.path.az = p.z
  rt.path.bx = bx
  rt.path.bz = bz
  rt.path.on = damp(rt.path.on, rt.trip > 0.5 ? 1 : 0, 0.8, dt)

  if (rt.phase !== 'playing') return
  rt.visionT -= dt
  if (rt.trip > 0.3 && rt.visionT <= 0) {
    vision(pick(LINES))
    audio.whisper(rand(-0.8, 0.8), rt.trip)
    rt.visionT = rand(3.5, 7) / (0.5 + rt.trip)
  }
  if (rt.trip > 0.65) {
    rt.heartT -= dt
    if (rt.heartT <= 0) {
      audio.heartbeat(rt.trip)
      rt.heartT = 1.15 - rt.trip * 0.35
    }
  }
  if (rt.trip > 0.35) {
    const n = Math.floor(rt.trip * 30 * dt + Math.random())
    spiceVortex(p.x, p.y + 1, p.z, rt.trip, n)
  }
}
