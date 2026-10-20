import * as THREE from 'three';
import { clamp, damp } from './core/util.js';

const STAND = 1.75, CROUCH = 1.12, RADIUS = 0.32, STEP = 0.5;

export class Player {
  constructor(colliders) {
    this.colliders = colliders;
    this.pos = new THREE.Vector3(0, 2.0, 2);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI; this.pitch = 0;
    this.height = STAND; this.eye = STAND - 0.1; this.eyeSmooth = this.eye;
    this.grounded = false; this.coyote = 0; this.landImpact = 0;
    this.sprinting = false; this.crouching = false; this.sliding = 0; this.slideDir = new THREE.Vector3();
    this.health = 100; this.maxHealth = 100; this.lastHurt = -10; this.alive = true;
    this.speed = 0; this.moveInput = new THREE.Vector2();
    this.stepTimer = 0; this.onStep = null; this.onLand = null; this.onJump = null; this.onSlide = null;
    this.forward = new THREE.Vector3();
    this.camTilt = 0;
  }

  reset() {
    this.pos.set(0, 2.0, 1.5); this.vel.set(0, 0, 0); this.yaw = Math.PI; this.pitch = -0.05;
    this.health = this.maxHealth; this.alive = true; this.sliding = 0;
  }

  overlaps(minX, minY, minZ, maxX, maxY, maxZ) {
    for (const c of this.colliders) {
      if (maxX <= c.minX || minX >= c.maxX || maxY <= c.minY || minY >= c.maxY || maxZ <= c.minZ || minZ >= c.maxZ) continue;
      return c;
    }
    return null;
  }

  // Move along one horizontal axis, stepping up small ledges.
  moveAxis(axis, amount) {
    if (!amount) return false;
    const p = this.pos;
    p[axis] += amount;
    let c = this.overlaps(p.x - RADIUS, p.y + 0.01, p.z - RADIUS, p.x + RADIUS, p.y + this.height, p.z + RADIUS);
    if (!c) return false;
    // step up?
    if (this.grounded && c.maxY - p.y <= STEP && c.maxY - p.y > 0) {
      const ny = c.maxY + 0.001;
      if (!this.overlaps(p.x - RADIUS, ny + 0.01, p.z - RADIUS, p.x + RADIUS, ny + this.height, p.z + RADIUS)) {
        this.eyeSmooth -= ny - p.y; // smooth the camera over the step
        p.y = ny; return false;
      }
    }
    // push back out
    if (amount > 0) p[axis] = (axis === 'x' ? c.minX : c.minZ) - RADIUS - 0.0005;
    else p[axis] = (axis === 'x' ? c.maxX : c.maxZ) + RADIUS + 0.0005;
    return true;
  }

  update(dt, input, opts) {
    const p = this.pos;
    // ---- look ----
    const sens = 0.0021 * input.sensitivity * opts.lookScale;
    this.yaw -= input.mouse.dx * sens;
    this.pitch = clamp(this.pitch - input.mouse.dy * sens, -1.5, 1.5);

    // ---- intent ----
    const fwd = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const str = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    this.moveInput.set(str, fwd);
    const crouchHeld = input.down('KeyC') || input.down('ControlLeft');
    const wantSprint = input.down('ShiftLeft') && fwd > 0 && !opts.ads && !opts.blockSprint;

    // slide: crouch while sprinting on the ground
    if (this.sliding <= 0 && this.grounded && this.sprinting && (input.hit('KeyC') || input.hit('ControlLeft'))) {
      this.sliding = 0.85;
      this.slideDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const sp = Math.max(11, Math.hypot(this.vel.x, this.vel.z) + 2.5);
      this.vel.x = this.slideDir.x * sp; this.vel.z = this.slideDir.z * sp;
      this.onSlide?.();
    }
    if (this.sliding > 0) { this.sliding -= dt; if (!crouchHeld && this.sliding < 0.55) this.sliding = 0; }
    this.crouching = crouchHeld || this.sliding > 0;
    this.sprinting = wantSprint && !this.crouching;

    // height (stand up only if there is room)
    const targetH = this.crouching ? CROUCH : STAND;
    if (targetH > this.height && this.overlaps(p.x - RADIUS, p.y + this.height, p.z - RADIUS, p.x + RADIUS, p.y + targetH, p.z + RADIUS)) {
      this.crouching = true;
    } else this.height = targetH;

    // ---- horizontal velocity ----
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * fwd + cy * str, wz = -cy * fwd - sy * str;
    const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
    let maxSpeed = this.sprinting ? 8.4 : this.crouching ? 3.0 : 5.4;
    if (opts.ads) maxSpeed *= 0.62;
    maxSpeed *= opts.weightSpeed;
    if (this.sliding > 0) {
      const f = this.grounded ? 4.2 : 0.6;
      this.vel.x = damp(this.vel.x, this.slideDir.x * 3, f, dt);
      this.vel.z = damp(this.vel.z, this.slideDir.z * 3, f, dt);
    } else {
      const accel = this.grounded ? (wl ? 14 : 11) : 2.2;
      this.vel.x = damp(this.vel.x, wx * maxSpeed, accel, dt);
      this.vel.z = damp(this.vel.z, wz * maxSpeed, accel, dt);
    }

    // ---- jump + gravity ----
    this.coyote = this.grounded ? 0.12 : this.coyote - dt;
    if (input.hit('Space') && this.coyote > 0) {
      this.vel.y = 5.6; this.coyote = 0; this.grounded = false;
      if (this.sliding > 0) { this.sliding = 0; this.vel.x *= 1.05; this.vel.z *= 1.05; }
      this.onJump?.();
    }
    this.vel.y -= 17 * dt;

    // ---- integrate with collision ----
    this.moveAxis('x', this.vel.x * dt) && (this.vel.x = 0);
    this.moveAxis('z', this.vel.z * dt) && (this.vel.z = 0);
    p.y += this.vel.y * dt;
    const wasGrounded = this.grounded;
    this.grounded = false;
    const c = this.overlaps(p.x - RADIUS, p.y, p.z - RADIUS, p.x + RADIUS, p.y + this.height, p.z + RADIUS);
    if (c) {
      if (this.vel.y <= 0) {
        p.y = c.maxY; if (!wasGrounded && this.vel.y < -3) { this.landImpact = Math.min(1, -this.vel.y / 12); this.onLand?.(this.landImpact); }
        this.vel.y = 0; this.grounded = true;
      } else { p.y = c.minY - this.height - 0.001; this.vel.y = 0; }
    } else if (wasGrounded && this.vel.y <= 0) {
      // snap down small steps when walking off stairs
      const below = this.overlaps(p.x - RADIUS, p.y - STEP, p.z - RADIUS, p.x + RADIUS, p.y - 0.001, p.z + RADIUS);
      if (below && below.maxY <= p.y) { this.eyeSmooth += p.y - below.maxY; p.y = below.maxY; this.vel.y = 0; this.grounded = true; }
    }
    // keep inside the arena
    p.x = clamp(p.x, -35.4, 35.4); p.z = clamp(p.z, -35.4, 35.4);

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // footsteps
    if (this.grounded && this.speed > 1.5 && this.sliding <= 0) {
      this.stepTimer -= dt * this.speed * (this.sprinting ? 0.42 : 0.5);
      if (this.stepTimer <= 0) { this.stepTimer = 1.1; this.onStep?.(this.sprinting, this.crouching); }
    }

    // eye height (smoothed)
    this.eye = this.height - 0.1 - (this.sliding > 0 ? 0.22 : 0);
    this.eyeSmooth = damp(this.eyeSmooth, this.eye, 12, dt);
    this.camTilt = damp(this.camTilt, (this.sliding > 0 ? 0.08 : 0) - str * 0.012, 8, dt);

    // regen like modern shooters
    if (this.alive && performance.now() / 1000 - this.lastHurt > 4 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 30 * dt);
    this.forward.set(-sy * Math.cos(this.pitch), Math.sin(this.pitch), -cy * Math.cos(this.pitch));
  }

  hurt(amount) {
    if (!this.alive) return;
    this.health -= amount; this.lastHurt = performance.now() / 1000;
    if (this.health <= 0) { this.health = 0; this.alive = false; }
  }
}
