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
let dragDist = 0

export function initInput(canvas: HTMLElement, hooks: { onUnlock: () => void; onEscape: () => void }) {
  if (canvasEl) return
  canvasEl = canvas

  window.addEventListener('keydown', (e) => {
    // Typing a name or a chat line is not walking.
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
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
    if (input.dragging) dragDist += Math.abs(e.movementX) + Math.abs(e.movementY)
    input.mdx += clamp(e.movementX, -120, 120)
    input.mdy += clamp(e.movementY, -120, 120)
  })

  // Mouse buttons arrive as 'Mouse0' (left) and 'Mouse2' (right). When the pointer is
  // locked a press is a press; without the lock the left button drags to look, and only a
  // click that barely moved counts as a press.
  canvas.addEventListener('mousedown', (e) => {
    if (input.locked) {
      input.pressed.add('Mouse' + e.button)
      input.down.add('Mouse' + e.button)
    } else {
      input.dragging = true
      dragDist = 0
    }
  })
  window.addEventListener('mouseup', (e) => {
    if (!input.locked && input.dragging && dragDist < 5) input.pressed.add('Mouse' + e.button)
    input.down.delete('Mouse' + e.button)
    input.dragging = false
  })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())

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

// One press, one action: whoever handles a press removes it, so a single E can't
// board the ornithopter and then exit it later in the same frame.
export function consume(code: string): boolean {
  if (!input.pressed.has(code)) return false
  input.pressed.delete(code)
  return true
}

export function endFrame() {
  input.pressed.clear()
  input.mdx = 0
  input.mdy = 0
}
