import { rt } from './rt'
import { audio } from './audio'
import { prophecy, toast, vision } from './ui'
import { bearingOf, damp, pick, rand, smoothstep } from './math'
import { spiceVortex } from './fx'
import { glow } from './particles'

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
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

const dirName = (x: number, z: number) => DIRS[Math.round(bearingOf(x - rt.player.pos.x, z - rt.player.pos.z) / 45) % 8]
const when = (s: number) => (s < 20 ? 'It is close now' : s < 45 ? 'Soon' : 'Before long')

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
  rt.combat.hp = Math.min(rt.combat.maxHp, rt.combat.hp + 30)
  audio.consume()
  if (rt.eye < 0.05) placeEye()
  toast(pick(RUSH), 'spice', 3000)
}

// Prescience tells the truth: every line here is about something the game has already
// scheduled to happen.
function foretell(): string | null {
  const out: string[] = []
  const p = rt.player.pos
  const blowIn = rt.nextBlow - rt.time
  if (blowIn > 0 && blowIn < 90) {
    out.push(`Spice will bloom at ${Math.round(bearingOf(rt.nextBlowPos.x - p.x, rt.nextBlowPos.z - p.z))}°. ${when(blowIn)}.`)
  }
  const raidIn = rt.nextRaid - rt.time
  if (!rt.carrier.active && raidIn > 0 && raidIn < 90) {
    out.push(`Black ships will come down to the ${dirName(rt.nextRaidPos.x, rt.nextRaidPos.z)}. ${when(raidIn)}.`)
  }
  const stormIn = rt.nextStorm - rt.time
  if (!rt.storm.active && stormIn > 0 && stormIn < 120) {
    const from = DIRS[Math.round(((-rt.nextStormDir * 180) / Math.PI + 180 + 720) % 360 / 45) % 8]
    out.push(`The sky will turn to sand from the ${from}. ${when(stormIn)}.`)
  }
  if (rt.wormsign > 0.6) out.push('The maker circles closer. It hears your heart.')
  const near = rt.foes.filter((f) => f.state !== 'dead' && Math.hypot(f.pos.x - p.x, f.pos.z - p.z) < 120).length
  if (near > 0) out.push(near === 1 ? 'One Harkonnen heart beats nearby. It will stop.' : `${near} Harkonnen hearts beat nearby. They will stop.`)
  return out.length ? pick(out) : null
}

function inCombat() {
  const p = rt.player.pos
  return rt.foes.some((f) => (f.state === 'chase' || f.state === 'attack') && Math.hypot(f.pos.x - p.x, f.pos.z - p.z) < 30)
}

// A flash-forward: the camera cuts to where the future is about to happen.
function tryFlash() {
  const f = rt.flash
  if (f.cooldown > 0 || f.t > 0 || rt.mode === 'thopter' || rt.storm.inside > 0.2 || inCombat()) return
  const blowIn = rt.nextBlow - rt.time
  const raidIn = rt.nextRaid - rt.time
  let target = null
  let text = ''
  if (blowIn > 0 && blowIn < 60) {
    target = rt.nextBlowPos
    text = 'A vision: the sand splits open and the spice pours into the sky.'
  } else if (!rt.carrier.active && raidIn > 0 && raidIn < 60) {
    target = rt.nextRaidPos
    text = 'A vision: black ships, and men in masks dropping onto the sand.'
  }
  if (!target) return
  const p = rt.player.pos
  const dx = p.x - target.x
  const dz = p.z - target.z
  const d = Math.hypot(dx, dz) || 1
  f.t = 1.9
  f.cooldown = 30
  f.x = target.x + (dx / d) * 38
  f.z = target.z + (dz / d) * 38
  f.y = target.y + 22
  f.tx = target.x
  f.ty = target.y + 9
  f.tz = target.z
  for (let i = 0; i < 260; i++) {
    const a = Math.random() * Math.PI * 2
    const sp = rand(0.5, 5)
    glow.emit(target.x, target.y + rand(0, 3), target.z, Math.cos(a) * sp, rand(10, 34), Math.sin(a) * sp, rand(1.5, 2.6), rand(0.4, 1.4), 1.2, 1.0, 2.2, 0.35, 0.4)
  }
  audio.prescience()
  prophecy(text)
  rt.stats.prophecies++
}

export function updateTrip(dt: number) {
  rt.melange = Math.max(0, rt.melange - 0.0075 * dt)
  const target = Math.min(1, rt.melange)
  rt.trip = damp(rt.trip, target, target > rt.trip ? 0.45 : 0.22, dt)
  rt.eye = damp(rt.eye, rt.trip > 0.55 ? 1 : 0, 0.6, dt)
  if (rt.trip < 0.02 && rt.eye < 0.01) placeEye()

  // Deep in the spice, days race past; coming down, time rewinds to the present.
  const lapse = smoothstep(0.6, 1.0, rt.trip)
  if (lapse > 0.01) rt.visualTod += dt * 0.035 * lapse
  else rt.visualTod = damp(rt.visualTod, 0, 0.5, dt)

  // The golden path leads to spice that has not bloomed yet, if prescience sees one.
  const p = rt.player.pos
  let bx = p.x + Math.sin(rt.cam.yaw) * 300
  let bz = p.z + Math.cos(rt.cam.yaw) * 300
  if (rt.nextBlow - rt.time < 60 && rt.nextBlow > rt.time) {
    bx = rt.nextBlowPos.x
    bz = rt.nextBlowPos.z
  } else {
    let best = Infinity
    for (const f of rt.fields) {
      const d = Math.hypot(f.x - p.x, f.z - p.z)
      if (d < best && d > 12) {
        best = d
        bx = f.x
        bz = f.z
      }
    }
  }
  rt.path.ax = p.x
  rt.path.az = p.z
  rt.path.bx = bx
  rt.path.bz = bz
  rt.path.on = damp(rt.path.on, rt.trip > 0.5 ? 1 : 0, 0.8, dt)

  rt.flash.t = Math.max(0, rt.flash.t - dt)
  rt.flash.cooldown -= dt
  if (rt.phase !== 'playing') return
  if (rt.trip > 0.75) tryFlash()

  rt.visionT -= dt
  if (rt.trip > 0.3 && rt.visionT <= 0) {
    rt.prophecyT -= 1
    const truth = rt.prophecyT <= 0 ? foretell() : null
    if (truth) {
      prophecy(truth)
      rt.stats.prophecies++
      rt.prophecyT = 2
    } else {
      vision(pick(LINES))
    }
    audio.whisper(rand(-0.8, 0.8), rt.trip)
    rt.visionT = rand(3.5, 6.5) / (0.5 + rt.trip)
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
