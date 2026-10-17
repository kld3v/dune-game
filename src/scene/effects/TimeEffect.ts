import { Effect, EffectAttribute } from 'postprocessing'
import { Uniform } from 'three'

// Time bending. uSlow: prescience slow motion, the world smeared toward the centre and
// drained of colour. uFlash: a vision of the future, in gold. uWhite: the flash of the cut.
const FRAG = /* glsl */ `
uniform float uSlow;
uniform float uFlash;
uniform float uWhite;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 col = inputColor.rgb;
  if (uSlow > 0.001) {
    vec2 dir = (uv - 0.5) * 0.03 * uSlow;
    vec3 acc = col;
    acc += texture2D(inputBuffer, uv - dir).rgb;
    acc += texture2D(inputBuffer, uv - dir * 2.0).rgb;
    acc += texture2D(inputBuffer, uv - dir * 3.0).rgb;
    col = mix(col, acc * 0.25, uSlow * 0.8);
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(l) * vec3(0.85, 0.95, 1.15), uSlow * 0.5);
  }
  if (uFlash > 0.001) {
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 gold = vec3(1.25, 0.95, 0.55) * (l * 1.15 + 0.04);
    col = mix(col, gold, uFlash * 0.85);
    vec2 c = uv - 0.5;
    col *= 1.0 - dot(c, c) * 1.3 * uFlash;
  }
  col = mix(col, vec3(1.0, 0.96, 0.88), clamp(uWhite, 0.0, 1.0));
  outputColor = vec4(max(col, 0.0), inputColor.a);
}
`

export class TimeEffect extends Effect {
  constructor() {
    super('TimeEffect', FRAG, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['uSlow', new Uniform(0)],
        ['uFlash', new Uniform(0)],
        ['uWhite', new Uniform(0)],
      ]),
    })
  }
}
