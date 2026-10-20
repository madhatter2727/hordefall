import * as THREE from 'three';
import { bulletHoleTexture, bloodTexture } from '../world/textures.js';
import { rand } from '../core/util.js';

// ---------- billboard particle system (CPU sim, one instanced draw call) ----------
class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iVel', this.aVel); g.setAttribute('iCol', this.aCol); g.setAttribute('iSize', this.aSize);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iCol; attribute vec2 iSize;
        varying vec2 vUv; varying vec4 vCol; varying float vKind;
        void main() {
          vUv = uv; vCol = iCol; vKind = iSize.y;
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
          vec2 p = position.xy * iSize.x;
          if (iSize.y > 0.5) {
            // velocity-stretched streak (sparks)
            vec2 d = vv.xy; float l = length(d);
            vec2 dir = l > 1e-4 ? d / l : vec2(0.0, 1.0);
            vec2 side = vec2(-dir.y, dir.x);
            p = side * position.x * iSize.x * 0.35 + dir * position.y * (iSize.x + l * 0.035);
          }
          mv.xy += p;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying vec4 vCol; varying float vKind;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = vKind > 0.5 ? smoothstep(1.0, 0.2, abs(vUv.x - 0.5) * 2.0) * smoothstep(1.0, 0.6, abs(vUv.y - 0.5) * 2.0) : smoothstep(1.0, 0.25, d);
          gl_FragColor = vec4(vCol.rgb, vCol.a * a);
        }`,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: !additive,
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 3 : 2;
    scene.add(this.mesh);
    this.p = []; // {pos, vel, life, max, size, grow, col, drag, grav, kind, fade}
  }
  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({ pos: o.pos.clone(), vel: o.vel ? o.vel.clone() : new THREE.Vector3(), life: o.life, max: o.life, size: o.size, grow: o.grow || 0, col: o.col, alpha: o.alpha ?? 1, drag: o.drag ?? 0, grav: o.grav ?? 0, kind: o.kind || 0, floor: o.floor ?? -1e9 });
  }
  update(dt) {
    const P = this.p;
    let w = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i]; q.life -= dt;
      if (q.life <= 0) continue;
      q.vel.y -= q.grav * dt; q.vel.multiplyScalar(Math.exp(-q.drag * dt));
      q.pos.addScaledVector(q.vel, dt);
      if (q.pos.y < q.floor) { q.pos.y = q.floor; q.vel.y *= -0.3; q.vel.x *= 0.5; q.vel.z *= 0.5; }
      P[w++] = q;
    }
    P.length = w;
    const n = Math.min(w, this.max);
    for (let i = 0; i < n; i++) {
      const q = P[i], t = q.life / q.max;
      this.aPos.array.set([q.pos.x, q.pos.y, q.pos.z], i * 3);
      this.aVel.array.set([q.vel.x, q.vel.y, q.vel.z], i * 3);
      this.aCol.array.set([q.col.r, q.col.g, q.col.b, q.alpha * Math.min(1, t * 2.5)], i * 4);
      this.aSize.array.set([q.size + q.grow * (1 - t), q.kind], i * 2);
    }
    this.mesh.geometry.instanceCount = n;
    this.aPos.needsUpdate = this.aVel.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = true;
  }
}

// ---------- decals (instanced quads with a fade) ----------
class Decals {
  constructor(scene, max, tex, opts = {}) {
    this.max = max; this.i = 0;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: opts.roughness ?? 0.9, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.z = new THREE.Vector3(0, 0, 1);
  }
  add(pos, normal, size) {
    this.q.setFromUnitVectors(this.z, normal);
    const spin = new THREE.Quaternion().setFromAxisAngle(this.z, Math.random() * Math.PI * 2);
    this.q.multiply(spin);
    this.s.set(size, size, size);
    this.m.compose(pos.clone().addScaledVector(normal, 0.004), this.q, this.s);
    const idx = this.i++ % this.max;
    this.mesh.setMatrixAt(idx, this.m);
    this.mesh.count = Math.min(this.max, this.i);
    this.mesh.instanceMatrix.needsUpdate = true;
    return idx;
  }
  hide(idx) { this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(idx, this.m); this.mesh.instanceMatrix.needsUpdate = true; }
  clear() { this.i = 0; this.mesh.count = 0; }
}

// ---------- tracers ----------
class Tracers {
  constructor(scene, max = 48) {
    this.max = max; this.items = [];
    const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0);
    this.mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.6, 1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    // soft edges via alpha map
    const c = document.createElement('canvas'); c.width = 16; c.height = 64;
    const x = c.getContext('2d'); const gr = x.createLinearGradient(0, 0, 16, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, '#fff'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 16, 64);
    const fade = x.createLinearGradient(0, 0, 0, 64); fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    x.globalCompositeOperation = 'destination-out'; x.fillStyle = fade; x.fillRect(0, 0, 16, 64);
    this.mat.alphaMap = new THREE.CanvasTexture(c);
    this.mesh = new THREE.InstancedMesh(g, this.mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this.tmp = new THREE.Object3D();
  }
  add(from, to, speed = 380, len = 7, width = 0.022) {
    if (this.items.length >= this.max) this.items.shift();
    const dir = to.clone().sub(from); const dist = dir.length(); dir.normalize();
    this.items.push({ from: from.clone(), dir, dist, t: 0, speed, len, width });
  }
  update(dt, camera) {
    this.items = this.items.filter((it) => (it.t += dt * it.speed) < it.dist + it.len);
    const cam = camera.position;
    this.items.forEach((it, i) => {
      const head = Math.min(it.t, it.dist), tail = Math.max(0, it.t - it.len);
      const a = it.from.clone().addScaledVector(it.dir, tail), b = it.from.clone().addScaledVector(it.dir, head);
      const L = Math.max(0.001, head - tail);
      const o = this.tmp; o.position.copy(a);
      // orient: local Y along the tracer, face the camera
      const yAxis = it.dir, toCam = cam.clone().sub(a).normalize();
      const xAxis = new THREE.Vector3().crossVectors(yAxis, toCam).normalize();
      const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
      const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
      o.quaternion.setFromRotationMatrix(m);
      o.scale.set(it.width * (1 + a.distanceTo(cam) * 0.02), L, 1);
      o.updateMatrix();
      this.mesh.setMatrixAt(i, o.matrix);
      void b;
    });
    this.mesh.count = this.items.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, quality) {
    this.scene = scene;
    this.add = new Particles(scene, 1400, true);
    this.alpha = new Particles(scene, 1200, false);
    this.holes = new Decals(scene, quality === 'low' ? 160 : 400, bulletHoleTexture());
    this.blood = new Decals(scene, 140, bloodTexture(), { roughness: 0.6 });
    this.blood.mesh.material.color.set('#2a2420'); // scorch/ash marks rather than blood
    this.tracers = new Tracers(scene);
    // pooled world flash lights (muzzle + explosions)
    this.muzzleLight = new THREE.PointLight('#ffb35c', 0, 9, 2); scene.add(this.muzzleLight);
    this.flashT = 0;
    this.embers = this.makeEmbers(scene);
    this.acid = new Decals(scene, 24, bloodTexture(), { roughness: 0.2 });
    this.acid.mesh.material.color.set('#7dff4a'); this.acid.mesh.material.emissive = new THREE.Color(0.25, 1.0, 0.1); this.acid.mesh.material.emissiveIntensity = 1.4;
    this.acid.mesh.material.emissiveMap = this.acid.mesh.material.map;
    // shockwave rings (pooled)
    this.waves = [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.3, 0.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
      m.visible = false; m.frustumCulled = false; scene.add(m);
      return { mesh: m, t: 1, r: 8 };
    });
  }

  makeEmbers(scene) {
    const n = 500, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos.set([rand(-40, 40), rand(0, 14), rand(-40, 40)], i * 3); seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, pr: { value: Math.min(devicePixelRatio, 2) } },
      vertexShader: /* glsl */ `attribute float seed; uniform float time, pr; varying float vA;
        void main(){ vec3 p = position; float t = time * (0.15 + seed * 0.25);
          p.y = mod(p.y + t * 2.0, 14.0); p.x += sin(t + seed * 30.0) * 2.0 + t * 0.8; p.z += cos(t * 0.7 + seed * 12.0) * 2.0;
          p.x = mod(p.x + 40.0, 80.0) - 40.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = (0.5 + 0.5 * sin(time * 3.0 + seed * 50.0)) * smoothstep(14.0, 8.0, p.y);
          gl_PointSize = (1.0 + seed * 2.0) * pr * (20.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vec3(2.4, 1.0, 0.35), vA * smoothstep(0.5, 0.0, d)); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
    return pts;
  }

  muzzle(pos) { this.muzzleLight.position.copy(pos); this.flashT = 0.05; }
  // lingering muzzle smoke drifting forward and up
  smoke(pos, dir, amount = 1) {
    const n = Math.round(2 + amount * 3);
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(rand(0.4, 1.6) * amount).add(new THREE.Vector3(rand(-0.25, 0.25), rand(0.15, 0.5), rand(-0.25, 0.25)));
      this.alpha.spawn({ pos: pos.clone().addScaledVector(dir, rand(0.05, 0.4)), vel: v, life: rand(0.9, 1.8), size: rand(0.05, 0.1), grow: rand(0.35, 0.7) * (0.6 + amount * 0.4), col: new THREE.Color(0.42, 0.41, 0.42), alpha: 0.16 + amount * 0.06, drag: 2.2, grav: -0.35 });
    }
  }

  // surface impact: sparks + dust + decal
  impact(point, normal, mat) {
    const metal = mat === 'metal', wood = mat === 'wood';
    const sparkCount = metal ? 14 : wood ? 3 : 7;
    for (let i = 0; i < sparkCount; i++) {
      const v = normal.clone().multiplyScalar(rand(2, 7)).add(new THREE.Vector3(rand(-4, 4), rand(-1, 5), rand(-4, 4)));
      this.add.spawn({ pos: point, vel: v, life: rand(0.12, 0.38), size: rand(0.012, 0.025), col: new THREE.Color(5, rand(2, 3.2), 0.8), grav: 14, drag: 2, kind: 1 });
    }
    this.add.spawn({ pos: point.clone().addScaledVector(normal, 0.03), life: 0.06, size: 0.22, col: new THREE.Color(4, 2.6, 1.2) });
    const dustCol = wood ? new THREE.Color(0.35, 0.26, 0.17) : metal ? new THREE.Color(0.3, 0.3, 0.32) : new THREE.Color(0.55, 0.52, 0.5);
    for (let i = 0; i < (metal ? 2 : 5); i++) {
      const v = normal.clone().multiplyScalar(rand(0.6, 2.2)).add(new THREE.Vector3(rand(-0.5, 0.5), rand(0, 0.8), rand(-0.5, 0.5)));
      this.alpha.spawn({ pos: point.clone().addScaledVector(normal, 0.05), vel: v, life: rand(0.5, 1.1), size: rand(0.12, 0.25), grow: rand(0.3, 0.7), col: dustCol, alpha: 0.55, drag: 3, grav: -0.2 });
    }
    // chips
    for (let i = 0; i < 4; i++) {
      const v = normal.clone().multiplyScalar(rand(1.5, 4)).add(new THREE.Vector3(rand(-2, 2), rand(0, 3), rand(-2, 2)));
      this.alpha.spawn({ pos: point, vel: v, life: rand(0.4, 0.8), size: rand(0.015, 0.03), col: dustCol.clone().multiplyScalar(0.6), grav: 12, floor: 0.01 });
    }
    this.holes.add(point, normal, rand(0.07, 0.11) * (metal ? 0.8 : 1));
  }

  // flesh hit, gore-free: charred flakes + ash puff + molten ichor flecks
  bloodHit(point, dir, big = false) {
    const n = big ? 16 : 9;
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(rand(1, 5)).add(new THREE.Vector3(rand(-1.5, 1.5), rand(-0.5, 2.5), rand(-1.5, 1.5)));
      this.alpha.spawn({ pos: point, vel: v, life: rand(0.35, 0.8), size: rand(0.02, 0.05), col: new THREE.Color(0.07, 0.055, 0.05), grav: 11, floor: 0.02 });
    }
    for (let i = 0; i < (big ? 4 : 2); i++) {
      this.alpha.spawn({ pos: point, vel: dir.clone().multiplyScalar(rand(0.5, 1.6)).add(new THREE.Vector3(rand(-0.4, 0.4), rand(0, 0.5), rand(-0.4, 0.4))), life: rand(0.35, 0.7), size: rand(0.12, 0.25), grow: 0.6, col: new THREE.Color(0.16, 0.13, 0.12), alpha: 0.45, drag: 4 });
    }
    for (let i = 0; i < (big ? 8 : 4); i++) {
      this.add.spawn({ pos: point, vel: dir.clone().multiplyScalar(rand(0.8, 3)).add(new THREE.Vector3(rand(-1.2, 1.2), rand(0.3, 2.5), rand(-1.2, 1.2))), life: rand(0.25, 0.6), size: rand(0.02, 0.035), col: new THREE.Color(4.2, 1.5, 0.3), grav: 9, floor: 0.02 });
    }
    // the husks burn: hot ember sparks from wounds
    for (let i = 0; i < (big ? 10 : 5); i++) {
      this.add.spawn({ pos: point, vel: dir.clone().multiplyScalar(rand(1, 4)).add(new THREE.Vector3(rand(-2, 2), rand(0, 3), rand(-2, 2))), life: rand(0.2, 0.5), size: rand(0.012, 0.022), col: new THREE.Color(4, 1.4, 0.3), grav: 6, drag: 1.5, kind: 1 });
    }
  }
  // stylized ichor: hot glowing molten spray (matches the ember husks), no red gore
  ichor(point, dir, amount = 1, acid = false) {
    const hot = acid ? new THREE.Color(1.2, 4.5, 0.6) : new THREE.Color(5, 2.0, 0.4);
    for (let i = 0; i < Math.round(14 * amount); i++) {
      const v = dir.clone().multiplyScalar(rand(0.5, 3.5)).add(new THREE.Vector3(rand(-2, 2), rand(0.5, 4), rand(-2, 2)));
      this.add.spawn({ pos: point, vel: v, life: rand(0.35, 0.9), size: rand(0.02, 0.045), col: hot, grav: 9, drag: 1, kind: i % 3 === 0 ? 1 : 0, floor: 0.02 });
    }
    for (let i = 0; i < Math.round(4 * amount); i++) {
      this.alpha.spawn({ pos: point, vel: new THREE.Vector3(rand(-0.5, 0.5), rand(0.3, 1), rand(-0.5, 0.5)), life: rand(0.6, 1.2), size: rand(0.12, 0.2), grow: 0.6, col: new THREE.Color(0.12, 0.1, 0.09), alpha: 0.45, drag: 3, grav: -0.4 });
    }
  }
  // thin continuous squirt from a stump
  stumpSpray(point, dir, acid = false) {
    const v = dir.clone().multiplyScalar(rand(1.2, 2.6)).add(new THREE.Vector3(rand(-0.4, 0.4), rand(0.6, 1.8), rand(-0.4, 0.4)));
    this.add.spawn({ pos: point, vel: v, life: rand(0.25, 0.5), size: rand(0.015, 0.03), col: acid ? new THREE.Color(1, 4, 0.5) : new THREE.Color(4.5, 1.6, 0.35), grav: 9, floor: 0.02 });
  }
  acidTrail(pos) {
    this.add.spawn({ pos, vel: new THREE.Vector3(rand(-0.3, 0.3), rand(-0.2, 0.3), rand(-0.3, 0.3)), life: rand(0.2, 0.4), size: rand(0.06, 0.12), col: new THREE.Color(0.6, 2.6, 0.3) });
    if (Math.random() < 0.5) this.alpha.spawn({ pos, vel: new THREE.Vector3(0, 0.3, 0), life: rand(0.4, 0.8), size: 0.1, grow: 0.35, col: new THREE.Color(0.25, 0.4, 0.12), alpha: 0.35, drag: 2 });
  }
  acidBurst(point, ground = true) {
    for (let i = 0; i < 26; i++) {
      const v = new THREE.Vector3(rand(-4, 4), rand(1, 5.5), rand(-4, 4));
      this.add.spawn({ pos: point, vel: v, life: rand(0.3, 0.8), size: rand(0.03, 0.07), col: new THREE.Color(0.9, 4, 0.5), grav: 12, drag: 1, kind: i % 2, floor: 0.02 });
    }
    for (let i = 0; i < 8; i++) this.alpha.spawn({ pos: point.clone().add(new THREE.Vector3(rand(-0.5, 0.5), rand(0, 0.4), rand(-0.5, 0.5))), vel: new THREE.Vector3(rand(-0.8, 0.8), rand(0.3, 1.2), rand(-0.8, 0.8)), life: rand(0.8, 1.6), size: rand(0.4, 0.7), grow: 1.2, col: new THREE.Color(0.28, 0.45, 0.12), alpha: 0.4, drag: 2.5, grav: -0.3 });
    this.add.spawn({ pos: point.clone().setY(point.y + 0.2), life: 0.12, size: 1.6, col: new THREE.Color(0.8, 3, 0.4) });
    if (ground) return this.acid.add(new THREE.Vector3(point.x, point.y + 0.014 + Math.random() * 0.004, point.z), new THREE.Vector3(0, 1, 0), rand(2.2, 2.8));
  }
  // ground slam: expanding dust ring + embers + shockwave mesh
  slam(point, radius = 8) {
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2, sp = rand(5, 9);
      this.alpha.spawn({ pos: point.clone().add(new THREE.Vector3(Math.cos(a) * 0.8, 0.2, Math.sin(a) * 0.8)), vel: new THREE.Vector3(Math.cos(a) * sp, rand(0.3, 1.5), Math.sin(a) * sp), life: rand(0.7, 1.3), size: rand(0.4, 0.8), grow: 1.4, col: new THREE.Color(0.38, 0.32, 0.3), alpha: 0.5, drag: 2.6, grav: -0.2 });
    }
    for (let i = 0; i < 30; i++) this.add.spawn({ pos: point.clone().setY(point.y + 0.2), vel: new THREE.Vector3(rand(-6, 6), rand(2, 8), rand(-6, 6)), life: rand(0.3, 0.8), size: rand(0.015, 0.03), col: new THREE.Color(5, 1.8, 0.4), grav: 12, kind: 1, floor: 0.02 });
    const w = this.waves.find((x) => x.t >= 1) || this.waves[0];
    w.t = 0; w.r = radius; w.mesh.position.copy(point).setY(point.y + 0.06); w.mesh.visible = true;
  }
  bloodPool(pos, size = 1, y = 0) { this.blood.add(new THREE.Vector3(pos.x, y + 0.012 + Math.random() * 0.004, pos.z), new THREE.Vector3(0, 1, 0), rand(0.6, 1.2) * size); }

  update(dt, camera, time) {
    this.add.update(dt); this.alpha.update(dt); this.tracers.update(dt, camera);
    this.muzzleLight.intensity = Math.max(0, this.flashT / 0.05) * 30; this.flashT -= dt;
    this.embers.material.uniforms.time.value = time;
    for (const w of this.waves) {
      if (w.t >= 1) { w.mesh.visible = false; continue; }
      w.t = Math.min(1, w.t + dt / 0.55);
      const k = 1 - Math.pow(1 - w.t, 2.2);
      w.mesh.scale.setScalar(0.5 + k * w.r); w.mesh.material.opacity = (1 - w.t) * 0.9;
    }
  }
  clear() { this.holes.clear(); this.blood.clear(); this.acid.clear(); this.add.p.length = 0; this.alpha.p.length = 0; }
}
