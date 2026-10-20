import * as THREE from 'three';
import { bulletHoleTexture, bloodTexture, splatterTexture } from '../world/textures.js';
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

// ---------- decals (instanced quads; optional 2x2 atlas for variety) ----------
class Decals {
  constructor(scene, max, tex, opts = {}) {
    this.max = max; this.i = 0; this.atlas = !!opts.atlas;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: opts.roughness ?? 0.9, metalness: 0 });
    const geo = new THREE.PlaneGeometry(1, 1);
    if (this.atlas) {
      this.aUv = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
      geo.setAttribute('iUv', this.aUv);
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 iUv;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * 0.5 + iUv;\n#endif');
      };
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.z = new THREE.Vector3(0, 0, 1);
    this.bx = new THREE.Vector3(); this.by = new THREE.Vector3(); this.rm = new THREE.Matrix4();
  }
  // dir (optional): the decal's +x is laid along dir projected onto the surface (sprays, smears)
  add(pos, normal, size, dir = null, stretch = 1) {
    if (dir) {
      this.bx.copy(dir).addScaledVector(normal, -dir.dot(normal));
      if (this.bx.lengthSq() < 1e-4) this.bx.set(1, 0, 0).addScaledVector(normal, -normal.x);
      this.bx.normalize(); this.by.crossVectors(normal, this.bx);
      this.rm.makeBasis(this.bx, this.by, normal); this.q.setFromRotationMatrix(this.rm);
      this.s.set(size * stretch, size, size);
    } else {
      this.q.setFromUnitVectors(this.z, normal);
      const spin = new THREE.Quaternion().setFromAxisAngle(this.z, Math.random() * Math.PI * 2);
      this.q.multiply(spin);
      this.s.set(size, size, size);
    }
    this.m.compose(pos.clone().addScaledVector(normal, 0.004 + Math.random() * 0.003), this.q, this.s);
    const idx = this.i++ % this.max;
    this.mesh.setMatrixAt(idx, this.m);
    if (this.atlas) { this.aUv.setXY(idx, (Math.random() < 0.5 ? 0 : 0.5), (Math.random() < 0.5 ? 0 : 0.5)); this.aUv.needsUpdate = true; }
    this.mesh.count = Math.min(this.max, this.i);
    this.mesh.instanceMatrix.needsUpdate = true;
    return idx;
  }
  hide(idx) { this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(idx, this.m); this.mesh.instanceMatrix.needsUpdate = true; }
  clear() { this.i = 0; this.mesh.count = 0; }
}

// ---------- gibs: pooled meaty chunks with simple rigid-ish physics ----------
class Gibs {
  constructor(scene, max = 64, opts = {}) {
    this.max = max; this.items = []; this.decal = opts.decal ?? true;
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position; // lumpy
    for (let i = 0; i < p.count; i++) { const k = 0.7 + Math.random() * 0.5; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k); }
    g.computeVertexNormals();
    const mat = opts.material || new THREE.MeshStandardMaterial({ color: '#7a0c0c', roughness: 0.35, metalness: 0.05, emissive: '#1a0000' });
    this.mesh = new THREE.InstancedMesh(opts.geometry || g, mat, max);
    this.mesh.count = 0; this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.colors = opts.colors || [new THREE.Color('#ffffff'), new THREE.Color('#c9b0a0'), new THREE.Color('#5a3a30')];
    scene.add(this.mesh);
    this.o = new THREE.Object3D();
  }
  spawn(pos, vel, size, ground) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ pos: pos.clone(), vel, rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6), spin: new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)), size, t: 0, ground, landed: false, col: this.decal ? (Math.random() < 0.2 ? 1 : 0) : Math.floor(Math.random() * this.colors.length) % this.colors.length, sx: rand(0.6, 1.6), sz: rand(0.15, 1) });
  }
  update(dt, fx) {
    this.items = this.items.filter((g) => g.t < 9);
    this.items.forEach((g, i) => {
      g.t += dt;
      if (!g.rest) {
        g.vel.y -= 16 * dt; g.pos.addScaledVector(g.vel, dt);
        g.rot.x += g.spin.x * dt; g.rot.y += g.spin.y * dt; g.rot.z += g.spin.z * dt;
        const floor = g.ground + g.size * 0.6;
        if (g.pos.y < floor) {
          g.pos.y = floor;
          if (!g.landed) { g.landed = true; if (this.decal) fx.blood.add(new THREE.Vector3(g.pos.x, g.ground + 0.012, g.pos.z), new THREE.Vector3(0, 1, 0), g.size * rand(5, 8), new THREE.Vector3(g.vel.x, 0, g.vel.z), 1.6); }
          g.vel.y *= -0.25; g.vel.x *= 0.55; g.vel.z *= 0.55; g.spin.multiplyScalar(0.5);
          if (Math.abs(g.vel.y) < 0.4 && Math.hypot(g.vel.x, g.vel.z) < 0.3) g.rest = true;
        }
      }
      const shrink = g.t > 7.5 ? 1 - (g.t - 7.5) / 1.5 : 1;
      this.o.position.copy(g.pos); this.o.rotation.copy(g.rot); this.o.scale.set(g.size * shrink * (this.decal ? 1 : g.sx), g.size * shrink * (this.decal ? 1 : 0.18), g.size * shrink * (this.decal ? 1 : g.sz));
      this.o.updateMatrix(); this.mesh.setMatrixAt(i, this.o.matrix); this.mesh.setColorAt(i, this.colors[g.col]);
    });
    this.mesh.count = this.items.length;
    this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.items.length = 0; this.mesh.count = 0; }
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

function scorchTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(8,6,5,.95)'); g.addColorStop(0.35, 'rgba(14,10,8,.85)'); g.addColorStop(0.7, 'rgba(20,14,10,.4)'); g.addColorStop(1, 'rgba(20,14,10,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 160; i++) { const a = Math.random() * 6.28, r = 40 + Math.random() * 90; x.fillStyle = `rgba(0,0,0,${Math.random() * 0.5})`; x.beginPath(); x.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 3 + Math.random() * 14, 0, 6.28); x.fill(); }
  x.globalCompositeOperation = 'source-over'; x.strokeStyle = 'rgba(5,4,3,.7)'; x.lineCap = 'round';
  for (let i = 0; i < 28; i++) { const a = Math.random() * 6.28, r0 = 30 + Math.random() * 20, r1 = 80 + Math.random() * 45; x.lineWidth = 2 + Math.random() * 5; x.beginPath(); x.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0); x.lineTo(128 + Math.cos(a) * r1, 128 + Math.sin(a) * r1); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Effects {
  constructor(scene, quality) {
    this.scene = scene;
    this.add = new Particles(scene, 1400, true);
    this.alpha = new Particles(scene, 1200, false);
    this.holes = new Decals(scene, quality === 'low' ? 160 : 400, bulletHoleTexture());
    this.blood = new Decals(scene, quality === 'low' ? 120 : 220, bloodTexture(), { roughness: 0.18, atlas: true }); // pools (ground)
    this.splat = new Decals(scene, quality === 'low' ? 120 : 240, splatterTexture(), { roughness: 0.3, atlas: true }); // sprays (walls + ground)
    this.gibs = new Gibs(scene, quality === 'low' ? 40 : 72);
    this.tracers = new Tracers(scene);
    // pooled world flash lights (muzzle + explosions)
    this.muzzleLight = new THREE.PointLight('#ffb35c', 0, 9, 2); scene.add(this.muzzleLight);
    this.flashT = 0;
    this.embers = this.makeEmbers(scene);
    this.acid = new Decals(scene, 24, bloodTexture(), { roughness: 0.2, atlas: true });
    this.acid.mesh.material.color.set('#7dff4a'); this.acid.mesh.material.emissive = new THREE.Color(0.25, 1.0, 0.1); this.acid.mesh.material.emissiveIntensity = 1.4;
    this.acid.mesh.material.emissiveMap = this.acid.mesh.material.map;
    // explosions: metal debris, scorch marks, flash lights, lingering fires
    const shard = new THREE.BoxGeometry(1, 1, 1);
    this.debris = new Gibs(scene, 60, { decal: false, geometry: shard, material: new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.6, roughness: 0.55 }), colors: [new THREE.Color('#7e1a12'), new THREE.Color('#3a3634'), new THREE.Color('#5a1410'), new THREE.Color('#b08a20')] });
    this.scorch = new Decals(scene, 28, scorchTexture(), { roughness: 0.95 });
    this.boomLights = [0, 1, 2].map(() => { const L = new THREE.PointLight('#ff9a40', 0, 22, 1.6); scene.add(L); return { L, t: 1, k: 1 }; });
    this.burns = []; this.timers = [];
    // shockwave rings (pooled)
    this.waves = [0, 1, 2, 3].map(() => {
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

  // flesh hit: directional red spray (streaks + droplets) along the bullet, back-spatter, a little mist
  bloodHit(point, dir, big = false) {
    const n = big ? 34 : 18;
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(rand(1.5, big ? 8 : 6)).add(new THREE.Vector3(rand(-1.2, 1.2), rand(-0.3, 2.2), rand(-1.2, 1.2)));
      this.alpha.spawn({ pos: point, vel: v, life: rand(0.4, 0.9), size: rand(0.018, big ? 0.05 : 0.04), col: new THREE.Color(rand(0.22, 0.38), 0.008, 0.012), grav: 12, floor: 0.02, kind: i % 2 });
    }
    for (let i = 0; i < (big ? 8 : 4); i++) { // back-spatter toward the shooter
      const v = dir.clone().multiplyScalar(-rand(0.6, 2)).add(new THREE.Vector3(rand(-0.8, 0.8), rand(0, 1.4), rand(-0.8, 0.8)));
      this.alpha.spawn({ pos: point, vel: v, life: rand(0.3, 0.6), size: rand(0.015, 0.03), col: new THREE.Color(0.32, 0.01, 0.015), grav: 12, floor: 0.02 });
    }
    for (let i = 0; i < (big ? 5 : 2); i++) {
      this.alpha.spawn({ pos: point, vel: dir.clone().multiplyScalar(rand(0.6, 1.8)).add(new THREE.Vector3(rand(-0.4, 0.4), rand(0, 0.5), rand(-0.4, 0.4))), life: rand(0.3, 0.6), size: rand(0.1, 0.2), grow: 0.5, col: new THREE.Color(0.17, 0.008, 0.01), alpha: 0.35, drag: 4 });
    }
  }
  // kill: a bloom of red mist that hangs for a moment
  bloodMist(point, dir, amount = 1) {
    for (let i = 0; i < Math.round(9 * amount); i++) {
      const v = dir.clone().multiplyScalar(rand(0.3, 1.6)).add(new THREE.Vector3(rand(-0.7, 0.7), rand(-0.1, 0.8), rand(-0.7, 0.7)));
      this.alpha.spawn({ pos: point.clone().add(new THREE.Vector3(rand(-0.15, 0.15), rand(-0.15, 0.15), rand(-0.15, 0.15))), vel: v, life: rand(0.5, 1.0), size: rand(0.1, 0.22), grow: rand(0.4, 0.8), col: new THREE.Color(rand(0.12, 0.2), 0.006, 0.008), alpha: 0.32, drag: 3.2, grav: 0.3 });
    }
  }
  // big kills: meat chunks + a burst of heavy droplets
  gib(point, dir, n, ground) {
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(rand(2, 6)).add(new THREE.Vector3(rand(-2.5, 2.5), rand(1.5, 5), rand(-2.5, 2.5)));
      this.gibs.spawn(point.clone().add(new THREE.Vector3(rand(-0.15, 0.15), rand(-0.15, 0.15), rand(-0.15, 0.15))), v, rand(0.03, 0.075), ground);
    }
    this.bloodHit(point, dir, true); this.bloodMist(point, dir, 1.6);
  }
  // severed stump: pulsing arterial spurts (strength 0..1)
  artery(point, dir, strength) {
    const v = dir.clone().multiplyScalar(rand(2, 4.5) * strength + 0.6).add(new THREE.Vector3(rand(-0.25, 0.25), rand(0.4, 1.2), rand(-0.25, 0.25)));
    this.alpha.spawn({ pos: point, vel: v, life: rand(0.35, 0.7), size: rand(0.02, 0.04), col: new THREE.Color(rand(0.3, 0.42), 0.01, 0.015), grav: 11, floor: 0.02, kind: 1 });
  }
  // stylized ichor: hot glowing molten spray (matches the ember husks), no red gore
  ichor(point, dir, amount = 1, acid = false) {
    if (!acid) { this.bloodHit(point, dir, true); this.bloodMist(point, dir, amount * 0.5); return; }
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
    if (acid) this.add.spawn({ pos: point, vel: v, life: rand(0.25, 0.5), size: rand(0.015, 0.03), col: new THREE.Color(1, 4, 0.5), grav: 9, floor: 0.02 });
    else this.alpha.spawn({ pos: point, vel: v, life: rand(0.3, 0.6), size: rand(0.018, 0.035), col: new THREE.Color(0.34, 0.01, 0.015), grav: 11, floor: 0.02, kind: 1 });
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
    w.t = 0; w.r = radius; w.op = 0.9; w.dur = 0.55; w.mesh.position.copy(point).setY(point.y + 0.06); w.mesh.visible = true;
  }
  // fireball + flash + sparks + smoke + debris + shock ring + scorch; k scales everything (1 = fuel drum)
  explosion(p, k = 1, ground = 0) {
    const C = (r, g, b) => new THREE.Color(r, g, b);
    this.add.spawn({ pos: p.clone().setY(p.y + 0.3 * k), life: 0.08, size: 3.4 * k, col: C(4, 2.6, 1.2) });
    // white-hot core (additive, short) inside a billowing orange fireball (alpha-blended so it keeps its colour)
    for (let i = 0; i < Math.round(8 * k + 3); i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize();
      this.add.spawn({ pos: p.clone().addScaledVector(d, rand(0, 0.3) * k), vel: d.multiplyScalar(rand(1.5, 4) * k), life: rand(0.18, 0.32), size: rand(0.4, 0.7) * k, grow: 1.1 * k, col: C(2.6, 1.2, 0.35), drag: 4 });
    }
    for (let i = 0; i < Math.round(22 * k + 5); i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(-0.1, 1), rand(-1, 1)).normalize();
      const hot = Math.random();
      this.alpha.spawn({ pos: p.clone().addScaledVector(d, rand(0.1, 0.5) * k), vel: d.multiplyScalar(rand(2, 6.5) * k).add(new THREE.Vector3(0, 1.8 * k, 0)), life: rand(0.35, 0.75), size: rand(0.45, 0.85) * k, grow: rand(1.3, 2.2) * k, col: hot < 0.4 ? C(3.2, 1.7, 0.5) : hot < 0.8 ? C(2.4, 0.8, 0.16) : C(1.3, 0.3, 0.06), alpha: 0.9, drag: 3.4, grav: -2.2 });
    }
    for (let i = 0; i < Math.round(40 * k + 8); i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0.1, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(8, 20) * Math.sqrt(k));
      this.add.spawn({ pos: p, vel: v, life: rand(0.3, 1.0), size: rand(0.02, 0.04), col: C(5, rand(2, 3.2), 0.7), grav: 12, drag: 0.6, kind: 1, floor: ground + 0.02 });
    }
    // thick smoke rolls up as the fire dies (spawned a beat later, inside the fireball)
    this.later(0.12, () => {
      for (let i = 0; i < Math.round(24 * k + 4); i++) {
        const g = rand(0.1, 0.17);
        this.alpha.spawn({ pos: p.clone().add(new THREE.Vector3(rand(-0.9, 0.9), rand(0.2, 1.8), rand(-0.9, 0.9)).multiplyScalar(k)), vel: new THREE.Vector3(rand(-1.2, 1.2), rand(1.2, 3.0), rand(-1.2, 1.2)).multiplyScalar(k), life: rand(2.4, 4), size: rand(1.1, 1.7) * k, grow: rand(3, 4.5) * k, col: C(g, g * 0.88, g * 0.8), alpha: 0.85, drag: 1.3, grav: -0.8 });
      }
    });
    // ground dust ring
    for (let i = 0; i < Math.round(22 * k); i++) {
      const a = (i / (22 * k)) * Math.PI * 2, sp = rand(5, 9) * k;
      this.alpha.spawn({ pos: new THREE.Vector3(p.x + Math.cos(a) * 0.5, ground + 0.25, p.z + Math.sin(a) * 0.5), vel: new THREE.Vector3(Math.cos(a) * sp, rand(0.2, 1), Math.sin(a) * sp), life: rand(0.6, 1.2), size: rand(0.4, 0.8) * k, grow: 1.6 * k, col: C(0.36, 0.3, 0.27), alpha: 0.45, drag: 3, grav: -0.2 });
    }
    if (k >= 0.8) for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0.6, 1.6), rand(-1, 1)).normalize().multiplyScalar(rand(5, 13));
      this.debris.spawn(p.clone().add(new THREE.Vector3(rand(-0.25, 0.25), rand(-0.2, 0.3), rand(-0.25, 0.25))), v, rand(0.08, 0.2), ground);
    }
    const w = this.waves.find((x) => x.t >= 1) || this.waves[0];
    w.t = 0; w.r = 7 * k; w.op = 0.32; w.dur = 0.4; w.mesh.position.set(p.x, ground + 0.08, p.z); w.mesh.visible = true;
    const L = this.boomLights.find((x) => x.t >= 1) || this.boomLights[0];
    L.t = 0; L.k = k; L.L.position.set(p.x, p.y + 1.2, p.z);
    this.scorch.add(new THREE.Vector3(p.x, ground + 0.014 + Math.random() * 0.003, p.z), new THREE.Vector3(0, 1, 0), rand(2.6, 3.4) * k);
    if (k >= 0.8) this.burns.push({ p: new THREE.Vector3(p.x, ground, p.z), t: rand(3, 4.5) });
  }
  later(t, fn) { this.timers.push({ t, fn }); }
  bloodPool(pos, size = 1, y = 0) { this.blood.add(new THREE.Vector3(pos.x, y + 0.012 + Math.random() * 0.004, pos.z), new THREE.Vector3(0, 1, 0), rand(0.9, 1.6) * size); }

  update(dt, camera, time) {
    this.add.update(dt); this.alpha.update(dt); this.tracers.update(dt, camera); this.gibs.update(dt, this); this.debris.update(dt, this);
    for (const B of this.boomLights) { if (B.t >= 1) { B.L.intensity = 0; continue; } B.t = Math.min(1, B.t + dt / 0.7); B.L.intensity = 110 * B.k * Math.pow(1 - B.t, 2.2); }
    this.burns = this.burns.filter((b) => (b.t -= dt) > 0);
    if (this.timers.length) { const due = this.timers.filter((x) => (x.t -= dt) <= 0); this.timers = this.timers.filter((x) => x.t > 0); due.forEach((x) => x.fn()); }
    for (const b of this.burns) {
      if (Math.random() < 0.8) this.add.spawn({ pos: new THREE.Vector3(b.p.x + rand(-0.6, 0.6), b.p.y + 0.05, b.p.z + rand(-0.6, 0.6)), vel: new THREE.Vector3(rand(-0.2, 0.2), rand(2, 3.6), rand(-0.2, 0.2)), life: rand(0.25, 0.5), size: rand(0.1, 0.18) * Math.min(1, b.t), col: new THREE.Color(3.4, 1.2, 0.25), kind: 1, drag: 1 });
      if (Math.random() < 0.15) this.alpha.spawn({ pos: new THREE.Vector3(b.p.x + rand(-0.3, 0.3), b.p.y + 0.8, b.p.z + rand(-0.3, 0.3)), vel: new THREE.Vector3(rand(-0.2, 0.2), rand(1, 1.8), rand(-0.2, 0.2)), life: rand(1.5, 2.5), size: 0.4, grow: 1.6, col: new THREE.Color(0.08, 0.07, 0.065), alpha: 0.4, drag: 1, grav: -0.5 });
    }
    this.muzzleLight.intensity = Math.max(0, this.flashT / 0.05) * 30; this.flashT -= dt;
    this.embers.material.uniforms.time.value = time;
    for (const w of this.waves) {
      if (w.t >= 1) { w.mesh.visible = false; continue; }
      w.t = Math.min(1, w.t + dt / (w.dur || 0.55));
      const k = 1 - Math.pow(1 - w.t, 2.2);
      w.mesh.scale.setScalar(0.5 + k * w.r); w.mesh.material.opacity = (1 - w.t) * (1 - w.t) * (w.op ?? 0.9);
    }
  }
  clear() { this.holes.clear(); this.blood.clear(); this.splat.clear(); this.gibs.clear(); this.debris.clear(); this.scorch.clear(); this.burns.length = 0; this.acid.clear(); this.add.p.length = 0; this.alpha.p.length = 0; }
}
