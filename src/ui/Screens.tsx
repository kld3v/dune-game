import { useEffect, useState } from 'react'
import { useUI } from '../game/ui'
import { rt } from '../game/rt'
import { resumeGame, rise, startGame, toggleMute, toggleShake } from '../game/sim'
import { resetProfile } from '../game/progress'
import { mmoUrl, playerName, setPlayerName } from '../net/client'

const CONTROLS: [string, string][] = [
  ['WASD + mouse', 'walk and look'],
  ['Shift / C', 'run / sandwalk quietly'],
  ['T', 'plant a thumper to call a worm'],
  ['E', 'set hooks on a surfaced worm, board the ornithopter'],
  ['Q', 'call the ornithopter to you'],
  ['F', 'take the spice'],
  ['Left mouse', 'sword: three strikes, the slow third one breaks shields'],
  ['V', 'the Voice, once a trial teaches it'],
  ['M', 'sound on or off'],
]

const DEATH: Record<string, string> = {
  worm: 'Shai-Hulud has taken you',
  thopter: 'The worm swallowed your ornithopter whole',
  harkonnen: 'A Harkonnen blade found you',
  storm: 'The storm stripped you to the bone',
}

function Controls() {
  return (
    <dl className="controls">
      {CONTROLS.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Screens() {
  const phase = useUI((s) => s.phase)
  const reason = useUI((s) => s.deathReason)
  const muted = useUI((s) => s.muted)
  const shake = useUI((s) => s.shake)
  const [coarse] = useState(() => window.matchMedia('(pointer: coarse)').matches)
  const [canRise, setCanRise] = useState(false)
  const [shared] = useState(() => !!mmoUrl())
  const [name, setName] = useState(playerName)

  useEffect(() => {
    if (phase !== 'dead') return
    setCanRise(false)
    const id = window.setTimeout(() => setCanRise(true), 1600)
    return () => window.clearTimeout(id)
  }, [phase])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Enter') return
      if (phase === 'title') startGame()
      else if (phase === 'paused') resumeGame()
      else if (phase === 'dead' && canRise) rise()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, canRise])

  if (phase === 'title') {
    return (
      <div className="screen title">
        <div className="title-block">
          <h1>Arrakis</h1>
          <p className="tagline">Ride the maker · Fly the ornithopter · Take the spice</p>
          {shared ? (
            <label className="name-field">
              <span>Your name in the desert</span>
              <input
                maxLength={16}
                value={name}
                placeholder="Wanderer"
                onChange={(e) => {
                  setName(e.target.value)
                  setPlayerName(e.target.value)
                }}
              />
            </label>
          ) : null}
          <button className="cta" onClick={startGame}>Enter the desert</button>
          {coarse ? <p className="note">Built for keyboard and mouse.</p> : null}
          <Controls />
          <p className="fine">Sound on, headphones help. A fan-made tribute, not affiliated with the Dune franchise.</p>
        </div>
      </div>
    )
  }

  if (phase === 'paused') {
    return (
      <div className="screen pause" onClick={resumeGame}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <h2>Paused</h2>
          <button className="cta" onClick={resumeGame}>Return to the sand</button>
          <button className="ghost" onClick={toggleMute}>{muted ? 'Sound off' : 'Sound on'}</button>
          <button className="ghost" onClick={toggleShake}>{shake ? 'Screen shake on' : 'Screen shake off'}</button>
          <button
            className="ghost"
            onClick={() => {
              if (window.confirm('Forget your level, trials and Fremen trust, and start over?')) resetProfile()
            }}
          >
            Start over
          </button>
          <Controls />
        </div>
      </div>
    )
  }

  if (phase === 'dead') {
    const s = rt.stats
    return (
      <div className="screen dead">
        <div className="panel">
          <h2>{DEATH[reason] ?? DEATH.worm}</h2>
          <p className="tagline">
            {reason === 'worm' ? 'Back to the beginning. The worm keeps all your spice.' : 'Back to the beginning. Half your spice is lost to the sand.'}
          </p>
          <p className="stats-line">
            {Math.floor(s.harvested)} spice harvested · {s.rides} {s.rides === 1 ? 'worm' : 'worms'} ridden · {s.doses} {s.doses === 1 ? 'dose' : 'doses'} taken
          </p>
          <button className="cta" onClick={rise} disabled={!canRise}>Rise again</button>
        </div>
      </div>
    )
  }

  return null
}
