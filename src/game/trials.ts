import { rt } from './rt'
import { toast } from './ui'
import { audio } from './audio'
import { addXP, saveProfile } from './progress'
import { maxTrust } from './sietch'

// The Trials of the Fremen: a chain of objectives that teaches the desert and pays out
// in power. Each trial measures a stat against its value when the trial began.
export interface Trial {
  title: string
  goal: string
  target: number
  unit?: string
  stat: () => number
  reward: string
  grant: () => void
}

export const TRIALS: Trial[] = [
  {
    title: 'Walk without rhythm',
    goal: 'Sandwalk across open sand (hold C)',
    target: 60, unit: 'm',
    stat: () => rt.stats.sandwalkDist,
    reward: '+15 spice',
    grant: () => { rt.spice += 15 },
  },
  {
    title: 'The spice must flow',
    goal: 'Harvest spice from the orange sand',
    target: 40,
    stat: () => rt.stats.harvested,
    reward: '+20 life',
    grant: () => { rt.combat.maxHp += 20; rt.combat.hp += 20 },
  },
  {
    title: 'Taste the future',
    goal: 'Take the spice (F) and hear a true prophecy',
    target: 1,
    stat: () => rt.stats.prophecies,
    reward: 'The Voice (V)',
    grant: () => { rt.upgrades.voice = true },
  },
  {
    title: 'Call the maker',
    goal: 'Plant a thumper, then set your hooks on the worm',
    target: 1,
    stat: () => rt.stats.rides,
    reward: '+25 spice',
    grant: () => { rt.spice += 25 },
  },
  {
    title: 'The hidden people',
    goal: 'Find a Fremen sietch hidden in the rocks (prophecies can point the way)',
    target: 1,
    stat: () => rt.stats.sietchesFound,
    reward: '+20 spice',
    grant: () => { rt.spice += 20 },
  },
  {
    title: 'The city of the spice',
    goal: 'Sell spice to Ammar in the Arrakeen market (follow the compass)',
    target: 10,
    stat: () => rt.stats.spiceSold,
    reward: '+60 solari',
    grant: () => { rt.solari += 60 },
  },
  {
    title: 'Break the patrol',
    goal: 'Kill Harkonnen soldiers',
    target: 3,
    stat: () => rt.stats.kills,
    reward: 'Sharper crysknife (+25% damage)',
    grant: () => { rt.upgrades.dmg *= 1.25 },
  },
  {
    title: 'Water of the tribe',
    goal: "Earn a sietch's trust: offer spice, kill Harkonnen near it, ride where they can see",
    target: 20, unit: ' trust',
    stat: () => maxTrust(),
    reward: '+25 life',
    grant: () => { rt.combat.maxHp += 25; rt.combat.hp += 25 },
  },
  {
    title: 'Flow with the storm',
    goal: 'Ride out a Coriolis storm, spice-high and moving with the wind',
    target: 10, unit: 's',
    stat: () => rt.stats.flowTime,
    reward: '+30 life',
    grant: () => { rt.combat.maxHp += 30; rt.combat.hp += 30 },
  },
  {
    title: 'Master of the maker',
    goal: 'Ride the great worms across the desert',
    target: 1500, unit: 'm',
    stat: () => rt.stats.rideDist,
    reward: '+40 spice',
    grant: () => { rt.spice += 40 },
  },
  {
    title: 'Shai-Hulud feeds',
    goal: 'Let a worm devour Harkonnen (thumper near a squad, or ride through them)',
    target: 3,
    stat: () => rt.stats.wormKills,
    reward: 'Sharper crysknife (+25% damage)',
    grant: () => { rt.upgrades.dmg *= 1.25 },
  },
  {
    title: 'Lisan al-Gaib',
    goal: 'Kill Harkonnen soldiers',
    target: 20,
    stat: () => rt.stats.kills,
    reward: 'The desert knows your name',
    grant: () => { rt.combat.maxHp += 50; rt.combat.hp += 50 },
  },
]

// Saved progress names the trial, so adding trials never shifts where you were.
export function restoreTrial() {
  const i = rt.trial.title ? TRIALS.findIndex((t) => t.title === rt.trial.title) : -1
  if (i >= 0) rt.trial.idx = i
  rt.trial.title = TRIALS[rt.trial.idx]?.title ?? ''
  rt.trial.base = currentTrial()?.stat() ?? 0
}

export function currentTrial() {
  return TRIALS[rt.trial.idx] ?? null
}

export function trialProgress(): number {
  const t = currentTrial()
  if (!t) return 1
  return Math.min(1, (t.stat() - rt.trial.base) / t.target)
}

export function updateTrials(dt: number) {
  void dt
  const t = currentTrial()
  if (!t) return
  if (t.stat() - rt.trial.base >= t.target) {
    t.grant()
    addXP(100 * (rt.trial.idx + 1))
    audio.hook()
    toast(`Trial complete: ${t.title}. ${t.reward}.`, 'spice', 6500)
    rt.trial.idx++
    rt.trial.doneT = rt.time
    const next = currentTrial()
    rt.trial.base = next ? next.stat() : 0
    rt.trial.title = next ? next.title : ''
    saveProfile()
    if (next) window.setTimeout(() => toast(`Next trial: ${next.title}. ${next.goal}.`, 'info', 6500), 2500)
  }
}
