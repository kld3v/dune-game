import { Pass } from 'postprocessing'
import * as THREE from 'three'

// Feedback trails: each frame keeps the brighter of itself and the faded previous frame.
export class AfterimagePass extends Pass {
  damp = 0
  private prev: THREE.WebGLRenderTarget
  private next: THREE.WebGLRenderTarget
  private mat: THREE.ShaderMaterial

  constructor() {
    super('AfterimagePass')
    const opts = { type: THREE.HalfFloatType, depthBuffer: false }
    this.prev = new THREE.WebGLRenderTarget(1, 1, opts)
    this.next = new THREE.WebGLRenderTarget(1, 1, opts)
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tNew: { value: null }, tOld: { value: null }, uDamp: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = position.xy * 0.5 + 0.5;
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tNew;
        uniform sampler2D tOld;
        uniform float uDamp;
        varying vec2 vUv;
        void main() {
          vec4 n = texture2D(tNew, vUv);
          vec4 o = texture2D(tOld, vUv) * uDamp;
          gl_FragColor = max(n, o);
        }
      `,
      depthTest: false,
      depthWrite: false,
    })
    this.fullscreenMaterial = this.mat
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget | null,
    outputBuffer: THREE.WebGLRenderTarget | null,
  ) {
    if (!inputBuffer) return
    this.mat.uniforms.tNew.value = inputBuffer.texture
    this.mat.uniforms.tOld.value = this.prev.texture
    this.mat.uniforms.uDamp.value = this.damp
    renderer.setRenderTarget(this.next)
    renderer.render(this.scene, this.camera)
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer)
    renderer.render(this.scene, this.camera)
    const t = this.prev
    this.prev = this.next
    this.next = t
  }

  override setSize(width: number, height: number) {
    this.prev.setSize(width, height)
    this.next.setSize(width, height)
  }

  override dispose() {
    super.dispose()
    this.prev.dispose()
    this.next.dispose()
  }
}
