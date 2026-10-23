import * as THREE from 'three';

// Dusk sky dome: gradient, low sun with halo, banded clouds lit from below, smoke haze near the horizon.
export const SUN_DIR = new THREE.Vector3(-0.62, 0.16, -0.77).normalize();

export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: true,
    uniforms: { sunDir: { value: SUN_DIR }, time: { value: 0 }, night: { value: 0 }, moonDir: { value: new THREE.Vector3(0.45, 0.42, 0.79).normalize() } },
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir; uniform float time; uniform float night; uniform vec3 moonDir; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 zenith = vec3(0.10, 0.11, 0.22), mid = vec3(0.42, 0.28, 0.38), horizon = vec3(1.25, 0.58, 0.32);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, zenith, smoothstep(0.18, 0.75, h));
        float sd = max(dot(d, sunDir), 0.0);
        col += vec3(1.6, 0.7, 0.3) * pow(sd, 6.0) * 0.8 + vec3(2.0, 1.0, 0.5) * pow(sd, 64.0);
        col += vec3(30.0, 18.0, 9.0) * smoothstep(0.9993, 0.9997, sd) * (1.0 - night);
        // night palette (M13 nightfall): deep blue dome, city glow on the horizon, stars, a cold moon
        vec3 ncol = mix(vec3(0.15, 0.09, 0.1), vec3(0.03, 0.035, 0.075), smoothstep(0.0, 0.2, h));
        ncol = mix(ncol, vec3(0.006, 0.009, 0.03), smoothstep(0.18, 0.75, h));
        ncol += vec3(0.25, 0.1, 0.06) * pow(sd, 5.0) * 0.5; // last ember where the sun went down
        float md = max(dot(d, moonDir), 0.0);
        ncol += vec3(0.12, 0.15, 0.26) * pow(md, 24.0) + vec3(1.1, 1.15, 1.3) * smoothstep(0.99935, 0.9996, md) * 2.5;
        vec3 sp = d * 260.0, ci = floor(sp); float st = hash(ci.xy + vec2(ci.z * 17.0, ci.z * 3.1));
        float tw = 0.55 + 0.45 * sin(time * 2.7 + st * 60.0);
        ncol += vec3(1.0, 0.95, 0.88) * step(0.9955, st) * smoothstep(0.04, 0.35, h) * tw * 1.8 * smoothstep(0.5, 0.1, length(fract(sp) - 0.5));
        float c = 0.0;
        // clouds
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 1.6 + vec2(time * 0.004, 0.0);
          c = smoothstep(0.45, 0.85, fbm(uv)) * smoothstep(0.0, 0.12, h);
          vec3 cc = mix(vec3(0.25, 0.16, 0.22), vec3(1.4, 0.62, 0.36), pow(sd, 3.0) * 0.9 + 0.15);
          col = mix(col, cc, c * 0.85);
          ncol = mix(ncol, vec3(0.03, 0.033, 0.05) + vec3(0.1, 0.11, 0.16) * pow(md, 6.0), c * 0.9);
        }
        col = mix(col, ncol, night);
        // smoke haze on the horizon
        col = mix(col, mix(vec3(0.42, 0.33, 0.38), vec3(0.07, 0.06, 0.085), night), smoothstep(0.08, -0.05, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  mesh.renderOrder = -10; mesh.frustumCulled = false;
  return mesh;
}
