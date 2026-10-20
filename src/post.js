import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { screenBloodTexture } from './world/textures.js';

// Final pass: color grade (split-tone), chromatic fringe, vignette, film grain, damage + low-health pulse.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, damage: { value: 0 }, lowHealth: { value: 0 },
    ads: { value: 0 }, aspect: { value: 1 }, flash: { value: 0 }, dead: { value: 0 }, acid: { value: 0 }, blood: { value: 0 }, bloodSeed: { value: 0 }, tBlood: { value: null },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time, damage, lowHealth, ads, aspect, flash, dead, acid, blood, bloodSeed; uniform sampler2D tBlood; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 13.7) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; c.x *= aspect; float r = length(c);
      vec2 off = (vUv - 0.5) * (0.0008 + damage * 0.006) * (1.0 + r * 2.0);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      // grade: lift shadows toward teal, push highlights warm, a touch of extra contrast
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, col * vec3(0.92, 1.0, 1.08) + vec3(0.0, 0.006, 0.014), 1.0 - smoothstep(0.0, 0.45, l));
      col = mix(col, col * vec3(1.06, 1.0, 0.92), smoothstep(0.45, 1.0, l));
      col = (col - 0.5) * 1.06 + 0.5;
      col = mix(vec3(l), col, 1.06 - dead * 0.9);
      // vignette (tighter when aiming)
      float vig = smoothstep(0.95 - ads * 0.18, 0.28, r);
      col *= mix(0.62, 1.0, vig);
      // damage: red edges + pulsing at low health
      float edge = smoothstep(0.25, 0.95, r);
      float pulse = lowHealth * (0.55 + 0.45 * sin(time * 6.0));
      col = mix(col, vec3(0.45, 0.0, 0.02), clamp(edge * (damage * 0.9 + pulse * 0.6), 0.0, 0.85));
      // acid: sickly green wash, strongest at the edges, with a wobble
      float ac = clamp(acid, 0.0, 1.0);
      col = mix(col, col * vec3(0.6, 1.12, 0.45) + vec3(0.01, 0.05, 0.0), ac * 0.5);
      col = mix(col, vec3(0.18, 0.55, 0.05), clamp(edge * ac * (0.75 + 0.25 * sin(time * 9.0 + vUv.y * 20.0)), 0.0, 0.55));
      // close-kill blood on the 'lens': edges first, slides down a little as it fades
      if (blood > 0.001) {
        vec2 bu = vUv; bu.x = bloodSeed > 0.5 ? 1.0 - bu.x : bu.x; bu.y += (1.0 - blood) * 0.06;
        float bm = texture2D(tBlood, bu).r * smoothstep(0.0, 0.35, blood);
        bm *= smoothstep(0.12, 0.5, r + 0.25 * (1.0 - blood));
        col = mix(col, vec3(0.16, 0.0, 0.005) + col * vec3(0.25, 0.0, 0.0), clamp(bm, 0.0, 0.92));
      }
      col += vec3(1.0, 0.9, 0.8) * flash * 0.08;
      col += (hash(vUv * 731.0) - 0.5) * 0.035;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, vmScene, vmCamera) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.composer = new EffectComposer(renderer);
    this.worldPass = new RenderPass(scene, camera);
    this.composer.addPass(this.worldPass);
    const s = renderer.getSize(new THREE.Vector2());
    this.gtao = new GTAOPass(scene, camera, s.x, s.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.5, scale: 1, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.composer.addPass(this.gtao);
    this.vmPass = new RenderPass(vmScene, vmCamera);
    this.vmPass.clear = false; this.vmPass.clearDepth = true;
    this.composer.addPass(this.vmPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(s.x / 2, s.y / 2), 0.55, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.u = this.grade.uniforms;
    this.u.tBlood.value = screenBloodTexture();
  }
  setQuality(q) {
    this.gtao.enabled = q === 'high';
    this.bloom.enabled = q !== 'low';
  }
  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.u.aspect.value = w / h;
  }
  render() { this.composer.render(); }
}
