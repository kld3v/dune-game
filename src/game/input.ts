import { clamp } from './math'

// One input manager for the whole game. Keys are tracked as held (down) and as
// edge-triggered presses that last exactly one simulation frame.

export const input = {
  down: new Set<string>(),
  pressed: new Set<string>(),
  mdx: 0,
  mdy: 0,
  locked: false,
  dragging: false,
}

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'])
let canvasEl: HTMLElement | null = null
let ignoreUntil = 0

export function initInput(canvas: HTMLElement, hooks: { onUnlock: () => void; onEscape: () => void }) {
  if (canvasEl) return
  canvasEl = canvas

  window.addEventListener('keydown', (e) => {
    if (PREVENT.has(e.code)) e.preventDefault()
    if (e.code === 'Escape' && !input.locked) hooks.onEscape()
    if (!e.repeat) input.pressed.add(e.code)
    input.down.add(e.code)
  })
  window.addEventListener('keyup', (e) => input.down.delete(e.code))
  window.addEventListener('blur', () => {
    input.down.clear()
    input.dragging = false
  })

  // Chrome reports a large bogus movement right after the lock engages: drop input for a
  // moment after locking, and clamp any later spikes.
  document.addEventListener('mousemove', (e) => {
    if (!input.locked && !input.dragging) return
    if (performance.now() < ignoreUntil) return
    input.mdx += clamp(e.movementX, -120, 120)
    input.mdy += clamp(e.movementY, -120, 120)
  })

  // Fallback when pointer lock is unavailable: drag to look.
  canvas.addEventListener('mousedown', () => {
    if (!input.locked) input.dragging = true
  })
  window.addEventListener('mouseup', () => {
    input.dragging = false
  })

  document.addEventListener('pointerlockchange', () => {
    const was = input.locked
    input.locked = document.pointerLockElement === canvasEl
    if (input.locked) ignoreUntil = performance.now() + 150
    if (was && !input.locked) hooks.onUnlock()
  })
}

export async function requestLock() {
  if (!canvasEl || input.locked) return
  try {
    await canvasEl.requestPointerLock({ unadjustedMovement: true })
  } catch {
    try {
      await canvasEl.requestPointerLock()
    } catch {
      // Stay unlocked; drag-to-look still works.
    }
  }
}

export function releaseLock() {
  if (document.pointerLockElement) document.exitPointerLock()
}

export const isDown = (code: string) => input.down.has(code)
export const pressed = (code: string) => input.pressed.has(code)

export function endFrame() {
  input.pressed.clear()
  input.mdx = 0
  input.mdy = 0
}
