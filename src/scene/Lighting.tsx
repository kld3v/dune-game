import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { rt } from '../game/rt'
import { terrainHeight } from '../game/terrain'
import { setReflections } from './reflections'

const SHADOW_HALF = 80
const SHADOW_RES = 2048
const TEXEL = (SHADOW_HALF * 2) / SHADOW_RES
const SAND = new THREE.Color('#c08a52')

const up = new THREE.Vector3(0, 1, 0)
const fwd = new THREE.Vector3()
const right = new THREE.Vector3()
const upv = new THREE.Vector3()
const focus = new THREE.Vector3()

function buildEnvScene() {
  const u = {
    uZen: { value: new THREE.Color() },
    uHor: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color() },
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZen;
      uniform vec3 uHor;
      uniform vec3 uGround;
      uniform vec3 uSunDir;
      uniform vec3 uSunCol;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 sky = mix(uHor, uZen, pow(max(d.y, 0.0), 0.5));
        vec3 col = mix(uGround, sky, smoothstep(-0.08, 0.04, d.y));
        col += uSunCol * pow(max(dot(d, uSunDir), 0.0), 64.0) * 6.0;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  })
  const scene = new THREE.Scene()
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat))
  return { scene, u }
}

export function Lighting() {
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const { sun, hemi } = useMemo(() => {
    const sun = new THREE.DirectionalLight('#ffffff', 3)
    sun.castShadow = true
    sun.shadow.mapSize.set(SHADOW_RES, SHADOW_RES)
    const cam = sun.shadow.camera
    cam.left = -SHADOW_HALF
    cam.right = SHADOW_HALF
    cam.top = SHADOW_HALF
    cam.bottom = -SHADOW_HALF
    cam.near = 20
    cam.far = 620
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.35
    const hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1)
    return { sun, hemi }
  }, [])
  const env = useMemo(() => ({ ...buildEnvScene(), pmrem: new THREE.PMREMGenerator(gl), target: null as THREE.WebGLRenderTarget | null, next: 0 }), [gl])

  useEffect(() => {
    scene.fog = new THREE.Fog('#d8b88a', 60, 640)
    scene.add(sun, sun.target, hemi)
    return () => {
      scene.remove(sun, sun.target, hemi)
      scene.fog = null
    }
  }, [scene, sun, hemi])

  useEffect(() => () => {
    env.target?.dispose()
    env.pmrem.dispose()
  }, [env])

  useFrame(() => {
    const e = rt.env
    const p = rt.player.pos
    focus.copy(p)
    focus.y = Math.min(focus.y, terrainHeight(p.x, p.z) + 20)
    // Snap the shadow frustum to whole texels in light space so shadows don't crawl.
    fwd.copy(e.lightDir).negate()
    right.crossVectors(fwd, up).normalize()
    upv.crossVectors(right, fwd)
    const r = Math.round(focus.dot(right) / TEXEL) * TEXEL
    const v = Math.round(focus.dot(upv) / TEXEL) * TEXEL
    const f = focus.dot(fwd)
    focus.copy(right).multiplyScalar(r).addScaledVector(upv, v).addScaledVector(fwd, f)
    sun.target.position.copy(focus)
    sun.position.copy(focus).addScaledVector(e.lightDir, 260)
    sun.target.updateMatrixWorld()
    sun.color.copy(e.lightCol)
    sun.intensity = e.lightIntensity
    hemi.color.copy(e.hemiSky)
    hemi.groundColor.copy(e.hemiGround)
    hemi.intensity = e.hemiIntensity

    // Haze thins out as you climb, so the ornithopter can see the land below it.
    const fog = scene.fog as THREE.Fog | null
    if (fog) {
      const c = rt.cam.pos
      const alt = Math.min(200, Math.max(0, c.y - terrainHeight(c.x, c.z)))
      fog.color.copy(e.horizon)
      fog.near = 60 + alt * 0.9
      fog.far = 640 + alt * 0.25
    }

    if (rt.realTime >= env.next) {
      env.next = rt.realTime + 3
      env.u.uZen.value.copy(e.zenith)
      env.u.uHor.value.copy(e.horizon)
      env.u.uGround.value.copy(SAND).multiplyScalar(e.lightIntensity * 0.12 + e.hemiIntensity * 0.25)
      env.u.uSunDir.value.copy(e.sunDir)
      env.u.uSunCol.value.copy(e.sunCol).multiplyScalar(e.sunDir.y > -0.05 ? 1 : 0)
      const old = env.target
      env.target = env.pmrem.fromScene(env.scene, 0.02, 0.1, 50)
      setReflections(env.target.texture)
      old?.dispose()
    }
  })

  return null
}
