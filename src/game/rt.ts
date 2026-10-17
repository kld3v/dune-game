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
  size: number
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

export type FoeState = 'drop' | 'search' | 'investigate' | 'alert' | 'chase' | 'attack' | 'hit' | 'stunned' | 'dead'

export interface Foe {
  id: number
  pos: THREE.Vector3
  vel: THREE.Vector3
  yaw: number
  state: FoeState
  st: number
  hp: number
  shield: number
  shieldT: number
  flash: number
  suspicion: number
  home: THREE.Vector3
  waypoint: THREE.Vector3
  lastSeen: THREE.Vector3
  seenT: number
  attackCD: number
  struck: boolean
  stunFor: number
  pause: number
  speed: number
  anim: string
  animKey: number
  screenX: number
  screenY: number
  onScreen: boolean
  gone: boolean
}

export interface Carrier {
  active: boolean
  state: 'inbound' | 'drop' | 'search' | 'leave'
  st: number
  pos: THREE.Vector3
  vel: THREE.Vector3
  yaw: number
  target: THREE.Vector3
  dropped: number
  beam: THREE.Vector3
  beamOn: number
  wingPhase: number
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
  spawn: { x: 0, z: 0 },

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

  combat: {
    hp: 100,
    maxHp: 100,
    hurtT: 99,
    hurtAt: -99,
    iframes: 0,
    attacking: false,
    atkIdx: 0,
    atkT: 0,
    atkHit: false,
    atkQueued: false,
    voiceCD: 0,
    voiceAt: -99,
    lockId: 0,
  },
  foes: [] as Foe[],
  carrier: {
    active: false,
    state: 'inbound',
    st: 0,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0,
    target: new THREE.Vector3(),
    dropped: 0,
    beam: new THREE.Vector3(),
    beamOn: 0,
    wingPhase: 0,
  } as Carrier,
  nextRaid: 50,
  nextRaidPos: new THREE.Vector3(),
  foeSign: 0,
  storm: {
    active: false,
    dirX: 1,
    dirZ: 0,
    front: 0,
    depth: 420,
    speed: 17,
    t: 0,
    inside: 0,
    flowing: false,
    lightning: 0,
    nextBolt: 0,
  },
  nextStorm: 210,
  nextStormDir: 0,
  nextBlowPos: new THREE.Vector3(),
  visualTod: 0,
  flash: { t: 0, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, cooldown: 0 },
  prophecyT: 6,
  riding: { epic: 0, mountT: 99, offT: -99, offId: 0 },
  slowmo: 0,
  presT: 0,
  hitstop: 0,

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
  stats: {
    harvested: 0, rides: 0, doses: 0, deaths: 0, kills: 0, wormKills: 0,
    rideDist: 0, flowTime: 0, sandwalkDist: 0, prophecies: 0,
  },
  upgrades: { dmg: 1, voice: false },
  trial: { idx: 0, base: 0, doneT: -99 },
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
