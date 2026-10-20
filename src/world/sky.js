import * as THREE from 'three';

// Dusk sky dome: gradient, low sun with halo, banded clouds lit from below, smoke haze near the horizon.
export const SUN_DIR = new THREE.Vector3(-0.62, 0.16, -0.77).normalize();

export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: true,
    uniforms: { sunDir: { value: SUN_DIR }, time: { value: 0 } },
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir; uniform float time; varying vec3 vDir;
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
        col += vec3(30.0, 18.0, 9.0) * smoothstep(0.9993, 0.9997, sd);
        // clouds
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 1.6 + vec2(time * 0.004, 0.0);
          float c = smoothstep(0.45, 0.85, fbm(uv));
          vec3 cc = mix(vec3(0.25, 0.16, 0.22), vec3(1.4, 0.62, 0.36), pow(sd, 3.0) * 0.9 + 0.15);
          col = mix(col, cc, c * smoothstep(0.0, 0.12, h) * 0.85);
        }
        // smoke haze on the horizon
        col = mix(col, vec3(0.42, 0.33, 0.38), smoothstep(0.08, -0.05, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  mesh.renderOrder = -10; mesh.frustumCulled = false;
  return mesh;
}
