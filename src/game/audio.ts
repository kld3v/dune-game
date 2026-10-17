import { clamp, rand } from './math'

// Every sound is synthesised: no asset files. Continuous layers (wind, worm rumble,
// ornithopter, spice drone) run from start and are faded by update(); one-shots build
// a tiny node graph each time and let it be garbage collected when it stops.

interface Levels {
  wind: number
  rumble: number
  grind: number
  thop: number
  thopRate: number
  thopPitch: number
  thopPan: number
  trip: number
  carrier: number
  carrierPan: number
}

class AudioEngine {
  ctx: AudioContext | null = null
  muted = false
  private master!: GainNode
  private verb!: ConvolverNode
  private white!: AudioBuffer
  private brown!: AudioBuffer
  private wind!: { g: GainNode; hiss: GainNode }
  private rumble!: { g: GainNode; sub: GainNode; grind: GainNode }
  private thop!: { g: GainNode; lfo: OscillatorNode; osc: OscillatorNode; pan: StereoPannerNode }
  private drone!: { g: GainNode; f: BiquadFilterNode; shimmer: GainNode }
  private carrier!: { g: GainNode; pan: StereoPannerNode }

  init() {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const ctx = new AudioContext()
    this.ctx = ctx
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.knee.value = 12
    comp.ratio.value = 4
    comp.attack.value = 0.005
    comp.release.value = 0.25
    comp.connect(ctx.destination)
    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.85
    this.master.connect(comp)
    this.verb = ctx.createConvolver()
    this.verb.buffer = this.makeIR(3.4)
    const verbOut = ctx.createGain()
    verbOut.gain.value = 0.5
    this.verb.connect(verbOut)
    verbOut.connect(this.master)
    this.white = this.makeNoise(false)
    this.brown = this.makeNoise(true)
    this.buildWind()
    this.buildRumble()
    this.buildThopter()
    this.buildDrone()
    this.buildCarrier()
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05)
  }

  update(p: Levels) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    this.wind.g.gain.setTargetAtTime(p.wind * 0.15, t, 0.4)
    this.wind.hiss.gain.setTargetAtTime(p.wind * 0.018, t, 0.4)
    this.rumble.g.gain.setTargetAtTime(p.rumble * 1.1, t, 0.15)
    this.rumble.sub.gain.setTargetAtTime(p.rumble * 0.5, t, 0.15)
    this.rumble.grind.gain.setTargetAtTime(p.grind * 0.1, t, 0.15)
    this.thop.g.gain.setTargetAtTime(p.thop * 0.2, t, 0.12)
    this.thop.lfo.frequency.setTargetAtTime(Math.max(0.5, p.thopRate), t, 0.15)
    this.thop.osc.frequency.setTargetAtTime(p.thopPitch, t, 0.15)
    this.thop.pan.pan.setTargetAtTime(clamp(p.thopPan, -1, 1), t, 0.05)
    this.drone.g.gain.setTargetAtTime(Math.pow(p.trip, 1.4) * 0.2, t, 0.6)
    this.drone.f.frequency.setTargetAtTime(220 + p.trip * 900, t, 0.8)
    this.drone.shimmer.gain.setTargetAtTime(Math.max(0, p.trip - 0.45) * 0.07, t, 0.8)
    this.carrier.g.gain.setTargetAtTime(p.carrier * 0.3, t, 0.3)
    this.carrier.pan.pan.setTargetAtTime(clamp(p.carrierPan, -1, 1), t, 0.1)
  }

  // ---------- combat ----------

  swing(heavy: boolean, pan = 0, vol = 1) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const out = this.dest(pan, 0.15)
    const dur = heavy ? 0.3 : 0.18
    const n = this.noiseSrc(this.white, t, dur + 0.05)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 2.5
    bp.frequency.setValueAtTime(heavy ? 400 : 700, t)
    bp.frequency.exponentialRampToValueAtTime(heavy ? 1600 : 2600, t + dur)
    const g = ctx.createGain()
    this.env(g.gain, t, (heavy ? 0.3 : 0.22) * vol, dur * 0.6, dur * 0.5)
    n.connect(bp).connect(g).connect(out)
  }

  hit(pan: number) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const out = this.dest(pan, 0.1)
    this.tone(t, 'sine', 140, 55, 0.12, 0.5, 0.003, 0.14, out)
    this.noiseBurst(t, 0.12, 'lowpass', 900, 0.8, 0.35, 0.002, 0.09, out)
  }

  shieldHit(pan: number) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const out = this.dest(pan, 0.3)
    this.tone(t, 'sine', 1500, 700, 0.1, 0.12, 0.002, 0.12, out)
    this.tone(t, 'square', 220, 180, 0.18, 0.05, 0.004, 0.18, out, 1200)
    this.noiseBurst(t, 0.1, 'bandpass', 3200, 4, 0.22, 0.001, 0.08, out)
  }

  shieldBreak(pan: number) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const out = this.dest(pan, 0.4)
    this.tone(t, 'sawtooth', 900, 120, 0.35, 0.16, 0.003, 0.4, out, 3000)
    this.noiseBurst(t, 0.45, 'highpass', 2000, 0.7, 0.2, 0.002, 0.4, out)
  }

  hurt() {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const out = this.dest(0, 0.1)
    this.tone(t, 'sine', 90, 50, 0.2, 0.6, 0.004, 0.22, out, 300)
    this.noiseBurst(t, 0.18, 'bandpass', 520, 1, 0.3, 0.004, 0.14, out)
  }

  // A harsh shout pushed through two vowel formants.
  yell(pan: number, vol = 1, low = false) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const out = this.dest(pan, 0.35)
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(low ? 125 : 165, t)
    o.frequency.exponentialRampToValueAtTime(low ? 70 : 118, t + 0.5)
    const g = ctx.createGain()
    this.env(g.gain, t, 0.22 * vol, 0.03, 0.5)
    for (const [f, q] of [[720, 6], [1150, 7]]) {
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = f
      bp.Q.value = q
      o.connect(bp).connect(g)
    }
    g.connect(out)
    o.start(t)
    o.stop(t + 0.6)
  }

  foeDeath(pan: number) {
    this.yell(pan, 0.8, true)
    this.hit(pan)
  }

  // The Voice: a doubled command an octave apart, a sub drop and a long tail. If the
  // browser has a speech voice, it says the word underneath.
  voice() {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const out = this.dest(0, 1.2)
    for (const f0 of [82, 41]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(f0 * 1.15, t)
      o.frequency.exponentialRampToValueAtTime(f0, t + 0.9)
      const g = ctx.createGain()
      this.env(g.gain, t, f0 > 50 ? 0.28 : 0.22, 0.04, 1.1)
      const f1 = ctx.createBiquadFilter()
      f1.type = 'bandpass'
      f1.Q.value = 6
      f1.frequency.setValueAtTime(300, t)
      f1.frequency.linearRampToValueAtTime(270, t + 0.4)
      f1.frequency.linearRampToValueAtTime(380, t + 1.0)
      const f2 = ctx.createBiquadFilter()
      f2.type = 'bandpass'
      f2.Q.value = 8
      f2.frequency.setValueAtTime(1500, t)
      f2.frequency.linearRampToValueAtTime(2290, t + 0.35)
      f2.frequency.linearRampToValueAtTime(1150, t + 1.0)
      o.connect(f1).connect(g)
      o.connect(f2).connect(g)
      g.connect(out)
      o.start(t)
      o.stop(t + 1.3)
    }
    this.tone(t, 'sine', 48, 28, 1.6, 0.9, 0.02, 1.8, out)
    try {
      const u = new SpeechSynthesisUtterance('Kneel')
      u.pitch = 0.1
      u.rate = 0.7
      u.volume = 1
      speechSynthesis.speak(u)
    } catch {
      // no speech voices on this system; the synth layer carries it
    }
  }

  thunder(vol: number) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const out = this.dest(rand(-0.6, 0.6), 0.8)
    this.noiseBurst(t, 0.12, 'highpass', 1500, 0.7, 0.4 * vol, 0.002, 0.1, out)
    const n = this.noiseSrc(this.brown, t, 3.5)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(900, t)
    lp.frequency.exponentialRampToValueAtTime(120, t + 3)
    const g = ctx.createGain()
    this.env(g.gain, t + 0.05, 1.3 * vol, 0.15, 3)
    n.connect(lp).connect(g).connect(out)
  }

  // ---------- the riding score ----------
  // A small lookahead sequencer: war drums, a D drone, brass swells and a vocal lead in
  // D Hijaz, all synthesised. intensity 0..1 follows the worm's speed.

  private music: {
    on: boolean
    timer: number
    step: number
    next: number
    bus: GainNode
    drone: GainNode
    droneF: BiquadFilterNode
    lead: { o: OscillatorNode; g: GainNode; vib: GainNode } | null
    intensity: number
    started: number
  } | null = null

  musicStart() {
    const ctx = this.ctx
    if (!ctx) return
    if (this.music?.on) return
    if (!this.music) {
      const bus = ctx.createGain()
      bus.gain.value = 0
      bus.connect(this.master)
      const send = ctx.createGain()
      send.gain.value = 0.35
      bus.connect(send).connect(this.verb)
      const droneF = ctx.createBiquadFilter()
      droneF.type = 'lowpass'
      droneF.frequency.value = 220
      droneF.Q.value = 1.2
      const drone = ctx.createGain()
      drone.gain.value = 0
      for (const [f, ty, gv] of [[36.71, 'sawtooth', 0.3], [73.42, 'sawtooth', 0.22], [55, 'sawtooth', 0.14], [36.9, 'sine', 0.4]] as const) {
        const o = ctx.createOscillator()
        o.type = ty
        o.frequency.value = f
        const og = ctx.createGain()
        og.gain.value = gv
        o.connect(og).connect(droneF)
        o.start()
      }
      droneF.connect(drone).connect(bus)
      this.music = { on: false, timer: 0, step: 0, next: 0, bus, drone, droneF, lead: null, intensity: 0, started: 0 }
    }
    const m = this.music
    m.on = true
    m.step = 0
    m.next = ctx.currentTime + 0.1
    m.started = ctx.currentTime
    m.bus.gain.cancelScheduledValues(ctx.currentTime)
    m.bus.gain.setTargetAtTime(0.9, ctx.currentTime, 0.8)
    m.drone.gain.setTargetAtTime(0.5, ctx.currentTime, 1.5)
    window.clearInterval(m.timer)
    m.timer = window.setInterval(() => this.schedule(), 25)
  }

  musicStop() {
    const m = this.music
    const ctx = this.ctx
    if (!m || !ctx || !m.on) return
    m.on = false
    m.bus.gain.setTargetAtTime(0, ctx.currentTime, 1.2)
    m.drone.gain.setTargetAtTime(0, ctx.currentTime, 1.2)
    window.setTimeout(() => {
      if (!m.on) window.clearInterval(m.timer)
    }, 4000)
  }

  musicIntensity(v: number) {
    if (!this.music || !this.ctx) return
    this.music.intensity = clamp(v, 0, 1)
    this.music.droneF.frequency.setTargetAtTime(160 + v * 700, this.ctx.currentTime, 0.6)
  }

  private schedule() {
    const ctx = this.ctx
    const m = this.music
    if (!ctx || !m || !m.on) return
    const sixteenth = 60 / 96 / 4
    while (m.next < ctx.currentTime + 0.15) {
      this.playStep(m.step, m.next, sixteenth)
      m.next += sixteenth
      m.step++
    }
  }

  private playStep(step: number, t: number, s16: number) {
    const m = this.music!
    const I = m.intensity
    const bar = Math.floor(step / 16)
    const k = step % 16
    const build = Math.min(1, bar / 2)
    // Taiko pattern: the big drum on a syncopated figure, toms filling in as it builds.
    if ([0, 6, 8, 11, 14].includes(k)) this.taiko(t, k === 0 ? 1 : 0.7, 1)
    if (build > 0.5 && [3, 4, 10, 12, 15].includes(k)) this.taiko(t, 0.35 + I * 0.25, 1.7)
    if (I > 0.55 && k % 2 === 0) this.frameDrum(t, k % 4 === 0 ? 0.5 : 0.25)
    if (k === 0 && bar % 2 === 0 && bar > 0) this.brass(t, s16 * 28, 0.35 + I * 0.5)
    if (bar >= 2 && k === 0) this.leadPhrase(t, bar, s16)
  }

  private taiko(t: number, vel: number, pitch: number) {
    const ctx = this.ctx!
    const out = this.music!.bus
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(82 * pitch, t)
    o.frequency.exponentialRampToValueAtTime(40 * pitch, t + 0.28)
    const g = ctx.createGain()
    this.env(g.gain, t, 0.9 * vel, 0.004, 0.55)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(t + 0.7)
    const n = this.noiseSrc(this.white, t, 0.12)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 700 * pitch
    const ng = ctx.createGain()
    this.env(ng.gain, t, 0.35 * vel, 0.002, 0.08)
    n.connect(lp).connect(ng).connect(out)
  }

  private frameDrum(t: number, vel: number) {
    const ctx = this.ctx!
    const n = this.noiseSrc(this.white, t, 0.08)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2400
    bp.Q.value = 1.4
    const g = ctx.createGain()
    this.env(g.gain, t, 0.12 * vel, 0.002, 0.06)
    n.connect(bp).connect(g).connect(this.music!.bus)
  }

  private brass(t: number, dur: number, vel: number) {
    const ctx = this.ctx!
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.Q.value = 2
    lp.frequency.setValueAtTime(200, t)
    lp.frequency.linearRampToValueAtTime(1400 * vel + 300, t + dur * 0.45)
    lp.frequency.linearRampToValueAtTime(260, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.11 * vel, t + dur * 0.4)
    g.gain.linearRampToValueAtTime(0.0001, t + dur)
    lp.connect(g).connect(this.music!.bus)
    for (const f of [73.42, 110, 146.83, 220]) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = f
        o.detune.value = det
        o.connect(lp)
        o.start(t)
        o.stop(t + dur + 0.1)
      }
    }
  }

  // D Hijaz: D Eb F# G A Bb C. Each phrase is [semitones above D4, length in 16ths].
  private static PHRASES: [number, number][][] = [
    [[0, 8], [1, 2], [4, 6], [5, 4], [4, 2], [1, 2], [0, 8], [-2, 4], [0, 12]],
    [[7, 8], [5, 2], [4, 2], [5, 4], [8, 6], [7, 2], [5, 4], [4, 4], [1, 4], [0, 12]],
    [[12, 6], [10, 2], [8, 4], [7, 8], [8, 2], [7, 2], [5, 4], [4, 8], [1, 4], [0, 8]],
  ]

  private leadPhrase(t: number, bar: number, s16: number) {
    const m = this.music!
    if (m.intensity < 0.25 || bar % 4 !== 2) return
    const ctx = this.ctx!
    const phrase = AudioEngine.PHRASES[Math.floor(bar / 4) % AudioEngine.PHRASES.length]
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    const vib = ctx.createOscillator()
    vib.frequency.value = 5.6
    const vibG = ctx.createGain()
    vibG.gain.value = 0
    vib.connect(vibG).connect(o.detune)
    const g = ctx.createGain()
    g.gain.value = 0
    const f1 = ctx.createBiquadFilter()
    f1.type = 'bandpass'
    f1.frequency.value = 780
    f1.Q.value = 5
    const f2 = ctx.createBiquadFilter()
    f2.type = 'bandpass'
    f2.frequency.value = 1180
    f2.Q.value = 6
    o.connect(f1).connect(g)
    o.connect(f2).connect(g)
    const send = ctx.createGain()
    send.gain.value = 0.7
    g.connect(m.bus)
    g.connect(send).connect(this.verb)
    let at = t
    const base = 293.66
    o.frequency.setValueAtTime(base * Math.pow(2, phrase[0][0] / 12), t)
    for (const [semi, len] of phrase) {
      const f = base * Math.pow(2, semi / 12)
      o.frequency.setTargetAtTime(f, at, 0.04)
      const d = len * s16
      g.gain.setTargetAtTime(0.16 * (0.6 + m.intensity * 0.4), at, 0.06)
      // Long notes bloom into a wide, ululating vibrato.
      vibG.gain.setValueAtTime(4, at)
      if (d > 0.5) vibG.gain.linearRampToValueAtTime(38, at + d * 0.9)
      at += d
    }
    g.gain.setTargetAtTime(0, at, 0.25)
    o.start(t)
    vib.start(t)
    o.stop(at + 1.5)
    vib.stop(at + 1.5)
  }

  prescience() {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const out = this.dest(0, 0.9)
    const n = this.noiseSrc(this.white, t, 0.9)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.Q.value = 3
    lp.frequency.setValueAtTime(3200, t)
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.6)
    const g = ctx.createGain()
    this.env(g.gain, t, 0.22, 0.12, 0.6)
    n.connect(lp).connect(g).connect(out)
    this.tone(t, 'sine', 70, 52, 0.8, 0.35, 0.1, 0.8, out)
  }

  // ---------- one-shots ----------

  thump(vol: number, pan: number) {
    const ctx = this.ctx
    if (!ctx || vol < 0.01) return
    const t = ctx.currentTime
    const out = this.dest(pan, 0.25)
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(130, t)
    o.frequency.exponentialRampToValueAtTime(40, t + 0.2)
    const g = ctx.createGain()
    this.env(g.gain, t, vol * 0.9, 0.006, 0.42)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(t + 0.5)
    this.noiseBurst(t, 0.08, 'bandpass', 700, 1.4, vol * 0.35, 0.002, 0.07, out)
  }

  breach(vol: number, pan: number) {
    const ctx = this.ctx
    if (!ctx || vol < 0.01) return
    const t = ctx.currentTime
    const out = this.dest(pan, 0.55)
    const n = this.noiseSrc(this.brown, t, 4.2)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.Q.value = 3
    lp.frequency.setValueAtTime(140, t)
    lp.frequency.exponentialRampToValueAtTime(950, t + 1.1)
    lp.frequency.exponentialRampToValueAtTime(130, t + 3.8)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol * 1.6, t + 0.7)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4)
    n.connect(lp).connect(g).connect(out)
    this.tone(t, 'sine', 58, 26, 3.2, vol * 0.8, 0.4, 3, out)
    this.tone(t, 'sawtooth', 46, 38, 2.6, vol * 0.18, 0.5, 2.2, out, 300)
    this.noiseBurst(t, 2.6, 'bandpass', 1900, 0.7, vol * 0.25, 0.3, 2.1, out)
  }

  crash(vol: number, pan: number) {
    const ctx = this.ctx
    if (!ctx || vol < 0.01) return
    const t = ctx.currentTime
    const out = this.dest(pan, 0.45)
    this.noiseBurst(t, 1.9, 'lowpass', 2200, 0.7, vol * 0.9, 0.01, 1.6, out)
    this.tone(t, 'sine', 75, 32, 0.9, vol * 0.9, 0.01, 0.9, out)
  }

  crunch(vol: number, pan: number) {
    const ctx = this.ctx
    if (!ctx || vol < 0.01) return
    const t = ctx.currentTime
    const out = this.dest(pan, 0.3)
    for (const f of [400, 610, 970]) this.tone(t, 'square', f, f * 0.7, 0.3, vol * 0.05, 0.002, 0.25, out, 2400)
    this.noiseBurst(t, 0.2, 'bandpass', 3000, 1, vol * 0.4, 0.002, 0.15, out)
  }

  step(vol: number, rock: boolean) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const out = this.dest(rand(-0.15, 0.15), 0.05)
    if (rock) this.noiseBurst(t, 0.1, 'bandpass', 2600, 2.5, vol * 0.5, 0.003, 0.05, out)
    else this.noiseBurst(t, 0.16, 'bandpass', rand(900, 1300), 0.8, vol * 0.35, 0.006, 0.11, out)
  }

  pickup() {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const notes = [1046.5, 1174.7, 1318.5, 1568, 1760, 2093]
    const out = this.dest(rand(-0.4, 0.4), 0.7)
    for (let i = 0; i < 2; i++) {
      const f = notes[Math.floor(Math.random() * notes.length)]
      this.tone(t + i * 0.06, 'sine', f, f, 0.6, 0.035, 0.005, 0.5, out)
    }
  }

  consume() {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const out = this.dest(0, 0.8)
    const n = this.noiseSrc(this.white, t, 1.7)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 4
    bp.frequency.setValueAtTime(250, t)
    bp.frequency.exponentialRampToValueAtTime(3800, t + 1.3)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.45, t + 1.1)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5)
    n.connect(bp).connect(g).connect(out)
    this.tone(t + 1.2, 'sine', 62, 28, 1.8, 0.9, 0.02, 1.8, out)
    for (const f of [660, 990, 1485]) {
      const o = ctx.createOscillator()
      o.frequency.value = f
      const sg = ctx.createGain()
      sg.gain.setValueAtTime(0, t)
      sg.gain.linearRampToValueAtTime(0.045, t + 1.2)
      sg.gain.linearRampToValueAtTime(0, t + 3.2)
      o.connect(sg).connect(out)
      o.start(t)
      o.stop(t + 3.3)
    }
  }

  whisper(pan: number, vol = 1) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const dur = rand(1.4, 2.4)
    const out = this.dest(pan, 0.9)
    const n = this.noiseSrc(this.white, t, dur)
    const f1 = ctx.createBiquadFilter()
    f1.type = 'bandpass'
    f1.Q.value = 9
    f1.frequency.setValueCurveAtTime(Float32Array.from({ length: 8 }, () => rand(700, 2600)), t, dur)
    const f2 = ctx.createBiquadFilter()
    f2.type = 'bandpass'
    f2.Q.value = 12
    f2.frequency.setValueCurveAtTime(Float32Array.from({ length: 8 }, () => rand(1800, 3800)), t, dur)
    const g = ctx.createGain()
    const envCurve = Float32Array.from({ length: 24 }, (_, i) =>
      i === 0 || i === 23 || i % 3 === 0 ? 0 : rand(0.3, 1) * 0.3 * vol)
    g.gain.setValueCurveAtTime(envCurve, t, dur)
    n.connect(f1).connect(g)
    n.connect(f2).connect(g)
    g.connect(out)
  }

  heartbeat(intensity: number) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const out = this.dest(0, 0.1)
    this.tone(t, 'sine', 54, 44, 0.2, 0.45 * intensity, 0.01, 0.17, out, 160)
    this.tone(t + 0.27, 'sine', 48, 40, 0.2, 0.32 * intensity, 0.01, 0.15, out, 160)
  }

  eaten() {
    this.breach(1.1, 0)
    this.crash(1, 0)
  }

  blow(vol: number, pan: number) {
    const ctx = this.ctx
    if (!ctx || vol < 0.01) return
    const t = ctx.currentTime
    const out = this.dest(pan, 0.6)
    this.tone(t, 'sine', 48, 22, 3, vol * 1.2, 0.05, 3.2, out)
    const n = this.noiseSrc(this.brown, t, 4.5)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(300, t)
    lp.frequency.exponentialRampToValueAtTime(1500, t + 0.6)
    lp.frequency.exponentialRampToValueAtTime(200, t + 4.2)
    const g = ctx.createGain()
    this.env(g.gain, t, vol * 1.4, 0.2, 4)
    n.connect(lp).connect(g).connect(out)
    this.noiseBurst(t, 3.6, 'highpass', 2500, 0.7, vol * 0.18, 0.5, 3, out)
  }

  hook() {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const out = this.dest(0, 0.5)
    for (const f of [523, 785, 1187]) this.tone(t, 'sine', f, f, 0.8, 0.06, 0.002, 0.7, out)
    this.noiseBurst(t, 0.05, 'bandpass', 3000, 1.5, 0.2, 0.001, 0.04, out)
  }

  board() {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const out = this.dest(0, 0.2)
    const n = this.noiseSrc(this.white, t, 0.5)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 2
    bp.frequency.setValueAtTime(500, t)
    bp.frequency.exponentialRampToValueAtTime(1600, t + 0.35)
    const g = ctx.createGain()
    this.env(g.gain, t, 0.15, 0.05, 0.35)
    n.connect(bp).connect(g).connect(out)
  }

  blip() {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    this.tone(t, 'sine', 740, 990, 0.1, 0.035, 0.005, 0.08, this.dest(0, 0.2))
  }

  // ---------- building blocks ----------

  private dest(pan: number, verb: number): AudioNode {
    const ctx = this.ctx!
    const p = ctx.createStereoPanner()
    p.pan.value = clamp(pan, -1, 1)
    p.connect(this.master)
    if (verb > 0) {
      const s = ctx.createGain()
      s.gain.value = verb
      p.connect(s)
      s.connect(this.verb)
    }
    return p
  }

  private env(param: AudioParam, t: number, peak: number, attack: number, decay: number) {
    param.setValueAtTime(0.0001, t)
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack)
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  }

  private tone(
    t: number, type: OscillatorType, f0: number, f1: number, glide: number,
    peak: number, attack: number, decay: number, out: AudioNode, lowpass = 0,
  ) {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide)
    const g = ctx.createGain()
    this.env(g.gain, t, peak, attack, decay)
    if (lowpass > 0) {
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = lowpass
      o.connect(lp).connect(g)
    } else {
      o.connect(g)
    }
    g.connect(out)
    o.start(t)
    o.stop(t + attack + decay + 0.05)
  }

  private noiseSrc(buf: AudioBuffer, t: number, dur: number) {
    const s = this.ctx!.createBufferSource()
    s.buffer = buf
    s.start(t, Math.random() * Math.max(0, buf.duration - dur - 0.05))
    s.stop(t + dur)
    return s
  }

  private noiseBurst(
    t: number, dur: number, type: BiquadFilterType, freq: number, q: number,
    peak: number, attack: number, decay: number, out: AudioNode,
  ) {
    const ctx = this.ctx!
    const n = this.noiseSrc(this.white, t, dur)
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = ctx.createGain()
    this.env(g.gain, t, peak, attack, decay)
    n.connect(f).connect(g).connect(out)
  }

  private loopSrc(buf: AudioBuffer) {
    const s = this.ctx!.createBufferSource()
    s.buffer = buf
    s.loop = true
    s.start(this.ctx!.currentTime, Math.random() * buf.duration)
    return s
  }

  private makeNoise(brown: boolean): AudioBuffer {
    const ctx = this.ctx!
    const len = ctx.sampleRate * 3
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      if (brown) {
        last = (last + 0.02 * w) / 1.02
        d[i] = last * 3.5
      } else {
        d[i] = w
      }
    }
    return buf
  }

  private makeIR(sec: number): AudioBuffer {
    const ctx = this.ctx!
    const len = Math.floor(ctx.sampleRate * sec)
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6)
    }
    return buf
  }

  private buildWind() {
    const ctx = this.ctx!
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 420
    f.Q.value = 0.5
    const g = ctx.createGain()
    g.gain.value = 0
    this.loopSrc(this.brown).connect(f).connect(g).connect(this.master)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.09
    const lfoG = ctx.createGain()
    lfoG.gain.value = 0.04
    lfo.connect(lfoG).connect(g.gain)
    lfo.start()
    const lfo2 = ctx.createOscillator()
    lfo2.frequency.value = 0.053
    const lfo2G = ctx.createGain()
    lfo2G.gain.value = 180
    lfo2.connect(lfo2G).connect(f.frequency)
    lfo2.start()
    const hf = ctx.createBiquadFilter()
    hf.type = 'highpass'
    hf.frequency.value = 5200
    const hiss = ctx.createGain()
    hiss.gain.value = 0
    this.loopSrc(this.white).connect(hf).connect(hiss).connect(this.master)
    this.wind = { g, hiss }
  }

  private buildRumble() {
    const ctx = this.ctx!
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 120
    lp.Q.value = 0.8
    const g = ctx.createGain()
    g.gain.value = 0
    this.loopSrc(this.brown).connect(lp).connect(g).connect(this.master)
    const o = ctx.createOscillator()
    o.frequency.value = 33
    const sub = ctx.createGain()
    sub.gain.value = 0
    o.connect(sub).connect(this.master)
    o.start()
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 300
    bp.Q.value = 0.6
    const grind = ctx.createGain()
    grind.gain.value = 0
    this.loopSrc(this.white).connect(bp).connect(grind).connect(this.master)
    this.rumble = { g, sub, grind }
  }

  private buildThopter() {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = 52
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 700
    lp.Q.value = 1.5
    const oscG = ctx.createGain()
    oscG.gain.value = 0.35
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 380
    bp.Q.value = 1.1
    const nG = ctx.createGain()
    nG.gain.value = 0.9
    const am = ctx.createGain()
    am.gain.value = 0.5
    const lfo = ctx.createOscillator()
    lfo.type = 'triangle'
    lfo.frequency.value = 12
    const lfoG = ctx.createGain()
    lfoG.gain.value = 0.5
    lfo.connect(lfoG).connect(am.gain)
    osc.connect(lp).connect(oscG).connect(am)
    this.loopSrc(this.white).connect(bp).connect(nG).connect(am)
    const pan = ctx.createStereoPanner()
    const g = ctx.createGain()
    g.gain.value = 0
    am.connect(pan).connect(g).connect(this.master)
    osc.start()
    lfo.start()
    this.thop = { g, lfo, osc, pan }
  }

  private buildCarrier() {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = 38
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 260
    const am = ctx.createGain()
    am.gain.value = 0.5
    const lfo = ctx.createOscillator()
    lfo.type = 'triangle'
    lfo.frequency.value = 8
    const lfoG = ctx.createGain()
    lfoG.gain.value = 0.45
    lfo.connect(lfoG).connect(am.gain)
    o.connect(lp).connect(am)
    this.loopSrc(this.brown).connect(lp)
    const pan = ctx.createStereoPanner()
    const g = ctx.createGain()
    g.gain.value = 0
    am.connect(pan).connect(g).connect(this.master)
    o.start()
    lfo.start()
    this.carrier = { g, pan }
  }

  private buildDrone() {
    const ctx = this.ctx!
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 300
    f.Q.value = 0.7
    const freqs = [55, 55.25, 82.41, 110.3, 164.8]
    const types: OscillatorType[] = ['sawtooth', 'sawtooth', 'sawtooth', 'triangle', 'sine']
    freqs.forEach((fr, i) => {
      const o = ctx.createOscillator()
      o.type = types[i]
      o.frequency.value = fr
      const og = ctx.createGain()
      og.gain.value = 0.16
      o.connect(og).connect(f)
      o.start()
    })
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07
    const lfoG = ctx.createGain()
    lfoG.gain.value = 160
    lfo.connect(lfoG).connect(f.frequency)
    lfo.start()
    const form = ctx.createBiquadFilter()
    form.type = 'bandpass'
    form.frequency.value = 560
    form.Q.value = 3
    const formG = ctx.createGain()
    formG.gain.value = 0.9
    const g = ctx.createGain()
    g.gain.value = 0
    f.connect(g)
    f.connect(form).connect(formG).connect(g)
    g.connect(this.master)
    const send = ctx.createGain()
    send.gain.value = 0.6
    g.connect(send).connect(this.verb)

    const shimmer = ctx.createGain()
    shimmer.gain.value = 0
    const trem = ctx.createGain()
    trem.gain.value = 0.5
    const tl = ctx.createOscillator()
    tl.frequency.value = 5.3
    const tlG = ctx.createGain()
    tlG.gain.value = 0.5
    tl.connect(tlG).connect(trem.gain)
    tl.start()
    for (const fr of [880, 1318.5]) {
      const o = ctx.createOscillator()
      o.frequency.value = fr
      o.connect(trem)
      o.start()
    }
    trem.connect(shimmer)
    shimmer.connect(this.master)
    shimmer.connect(this.verb)
    this.drone = { g, f, shimmer }
  }
}

export const audio = new AudioEngine()
