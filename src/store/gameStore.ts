import { create } from 'zustand'
import * as THREE from 'three'

export type PlayerMode = 'foot' | 'worm' | 'ornithopter'

interface GameState {
  mode: PlayerMode
  spice: number        // 0-1
  water: number        // 0-1
  hallucinationLevel: number // 0-1, rises with spice
  wormActive: boolean
  wormPosition: THREE.Vector3
  wormDirection: number // yaw radians
  orthoPosition: THREE.Vector3
  orthoDirection: number
  thumping: boolean
  thumpProgress: number // 0-1
  isRiding: boolean
  playerPosition: THREE.Vector3
  playerYaw: number
  showControls: boolean

  setMode: (mode: PlayerMode) => void
  collectSpice: (amt: number) => void
  drinkWater: (amt: number) => void
  setThumping: (t: boolean) => void
  setThumpProgress: (p: number) => void
  activateWorm: (pos: THREE.Vector3) => void
  deactivateWorm: () => void
  setWormTransform: (pos: THREE.Vector3, dir: number) => void
  setOrthoTransform: (pos: THREE.Vector3, dir: number) => void
  setPlayerTransform: (pos: THREE.Vector3, yaw: number) => void
  tick: (dt: number) => void
  toggleControls: () => void
}

export const useGameStore = create<GameState>((set, _get) => ({
  mode: 'foot',
  spice: 0,
  water: 1,
  hallucinationLevel: 0,
  wormActive: false,
  wormPosition: new THREE.Vector3(0, 0, -40),
  wormDirection: 0,
  orthoPosition: new THREE.Vector3(20, 3, -20),
  orthoDirection: 0,
  thumping: false,
  thumpProgress: 0,
  isRiding: false,
  playerPosition: new THREE.Vector3(0, 5, 0),
  playerYaw: 0,
  showControls: true,

  setMode: (mode) => set({ mode }),
  collectSpice: (amt) => set(s => {
    const spice = Math.min(1, s.spice + amt)
    const hallucinationLevel = Math.min(1, s.hallucinationLevel + amt * 1.2)
    return { spice, hallucinationLevel }
  }),
  drinkWater: (amt) => set(s => ({ water: Math.min(1, s.water + amt) })),
  setThumping: (t) => set({ thumping: t }),
  setThumpProgress: (p) => set({ thumpProgress: p }),
  activateWorm: (pos) => set({ wormActive: true, wormPosition: pos.clone(), isRiding: true }),
  deactivateWorm: () => set({ wormActive: false, isRiding: false, mode: 'foot' }),
  setWormTransform: (pos, dir) => set({ wormPosition: pos.clone(), wormDirection: dir }),
  setOrthoTransform: (pos, dir) => set({ orthoPosition: pos.clone(), orthoDirection: dir }),
  setPlayerTransform: (pos, yaw) => set({ playerPosition: pos.clone(), playerYaw: yaw }),
  toggleControls: () => set(s => ({ showControls: !s.showControls })),

  tick: (dt) => set(s => {
    let { water, hallucinationLevel } = s
    // Thirst ticks down slowly
    water = Math.max(0, water - dt * 0.002)
    // Hallucination decays slowly
    hallucinationLevel = Math.max(0, hallucinationLevel - dt * 0.01)
    return { water, hallucinationLevel }
  }),
}))
