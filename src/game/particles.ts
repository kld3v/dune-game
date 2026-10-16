import { rt } from './rt'

// Fire-and-forget GPU particles. Each particle stores its birth state once; the vertex
// shader integrates its motion from game time, so the CPU never touches it again.
export class ParticlePool {
  readonly cap: number
  head = 0
  readonly start: Float32Array
  readonly vel: Float32Array
  readonly info: Float32Array // birth, life, size, drag
  readonly color: Float32Array // rgb, gravity scale
  dirtyMin = Infinity
  dirtyMax = -1

  constructor(cap: number) {
    this.cap = cap
    this.start = new Float32Array(cap * 3)
    this.vel = new Float32Array(cap * 3)
    this.info = new Float32Array(cap * 4)
    this.color = new Float32Array(cap * 4)
  }

  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size: number,
    r: number, g: number, b: number,
    grav = 1, drag = 0,
  ) {
    const i = this.head
    this.head = (i + 1) % this.cap
    const i3 = i * 3
    const i4 = i * 4
    this.start[i3] = x
    this.start[i3 + 1] = y
    this.start[i3 + 2] = z
    this.vel[i3] = vx
    this.vel[i3 + 1] = vy
    this.vel[i3 + 2] = vz
    this.info[i4] = rt.time
    this.info[i4 + 1] = life
    this.info[i4 + 2] = size
    this.info[i4 + 3] = drag
    this.color[i4] = r
    this.color[i4 + 1] = g
    this.color[i4 + 2] = b
    this.color[i4 + 3] = grav
    if (i < this.dirtyMin) this.dirtyMin = i
    if (i > this.dirtyMax) this.dirtyMax = i
  }
}

export const dust = new ParticlePool(16000)
export const glow = new ParticlePool(10000)
