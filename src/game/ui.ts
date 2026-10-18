import { create } from 'zustand'
import { rt, type Mode, type Phase } from './rt'

// React-facing state only: things that change a few times a minute. Meters and the
// compass are written straight to the DOM by the HUD's own animation loop.

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'warn' | 'spice'
}

export interface Vision {
  id: number
  text: string
  x: number
  y: number
  size: number
}

export interface DialogueOption {
  label: string
  enabled: boolean
  note?: string
}

export interface Dialogue {
  title: string
  subtitle: string
  line: string
  options: DialogueOption[]
}

interface UIState {
  phase: Phase
  mode: Mode
  prompt: string
  toasts: Toast[]
  visions: Vision[]
  muted: boolean
  shake: boolean
  deathReason: string
  voiceAt: number
  prophecy: { id: number; text: string } | null
  dialogue: Dialogue | null
  net: { status: string; count: number; cap: number }
  chat: { id: number; name: string; text: string; at: number }[]
  chatOpen: boolean
}

export const useUI = create<UIState>(() => ({
  phase: 'title',
  mode: 'foot',
  prompt: '',
  toasts: [],
  visions: [],
  muted: false,
  shake: true,
  deathReason: '',
  voiceAt: 0,
  prophecy: null,
  dialogue: null,
  net: { status: 'off', count: 0, cap: 20 },
  chat: [],
  chatOpen: false,
}))

// A prophecy is a vision that matters: shown centred and long enough to read.
export function prophecy(text: string) {
  const id = nextId++
  useUI.setState({ prophecy: { id, text } })
  window.setTimeout(() => {
    if (useUI.getState().prophecy?.id === id) useUI.setState({ prophecy: null })
  }, 7000)
}

export function voiceFlash() {
  useUI.setState({ voiceAt: Date.now() })
}

let nextId = 1

export function toast(text: string, kind: Toast['kind'] = 'info', ms = 4200) {
  const id = nextId++
  useUI.setState((s) => ({ toasts: [...s.toasts.filter((t) => t.text !== text).slice(-2), { id, text, kind }] }))
  window.setTimeout(() => useUI.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms)
}

export function vision(text: string) {
  const id = nextId++
  const v: Vision = {
    id,
    text,
    x: 12 + Math.random() * 76,
    y: 18 + Math.random() * 58,
    size: 0.9 + Math.random() * 1.1,
  }
  useUI.setState((s) => ({ visions: [...s.visions.slice(-3), v] }))
  window.setTimeout(() => useUI.setState((s) => ({ visions: s.visions.filter((x) => x.id !== id) })), 6200)
}

export function syncUI() {
  const s = useUI.getState()
  if (s.phase !== rt.phase || s.mode !== rt.mode || s.prompt !== rt.prompt || s.deathReason !== rt.deathReason) {
    useUI.setState({ phase: rt.phase, mode: rt.mode, prompt: rt.prompt, deathReason: rt.deathReason })
  }
}
