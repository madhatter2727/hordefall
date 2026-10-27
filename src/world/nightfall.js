// M13 — Nightfall: the city slides from sunset (waves 1-3) through dusk into full night (wave 10+).
// Everything is a lerp of existing lights / fog / sky uniforms, eased over NIGHT.blend seconds, so the
// shader light count never changes (no recompiles). One extra non-shadow spot light (the weapon flashlight)
// is created up front and just sits at intensity 0 by day.
import * as THREE from 'three';
import { NIGHT, SPECIAL } from '../tuning.js';
import { EYE_MATS } from '../rig.js';
import { SKY_NIGHT } from './skyline.js';

const lerp = (a, b, t) => a + (b - a) * t;
const C = (h) => new THREE.Color(h);
const EYE_NIGHT = new THREE.Color(1.0, 0.32, 0.08);

export class Nightfall {
  constructor(game) {
    this.g = game; this.k = 0; this.target = 0; this.applied = -1;
    const s = game.scene;
    this.hemi = s.children.find((o) => o.isHemisphereLight);
    this.day = {
      fog: s.fog.color.clone(), sun: game.sun.color.clone(), hemiSky: this.hemi.color.clone(), hemiGround: this.hemi.groundColor.clone(),
      vmSun: game.vmSun.intensity, vmHemi: game.vmHemi.intensity, vmSunCol: game.vmSun.color.clone(), vmEnv: game.vmScene.environmentIntensity,
    };
    this.night = {
      fog: new THREE.Color().setRGB(0.028, 0.032, 0.06, THREE.LinearSRGBColorSpace), sun: C('#8ea6e6'), hemiSky: C('#4a5a8c'), hemiGround: C('#1c1a22'), vmSunCol: C('#a4b6ee'),
    };
    // weapon flashlight: a soft cone from just under the camera, no shadows
    const fl = (this.flash = new THREE.SpotLight('#fff1dc', 0, 34, 0.42, 0.55, 1.4));
    fl.castShadow = false; s.add(fl, fl.target);
    this.tmp = new THREE.Vector3(); this.col = new THREE.Color();
  }
  // night amount for a wave (0 sunset … 1 night)
  stageOf(w) { return THREE.MathUtils.clamp(NIGHT.stage(Math.max(1, w)), 0, 1); }
  stageName(k = this.k) { return k < 0.15 ? 'sunset' : k < 0.85 ? 'dusk' : 'night'; }
  snap(w) { this.target = this.k = this.stageOf(w); this.apply(true); }
  update(dt, wave) {
    this.target = this.stageOf(wave);
    const step = dt / NIGHT.blend;
    this.k = this.k < this.target ? Math.min(this.target, this.k + step) : Math.max(this.target, this.k - step * 4);
    const live = this.g.specialLive; if (live) this.spCur = live;
    this.spW = this.spCur ? THREE.MathUtils.clamp((this.spW || 0) + (live ? 1 : -1) * dt / SPECIAL.ease, 0, 1) : 0;
    this.apply();
    // flashlight follows the camera every frame
    const fl = this.flash, cam = this.g.camera;
    if (fl.intensity > 0) {
      cam.getWorldDirection(this.tmp);
      fl.position.copy(cam.position).addScaledVector(this.tmp, 0.3); fl.position.y -= 0.18;
      fl.target.position.copy(cam.position).addScaledVector(this.tmp, 12); fl.target.updateMatrixWorld();
    }
  }
  apply(force = false) {
    const sw0 = this.spW || 0, ST = this.spCur, bo = ST?.type === 'blackout' ? sw0 : 0, fo = ST?.type === 'fog' ? sw0 : 0;
    const k = this.k, e0 = k * k * (3 - 2 * k), e = lerp(e0, 1, bo), g = this.g, s = g.scene, D = this.day, N = this.night;
    // lamps/fire pools: read by the light loop in main.js every frame
    g.lampMul = (1 + NIGHT.lampBoost * e) * lerp(1, ST?.lamps ?? 1, bo); g.lampFlick = NIGHT.lampFlicker * e * (1 + 2 * bo);
    const f = THREE.MathUtils.clamp((e - NIGHT.flashOn) / (1 - NIGHT.flashOn), 0, 1);
    this.flash.intensity = g.state === 'play' || g.state === 'paused' ? NIGHT.flashlight * f * lerp(1, ST?.flashlight ?? 1, bo) : 0;
    if (!force && Math.abs(this.applied - e) + Math.abs((this.appliedSw ?? 0) - sw0) < 0.002 && this.eyes === EYE_MATS.length) return;
    this.applied = e; this.appliedSw = sw0;
    const am = lerp(1, ST?.ambient ?? 1, bo);
    g.sun.intensity = lerp(NIGHT.sun[0], NIGHT.sun[1], e) * am; g.sun.color.lerpColors(D.sun, N.sun, e);
    this.hemi.intensity = lerp(NIGHT.hemi[0], NIGHT.hemi[1], e) * am; this.hemi.color.lerpColors(D.hemiSky, N.hemiSky, e); this.hemi.groundColor.lerpColors(D.hemiGround, N.hemiGround, e);
    s.environmentIntensity = lerp(NIGHT.env[0], NIGHT.env[1], e) * am;
    s.fog.density = lerp(NIGHT.fog[0], NIGHT.fog[1], e) * lerp(1, ST?.fog ?? 1, fo); s.fog.color.lerpColors(D.fog, N.fog, e);
    if (fo > 0) { const m = ST.fogColor, dim = 1 - 0.82 * e; s.fog.color.lerp(this.col.setRGB(m[0] * dim, m[1] * dim, m[2] * dim, THREE.LinearSRGBColorSpace), fo); }
    g.renderer.toneMappingExposure = lerp(NIGHT.exposure[0], NIGHT.exposure[1], e);
    g.sky.material.uniforms.night.value = e; SKY_NIGHT.value = e;
    g.vmSun.intensity = lerp(D.vmSun, D.vmSun * 0.4, e); g.vmSun.color.lerpColors(D.vmSunCol, N.vmSunCol, e);
    g.vmHemi.intensity = lerp(D.vmHemi, D.vmHemi * 0.55, e); g.vmScene.environmentIntensity = lerp(D.vmEnv, D.vmEnv * 0.5, e);
    for (const L of g.arena.lights) if (L.head) L.head.material.color.setRGB(6 + 4 * e, 4.2 + 2.8 * e, 2.4 + 1.4 * e).multiplyScalar(lerp(1, 0.04, bo));
    this.col.setRGB(0.5, 0.42, 0.18).lerp(EYE_NIGHT, e); this.eyes = EYE_MATS.length;
    for (const m of EYE_MATS) { m.emissive.copy(this.col); m.emissiveIntensity = lerp(0.6, NIGHT.eyeGlow, e); }
  }
}
