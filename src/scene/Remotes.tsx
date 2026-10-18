import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { rt, WORM_R } from '../game/rt'
import { clamp } from '../game/math'
import { net, type Remote } from '../net/client'
import { ATREIDES, buildOrnithopter, poseOrnithopter, type Ornithopter } from './Thopter'
import { castFor, makePerson, playClip, useCast, type Person } from './people'

// Everyone else in the desert: walking, riding their worm, or flying.

interface View {
  person: Person | null
  worm: THREE.Mesh | null
  wormState: unknown
  thopter: Ornithopter | null
}

const wormMat = new THREE.MeshStandardMaterial({ color: '#6d6152', roughness: 0.85, metalness: 0.05 })
const head = new THREE.Vector3()
const CLIP: Record<string, string> = { strike: 'idle' }

// Each rider dyed a little differently, so a crowd of Arissas is still a crowd of people.
function dyeFor(id: number) {
  const h = (id * 0.381966) % 1
  return new THREE.Color().setHSL(0.06 + h * 0.12, 0.35 + 0.2 * ((id * 0.618) % 1), 0.55).multiplyScalar(3.2)
}

export function Remotes() {
  const size = useThree((s) => s.size)
  const assets = useCast()
  const root = useMemo(() => new THREE.Group(), [])
  const views = useMemo(() => new Map<number, View>(), [])

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.1)
    for (const [id, v] of views) {
      if (net.remotes.has(id)) continue
      if (v.person) root.remove(v.person.root)
      if (v.worm) {
        root.remove(v.worm)
        v.worm.geometry.dispose()
      }
      if (v.thopter) root.remove(v.thopter.root)
      views.delete(id)
    }
    for (const r of net.remotes.values()) {
      let v = views.get(r.id)
      if (!v) {
        v = { person: null, worm: null, wormState: null, thopter: null }
        views.set(r.id, v)
      }
      if (!v.person && assets) {
        const a = castFor(assets, 'fremenWoman')
        if (a) {
          v.person = makePerson(a, 'fremenWoman')
          v.person.root.traverse((o) => {
            const m = o as THREE.Mesh
            if (m.isMesh) (m.material as THREE.MeshStandardMaterial).color.copy(dyeFor(r.id))
          })
          root.add(v.person.root)
        }
      }
      draw(r, v, dt)
      // Where the name tag goes on screen.
      head.set(r.pos.x, r.pos.y + (r.state.mode === 'thopter' ? 3.5 : 2.3), r.pos.z).project(camera)
      r.onScreen = head.z < 1 && Math.abs(head.x) < 1.1 && Math.abs(head.y) < 1.1
      r.screenX = (head.x * 0.5 + 0.5) * size.width
      r.screenY = (-head.y * 0.5 + 0.5) * size.height
    }
  })

  function draw(r: Remote, v: View, dt: number) {
    const s = r.state
    // Underground and on the surface never see each other.
    const apart = (s.mode === 'cave') !== !!rt.cave
    const flying = s.mode === 'thopter'
    if (v.person) {
      v.person.root.visible = !flying && !apart
      if (v.person.root.visible) {
        v.person.root.position.copy(r.pos)
        v.person.root.rotation.y = r.yaw
        const clip = CLIP[s.anim] ?? s.anim
        playClip(v.person, clip, 0.2)
        const act = v.person.actions.get(clip)
        const nominal = clip === 'sprint' ? 7.4 : clip === 'jog' ? 4.3 : clip === 'walk' ? 1.45 : clip === 'sneak' ? 1.3 : 0
        if (act) act.timeScale = nominal ? clamp(s.speed / nominal, 0.6, 1.6) : 1
        v.person.mixer.update(dt)
      }
    }
    // Their worm, drawn as a tube through the spine they report.
    const riding = s.mode === 'worm' && !!s.worm && !apart
    if (riding && s !== v.wormState && s.worm) {
      v.wormState = s
      const pts: THREE.Vector3[] = []
      for (let i = 0; i < s.worm.pts.length; i += 3) pts.push(new THREE.Vector3(s.worm.pts[i], s.worm.pts[i + 1], s.worm.pts[i + 2]))
      const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, WORM_R * s.worm.size * 0.85, 12, false)
      if (!v.worm) {
        v.worm = new THREE.Mesh(geo, wormMat)
        v.worm.castShadow = true
        v.worm.frustumCulled = false
        root.add(v.worm)
      } else {
        v.worm.geometry.dispose()
        v.worm.geometry = geo
      }
    }
    if (v.worm) v.worm.visible = riding
    if (flying && !apart && !v.thopter) {
      v.thopter = buildOrnithopter(ATREIDES)
      root.add(v.thopter.root)
    }
    if (v.thopter) {
      v.thopter.root.visible = flying && !apart
      if (flying && s.fly) poseOrnithopter(v.thopter, r.pos, s.fly.pitch, r.yaw, s.fly.bank, s.fly.wing, 20, 0, 0.6, ATREIDES.engine)
    }
  }

  return <primitive object={root} />
}
