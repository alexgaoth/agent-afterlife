// Renders the scene as an aged temple mural, after the outline-and-fill technique of the
// Yongle Palace murals: ink line first, mineral pigment inside, then centuries of wear.
//   1. Kuwahara filter: shading flattens into brushed fields of pigment
//   2. ink outline from depth and colour edges (thinner with distance)
//   3. mineral grade: desaturate, blacks lift to brown ink, whites settle to paper
//   4. paper fibre, craquelure, flaked pigment, water stains, vignette
import * as THREE from "three";

const vertex = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragment = /* glsl */`
  precision highp float;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 resolution;
  uniform float near, far, aging;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
  // Distance to the nearest crack: the edge between Voronoi cells (F2 - F1).
  float cracks(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(x, y);
      vec2 o = vec2(hash(i + g), hash(i + g + 17.3));
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
    return d2 - d1;
  }
  float linearDepth(vec2 uv) {
    float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
    return (2.0 * near * far) / (far + near - z * (far - near));
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec3 kuwahara(vec2 uv) {
    vec2 px = 1.0 / resolution;
    const int R = 3;
    vec3 m[4]; vec3 s[4];
    for (int k = 0; k < 4; k++) { m[k] = vec3(0.0); s[k] = vec3(0.0); }
    for (int j = -R; j <= R; j++) for (int i = -R; i <= R; i++) {
      vec3 c = texture2D(tColor, uv + vec2(i, j) * px).rgb;
      vec3 c2 = c * c;
      if (i <= 0 && j <= 0) { m[0] += c; s[0] += c2; }
      if (i >= 0 && j <= 0) { m[1] += c; s[1] += c2; }
      if (i <= 0 && j >= 0) { m[2] += c; s[2] += c2; }
      if (i >= 0 && j >= 0) { m[3] += c; s[3] += c2; }
    }
    float n = float((R + 1) * (R + 1));
    vec3 best = vec3(0.0); float bestV = 1e9;
    for (int k = 0; k < 4; k++) {
      vec3 mean = m[k] / n;
      vec3 v = abs(s[k] / n - mean * mean);
      float sv = v.r + v.g + v.b;
      if (sv < bestV) { bestV = sv; best = mean; }
    }
    return best;
  }

  void main() {
    vec2 px = 1.0 / resolution;
    vec3 col = kuwahara(vUv);

    // Ink outline: depth edges (silhouettes, steps) and colour edges (pattern, folds).
    float d = linearDepth(vUv);
    float dd = 0.0, cd = 0.0;
    for (int k = 0; k < 4; k++) {
      vec2 o = vec2(k == 0 ? 1.0 : k == 1 ? -1.0 : 0.0, k == 2 ? 1.0 : k == 3 ? -1.0 : 0.0) * px * 1.2;
      dd += abs(linearDepth(vUv + o) - d);
      cd += abs(luma(texture2D(tColor, vUv + o).rgb) - luma(texture2D(tColor, vUv).rgb));
    }
    float ink = smoothstep(0.035, 0.09, dd / max(d, 0.5)) + smoothstep(0.28, 0.5, cd) * 0.6;
    ink *= (1.0 - smoothstep(60.0, 120.0, d) * 0.6) * (1.0 - smoothstep(125.0, 145.0, d));  // far lines fade; the backdrop has none
    ink = clamp(ink, 0.0, 1.0) * (0.75 + 0.25 * noise(gl_FragCoord.xy * 0.35)); // a brush line is never even

    // Mineral grade.
    float l = luma(col);
    col = mix(col, vec3(l), 0.1);
    col = mix(vec3(0.15, 0.11, 0.08), vec3(0.96, 0.92, 0.82), col);        // blacks to brown ink, whites to paper
    col *= vec3(1.0, 0.975, 0.93);
    col = mix(col, vec3(0.17, 0.12, 0.09), ink * 0.85);

    // The painted surface ages.
    vec2 p = gl_FragCoord.xy;
    float fibre = noise(vec2(p.x * 0.9, p.y * 0.06)) * 0.06 + fbm(p * 0.02) * 0.10;
    col *= 0.92 + fibre;
    float crackMask = smoothstep(0.58, 0.72, fbm(p * 0.006 + 3.1));
    float crack = 1.0 - smoothstep(0.0, 0.03, cracks(p * 0.09));
    col = mix(col, col * 0.72, crack * crackMask * 0.7 * aging);
    float flake = smoothstep(0.7, 0.73, fbm(p * 0.045 + 9.0)) * smoothstep(0.55, 0.8, fbm(p * 0.004));
    col = mix(col, col * 0.85 + vec3(0.1, 0.09, 0.07), flake * 0.6 * aging);           // small losses down to the ground layer
    float stain = smoothstep(0.55, 0.95, fbm(p * 0.0022 + 1.7));
    col = mix(col, col * vec3(0.85, 0.75, 0.62), stain * 0.3 * aging);
    vec2 v = vUv - 0.5;
    col *= 1.0 - dot(v, v) * 0.9;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Mural {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1), samples: 0 });
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment,
      uniforms: { tColor: { value: null }, tDepth: { value: null }, resolution: { value: new THREE.Vector2() },
                  near: { value: 0.1 }, far: { value: 300 }, aging: { value: 1 } },
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.enabled = true;
  }
  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    this.target.setSize(w * pr, h * pr);
    this.material.uniforms.resolution.value.set(w * pr, h * pr);
  }
  render(scene, camera) {
    if (!this.enabled) { this.renderer.setRenderTarget(null); this.renderer.render(scene, camera); return; }
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    const u = this.material.uniforms;
    u.tColor.value = this.target.texture; u.tDepth.value = this.target.depthTexture;
    u.near.value = camera.near; u.far.value = camera.far;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }
}
