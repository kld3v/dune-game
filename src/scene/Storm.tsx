import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rt } from '../game/rt'

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uOn;
uniform vec3 uDark;
uniform vec3 uLit;
varying vec2 vUv;
float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += vn(p) * a;
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
void main() {
  vec2 q = vec2(vUv.x * 22.0, vUv.y * 2.6);
  float n = fbm(q + vec2(uTime * 0.04, -uTime * 0.07));
  float billow = fbm(q * 1.7 + n * 1.6 + vec2(-uTime * 0.03, -uTime * 0.11));
  float top = 1.0 - smoothstep(0.5 + 0.3 * billow, 1.0, vUv.y);
  float alpha = top * (0.78 + 0.22 * billow) * uOn;
  vec3 col = mix(uDark, uLit, clamp(billow * (0.35 + 0.8 * vUv.y), 0.0, 1.0));
  gl_FragColor = vec4(col, alpha);
}
`

const DARK = new THREE.Color('#3c2412')

// Inside the storm: a shell of flying sand around the camera that swallows the sky and
// everything past a few dozen metres. Gold when you are flowing with it.
const SHELL_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const SHELL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOn;
uniform float uFlow;
uniform float uBolt;
uniform vec3 uDark;
uniform vec3 uLit;
uniform vec2 uWind;
varying vec3 vDir;
float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += vn(p) * a;
    p = p * 2.07 + 13.7;
    a *= 0.5;
  }
  return s;
}
void main() {
  float along = dot(vDir.xz, uWind);
  float across = dot(vDir.xz, vec2(-uWind.y, uWind.x));
  vec2 q = vec2(across * 3.0 - uTime * 0.9, vDir.y * 5.0 + along * 1.5);
  float n = fbm(q + vec2(0.0, uTime * 0.15));
  float billow = fbm(q * 1.9 + n * 2.0 - vec2(uTime * 1.4, 0.0));
  vec3 col = mix(uDark, uLit, clamp(billow * 0.9 + vDir.y * 0.25, 0.0, 1.0));
  col = mix(col, vec3(1.6, 1.15, 0.45) * (0.4 + billow), uFlow * 0.55);
  col += vec3(0.9, 0.85, 1.0) * uBolt * (0.4 + billow);
  float alpha = uOn * clamp(0.7 + 0.3 * billow - uFlow * 0.25, 0.0, 0.97);
  gl_FragColor = vec4(col, alpha);
}
`

// A Coriolis storm seen from outside: a wall of dust riding its leading edge.
export function Storm() {
  const { mesh, u, shell, su } = useMemo(() => {
    const u = {
      uTime: { value: 0 },
      uOn: { value: 0 },
      uDark: { value: DARK.clone() },
      uLit: { value: new THREE.Color() },
    }
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2600, 340), mat)
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    const su = {
      uTime: { value: 0 },
      uOn: { value: 0 },
      uFlow: { value: 0 },
      uBolt: { value: 0 },
      uDark: { value: new THREE.Color() },
      uLit: { value: new THREE.Color() },
      uWind: { value: new THREE.Vector2(1, 0) },
    }
    const shell = new THREE.Mesh(new THREE.SphereGeometry(28, 32, 16), new THREE.ShaderMaterial({
      uniforms: su,
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
    }))
    shell.frustumCulled = false
    shell.renderOrder = 3
    return { mesh, u, shell, su }
  }, [])

  useFrame(({ camera }) => {
    const s = rt.storm
    shell.visible = s.inside > 0.02 && !rt.cave
    if (shell.visible) {
      shell.position.copy(camera.position)
      su.uTime.value = rt.time
      su.uOn.value = s.inside
      su.uFlow.value += ((s.flowing ? 1 : 0) - su.uFlow.value) * 0.05
      su.uBolt.value = s.lightning
      su.uWind.value.set(s.dirX, s.dirZ)
      const light = 0.25 + 0.75 * rt.env.day
      su.uDark.value.copy(DARK).multiplyScalar(0.55 * light)
      su.uLit.value.setRGB(0.62, 0.4, 0.22).multiplyScalar(light)
    }
    const on = s.active ? 1 - s.inside : 0
    mesh.visible = on > 0.01 && !rt.cave
    if (!mesh.visible) return
    const c = camera.position
    const along = c.x * s.dirX + c.z * s.dirZ
    const ahead = s.front - along
    mesh.position.set(c.x + s.dirX * ahead, c.y + 110, c.z + s.dirZ * ahead)
    mesh.lookAt(mesh.position.x - s.dirX, mesh.position.y, mesh.position.z - s.dirZ)
    u.uTime.value = rt.time
    u.uOn.value = on
    u.uLit.value.copy(rt.env.sunCol).multiplyScalar(0.55).add(rt.env.horizon.clone().multiplyScalar(0.35))
  })

  return (
    <>
      <primitive object={mesh} />
      <primitive object={shell} />
    </>
  )
}
