import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rt } from '../game/rt'
import { clamp, smoothstep } from '../game/math'
import { glow } from '../game/particles'
import { terrainHeight } from '../game/terrain'

// Prescience made visible. Everything here is drawn only while the spice is in you, and
// everything it shows is something the game has already decided will happen.

const GHOST_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vH = uv.y;
  gl_Position = projectionMatrix * mv;
}
`
const GHOST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
uniform float uBands;
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  float rim = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.6);
  float bands = mix(1.0, 0.55 + 0.45 * sin(vH * 40.0 - uTime * 6.0), uBands);
  float fade = uBands > 0.5 ? (1.0 - vH) : 1.0;
  gl_FragColor = vec4(uColor * (0.25 + rim * 1.4) * bands * uAlpha * fade, 1.0);
}
`

function ghostMat(color: THREE.Color, bands: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uAlpha: { value: 0 }, uTime: { value: 0 }, uBands: { value: bands } },
    vertexShader: GHOST_VERT,
    fragmentShader: GHOST_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  })
}

function figureGeometry() {
  const pts = [
    [0.0, 1.95], [0.16, 1.9], [0.2, 1.75], [0.16, 1.62], [0.3, 1.5], [0.34, 1.2],
    [0.37, 0.8], [0.42, 0.4], [0.47, 0.05],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  return new THREE.LatheGeometry(pts, 14)
}

const POOL = 10

export function Future() {
  const f = useMemo(() => {
    const group = new THREE.Group()
    const pillarMat = ghostMat(new THREE.Color(2.2, 1.4, 0.4), 1)
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(7, 11, 140, 28, 1, true), pillarMat)
    pillar.frustumCulled = false
    const fig = figureGeometry()
    const phantomMat = ghostMat(new THREE.Color(2.4, 0.25, 0.15), 0)
    const phantoms = Array.from({ length: 4 }, () => {
      const m = new THREE.Mesh(fig, phantomMat)
      m.frustumCulled = false
      group.add(m)
      return m
    })
    const selfMat = ghostMat(new THREE.Color(2.0, 1.5, 0.5), 0)
    const self = new THREE.Mesh(fig, selfMat)
    self.frustumCulled = false
    const sectorGeo = new THREE.RingGeometry(0.5, 2.8, 24, 1, Math.PI / 2 - 1.05, 2.1)
    sectorGeo.rotateX(-Math.PI / 2)
    const sectorMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.6, 0.2, 0.1), transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    })
    const sectors = Array.from({ length: POOL }, () => {
      const m = new THREE.Mesh(sectorGeo, sectorMat.clone())
      m.frustumCulled = false
      group.add(m)
      return m
    })
    group.add(pillar, self)
    return { group, pillar, pillarMat, phantoms, phantomMat, self, selfMat, sectors }
  }, [])

  useFrame(() => {
    const trip = rt.trip
    const sight = smoothstep(0.3, 0.6, trip)
    f.group.visible = sight > 0.01
    if (!f.group.visible) return
    const t = rt.time
    const p = rt.player.pos

    // Where the spice will bloom.
    const blowIn = rt.nextBlow - t
    const blowSoon = blowIn > 0 && blowIn < 90 ? 1 - blowIn / 90 : 0
    f.pillar.visible = blowSoon > 0
    f.pillar.position.set(rt.nextBlowPos.x, rt.nextBlowPos.y + 70, rt.nextBlowPos.z)
    f.pillarMat.uniforms.uAlpha.value = sight * (0.25 + 0.75 * blowSoon)
    f.pillarMat.uniforms.uTime.value = t

    // Where the next squad will drop.
    const raidIn = rt.nextRaid - t
    const raidSoon = !rt.carrier.active && raidIn > 0 && raidIn < 90 ? 1 - raidIn / 90 : 0
    f.phantoms.forEach((m, i) => {
      m.visible = raidSoon > 0
      const a = (i / 4) * Math.PI * 2 + t * 0.2
      const x = rt.nextRaidPos.x + Math.cos(a) * 3
      const z = rt.nextRaidPos.z + Math.sin(a) * 3
      m.position.set(x, terrainHeight(x, z), z)
      m.rotation.y = Math.atan2(p.x - x, p.z - z)
    })
    f.phantomMat.uniforms.uAlpha.value = sight * (0.3 + 0.7 * raidSoon) * (0.75 + 0.25 * Math.sin(t * 5))
    f.phantomMat.uniforms.uTime.value = t

    // Your own future: where you will be in a moment and a half.
    const v = rt.player.vel
    const moving = rt.mode === 'foot' && Math.hypot(v.x, v.z) > 1.5
    f.self.visible = moving
    if (moving) {
      const ax = p.x + v.x * 1.5
      const az = p.z + v.z * 1.5
      f.self.position.set(ax, terrainHeight(ax, az), az)
      f.self.rotation.y = rt.player.yaw
    }
    f.selfMat.uniforms.uAlpha.value = sight * 0.6 * (0.8 + 0.2 * Math.sin(t * 7))

    // Strikes you can see coming: a red wedge under each Harkonnen about to swing.
    for (let i = 0; i < POOL; i++) {
      const m = f.sectors[i]
      const foe = rt.foes[i]
      const mat = m.material as THREE.MeshBasicMaterial
      let urgency = 0
      if (foe && foe.state === 'chase' && Math.hypot(foe.pos.x - p.x, foe.pos.z - p.z) < 4) urgency = clamp(1 - foe.attackCD / 0.8, 0, 1) * 0.6
      if (foe && foe.state === 'attack' && foe.st < 0.65) urgency = 0.6 + 0.4 * (foe.st / 0.65)
      m.visible = urgency > 0.01
      if (!m.visible || !foe) continue
      m.position.set(foe.pos.x, foe.pos.y + 0.08, foe.pos.z)
      m.rotation.y = foe.yaw
      mat.opacity = sight * urgency * (0.6 + 0.4 * Math.sin(t * 20))
    }

    // The arc a worm will cut when it breaches, traced in sparks before it happens.
    for (const w of rt.worms) {
      if (w.state !== 'approach' || w.kind === 'wild') continue
      if (w.kind === 'hunter' && rt.wormsign < 1) continue
      const dx = w.target.x - w.head.x
      const dz = w.target.z - w.head.z
      const d = Math.hypot(dx, dz)
      const k = w.size
      if (d > 220 * k || d < 1) continue
      const ux = dx / d
      const uz = dz / d
      for (let k = 0; k < 5; k++) {
        const s = Math.random()
        const x = w.target.x - ux * 42 * k + ux * 46 * k * s
        const z = w.target.z - uz * 42 * k + uz * 46 * k * s
        const y = terrainHeight(x, z) - 6 * k + 4 * 42 * k * s * (1 - s)
        glow.emit(x, y, z, 0, 0.3, 0, 0.6, 0.35, 1.1 * sight, 0.6 * sight, 2.2 * sight, 0, 0)
      }
    }
  })

  return <primitive object={f.group} />
}
