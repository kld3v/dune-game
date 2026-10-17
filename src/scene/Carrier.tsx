import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rt } from '../game/rt'
import { buildOrnithopter, poseOrnithopter, type Palette } from './Thopter'

const HARKONNEN: Palette = {
  hull: '#2b2826',
  trim: '#121010',
  glass: '#2a0d0a',
  membrane: '#3a3532',
  rib: '#1c1a19',
  engine: new THREE.Color(3, 0.35, 0.12),
  navLeft: new THREE.Color(3, 0.15, 0.1),
  navRight: new THREE.Color(3, 0.15, 0.1),
}

const BEAM_VERT = /* glsl */ `
varying float vH;
void main() {
  vH = uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const BEAM_FRAG = /* glsl */ `
uniform float uOn;
uniform float uNight;
varying float vH;
void main() {
  float a = (0.05 + 0.18 * uNight) * uOn * (0.35 + 0.65 * vH);
  gl_FragColor = vec4(vec3(1.0, 0.92, 0.78) * a, a);
}
`

const up = new THREE.Vector3(0, 1, 0)
const dir = new THREE.Vector3()

// A Harkonnen carrier: a larger, darker ornithopter with a searchlight under its nose.
export function Carrier() {
  const c = useMemo(() => {
    const o = buildOrnithopter(HARKONNEN, 1.9)
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uOn: { value: 0 }, uNight: { value: 0 } },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    })
    // Unit cone with its apex at the origin pointing down -Y, uv.y = 1 at the apex.
    const coneGeo = new THREE.ConeGeometry(1, 1, 24, 1, true)
    coneGeo.translate(0, -0.5, 0)
    const beam = new THREE.Mesh(coneGeo, beamMat)
    beam.frustumCulled = false
    const spot = new THREE.SpotLight('#fff1d8', 0, 260, 0.22, 0.5, 1.2)
    const spotTarget = new THREE.Object3D()
    spot.target = spotTarget
    return { o, beam, beamMat, spot, spotTarget }
  }, [])

  useFrame(() => {
    const k = rt.carrier
    c.o.root.visible = k.active
    c.beam.visible = k.active && k.beamOn > 0.01
    c.spot.intensity = k.active ? k.beamOn * (60 + 900 * rt.env.night) : 0
    if (!k.active) return
    poseOrnithopter(c.o, k.pos, -0.05, k.yaw, 0, k.wingPhase, 22, 0, 0.8, HARKONNEN.engine)
    // Stretch the cone from under the carrier's nose to the lit spot on the sand.
    const src = c.beam.position.set(k.pos.x + Math.sin(k.yaw) * 5, k.pos.y - 2.5, k.pos.z + Math.cos(k.yaw) * 5)
    dir.subVectors(k.beam, src)
    const len = dir.length()
    c.beam.quaternion.setFromUnitVectors(up, dir.normalize().negate())
    c.beam.scale.set(8, len, 8)
    c.beamMat.uniforms.uOn.value = k.beamOn
    c.beamMat.uniforms.uNight.value = rt.env.night
    c.spot.position.copy(src)
    c.spotTarget.position.copy(k.beam)
    c.spotTarget.updateMatrixWorld()
  })

  return (
    <>
      <primitive object={c.o.root} />
      <primitive object={c.beam} />
      <primitive object={c.spot} />
      <primitive object={c.spotTarget} />
    </>
  )
}
