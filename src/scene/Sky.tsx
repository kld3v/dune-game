import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rt } from '../game/rt'
import { clamp } from '../game/math'

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uMoon2Dir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunCol;
uniform float uSunUp;
uniform float uNight;
uniform float uTrip;
uniform float uTime;
uniform vec3 uEyeDir;
uniform float uEye;
varying vec3 vDir;

float sHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 moon(vec3 col, vec3 d, vec3 md, float size, vec3 tint, float vis, bool mouse) {
  if (dot(d, md) < 0.98) return col;
  vec3 r = normalize(cross(md, vec3(0.0, 1.0, 0.0)));
  vec3 u = cross(r, md);
  vec2 q = vec2(dot(d, r), dot(d, u)) / size;
  float rr = length(q);
  float disc = 1.0 - smoothstep(0.96, 1.0, rr);
  float z = sqrt(max(0.0, 1.0 - rr * rr));
  vec3 n = normalize(r * q.x + u * q.y - md * z);
  float lit = smoothstep(-0.08, 0.3, dot(n, uSunDir));
  float m = 0.78 + 0.22 * sin(q.x * 6.0 + 1.3) * sin(q.y * 5.0 - 0.7);
  if (mouse) {
    // Muad'Dib: the desert mouse in the first moon.
    float body = length((q - vec2(0.12, -0.12)) / vec2(0.36, 0.22));
    float head = length(q - vec2(-0.3, 0.02)) / 0.15;
    float ear = length(q - vec2(-0.26, 0.19)) / 0.08;
    float tailY = -0.08 + 0.18 * sin((q.x - 0.45) * 5.0);
    float tail = (q.x > 0.42 && q.x < 0.82) ? abs(q.y - tailY) / 0.03 : 9.0;
    m *= mix(0.6, 1.0, smoothstep(0.85, 1.05, min(min(body, head), min(ear, tail))));
  }
  vec3 mc = tint * m * (0.05 + 1.5 * lit);
  col = mix(col, mc, disc * vis);
  col += tint * exp(-max(rr - 1.0, 0.0) * 5.0) * 0.06 * (1.0 - disc) * vis;
  return col;
}

// The Eye of Ibad: blue within blue, opening in the sky when the spice is deep.
vec3 eye(vec3 col, vec3 d) {
  float facing = dot(d, uEyeDir);
  if (facing < 0.6) return col;
  vec3 r = normalize(cross(uEyeDir, vec3(0.0, 1.0, 0.0)));
  vec3 u = cross(r, uEyeDir);
  vec2 q = vec2(dot(d, r), dot(d, u)) / 0.34;
  float bl = fract(uTime / 7.3);
  float open = max(0.02, 1.0 - smoothstep(0.0, 0.025, bl) * (1.0 - smoothstep(0.025, 0.07, bl)));
  vec2 qe = vec2(q.x, q.y / open);
  float inside = max(length(qe - vec2(0.0, -0.634)) - 1.184, length(qe - vec2(0.0, 0.634)) - 1.184);
  float mask = 1.0 - smoothstep(-0.02, 0.02, inside);
  float ir = length(q);
  float ang = atan(q.y, q.x);
  vec3 sclera = vec3(0.05, 0.12, 0.5) * (1.3 - 0.7 * smoothstep(-0.35, 0.0, inside));
  float fib = 0.6 + 0.4 * sin(ang * 37.0 + sin(ang * 11.0) * 2.0 + ir * 9.0 - uTime * 0.3);
  vec3 iris = mix(vec3(0.05, 0.35, 1.4), vec3(0.45, 0.9, 2.2), smoothstep(0.42, 0.16, ir)) * fib;
  iris *= 1.0 - smoothstep(0.35, 0.42, ir) * 0.75;
  float pr = 0.15 + 0.035 * sin(uTime * 0.9);
  vec3 e = mix(sclera, iris * 2.2, 1.0 - smoothstep(0.41, 0.43, ir));
  e = mix(e, vec3(0.0), 1.0 - smoothstep(pr - 0.012, pr + 0.012, ir));
  e += vec3(2.0) * (1.0 - smoothstep(0.0, 0.05, length(q - vec2(-0.12, 0.13))));
  float halo = exp(-max(inside, 0.0) * 3.5) * (1.0 - mask);
  vec3 outc = mix(col, e, mask) + vec3(0.12, 0.35, 1.2) * halo * 0.45;
  return mix(col, outc, uEye * smoothstep(0.6, 0.75, facing));
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.42));
  float sd = dot(d, uSunDir);
  float sp = max(sd, 0.0);
  col += uSunCol * pow(sp, 5.0) * 0.28 * uSunUp * (1.0 - up * 0.6);
  col += uSunCol * pow(sp, 64.0) * 0.55 * uSunUp;
  col += uSunCol * smoothstep(0.99955, 0.99975, sd) * 30.0 * uSunUp;

  float starVis = clamp(uNight * smoothstep(-0.02, 0.25, h) + uTrip * 0.85 * smoothstep(-0.05, 0.2, h), 0.0, 1.0);
  if (starVis > 0.01) {
    vec3 p = d * 260.0;
    vec3 cell = floor(p);
    float rnd = sHash(cell);
    if (rnd > 0.96) {
      vec3 spos = cell + vec3(sHash(cell + 1.7), sHash(cell + 3.1), sHash(cell + 5.3));
      float tw = 0.6 + 0.4 * sin(uTime * (1.5 + rnd * 7.0) + rnd * 60.0);
      col += vec3(0.85, 0.9, 1.0) * smoothstep(0.3, 0.0, length(p - spos)) * tw * (rnd - 0.96) * 60.0 * starVis;
    }
  }

  float moonVis = 0.3 + 0.7 * uNight;
  col = moon(col, d, uMoonDir, 0.045, vec3(1.0, 0.95, 0.88), moonVis, true);
  col = moon(col, d, uMoon2Dir, 0.026, vec3(0.9, 0.92, 1.0), moonVis, false);

  if (uTrip > 0.01) {
    float az = atan(d.z, d.x);
    float sw = sin(az * 5.0 + h * 12.0 - uTime * 0.6 + sin(h * 6.0 + uTime * 0.3) * 2.0);
    vec3 pc = 0.5 + 0.5 * cos(6.28318 * (az * 0.159 + h * 0.5 + uTime * 0.05 + vec3(0.0, 0.33, 0.67)));
    float k = smoothstep(0.2, 1.0, uTrip) * smoothstep(-0.05, 0.3, h);
    col = mix(col, col * 0.45 + pc * (0.35 + 0.25 * sw) * vec3(0.7, 0.55, 1.1), k * 0.8);
  }
  if (uEye > 0.01) col = eye(col, d);
  gl_FragColor = vec4(col, 1.0);
}
`

export function Sky() {
  const { mesh, u } = useMemo(() => {
    const u = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoon2Dir: { value: new THREE.Vector3(0, 1, 0) },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunCol: { value: new THREE.Color() },
      uSunUp: { value: 1 },
      uNight: { value: 0 },
      uTrip: { value: 0 },
      uTime: { value: 0 },
      uEyeDir: { value: new THREE.Vector3(0, 0.4, 1).normalize() },
      uEye: { value: 0 },
    }
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat)
    mesh.scale.setScalar(3000)
    mesh.frustumCulled = false
    mesh.renderOrder = -1000
    return { mesh, u }
  }, [])

  useFrame(({ camera }) => {
    mesh.position.copy(camera.position)
    const e = rt.env
    u.uSunDir.value.copy(e.sunDir)
    u.uMoonDir.value.copy(e.moonDir)
    u.uMoon2Dir.value.copy(e.moon2Dir)
    u.uZenith.value.copy(e.zenith)
    u.uHorizon.value.copy(e.horizon)
    u.uSunCol.value.copy(e.sunCol)
    u.uSunUp.value = clamp((e.sunDir.y + 0.12) / 0.17, 0, 1)
    u.uNight.value = e.night
    u.uTrip.value = rt.trip
    u.uTime.value = rt.time
    u.uEyeDir.value.copy(rt.eyeDir)
    u.uEye.value = rt.eye
  })

  return <primitive object={mesh} />
}
