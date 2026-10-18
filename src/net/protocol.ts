// The wire format between the game and the Arrakis server. Shared by both sides, so it
// must stay free of browser and Node APIs. Messages are small JSON objects tagged by t.

export const PROTOCOL = 1
export const SEND_HZ = 10

export type NetMode = 'foot' | 'worm' | 'thopter' | 'cave'

export interface PlayerState {
  x: number
  y: number
  z: number
  yaw: number
  mode: NetMode
  // The clip the character is playing: idle, walk, jog, sprint, sneak, jump, fall, ride, drink, strike.
  anim: string
  speed: number
  hp: number
  level: number
  // Riding: the worm under you, as a coarse spine others can draw.
  worm?: { size: number; pts: number[] }
  // Flying: the ornithopter's attitude.
  fly?: { pitch: number; bank: number; wing: number }
}

// A Coriolis storm everyone shares. front is where the leading edge stood at server time at.
export interface StormEvent {
  id: number
  dirX: number
  dirZ: number
  front: number
  depth: number
  speed: number
  at: number
}

export type ClientMsg =
  | { t: 'hello'; v: number; name: string }
  | { t: 'state'; s: PlayerState }
  | { t: 'chat'; text: string }

export type ServerMsg =
  | { t: 'welcome'; id: number; cap: number; tod: number; dayLength: number; now: number; storm: StormEvent | null }
  | { t: 'full'; cap: number }
  | { t: 'roster'; players: { id: number; name: string }[] }
  | { t: 'join'; id: number; name: string }
  | { t: 'leave'; id: number }
  | { t: 'snap'; now: number; p: [number, PlayerState][] }
  | { t: 'chat'; id: number; name: string; text: string }
  | { t: 'world'; tod: number; now: number; storm: StormEvent | null }

export const MODES: readonly NetMode[] = ['foot', 'worm', 'thopter', 'cave']
export const MAX_NAME = 16
export const MAX_CHAT = 160
export const WORM_PTS = 16
