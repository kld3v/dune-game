import { rt } from './rt'
import { toast } from './ui'
import { audio } from './audio'
import { glow } from './particles'
import { TAU, rand } from './math'

// Levels: everything you do in the desert earns experience. Each level adds life and an
// edge to the blade. Level, trials and upgrades are kept in this browser between visits.

const KEY = 'arrakis.profile.v1'

export const TITLES = [
  'Outworlder', 'Sand-touched', 'Walker without rhythm', 'Spice-eater', 'Water-bearer', 'Wormrider',
  'Fedaykin', 'Blade of the sietch', 'Rider of the deep desert', 'Naib', "Muad'Dib", 'Lisan al-Gaib',
]

export const titleFor = (level: number) => TITLES[Math.min(level, TITLES.length) - 1]
export const xpToNext = (level: number) => Math.round(80 * Math.pow(level, 1.35))

type Stat = keyof typeof rt.stats

// Experience per unit of each stat: per kill, per spice harvested, per metre ridden...
const RATES: [Stat, number][] = [
  ['kills', 25], ['wormKills', 15], ['harvested', 0.5], ['rides', 40], ['grandRides', 150],
  ['rideDist', 0.02], ['flowTime', 4], ['prophecies', 20], ['sandwalkDist', 0.1], ['sietchesFound', 60],
]

const last: Partial<Record<Stat, number>> = {}

interface Profile {
  level: number
  xp: number
  maxHp: number
  dmg: number
  voice: boolean
  trial: number
  trust: Record<string, number>
  gifts: Record<string, number>
  stillsuit: boolean
  solari: number
  shield: boolean
  thopter: number
  paracompass: boolean
  rings: number
  waterOfLife: boolean
  trialTitle: string
}

export function loadProfile() {
  for (const [k] of RATES) last[k] = rt.stats[k]
  let p: Partial<Profile> | null = null
  try {
    const raw = localStorage.getItem(KEY)
    p = raw ? (JSON.parse(raw) as Partial<Profile>) : null
  } catch {
    p = null
  }
  if (!p) return
  const g = rt.progress
  g.level = Math.max(1, Math.floor(p.level ?? 1))
  g.xp = Math.max(0, Math.floor(p.xp ?? 0))
  rt.combat.maxHp = Math.max(100, p.maxHp ?? 100)
  rt.combat.hp = rt.combat.maxHp
  rt.upgrades.dmg = Math.max(1, p.dmg ?? 1)
  rt.upgrades.voice = !!p.voice
  rt.trial.idx = Math.max(0, Math.floor(p.trial ?? 0))
  rt.trial.base = 0
  if (p.trust) Object.assign(rt.trust, p.trust)
  if (p.gifts) Object.assign(rt.gifts, p.gifts)
  rt.upgrades.stillsuit = !!p.stillsuit
  rt.solari = Math.max(0, Math.floor(p.solari ?? 0))
  rt.upgrades.shield = !!p.shield
  rt.shieldOn = rt.upgrades.shield
  rt.upgrades.thopter = Math.max(1, p.thopter ?? 1)
  rt.upgrades.paracompass = !!p.paracompass
  rt.upgrades.rings = Math.max(0, Math.floor(p.rings ?? 0))
  rt.upgrades.waterOfLife = !!p.waterOfLife
  rt.trial.title = p.trialTitle ?? ''
}

export function saveProfile() {
  const g = rt.progress
  g.dirty = false
  g.saveT = 3
  const p: Profile = {
    level: g.level,
    xp: g.xp,
    maxHp: rt.combat.maxHp,
    dmg: rt.upgrades.dmg,
    voice: rt.upgrades.voice,
    trial: rt.trial.idx,
    trust: rt.trust,
    gifts: rt.gifts,
    stillsuit: rt.upgrades.stillsuit,
    solari: rt.solari,
    shield: rt.upgrades.shield,
    thopter: rt.upgrades.thopter,
    paracompass: rt.upgrades.paracompass,
    rings: rt.upgrades.rings,
    waterOfLife: rt.upgrades.waterOfLife,
    trialTitle: rt.trial.title,
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // storage unavailable (private mode): progress lasts for this visit only
  }
}

export function resetProfile() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing stored, nothing to forget
  }
  location.reload()
}

export function addXP(amount: number) {
  const g = rt.progress
  g.frac += amount
  const whole = Math.floor(g.frac)
  if (whole <= 0) return
  g.frac -= whole
  g.xp += whole
  g.gainAt = rt.time
  g.dirty = true
  while (g.xp >= xpToNext(g.level)) {
    g.xp -= xpToNext(g.level)
    g.level++
    levelUp(g.level)
  }
}

function levelUp(level: number) {
  rt.combat.maxHp += 8
  rt.combat.hp = rt.combat.maxHp
  rt.upgrades.dmg *= 1.04
  rt.progress.levelAt = rt.time
  audio.levelUp()
  toast(`Level ${level}: ${titleFor(level)}. +8 life, a keener blade.`, 'spice', 6000)
  const p = rt.player.pos
  for (let i = 0; i < 240; i++) {
    const a = (i / 240) * TAU
    const sp = rand(4, 9)
    glow.emit(p.x + Math.cos(a) * 0.6, p.y + rand(0, 1.8), p.z + Math.sin(a) * 0.6,
      Math.cos(a) * sp, rand(2, 7), Math.sin(a) * sp, rand(0.8, 1.6), rand(0.25, 0.6), 2.2, 1.5, 0.5, -0.2, 1.4)
  }
  saveProfile()
}

export function updateProgress(dt: number) {
  let gained = 0
  for (const [k, rate] of RATES) {
    const v = rt.stats[k]
    const d = v - (last[k] ?? v)
    if (d > 0) gained += d * rate
    last[k] = v
  }
  if (gained > 0) addXP(gained)
  const g = rt.progress
  g.saveT -= dt
  if (g.dirty && g.saveT <= 0) saveProfile()
}
