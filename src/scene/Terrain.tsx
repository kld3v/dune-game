import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rt, MAX_WORMS, WORM_R } from '../game/rt'
import { TERRAIN_GLSL, WIND_X, WIND_Z, terrainHeight } from '../game/terrain'
import { fieldRadius } from '../game/spice'
import { clamp } from '../game/math'

// One mesh that follows the camera. Vertex spacing is 1 unit for the inner 96x96 and
// then grows quadratically out to the horizon, so the near ground is exact and the far
// ground is cheap. Heights come from the same function the CPU collides against.
const N = 256
const INNER = 48
const SPACING = 1
const RADIUS = 720
const MAX_FIELDS = 8

function gridCoords(): Float32Array {
  const half = N / 2
  const jm = half - INNER
  const g = (2 * (RADIUS - SPACING * half)) / (jm * jm)
  const out = new Float32Array(N + 1)
  for (let k = 0; k <= N; k++) {
    const c = k - half
    const a = Math.abs(c)
    let x: number
    if (a <= INNER) x = a * SPACING
    else {
      const j = a - INNER
      x = INNER * SPACING + SPACING * j + 0.5 * g * j * j
    }
    out[k] = Math.sign(c) * x
  }
  return out
}

function buildGeometry() {
  const coords = gridCoords()
  const n1 = N + 1
  const pos = new Float32Array(n1 * n1 * 3)
  const nrm = new Float32Array(n1 * n1 * 3)
  for (let iz = 0; iz < n1; iz++) {
    for (let ix = 0; ix < n1; ix++) {
      const i = (iz * n1 + ix) * 3
      pos[i] = coords[ix]
      pos[i + 2] = coords[iz]
      nrm[i + 1] = 1
    }
  }
  const idx = new Uint32Array(N * N * 6)
  let o = 0
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const a = iz * n1 + ix
      const b = a + 1
      const c = a + n1
      const d = c + 1
      idx[o++] = a
      idx[o++] = c
      idx[o++] = b
      idx[o++] = b
      idx[o++] = c
      idx[o++] = d
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), RADIUS * 1.5)
  return geo
}

const VERT_HEAD = /* glsl */ `
uniform float uTime;
uniform float uTrip;
uniform vec3 uCam;
uniform vec4 uWormA[${MAX_WORMS}];
uniform vec4 uWormB[${MAX_WORMS}];
${TERRAIN_GLSL}
// Sand wave above a worm travelling just under the surface.
float wormBumps(vec2 p) {
  float b = 0.0;
  for (int i = 0; i < ${MAX_WORMS}; i++) {
    vec4 A = uWormA[i];
    vec4 B = uWormB[i];
    if (B.x <= 0.0) continue;
    vec2 d = p - A.xy;
    float t = clamp(-dot(d, A.zw) / B.y, 0.0, 1.0);
    vec2 e = p - (A.xy - A.zw * (t * B.y));
    float w = B.z * (1.0 + t * 0.8);
    b += B.x * (1.0 - t * 0.8) * exp(-dot(e, e) / (w * w));
  }
  return b;
}
float fullHeight(vec2 p, float lod, out float rock) {
  return terrainHeight(p, lod, rock) + wormBumps(p);
}
float tripBreath(float dist) {
  return uTrip * uTrip * 1.6 * sin(dist * 0.09 - uTime * 1.7) * smoothstep(8.0, 40.0, dist);
}
`

const FRAG_HEAD = /* glsl */ `
uniform float uTime;
uniform float uTrip;
uniform float uDay;
uniform vec4 uSpice[${MAX_FIELDS}];
uniform vec4 uPath;
uniform float uPathOn;
uniform vec3 uSunDir;
uniform vec3 uSunHaze;
uniform vec3 uSandA;
uniform vec3 uSandB;
uniform vec3 uRockA;
uniform vec3 uRockB;
uniform vec3 uSpiceCol;
uniform vec2 uWind;
uniform vec3 uPlayer;
varying vec3 vTWorld;
varying float vRock;
varying float vSlope;
float gSpice;
float tHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float tVal(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash12(i), tHash12(i + vec2(1.0, 0.0)), u.x),
             mix(tHash12(i + vec2(0.0, 1.0)), tHash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`

const COLOR = /* glsl */ `
{
  vec3 wp = vTWorld;
  float n1 = tVal(wp.xz * 0.05);
  float n2 = tVal(wp.xz * 0.31 + 7.0);
  float hT = smoothstep(-10.0, 22.0, wp.y);
  vec3 sand = mix(uSandB, uSandA, clamp(hT * 0.75 + n1 * 0.35, 0.0, 1.0));
  sand *= 0.92 + 0.12 * n2;
  sand = mix(sand, sand * vec3(0.86, 0.74, 0.66), smoothstep(0.12, 0.42, vSlope));
  float strata = 0.5 + 0.5 * sin(wp.y * 1.9 + n1 * 3.0);
  float crack = 1.0 - smoothstep(0.0, 0.05, abs(tVal(wp.xz * 0.35 + wp.y * 0.2) - 0.5));
  vec3 rock = mix(uRockA, uRockB, strata) * (0.75 + 0.35 * n2) * (1.0 - 0.45 * crack);
  float rk = smoothstep(0.25, 0.6, vRock) * (0.55 + 0.45 * smoothstep(0.08, 0.35, vSlope + vRock * 0.2));
  vec3 col = mix(sand, rock, clamp(rk, 0.0, 1.0));
  gSpice = 0.0;
  for (int i = 0; i < ${MAX_FIELDS}; i++) {
    vec4 s = uSpice[i];
    if (s.w <= 0.0) continue;
    float d = length(wp.xz - s.xy);
    float edge = s.z * (0.75 + 0.35 * (n1 - 0.5) + 0.25 * (n2 - 0.5));
    gSpice = max(gSpice, s.w * (1.0 - smoothstep(edge * 0.55, edge, d)));
  }
  gSpice *= 1.0 - smoothstep(0.2, 0.5, vRock);
  col = mix(col, uSpiceCol * (0.85 + 0.3 * n2), gSpice * 0.78);
  col = mix(col, col.bgr * vec3(0.55, 0.7, 1.35), smoothstep(0.3, 1.0, uTrip) * 0.55);
  diffuseColor.rgb = col;
}
`

const NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
  float camD = length(vTWorld - cameraPosition);
  float rFade = (1.0 - smoothstep(25.0, 120.0, camD)) * (1.0 - smoothstep(0.2, 0.5, vRock)) * (1.0 - smoothstep(0.3, 0.6, vSlope));
  if (rFade > 0.001) {
    vec2 wp = vTWorld.xz;
    float ph = dot(wp, uWind) * 2.3 + sin(wp.x * 0.11 + wp.y * 0.07) * 2.5 + sin(dot(wp, vec2(-0.05, 0.13))) * 3.0;
    float s = sin(ph);
    s = s * abs(s);
    vec3 dW = vec3(uWind.x, 0.0, uWind.y) * (s * 0.2 * rFade);
    normal = normalize(normal + (viewMatrix * vec4(dW, 0.0)).xyz);
  }
  // Rock gets a bumped, broken surface from the gradient of two octaves of noise.
  float kAmt = smoothstep(0.3, 0.7, vRock) * (1.0 - smoothstep(30.0, 150.0, camD));
  if (kAmt > 0.001) {
    vec3 q = vTWorld * 0.9;
    float e = 0.15;
    vec2 o2 = vec2(q.y * 0.7);
    float n0 = tVal(q.xz) + 0.5 * tVal(q.xz * 2.3 + o2);
    float nx = tVal(q.xz + vec2(e, 0.0)) + 0.5 * tVal((q.xz + vec2(e, 0.0)) * 2.3 + o2);
    float nz = tVal(q.xz + vec2(0.0, e)) + 0.5 * tVal((q.xz + vec2(0.0, e)) * 2.3 + o2);
    vec3 dR = vec3(n0 - nx, 0.0, n0 - nz) / e * 0.26 * kAmt;
    normal = normalize(normal + (viewMatrix * vec4(dR, 0.0)).xyz);
  }
}
`

const EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  vec3 wp = vTWorld;
  float camD = length(wp - cameraPosition);
  vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 V = normalize(cameraPosition - wp);
  float g = tHash12(floor(wp.xz * 7.0));
  float spec = pow(max(dot(reflect(-V, nW), uSunDir), 0.0), 18.0);
  float glint = step(0.9975, g) * spec * (1.0 - smoothstep(8.0, 45.0, camD)) * (1.0 - vRock) * uDay;
  totalEmissiveRadiance += vec3(1.0, 0.9, 0.75) * glint * 2.5;
  totalEmissiveRadiance += uSpiceCol * gSpice * (0.06 + 0.05 * sin(uTime * 2.0 + wp.x * 0.3 + wp.z * 0.2));
  if (uTrip > 0.01) {
    float dP = length(wp.xz - uPlayer.xz);
    float c = wp.y * 0.45 - uTime * 0.8;
    float line = 1.0 - smoothstep(0.0, fwidth(c) * 1.5, abs(fract(c) - 0.5));
    float rc = dP * 0.06 - uTime * 0.9;
    float ring = 1.0 - smoothstep(0.0, fwidth(rc) * 2.0, abs(fract(rc) - 0.5));
    vec3 tc = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + dP * 0.01 - uTime * 0.1));
    float fade = smoothstep(0.15, 0.6, uTrip) * (1.0 - smoothstep(150.0, 420.0, dP));
    totalEmissiveRadiance += tc * (line * 0.9 + ring * 0.6 * smoothstep(0.5, 0.9, uTrip)) * fade * 1.4;
  }
  if (uPathOn > 0.01) {
    vec2 a = uPath.xy;
    vec2 b = uPath.zw;
    vec2 ba = a - b;
    float len = length(ba);
    vec2 dir = ba / max(len, 0.001);
    vec2 perp = vec2(-dir.y, dir.x);
    float t = clamp(dot(wp.xz - b, dir), 0.0, len);
    float wig = sin(t * 0.045) * 9.0 * smoothstep(0.0, 40.0, t) + sin(t * 0.11 + 1.3) * 3.0 * smoothstep(0.0, 20.0, t);
    float d = length(wp.xz - (b + dir * t + perp * wig));
    float core = 1.0 - smoothstep(0.35, 1.5, d);
    float halo = 1.0 - smoothstep(1.0, 7.0, d);
    float flow = 0.55 + 0.45 * sin(t * 0.35 + uTime * 5.0);
    float ends = smoothstep(0.0, 6.0, t) * (1.0 - smoothstep(len - 10.0, len - 2.0, t));
    totalEmissiveRadiance += vec3(1.6, 1.05, 0.35) * (core * 2.6 * flow + halo * 0.35) * uPathOn * ends;
  }
}
`

// Fog that brightens toward the sun the same way the sky does, so the horizon has no seam.
const FOG = /* glsl */ `
#ifdef USE_FOG
  float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  vec3 fogDir = normalize(vTWorld - cameraPosition);
  vec3 fogC = fogColor + uSunHaze * pow(max(dot(fogDir, uSunDir), 0.0), 5.0) * 0.28;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogC, fogFactor);
#endif
`

export function Terrain() {
  const { mesh, u } = useMemo(() => {
    const u = {
      uTime: { value: 0 },
      uTrip: { value: 0 },
      uDay: { value: 1 },
      uCam: { value: new THREE.Vector3() },
      uPlayer: { value: new THREE.Vector3() },
      uWormA: { value: Array.from({ length: MAX_WORMS }, () => new THREE.Vector4()) },
      uWormB: { value: Array.from({ length: MAX_WORMS }, () => new THREE.Vector4()) },
      uSpice: { value: Array.from({ length: MAX_FIELDS }, () => new THREE.Vector4()) },
      uPath: { value: new THREE.Vector4() },
      uPathOn: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunHaze: { value: new THREE.Color() },
      uSandA: { value: new THREE.Color('#e7b47b') },
      uSandB: { value: new THREE.Color('#bb7440') },
      uRockA: { value: new THREE.Color('#4e3326') },
      uRockB: { value: new THREE.Color('#87573a') },
      uSpiceCol: { value: new THREE.Color('#d8662a') },
      uWind: { value: new THREE.Vector2(WIND_X, WIND_Z) },
    }

    const mat = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0 })
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u)
      shader.vertexShader =
        VERT_HEAD + 'varying vec3 vTWorld;\nvarying float vRock;\nvarying float vSlope;\n' +
        shader.vertexShader
          .replace('#include <beginnormal_vertex>', /* glsl */ `
            vec2 tXZ = (modelMatrix * vec4(position, 1.0)).xz;
            float tDist = length(tXZ - uCam.xz);
            float tLod = smoothstep(140.0, 340.0, tDist);
            float tRock;
            float tH = fullHeight(tXZ, tLod, tRock);
            float tE = max(0.6, tDist * 0.012);
            float tR2;
            float tHx = fullHeight(tXZ + vec2(tE, 0.0), tLod, tR2);
            float tHz = fullHeight(tXZ + vec2(0.0, tE), tLod, tR2);
            vec3 objectNormal = normalize(vec3(tH - tHx, tE, tH - tHz));
            tH += tripBreath(tDist);
          `)
          .replace('#include <begin_vertex>', /* glsl */ `
            vec3 transformed = vec3(position.x, tH, position.z);
            vTWorld = vec3(tXZ.x, tH, tXZ.y);
            vRock = tRock;
            vSlope = 1.0 - objectNormal.y;
          `)
      shader.fragmentShader =
        FRAG_HEAD +
        shader.fragmentShader
          .replace('#include <color_fragment>', COLOR)
          .replace('#include <normal_fragment_maps>', NORMAL)
          .replace('#include <emissivemap_fragment>', EMISSIVE)
          .replace('#include <fog_fragment>', FOG)
    }
    mat.customProgramCacheKey = () => 'arrakis-terrain'

    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
    depth.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u)
      shader.vertexShader = VERT_HEAD + shader.vertexShader.replace('#include <begin_vertex>', /* glsl */ `
        vec2 tXZ = (modelMatrix * vec4(position, 1.0)).xz;
        float tRock;
        float tH = fullHeight(tXZ, 0.0, tRock) + tripBreath(length(tXZ - uCam.xz));
        vec3 transformed = vec3(position.x, tH, position.z);
      `)
    }
    depth.customProgramCacheKey = () => 'arrakis-terrain-depth'

    const mesh = new THREE.Mesh(buildGeometry(), mat)
    mesh.customDepthMaterial = depth
    mesh.frustumCulled = false
    mesh.receiveShadow = true
    mesh.castShadow = true
    return { mesh, u }
  }, [])

  useFrame(({ camera }) => {
    mesh.position.set(Math.round(camera.position.x / SPACING) * SPACING, 0, Math.round(camera.position.z / SPACING) * SPACING)
    const e = rt.env
    u.uTime.value = rt.time
    u.uTrip.value = rt.trip
    u.uDay.value = e.day
    u.uCam.value.copy(camera.position)
    u.uPlayer.value.copy(rt.player.pos)
    u.uSunDir.value.copy(e.sunDir)
    u.uSunHaze.value.copy(e.sunCol).multiplyScalar(clamp((e.sunDir.y + 0.12) / 0.17, 0, 1))
    for (let i = 0; i < MAX_WORMS; i++) {
      const w = rt.worms[i]
      const A = u.uWormA.value[i]
      const B = u.uWormB.value[i]
      if (!w || !(w.state === 'approach' || w.state === 'leave' || w.state === 'dive')) {
        B.x = 0
        continue
      }
      const depth = terrainHeight(w.head.x, w.head.z) - w.head.y
      A.set(w.head.x, w.head.z, Math.sin(w.yaw), Math.cos(w.yaw))
      B.set(clamp(1 - (depth - 8) / 16, 0, 1) * 2.6, 36, WORM_R + 1, 0)
    }
    for (let i = 0; i < MAX_FIELDS; i++) {
      const f = rt.fields[i]
      const S = u.uSpice.value[i]
      if (!f) {
        S.w = 0
        continue
      }
      S.set(f.x, f.z, fieldRadius(f), Math.sqrt(f.amount / f.capacity))
    }
    u.uPath.value.set(rt.path.ax, rt.path.az, rt.path.bx, rt.path.bz)
    u.uPathOn.value = rt.path.on
  })

  return <primitive object={mesh} />
}
