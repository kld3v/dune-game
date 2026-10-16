import { useEffect, useRef } from 'react'
import { rt, type Mode } from '../game/rt'
import { useUI } from '../game/ui'
import { bearingOf, clamp, wrap180, yawToBearing } from '../game/math'
import { fieldRadius } from '../game/spice'

const HINTS: Record<Mode, [string, string][]> = {
  foot: [
    ['WASD', 'move'], ['Shift', 'run'], ['C', 'sandwalk'], ['Space', 'jump'], ['T', 'thumper'],
    ['F', 'take spice'], ['Q', 'call thopter'], ['E', 'interact'], ['M', 'sound'],
  ],
  worm: [
    ['Mouse / A D', 'steer'], ['W', 'faster'], ['S', 'slower'], ['Shift', 'surge'], ['E', 'leap off'], ['F', 'take spice'],
  ],
  thopter: [
    ['Mouse', 'steer'], ['W S', 'thrust'], ['A D', 'strafe'], ['Space', 'climb'], ['C', 'descend'], ['Shift', 'boost'],
    ['E', 'exit'], ['F', 'take spice'],
  ],
}

const MODE_NAME: Record<Mode, string> = { foot: 'On foot', worm: 'Riding the maker', thopter: 'Ornithopter' }

const COMPASS_W = 560
const SPAN = 160
const PX = COMPASS_W / SPAN
const LABELS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }

function Ticks() {
  const ticks = []
  for (let d = -360; d <= 720; d += 15) {
    const n = ((d % 360) + 360) % 360
    const label = LABELS[n]
    ticks.push(
      <div key={d} className={label ? 'tick tick-major' : 'tick'} style={{ left: (d + 360) * PX }}>
        {label ? <span>{label}</span> : null}
      </div>,
    )
  }
  return <>{ticks}</>
}

interface MarkerEl {
  el: HTMLDivElement
  label: HTMLSpanElement | null
}

function timeLabel(tod: number) {
  const mins = Math.floor(tod * 24 * 60)
  const h = Math.floor(mins / 60) % 24
  const m = mins % 60
  const e = rt.env.sunDir.y
  const name = e > 0.25 ? 'Day' : e > 0.02 ? (tod < 0.5 ? 'Morning' : 'Dusk') : e > -0.12 ? 'Twilight' : 'Night'
  return `${name}  ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function HUD() {
  const phase = useUI((s) => s.phase)
  const mode = useUI((s) => s.mode)
  const prompt = useUI((s) => s.prompt)
  const toasts = useUI((s) => s.toasts)
  const visions = useUI((s) => s.visions)
  const muted = useUI((s) => s.muted)

  const strip = useRef<HTMLDivElement>(null)
  const markers = useRef<HTMLDivElement>(null)
  const spiceVal = useRef<HTMLSpanElement>(null)
  const melFill = useRef<HTMLDivElement>(null)
  const melBar = useRef<HTMLDivElement>(null)
  const wsFill = useRef<HTMLDivElement>(null)
  const wsLabel = useRef<HTMLSpanElement>(null)
  const threat = useRef<HTMLDivElement>(null)
  const warn = useRef<HTMLDivElement>(null)
  const arrow = useRef<HTMLSpanElement>(null)
  const clock = useRef<HTMLDivElement>(null)
  const fps = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const pool: MarkerEl[] = []
    const host = markers.current!
    const get = (i: number, cls: string, withLabel: boolean) => {
      while (pool.length <= i) {
        const el = document.createElement('div')
        const label = document.createElement('span')
        el.appendChild(label)
        host.appendChild(el)
        pool.push({ el, label })
      }
      const m = pool[i]
      m.el.className = `marker ${cls}`
      if (m.label) m.label.style.display = withLabel ? '' : 'none'
      return m
    }
    const showFps = new URLSearchParams(location.search).has('fps')
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const camB = yawToBearing(rt.cam.yaw)
      if (strip.current) strip.current.style.transform = `translateX(${COMPASS_W / 2 - (camB + 360) * PX}px)`
      const p = rt.player.pos
      let n = 0
      const place = (x: number, z: number, cls: string, pin: boolean, label?: string) => {
        const off = wrap180(bearingOf(x - p.x, z - p.z) - camB)
        if (Math.abs(off) > SPAN / 2 && !pin) return
        const m = get(n++, cls, !!label)
        const c = clamp(off, -SPAN / 2, SPAN / 2)
        m.el.style.display = ''
        m.el.style.transform = `translateX(${COMPASS_W / 2 + c * PX}px)`
        m.el.style.opacity = Math.abs(off) > SPAN / 2 ? '0.45' : '1'
        if (m.label && label) m.label.textContent = label
      }
      const t = rt.thopter
      if (t.alive && rt.mode !== 'thopter') {
        place(t.pos.x, t.pos.z, 'm-thopter', true, `${Math.round(Math.hypot(t.pos.x - p.x, t.pos.z - p.z))}m`)
      }
      let nearest = Infinity
      let nf = -1
      rt.fields.forEach((f, i) => {
        const d = Math.hypot(f.x - p.x, f.z - p.z) - fieldRadius(f)
        if (d < nearest) {
          nearest = d
          nf = i
        }
      })
      rt.fields.forEach((f, i) => {
        place(f.x, f.z, 'm-spice', i === nf, i === nf ? (nearest > 0 ? `${Math.round(nearest)}m` : 'here') : undefined)
      })
      for (const b of rt.blows) if (!b.erupted) place(b.x, b.z, 'm-blow', true)
      if (rt.thumper.active) place(rt.thumper.pos.x, rt.thumper.pos.z, 'm-thumper', false)
      for (const w of rt.worms) {
        if (w.state === 'ridden') continue
        const d = Math.hypot(w.head.x - p.x, w.head.z - p.z)
        if (d < 320) place(w.head.x, w.head.z, 'm-worm', w.kind === 'hunter', `${Math.round(d)}m`)
      }
      for (let i = n; i < pool.length; i++) pool[i].el.style.display = 'none'

      if (spiceVal.current) spiceVal.current.textContent = String(Math.floor(rt.spice))
      if (melFill.current) melFill.current.style.width = `${clamp(rt.melange, 0, 1) * 100}%`
      if (melBar.current) melBar.current.classList.toggle('over', rt.melange > 1)
      if (wsFill.current) {
        wsFill.current.style.width = `${clamp(rt.wormsign, 0, 1) * 100}%`
        wsFill.current.classList.toggle('hot', rt.wormsign > 0.7 || rt.hunted)
      }
      if (wsLabel.current) wsLabel.current.textContent = rt.hunted ? 'Hunted' : rt.player.onRock && rt.mode === 'foot' ? 'Rock. Safe.' : ''
      const th = rt.threat
      if (threat.current) threat.current.style.opacity = String(th > 0 ? Math.pow(th, 1.4) * (0.55 + 0.25 * Math.sin(rt.realTime * 6)) : 0)
      if (warn.current) warn.current.style.opacity = th > 0.15 ? '1' : '0'
      if (arrow.current) arrow.current.style.transform = `rotate(${wrap180((-rt.threatBearing * 180) / Math.PI - camB)}deg)`
      if (clock.current) clock.current.textContent = timeLabel(rt.tod)
      if (fps.current && showFps) fps.current.textContent = `${Math.round(rt.fps)} fps`
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const active = phase === 'playing' || phase === 'paused'
  const [key, ...rest] = prompt.split('  ')

  return (
    <div className={`hud ${active ? '' : 'hud-hidden'}`}>
      <div className="threat" ref={threat} />
      <div className="compass">
        <div className="compass-window">
          <div className="compass-strip" ref={strip}>
            <Ticks />
          </div>
          <div className="compass-markers" ref={markers} />
          <div className="compass-centre" />
        </div>
      </div>
      <div className="wormsign-warn" ref={warn} style={{ opacity: 0 }}>
        <span>
          <span className="arrow" ref={arrow}>▲</span> Wormsign
        </span>
      </div>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
      <div className="stats">
        <div className="stat-spice">
          <span className="stat-label">Spice</span>
          <span className="stat-value" ref={spiceVal}>0</span>
        </div>
        <div className="bar-row">
          <span className="stat-label">Melange</span>
          <div className="bar bar-melange" ref={melBar}>
            <div className="bar-fill" ref={melFill} />
          </div>
        </div>
        <div className="bar-row">
          <span className="stat-label">Wormsign</span>
          <div className="bar bar-worm">
            <div className="bar-fill" ref={wsFill} />
          </div>
          <span className="bar-note" ref={wsLabel} />
        </div>
      </div>
      <div className="corner">
        <div ref={clock} />
        <div className="muted">{muted ? 'Sound off (M)' : ''}</div>
        <div ref={fps} />
      </div>
      {prompt ? (
        <div className="prompt">
          <kbd>{key}</kbd>
          <span>{rest.join('  ')}</span>
        </div>
      ) : null}
      <div className="mode">
        <div className="mode-name">{MODE_NAME[mode]}</div>
        <div className="hints">
          {HINTS[mode].map(([k, v]) => (
            <span key={k}>
              <kbd>{k}</kbd>
              {v}
            </span>
          ))}
        </div>
      </div>
      <div className="visions">
        {visions.map((v) => (
          <div key={v.id} className="vision" style={{ left: `${v.x}%`, top: `${v.y}%`, fontSize: `${v.size}rem` }}>
            {v.text}
          </div>
        ))}
      </div>
    </div>
  )
}
