import * as THREE from 'three'

// Mutable per-frame game state. Nothing in here goes through React: the simulation
// writes it once per frame and render components read it inside useFrame.

export type Mode = 'foot' | 'worm' | 'thopter'
export type Phase = 'title' | 'playing' | 'paused' | 'dead'
export type WormState = 'approach' | 'breach' | 'surface' | 'dive' | 'leave' | 'ridden'
export type WormKind = 'lure' | 'hunter' | 'wild'

export const WORM_R = 6
export const WORM_L = 150
export const WORM_RINGS = 180
export const RING_DS = WORM_L / (WORM_RINGS - 1)
export const PATH_SP = 0.6
export const MAX_WORMS = 3

export interface Worm {
  id: number
  kind: WormKind
  state: WormState
  st: number
  life: number
  head: THREE.Vector3
  yaw: number
  speed: number
  path: Float32Array
  cap: number
  count: number
  end: number
  spine: Float32Array
  target: THREE.Vector3
  breachA: THREE.Vector3
  breachLen: number
  breachDur: number
  breachH: number
  mouth: number
  mouthTarget: number
  attempts: number
  resume: boolean
  lostT: number
  circleDir: number
  baseYaw: number
  surfaceAt: number
  splashUp: boolean
  splashDown: boolean
  rumble: number
  dead: boolean
}

export interface SpiceField {
  id: number
  x: number
  z: number
  radius: number
  amount: number
  capacity: number
  emitAcc: number
}

export interface Blow {
  id: number
  x: number
  z: number
  t: number
  erupted: boolean
}

export interface Env {
  sunDir: THREE.Vector3
  moonDir: THREE.Vector3
  moon2Dir: THREE.Vector3
  lightDir: THREE.Vector3
  zenith: THREE.Color
  horizon: THREE.Color
  sunCol: THREE.Color
  lightCol: THREE.Color
  lightIntensity: number
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  hemiIntensity: number
  night: number
  day: number
}

export const rt = {
  phase: 'title' as Phase,
  mode: 'foot' as Mode,
  time: 0,
  realTime: 0,
  fps: 60,
  tod: 0.64,
  dayLength: 840,
  started: false,

  player: {
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0,
    grounded: true,
    onRock: true,
    speed: 0,
    walkPhase: 0,
    stepT: 0,
    airTime: 0,
    running: false,
    sandwalk: false,
  },

  cam: {
    yaw: 0,
    pitch: -0.2,
    target: new THREE.Vector3(),
    pos: new THREE.Vector3(),
    rumble: 0,
    rumbleTarget: 0,
    impulse: 0,
    fov: 62,
    snap: true,
  },

  settings: { shake: true },

  thopter: {
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0,
    bank: 0,
    pitch: 0,
    wingPhase: 0,
    wingRate: 0,
    fold: 1,
    landed: true,
    alive: true,
    autopilot: false,
    thrust: 0,
    boost: false,
  },

  worms: [] as Worm[],
  ridden: null as Worm | null,
  riderS: 16,
  pendingWorms: [] as { at: number; kind: WormKind; target: THREE.Vector3 }[],
  nextTitleWorm: 3,

  thumper: { active: false, pos: new THREE.Vector3(), t: 0, beat: 0, called: false, phase: 0 },

  spice: 30,
  melange: 0,
  trip: 0,
  wormsign: 0,
  hunted: false,
  threat: 0,
  threatBearing: 0,

  fields: [] as SpiceField[],
  blows: [] as Blow[],
  nextBlow: 40,
  harvesting: false,

  eye: 0,
  eyeDir: new THREE.Vector3(0, 0.38, 1).normalize(),
  path: { on: 0, ax: 0, az: 0, bx: 0, bz: 1 },
  visionT: 4,
  heartT: 0,
  pickupT: 0,
  doseAt: -99,

  prompt: '',
  deathReason: '',
  hintStep: 0,
  hintT: 2,
  stats: { harvested: 0, rides: 0, doses: 0, deaths: 0 },
  nextId: 1,

  env: {
    sunDir: new THREE.Vector3(0, 1, 0),
    moonDir: new THREE.Vector3(0, 1, 0),
    moon2Dir: new THREE.Vector3(0, 1, 0),
    lightDir: new THREE.Vector3(0, 1, 0),
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    sunCol: new THREE.Color(),
    lightCol: new THREE.Color(),
    lightIntensity: 1,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 1,
    night: 0,
    day: 1,
  } as Env,
}

export type RT = typeof rt
