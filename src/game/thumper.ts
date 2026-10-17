import { rt } from './rt'
import { rockMask, terrainHeight } from './terrain'
import { audio } from './audio'
import { toast } from './ui'
import { puff, shockRing } from './fx'
import { jolt, panFor, volFor } from './actions'
import { spawnWorm } from './worms'

const BEAT = 0.85
let planted = 0

export function plantThumper() {
  const p = rt.player
  if (!p.grounded) return
  const x = p.pos.x + Math.sin(p.yaw) * 1.6
  const z = p.pos.z + Math.cos(p.yaw) * 1.6
  if (rockMask(x, z) > 0.2) {
    toast('A thumper needs open sand', 'warn', 2500)
    audio.blip()
    return
  }
  const th = rt.thumper
  th.active = true
  th.pos.set(x, terrainHeight(x, z), z)
  th.t = 0
  th.beat = BEAT * 0.7
  th.called = false
  planted++
  toast(planted === 1 ? 'Thumper planted. Get well clear of it, then wait for the maker.' : 'Thumper planted', 'info', 5500)
}

export function updateThumper(dt: number) {
  const th = rt.thumper
  if (!th.active) return
  th.t += dt
  th.beat += dt
  if (th.beat >= BEAT) {
    th.beat -= BEAT
    audio.thump(volFor(th.pos, 240), panFor(th.pos.x, th.pos.z))
    puff(th.pos.x, th.pos.y, th.pos.z, 1.2, 4)
    shockRing(th.pos.x, th.pos.y, th.pos.z, 6, 14)
    jolt(th.pos, 0.05, 25)
  }
  th.phase = th.beat / BEAT
  if (!th.called && th.t > 3) {
    th.called = true
    const hunter = rt.worms.find((w) => w.kind === 'hunter' && w.state === 'approach')
    if (hunter) {
      hunter.kind = 'lure'
      hunter.target.copy(th.pos)
      toast('The worm turns toward the thumper', 'spice', 4500)
    } else if (spawnWorm('lure', th.pos, 170)) {
      toast('Wormsign. Something vast is coming for the thumper.', 'warn', 5500)
    }
  }
  if (th.t > 70) th.active = false
}
