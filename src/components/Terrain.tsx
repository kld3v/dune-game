import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { heightData, TERRAIN_SEGS } from '../lib/terrain'

const TERRAIN_SIZE = 300

export default function Terrain() {
  const meshRef = useRef<THREE.Mesh>(null!)
  const timeRef = useRef(0)
  const shaderRef = useRef<THREE.WebGLProgramParametersWithUniforms | null>(null)

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGS, TERRAIN_SEGS)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightData[i])
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    return geo
  }, [])

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#c8a96e'),
      roughness: 0.95,
      metalness: 0.02,
      side: THREE.FrontSide,
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.time = { value: 0 }
      shader.vertexShader = [
        'uniform float time;',
        shader.vertexShader,
      ].join('\n').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ripple = sin(position.x * 0.3 + time * 1.2) * sin(position.z * 0.3 + time * 0.8) * 0.04;
        transformed.y += ripple;`
      )
      shaderRef.current = shader
    }
    return mat
  }, [])

  // Vertex colors for subtle spice tinting
  useMemo(() => {
    const cnt = geometry.attributes.position.count
    const colors = new Float32Array(cnt * 3)
    const pos = geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < cnt; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      const spiceMix = Math.max(0,
        Math.sin(x * 0.07) * Math.cos(z * 0.05) * 0.5 +
        Math.sin(x * 0.03 + 1.2) * Math.sin(z * 0.04 + 0.8) * 0.3
      )
      colors[i * 3]     = 0.78 + spiceMix * 0.2
      colors[i * 3 + 1] = 0.66 + spiceMix * 0.05
      colors[i * 3 + 2] = 0.43 - spiceMix * 0.1
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    material.vertexColors = true
  }, [geometry, material])

  useFrame((_, dt) => {
    timeRef.current += dt
    if (shaderRef.current) shaderRef.current.uniforms.time.value = timeRef.current
  })

  return (
    <mesh ref={meshRef} geometry={geometry} material={material} receiveShadow />
  )
}
