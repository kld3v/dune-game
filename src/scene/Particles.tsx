import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { rt } from '../game/rt'
import { dust, glow, type ParticlePool } from '../game/particles'
import { WIND_X, WIND_Z } from '../game/terrain'

const VERT = /* glsl */ `
attribute vec3 aVel;
attribute vec4 aInfo;
attribute vec4 aColor;
uniform float uTime;
uniform float uScale;
uniform vec2 uWind;
varying vec3 vColor;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  float age = uTime - aInfo.x;
  float life = aInfo.y;
  if (life <= 0.0 || age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    vAlpha = 0.0;
    return;
  }
  float drag = aInfo.w;
  vec3 disp = drag > 0.0 ? aVel * (1.0 - exp(-drag * age)) / drag : aVel * age;
  vec3 p = position + disp;
  p.y -= 4.9 * aColor.w * age * age;
  p.xz += uWind * age * 0.6;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float u = age / life;
  gl_PointSize = aInfo.z * (0.55 + u * 0.9) * uScale / max(-mvPosition.z, 0.1);
  vAlpha = smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.55, 1.0, u)) * smoothstep(1.5, 9.0, -mvPosition.z);
  vColor = aColor.rgb;
  #include <fog_vertex>
}
`

const DUST_FRAG = /* glsl */ `
uniform vec3 uLight;
varying vec3 vColor;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, d) * vAlpha * 0.55;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * uLight, a);
  #include <fog_fragment>
}
`

const GLOW_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor, a);
  #ifdef USE_FOG
    gl_FragColor.a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
}
`

const ATTRS: [keyof ParticlePool & ('start' | 'vel' | 'info' | 'color'), string, number][] = [
  ['start', 'position', 3],
  ['vel', 'aVel', 3],
  ['info', 'aInfo', 4],
  ['color', 'aColor', 4],
]

function build(pool: ParticlePool, frag: string, additive: boolean) {
  const geo = new THREE.BufferGeometry()
  for (const [key, name, size] of ATTRS) {
    const attr = new THREE.BufferAttribute(pool[key], size)
    attr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute(name, attr)
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uScale: { value: 800 },
        uWind: { value: new THREE.Vector2(WIND_X, WIND_Z) },
        uLight: { value: new THREE.Color(1, 1, 1) },
      },
    ]),
    vertexShader: VERT,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    fog: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  points.renderOrder = additive ? 6 : 5
  return { points, geo, mat }
}

function flush(pool: ParticlePool, geo: THREE.BufferGeometry) {
  if (pool.dirtyMax < 0) return
  const start = pool.dirtyMin
  const count = pool.dirtyMax - pool.dirtyMin + 1
  for (const [, name, size] of ATTRS) {
    const attr = geo.attributes[name] as THREE.BufferAttribute
    attr.clearUpdateRanges()
    attr.addUpdateRange(start * size, count * size)
    attr.needsUpdate = true
  }
  pool.dirtyMin = Infinity
  pool.dirtyMax = -1
}

export function Particles() {
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const sys = useMemo(() => ({ dust: build(dust, DUST_FRAG, false), glow: build(glow, GLOW_FRAG, true) }), [])

  useFrame(({ camera }) => {
    const cam = camera as THREE.PerspectiveCamera
    const scale = (size.height * dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2))
    const e = rt.env
    for (const s of [sys.dust, sys.glow]) {
      s.mat.uniforms.uTime.value = rt.time
      s.mat.uniforms.uScale.value = scale
    }
    const L = sys.dust.mat.uniforms.uLight.value as THREE.Color
    L.copy(e.hemiSky).multiplyScalar(e.hemiIntensity * 0.55)
    L.r += e.lightCol.r * e.lightIntensity * 0.28
    L.g += e.lightCol.g * e.lightIntensity * 0.28
    L.b += e.lightCol.b * e.lightIntensity * 0.28
    flush(dust, sys.dust.geo)
    flush(glow, sys.glow.geo)
  })

  return (
    <>
      <primitive object={sys.dust.points} />
      <primitive object={sys.glow.points} />
    </>
  )
}
