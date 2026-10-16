import { Effect, EffectAttribute } from 'postprocessing'
import { Uniform } from 'three'

// Breathing warp, kaleidoscope at the edges, chromatic split, double vision, the blue
// tint of spice-saturated eyes and a slow hue drift. Everything scales with uIntensity.
const FRAG = /* glsl */ `
uniform float uIntensity;
uniform float uT;

vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

vec2 kaleido(vec2 uv, float n) {
  vec2 p = uv - 0.5;
  p.x *= aspect;
  float r = length(p);
  float a = atan(p.y, p.x);
  float seg = 6.2831853 / n;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  p = r * vec2(cos(a), sin(a));
  p.x /= aspect;
  return p + 0.5;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float I = uIntensity;
  float t = uT;
  vec2 c = uv - 0.5;
  float r = length(c * vec2(aspect, 1.0));
  vec2 p = uv;
  p += c * sin(t * 1.3 + r * 9.0) * 0.012 * I;
  p.x += sin(p.y * 14.0 + t * 1.7) * 0.004 * I;
  p.y += cos(p.x * 11.0 + t * 1.1) * 0.004 * I;
  float kAmt = smoothstep(0.6, 1.0, I) * smoothstep(0.2, 0.55, r);
  p = mix(p, kaleido(p, 6.0), kAmt * 0.6);
  vec2 dir = (p - 0.5) * (0.004 + 0.018 * I);
  vec3 col;
  col.r = texture2D(inputBuffer, p + dir).r;
  col.g = texture2D(inputBuffer, p).g;
  col.b = texture2D(inputBuffer, p - dir).b;
  vec2 gOff = vec2(sin(t * 0.7), cos(t * 0.53)) * 0.02 * I;
  vec3 ghost = texture2D(inputBuffer, p + gOff).rgb;
  col = mix(col, max(col, ghost), 0.35 * I);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 ibad = vec3(0.1, 0.35, 1.0) * (lum * 1.2 + 0.05);
  col = mix(col, ibad + col * 0.4, smoothstep(0.2, 0.9, I) * 0.45 * (1.0 - lum));
  col = hueRotate(col, I * I * sin(t * 0.21 + r * 3.0) * 1.6);
  col = mix(vec3(lum), col, 1.0 + I * 0.6);
  col *= 1.0 + 0.08 * I * sin(t * 2.4);
  outputColor = vec4(max(col, 0.0), inputColor.a);
}
`

export class HallucinationEffect extends Effect {
  constructor() {
    super('HallucinationEffect', FRAG, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['uIntensity', new Uniform(0)],
        ['uT', new Uniform(0)],
      ]),
    })
  }
}
