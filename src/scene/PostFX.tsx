import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  BlendFunction, BloomEffect, EffectComposer, EffectPass, NoiseEffect, RenderPass,
  ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing'
import { HallucinationEffect } from './effects/HallucinationEffect'
import { AfterimagePass } from './effects/AfterimagePass'
import { TimeEffect } from './effects/TimeEffect'
import { rt } from '../game/rt'
import { smoothstep } from '../game/math'

// Scene renders linear HDR; bloom, then tone mapping, then the trip effects work on
// display-range colour, and the last pass converts to sRGB for the screen.
export function PostFX() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)

  const fx = useMemo(() => {
    const composer = new EffectComposer(gl, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: Math.min(4, gl.capabilities.maxSamples),
    })
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new BloomEffect({
      intensity: 0.85,
      luminanceThreshold: 0.92,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
      radius: 0.72,
    })
    composer.addPass(new EffectPass(camera, bloom))
    composer.addPass(new EffectPass(camera, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })))
    const time = new TimeEffect()
    const timePass = new EffectPass(camera, time)
    composer.addPass(timePass)
    const hallu = new HallucinationEffect()
    const halluPass = new EffectPass(camera, hallu)
    composer.addPass(halluPass)
    const after = new AfterimagePass()
    composer.addPass(after)
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.5 })
    const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false })
    noise.blendMode.opacity.value = 0.05
    composer.addPass(new EffectPass(camera, vignette, noise))
    return { composer, bloom, hallu, halluPass, after, vignette, time, timePass, flashWas: 0, white: 0 }
  }, [gl, scene, camera])

  useEffect(() => {
    fx.composer.setSize(size.width, size.height)
  }, [fx, size, dpr])

  useEffect(() => () => fx.composer.dispose(), [fx])

  useFrame((_, delta) => {
    const trip = rt.trip
    fx.hallu.uniforms.get('uIntensity')!.value = trip
    fx.hallu.uniforms.get('uT')!.value = rt.time
    fx.halluPass.enabled = trip > 0.004
    fx.after.damp = smoothstep(0.3, 1.0, trip) * 0.84
    fx.after.enabled = fx.after.damp > 0.01
    fx.bloom.intensity = 0.85 + trip * 1.3
    fx.vignette.darkness = 0.5 + trip * 0.3
    const flash = rt.flash.t > 0 ? 1 : 0
    if (flash !== fx.flashWas) {
      fx.white = 1
      fx.flashWas = flash
    }
    if (rt.whiteout > 0) {
      fx.white = Math.max(fx.white, rt.whiteout)
      rt.whiteout = 0
    }
    fx.white = Math.max(0, fx.white - delta * (fx.white > 0.6 ? 0.8 : 5))
    fx.time.uniforms.get('uSlow')!.value = rt.slowmo
    fx.time.uniforms.get('uFlash')!.value = flash
    fx.time.uniforms.get('uWhite')!.value = fx.white
    fx.timePass.enabled = rt.slowmo > 0.01 || flash > 0 || fx.white > 0.001
    fx.composer.render(delta)
  }, 1)

  return null
}
