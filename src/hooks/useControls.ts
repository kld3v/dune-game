import { useEffect, useRef } from 'react'

export interface Controls {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  thump: boolean   // T
  interact: boolean // E
  sprint: boolean  // shift
  mouseX: number
  mouseY: number
  mouseDX: number
  mouseDY: number
}

export function useControls(): React.MutableRefObject<Controls> {
  const ctrl = useRef<Controls>({
    forward: false, back: false, left: false, right: false,
    up: false, down: false, thump: false, interact: false, sprint: false,
    mouseX: 0, mouseY: 0, mouseDX: 0, mouseDY: 0,
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const c = ctrl.current
      switch (e.code) {
        case 'KeyW': case 'ArrowUp':    c.forward  = down; break
        case 'KeyS': case 'ArrowDown':  c.back     = down; break
        case 'KeyA': case 'ArrowLeft':  c.left     = down; break
        case 'KeyD': case 'ArrowRight': c.right    = down; break
        case 'Space':                   c.up       = down; e.preventDefault(); break
        case 'KeyQ':                    c.down     = down; break
        case 'KeyT':                    c.thump    = down; break
        case 'KeyE':                    c.interact = down; break
        case 'ShiftLeft': case 'ShiftRight': c.sprint = down; break
      }
    }

    const onMouseMove = (e: MouseEvent) => {
      ctrl.current.mouseDX += e.movementX
      ctrl.current.mouseDY += e.movementY
    }

    const onClick = () => {
      document.body.requestPointerLock()
    }

    document.addEventListener('keydown', e => onKey(e, true))
    document.addEventListener('keyup',   e => onKey(e, false))
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('click', onClick)

    return () => {
      document.removeEventListener('keydown', e => onKey(e, true))
      document.removeEventListener('keyup',   e => onKey(e, false))
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('click', onClick)
    }
  }, [])

  return ctrl
}
