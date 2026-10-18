import { createServer } from 'node:http'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import {
  MAX_CHAT, MAX_NAME, MODES, PROTOCOL, SEND_HZ, WORM_PTS,
  type ClientMsg, type PlayerState, type ServerMsg, type StormEvent,
} from '../../src/net/protocol.ts'

// The Arrakis server: up to MAX_PLAYERS people in one desert. Phase one shares who is
// where (on foot, on a worm, in a thopter), chat, the time of day and the storms.
// Worms, raids and spice still run on each player's machine.

const PORT = Number(process.env.PORT ?? 8006)
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS ?? 20)
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'https://dune-game-arrakis.netlify.app,http://localhost:5179,http://127.0.0.1:5179')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const DAY_LENGTH = 840
const WIND = Math.atan2(0.8944272, 0.4472136)

interface Player {
  id: number
  name: string
  ws: WebSocket
  state: PlayerState | null
  alive: boolean
  tokens: number
  lastChat: number
}

const players = new Map<number, Player>()
let nextId = 1
let tod = 0.64
let storm: StormEvent | null = null
let stormId = 1
// FIRST_STORM (seconds) brings the first storm forward, for testing.
let nextStorm = Date.now() + (process.env.FIRST_STORM ? Number(process.env.FIRST_STORM) : rand(200, 320)) * 1000
const started = Date.now()

function rand(a: number, b: number) {
  return a + Math.random() * (b - a)
}

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function broadcast(msg: ServerMsg, except?: number) {
  const data = JSON.stringify(msg)
  for (const p of players.values()) {
    if (p.id !== except && p.ws.readyState === WebSocket.OPEN) p.ws.send(data)
  }
}

function cleanName(raw: unknown, id: number) {
  const s = typeof raw === 'string' ? raw.replace(/[^\p{L}\p{N} _'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : ''
  return s.length >= 2 ? s : `Wanderer ${id}`
}

function cleanChat(raw: unknown) {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_CHAT)
}

const num = (v: unknown, lim: number) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim

// Accept only well-formed states; anything else is dropped rather than relayed.
function cleanState(s: unknown): PlayerState | null {
  if (!s || typeof s !== 'object') return null
  const o = s as Record<string, unknown>
  if (!num(o.x, 1e6) || !num(o.y, 1e5) || !num(o.z, 1e6) || !num(o.yaw, 1e3) || !num(o.speed, 500)) return null
  if (!MODES.includes(o.mode as PlayerState['mode'])) return null
  const out: PlayerState = {
    x: o.x as number, y: o.y as number, z: o.z as number, yaw: o.yaw as number,
    mode: o.mode as PlayerState['mode'],
    anim: typeof o.anim === 'string' ? o.anim.slice(0, 12) : 'idle',
    speed: o.speed as number,
    hp: num(o.hp, 1) ? (o.hp as number) : 1,
    level: num(o.level, 999) ? Math.floor(o.level as number) : 1,
  }
  const w = o.worm as Record<string, unknown> | undefined
  if (w && num(w.size, 10) && Array.isArray(w.pts) && w.pts.length === WORM_PTS * 3 && w.pts.every((v) => num(v, 1e6))) {
    out.worm = { size: w.size as number, pts: w.pts as number[] }
  }
  const f = o.fly as Record<string, unknown> | undefined
  if (f && num(f.pitch, 10) && num(f.bank, 10) && num(f.wing, 1e6)) {
    out.fly = { pitch: f.pitch as number, bank: f.bank as number, wing: f.wing as number }
  }
  return out
}

function roster(): ServerMsg {
  return { t: 'roster', players: [...players.values()].map((p) => ({ id: p.id, name: p.name })) }
}

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, players: players.size, cap: MAX_PLAYERS, uptime: Math.round((Date.now() - started) / 1000) }))
    return
  }
  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({
  server: http,
  maxPayload: 8 * 1024,
  verifyClient: (info: { origin: string }) => ORIGINS.includes(info.origin),
})

wss.on('connection', (ws) => {
  if (players.size >= MAX_PLAYERS) {
    send(ws, { t: 'full', cap: MAX_PLAYERS })
    ws.close(4001, 'full')
    return
  }
  const id = nextId++
  let player: Player | null = null
  const hello = setTimeout(() => ws.close(4002, 'no hello'), 5000)

  ws.on('message', (data: RawData) => {
    let msg: ClientMsg
    try {
      msg = JSON.parse(data.toString()) as ClientMsg
    } catch {
      ws.close(4003, 'bad json')
      return
    }
    if (!player) {
      if (msg.t !== 'hello' || msg.v !== PROTOCOL) {
        ws.close(4004, 'bad hello')
        return
      }
      clearTimeout(hello)
      player = { id, name: cleanName(msg.name, id), ws, state: null, alive: true, tokens: 40, lastChat: 0 }
      players.set(id, player)
      send(ws, { t: 'welcome', id, cap: MAX_PLAYERS, tod, dayLength: DAY_LENGTH, now: Date.now(), storm })
      broadcast({ t: 'join', id, name: player.name }, id)
      broadcast(roster())
      console.log(`join ${id} "${player.name}" (${players.size}/${MAX_PLAYERS})`)
      return
    }
    // A token bucket: 40 messages a second at most, refilled each tick.
    if (--player.tokens < 0) {
      ws.close(4005, 'too fast')
      return
    }
    if (msg.t === 'state') {
      const s = cleanState(msg.s)
      if (s) player.state = s
    } else if (msg.t === 'chat') {
      const text = cleanChat(msg.text)
      const now = Date.now()
      if (text && now - player.lastChat > 1200) {
        player.lastChat = now
        broadcast({ t: 'chat', id, name: player.name, text })
      }
    }
  })

  ws.on('pong', () => {
    if (player) player.alive = true
  })

  ws.on('close', () => {
    clearTimeout(hello)
    if (!player) return
    players.delete(id)
    broadcast({ t: 'leave', id })
    broadcast(roster())
    console.log(`leave ${id} "${player.name}" (${players.size}/${MAX_PLAYERS})`)
  })

  ws.on('error', () => ws.close())
})

// Snapshots of everyone, ten times a second; each player gets the others.
setInterval(() => {
  const now = Date.now()
  const states: [number, PlayerState][] = []
  for (const p of players.values()) {
    p.tokens = Math.min(40, p.tokens + 40 / SEND_HZ)
    if (p.state) states.push([p.id, p.state])
  }
  for (const p of players.values()) {
    send(p.ws, { t: 'snap', now, p: states.filter(([id]) => id !== p.id) })
  }
}, 1000 / SEND_HZ)

// One clock for the whole desert, and storms that sweep across everyone.
setInterval(() => {
  const now = Date.now()
  tod = (tod + 1 / DAY_LENGTH) % 1
  if (storm) {
    const front = storm.front + (storm.speed * (now - storm.at)) / 1000
    let furthest = -Infinity
    for (const p of players.values()) {
      if (p.state && p.state.mode !== 'cave') furthest = Math.max(furthest, p.state.x * storm.dirX + p.state.z * storm.dirZ)
    }
    if (front - storm.depth > furthest + 80 && now - storm.at > 30000) storm = null
  } else if (now > nextStorm) {
    const out = [...players.values()].filter((p) => p.state && p.state.mode !== 'cave')
    // Nobody out on the sand: try again shortly rather than skip a whole cycle.
    nextStorm = now + (out.length ? rand(220, 340) : 30) * 1000
    if (out.length) {
      const a = WIND + rand(-0.6, 0.6)
      const dirX = Math.sin(a)
      const dirZ = Math.cos(a)
      const cx = out.reduce((s, p) => s + p.state!.x, 0) / out.length
      const cz = out.reduce((s, p) => s + p.state!.z, 0) / out.length
      storm = { id: stormId++, dirX, dirZ, front: cx * dirX + cz * dirZ - 700, depth: rand(380, 480), speed: rand(15, 19), at: now }
      console.log(`storm ${storm.id} rising`)
    }
  }
  broadcast({ t: 'world', tod, now, storm })
}, 1000)

// Drop connections that stop answering.
setInterval(() => {
  for (const p of players.values()) {
    if (!p.alive) {
      p.ws.terminate()
      continue
    }
    p.alive = false
    p.ws.ping()
  }
}, 15000)

http.listen(PORT, () => console.log(`Arrakis server on :${PORT}, ${MAX_PLAYERS} players max, origins ${ORIGINS.join(' ')}`))

const shutdown = () => {
  for (const p of players.values()) p.ws.close(1001, 'server restarting')
  http.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
