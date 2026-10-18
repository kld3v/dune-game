import * as THREE from 'three'
import { rt, WORM_RINGS } from '../game/rt'
import { useUI } from '../game/ui'
import { toast } from '../game/ui'
import { damp, dampAngle } from '../game/math'
import { stormFromServer } from '../game/storm'
import { PROTOCOL, SEND_HZ, WORM_PTS, type ClientMsg, type NetMode, type PlayerState, type ServerMsg } from './protocol'

// The game's side of the Arrakis server. Off unless a server is configured: at build time
// (VITE_MMO_URL), by a link (?mmo=wss://...), or remembered from a link visited before.

export interface Remote {
  id: number
  name: string
  state: PlayerState
  pos: THREE.Vector3
  yaw: number
  seen: number
  screenX: number
  screenY: number
  onScreen: boolean
}

export type NetStatus = 'off' | 'connecting' | 'online' | 'full' | 'offline'

export const net = {
  url: '',
  status: 'off' as NetStatus,
  id: 0,
  cap: 20,
  remotes: new Map<number, Remote>(),
  names: new Map<number, string>(),
  ws: null as WebSocket | null,
  retry: 0,
  sendT: 0,
  stormId: 0,
}

export function mmoUrl(): string {
  const q = new URLSearchParams(location.search).get('mmo')
  try {
    if (q !== null) {
      if (q) localStorage.setItem('arrakis.mmo', q)
      else localStorage.removeItem('arrakis.mmo')
      return q
    }
    const saved = localStorage.getItem('arrakis.mmo')
    if (saved) return saved
  } catch {
    // storage unavailable: only the link or the build setting can name a server
  }
  return q ?? (import.meta.env.VITE_MMO_URL as string | undefined) ?? ''
}

export function playerName(): string {
  try {
    return localStorage.getItem('arrakis.name') ?? ''
  } catch {
    return ''
  }
}

export function setPlayerName(name: string) {
  try {
    localStorage.setItem('arrakis.name', name.slice(0, 16))
  } catch {
    // the name lasts for this visit only
  }
}

function setStatus(status: NetStatus) {
  net.status = status
  useUI.setState({ net: { status, count: net.remotes.size + (status === 'online' ? 1 : 0), cap: net.cap } })
}

function send(msg: ClientMsg) {
  if (net.ws && net.ws.readyState === WebSocket.OPEN) net.ws.send(JSON.stringify(msg))
}

export function sendChat(text: string) {
  const t = text.trim()
  if (t) send({ t: 'chat', text: t.slice(0, 160) })
}

export function startNet() {
  net.url = mmoUrl()
  if (net.url) connect()
}

function connect() {
  setStatus('connecting')
  let ws: WebSocket
  try {
    ws = new WebSocket(net.url)
  } catch {
    setStatus('offline')
    return
  }
  net.ws = ws
  ws.onopen = () => send({ t: 'hello', v: PROTOCOL, name: playerName() || 'Wanderer' })
  ws.onmessage = (e) => {
    try {
      handle(JSON.parse(String(e.data)) as ServerMsg)
    } catch {
      // ignore a malformed message rather than drop the connection
    }
  }
  ws.onclose = (e) => {
    net.ws = null
    net.remotes.clear()
    net.stormId = 0
    rt.nextStorm = Math.max(rt.nextStorm === Infinity ? 0 : rt.nextStorm, rt.time + 180)
    const full = e.code === 4001 || net.status === 'full'
    setStatus(full ? 'full' : 'offline')
    const delay = full ? 30 : Math.min(30, 2 ** net.retry)
    net.retry++
    window.setTimeout(connect, delay * 1000)
  }
}

let clock = 0

function handle(m: ServerMsg) {
  switch (m.t) {
    case 'welcome': {
      net.id = m.id
      net.cap = m.cap
      net.retry = 0
      clock = m.now - Date.now()
      // The server keeps the clock and the storms for everyone now.
      rt.tod = m.tod
      rt.nextStorm = Infinity
      if (m.storm) applyStorm(m.storm, m.now)
      setStatus('online')
      toast(`Connected to Arrakis. Others walk this desert with you.`, 'info', 4500)
      break
    }
    case 'full':
      setStatus('full')
      toast(`Arrakis is full (${m.cap} riders). Playing alone for now.`, 'warn', 5000)
      break
    case 'roster':
      net.names = new Map(m.players.map((p) => [p.id, p.name]))
      for (const r of net.remotes.values()) r.name = net.names.get(r.id) ?? r.name
      setStatus('online')
      break
    case 'join':
      if (m.id !== net.id) toast(`${m.name} has come to the desert.`, 'info', 3500)
      break
    case 'leave': {
      const r = net.remotes.get(m.id)
      if (r) toast(`${r.name} has left the desert.`, 'info', 3000)
      net.remotes.delete(m.id)
      setStatus('online')
      break
    }
    case 'snap': {
      const now = performance.now()
      for (const [id, s] of m.p) {
        let r = net.remotes.get(id)
        if (!r) {
          r = { id, name: net.names.get(id) ?? 'Wanderer', state: s, pos: new THREE.Vector3(s.x, s.y, s.z), yaw: s.yaw, seen: now, screenX: 0, screenY: 0, onScreen: false }
          net.remotes.set(id, r)
        }
        r.state = s
        r.seen = now
      }
      break
    }
    case 'chat': {
      const lines = useUI.getState().chat
      useUI.setState({ chat: [...lines.slice(-5), { id: Date.now() + Math.random(), name: m.name, text: m.text, at: Date.now() }] })
      break
    }
    case 'world':
      rt.tod = m.tod
      if (m.storm && m.storm.id !== net.stormId) applyStorm(m.storm, m.now)
      break
  }
}

function applyStorm(ev: NonNullable<Extract<ServerMsg, { t: 'world' }>['storm']>, serverNow: number) {
  net.stormId = ev.id
  stormFromServer(ev, serverNow)
}

export const serverNow = () => Date.now() + clock

// What this player is doing, in the few numbers others need to draw it.
function animOf(): string {
  const p = rt.player
  if (rt.mode === 'worm') return 'ride'
  if (rt.combat.attacking) return 'strike'
  if (!p.grounded && (p.vel.y > 2 || p.airTime > 0.25)) return p.vel.y > 2 ? 'jump' : 'fall'
  if (p.speed < 0.6) return rt.time - rt.doseAt < 3.6 ? 'drink' : 'idle'
  if (p.sandwalk) return 'sneak'
  if (p.running) return 'sprint'
  return p.speed < 2.8 ? 'walk' : 'jog'
}

function stateOf(): PlayerState {
  const flying = rt.mode === 'thopter'
  const t = rt.thopter
  const pos = flying ? t.pos : rt.player.pos
  const mode: NetMode = rt.cave ? 'cave' : rt.mode
  const s: PlayerState = {
    x: Math.round(pos.x * 100) / 100,
    y: Math.round(pos.y * 100) / 100,
    z: Math.round(pos.z * 100) / 100,
    yaw: Math.round((flying ? t.yaw : rt.player.yaw) * 1000) / 1000,
    mode,
    anim: animOf(),
    speed: Math.round((flying ? t.vel.length() : rt.player.speed) * 10) / 10,
    hp: Math.round((rt.combat.hp / rt.combat.maxHp) * 100) / 100,
    level: rt.progress.level,
  }
  const w = rt.ridden
  if (rt.mode === 'worm' && w) {
    const pts: number[] = []
    for (let k = 0; k < WORM_PTS; k++) {
      const i = Math.round((k / (WORM_PTS - 1)) * (WORM_RINGS - 1)) * 3
      pts.push(Math.round(w.spine[i] * 10) / 10, Math.round(w.spine[i + 1] * 10) / 10, Math.round(w.spine[i + 2] * 10) / 10)
    }
    s.worm = { size: w.size, pts }
  }
  if (flying) s.fly = { pitch: t.pitch, bank: t.bank, wing: t.wingPhase }
  return s
}

export function updateNet(dt: number) {
  if (net.status !== 'online') return
  if (rt.phase === 'playing') {
    net.sendT -= dt
    if (net.sendT <= 0) {
      net.sendT = 1 / SEND_HZ
      send({ t: 'state', s: stateOf() })
    }
  }
  // Ease every remote toward its latest reported state; drop the ones gone quiet.
  const now = performance.now()
  for (const r of net.remotes.values()) {
    if (now - r.seen > 5000) {
      net.remotes.delete(r.id)
      continue
    }
    const s = r.state
    const jump = Math.hypot(s.x - r.pos.x, s.z - r.pos.z) > 60
    r.pos.set(jump ? s.x : damp(r.pos.x, s.x, 12, dt), jump ? s.y : damp(r.pos.y, s.y, 12, dt), jump ? s.z : damp(r.pos.z, s.z, 12, dt))
    r.yaw = dampAngle(r.yaw, s.yaw, 12, dt)
  }
}
