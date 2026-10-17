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

// A Coriolis storm seen from outside: a wall of dust riding its leading edge.
export function Storm() {
  const { mesh, u } = useMemo(() => {
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
    return { mesh, u }
  }, [])

  useFrame(({ camera }) => {
    const s = rt.storm
    const on = s.active ? 1 - s.inside : 0
    mesh.visible = on > 0.01
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

  return <primitive object={mesh} />
}
