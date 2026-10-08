#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform sampler2D uLut;
uniform vec2 imageSize;
uniform float lutSize;
uniform float lutIntensity;
uniform float exposureEv;
uniform float grainAmount;
uniform float grainSize;
uniform float grainRoughness;
uniform float halationAmount;
uniform float halationRadius;
uniform float bloomAmount;
uniform float bloomRadius;
uniform float sharpnessAmount;
uniform float vignetteAmount;
uniform float seed;
uniform float legacy;
uniform vec4 matrix0;
uniform vec4 matrix1;
uniform vec4 matrix2;
uniform vec4 matrix3;
uniform vec4 matrixOffset;
out vec4 fragColor;

vec3 lookupLut(vec3 color) {
  vec3 scaled = clamp(color, 0.0, 1.0) * (lutSize - 1.0);
  float blue0 = floor(scaled.b);
  float blue1 = min(lutSize - 1.0, blue0 + 1.0);
  vec2 atlas = vec2(lutSize * lutSize, lutSize);
  vec2 first = vec2(blue0 * lutSize + scaled.r + 0.5, scaled.g + 0.5);
  vec2 second = vec2(blue1 * lutSize + scaled.r + 0.5, scaled.g + 0.5);
  vec3 mapped = mix(texture(uLut, first / atlas).rgb,
                    texture(uLut, second / atlas).rgb, fract(scaled.b));
  return mix(color, mapped, lutIntensity);
}
vec3 grade(vec2 position) {
  vec3 source = texture(uImage, clamp(position, vec2(0), imageSize - vec2(1)) / imageSize).rgb;
  return lookupLut(clamp(source * exp2(exposureEv), 0.0, 1.0));
}
float noise(vec2 position) {
  float scale = mix(0.55, 2.8, grainSize);
  vec2 cell = floor(position / scale);
  float base = fract(sin(dot(cell + seed, vec2(12.9898, 78.233))) * 43758.5453);
  float coarse = fract(sin(dot(floor(cell * 0.37) + seed * 1.7, vec2(39.3468, 11.135))) * 24634.6345);
  return mix(base, coarse, grainRoughness) - 0.5;
}
void main() {
  // GL row zero maps to decoded bitmap row zero, so readback preserves orientation.
  vec2 xy = gl_FragCoord.xy;
  vec4 original = texture(uImage, xy / imageSize);
  if (legacy > 0.5) {
    fragColor = clamp(vec4(dot(original, matrix0), dot(original, matrix1),
                          dot(original, matrix2), dot(original, matrix3)) + matrixOffset, 0.0, 1.0);
    return;
  }
  vec3 color = grade(xy);
  float radius = 1.0 + max(halationRadius, bloomRadius) * 14.0;
  vec3 blurred = (grade(xy + vec2(radius, 0)) + grade(xy - vec2(radius, 0)) +
    grade(xy + vec2(0, radius)) + grade(xy - vec2(0, radius)) +
    grade(xy + vec2(radius, radius)) + grade(xy + vec2(-radius, radius)) +
    grade(xy + vec2(radius, -radius)) + grade(xy - vec2(radius, radius))) * 0.125;
  float highlight = smoothstep(0.55, 0.98, dot(blurred, vec3(0.2126, 0.7152, 0.0722)));
  color += blurred * highlight * (bloomAmount * 0.35);
  vec3 redGlow = vec3(1.0, 0.24, 0.08) * max(vec3(0), blurred - color);
  color += redGlow * highlight * (halationAmount * 0.75);
  color += noise(xy) * grainAmount * 0.16;
  color += (color - blurred) * (sharpnessAmount * 0.65);
  vec2 normalized = (xy / imageSize) * 2.0 - 1.0;
  float edge = smoothstep(0.28, 1.35, dot(normalized, normalized));
  color *= 1.0 - edge * vignetteAmount * 0.72;
  fragColor = vec4(clamp(color, 0.0, 1.0), original.a);
}
