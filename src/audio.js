// Procedural, layered WebAudio. No sample files: every sound is synthesized at runtime.
export class Audio {
  constructor() { this.ctx = null; this.enabled = true; this.volume = parseFloat(localStorage.getItem('hf-vol') || '0.8'); }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);
    // outdoor reverb tail for gunshots
    this.verb = ctx.createConvolver(); this.verb.buffer = this.impulse(2.6, 2.2);
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.55;
    const verbHP = ctx.createBiquadFilter(); verbHP.type = 'highpass'; verbHP.frequency.value = 180;
    this.verbIn.connect(verbHP).connect(this.verb).connect(this.master);
    // slapback echo off the buildings
    this.echo = ctx.createDelay(1); this.echo.delayTime.value = 0.13;
    const eg = ctx.createGain(); eg.gain.value = 0.22; const elp = ctx.createBiquadFilter(); elp.type = 'lowpass'; elp.frequency.value = 1800;
    this.echoIn = ctx.createGain(); this.echoIn.gain.value = 1;
    this.echoIn.connect(this.echo).connect(elp).connect(eg).connect(this.master);
    // muffle filter for low health
    this.noise = this.noiseBuffer(4);
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; localStorage.setItem('hf-vol', v); }

  noiseBuffer(sec) {
    const ctx = this.ctx, b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  impulse(sec, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        let v = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        // a few discrete early reflections
        if ([0.012, 0.031, 0.055, 0.083].some((e) => Math.abs(t * sec - e - c * 0.004) < 0.0008)) v += (Math.random() - 0.5) * 2.5;
        d[i] = v;
      }
    }
    return b;
  }

  // noise burst through a filter with an envelope
  burst({ t = 0, dur = 0.1, type = 'bandpass', freq = 1000, q = 0.8, gain = 1, attack = 0.001, rate = 1, out, send = 0, pan = 0, freqEnd }) {
    const ctx = this.ctx, now = ctx.currentTime + t, P = this.pitch || 1;
    rate *= P; freq *= P; if (freqEnd) freqEnd *= P;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, now); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(gain, now + attack); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(out || this.master);
    if (send) { const s = ctx.createGain(); s.gain.value = send; p.connect(s).connect(this.verbIn); s.connect(this.echoIn); }
    src.start(now, Math.random() * Math.max(0, 3.8 - dur), dur + 0.05);
  }
  tone({ t = 0, dur = 0.1, type = 'sine', freq = 200, freqEnd, gain = 0.5, attack = 0.002, out, pan = 0, send = 0 }) {
    const ctx = this.ctx, now = ctx.currentTime + t, P = this.pitch || 1;
    freq *= P; if (freqEnd) freqEnd *= P;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, now);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(gain, now + attack); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(g).connect(p).connect(out || this.master);
    if (send) { const s = ctx.createGain(); s.gain.value = send; p.connect(s).connect(this.verbIn); }
    o.start(now); o.stop(now + dur + 0.05);
  }

  play(name, o = {}) {
    if (!this.ctx || !this.enabled) return;
    const r = (a, b) => a + Math.random() * (b - a);
    switch (name) {
      case 'shot': {
        const s = o.weapon.sound, p = s.pitch * r(0.94, 1.06);
        // 1. supersonic crack / mechanical transient
        this.burst({ dur: 0.035, type: 'highpass', freq: 2600 * p, q: 0.6, gain: 0.9 * s.crack, rate: 1.4 });
        // 2. body: mid-band blast
        this.burst({ dur: 0.16 * s.body, type: 'bandpass', freq: 900 * p, q: 0.7, gain: 1.4 * s.body, send: 0.9 * s.tail, freqEnd: 300 });
        this.burst({ dur: 0.09, type: 'lowpass', freq: 3200 * p, q: 0.5, gain: 0.8, send: 0.4 });
        // 3. low thump with pitch drop (felt more than heard)
        this.tone({ dur: 0.18 * s.body, type: 'sine', freq: s.thump * 2 * p, freqEnd: s.thump * 0.45, gain: 1.1 * s.body });
        this.tone({ dur: 0.07, type: 'triangle', freq: s.thump * 4, freqEnd: s.thump, gain: 0.35 });
        // 4. distant tail: low rumble that rolls off
        this.burst({ t: 0.02, dur: 0.9 * s.tail, type: 'lowpass', freq: 520, q: 0.4, gain: 0.32 * s.tail, attack: 0.04, send: 0.5, freqEnd: 120 });
        // mechanism
        if (o.weapon.id !== 'sg') this.burst({ t: 0.03, dur: 0.03, type: 'bandpass', freq: 4200, q: 3, gain: 0.12 });
        break;
      }
      case 'dry': this.burst({ dur: 0.03, type: 'bandpass', freq: 3500, q: 4, gain: 0.35 }); this.burst({ t: 0.05, dur: 0.02, type: 'bandpass', freq: 2200, q: 4, gain: 0.2 }); break;
      case 'magOut': this.burst({ dur: 0.05, type: 'bandpass', freq: 1800, q: 3, gain: 0.45 }); this.burst({ t: 0.06, dur: 0.12, type: 'bandpass', freq: 700, q: 2, gain: 0.25 }); break;
      case 'magIn': this.burst({ dur: 0.04, type: 'bandpass', freq: 1300, q: 2, gain: 0.7 }); this.burst({ t: 0.035, dur: 0.05, type: 'bandpass', freq: 3200, q: 4, gain: 0.5 }); this.tone({ dur: 0.06, freq: 180, freqEnd: 90, gain: 0.3 }); break;
      case 'bolt': this.burst({ dur: 0.05, type: 'bandpass', freq: 2400, q: 3, gain: 0.5 }); this.burst({ t: 0.09, dur: 0.06, type: 'bandpass', freq: 1500, q: 2.5, gain: 0.8 }); this.burst({ t: 0.1, dur: 0.03, type: 'highpass', freq: 5000, gain: 0.4 }); break;
      case 'pumpBack': this.burst({ dur: 0.07, type: 'bandpass', freq: 1100, q: 2, gain: 0.6 }); this.burst({ t: 0.02, dur: 0.03, type: 'bandpass', freq: 3000, q: 3, gain: 0.35 }); break;
      case 'pumpFwd': this.burst({ dur: 0.06, type: 'bandpass', freq: 1500, q: 2, gain: 0.65 }); this.burst({ t: 0.04, dur: 0.03, type: 'bandpass', freq: 4000, q: 4, gain: 0.4 }); this.tone({ dur: 0.05, freq: 220, freqEnd: 120, gain: 0.2 }); break;
      case 'shellIn': this.burst({ dur: 0.04, type: 'bandpass', freq: 1700, q: 2.5, gain: 0.45 }); this.burst({ t: 0.03, dur: 0.05, type: 'bandpass', freq: 900, q: 2, gain: 0.3 }); break;
      case 'reloadStart': this.burst({ dur: 0.08, type: 'bandpass', freq: 600, q: 1.5, gain: 0.15 }); break;
      case 'swap': this.burst({ dur: 0.1, type: 'bandpass', freq: 500, q: 1, gain: 0.18 }); break;
      case 'raise': this.burst({ dur: 0.05, type: 'bandpass', freq: 2000, q: 2.5, gain: 0.25 }); this.burst({ t: 0.04, dur: 0.08, type: 'bandpass', freq: 800, q: 1.5, gain: 0.2 }); break;
      case 'tink': { const f = r(5200, 7200); this.tone({ t: 0.02, dur: 0.08, freq: f, gain: 0.05 }); this.tone({ t: 0.12, dur: 0.06, freq: f * 1.07, gain: 0.03 }); break; }
      case 'hit': this.tone({ dur: 0.05, type: 'square', freq: 1900, freqEnd: 1500, gain: 0.08 }); this.burst({ dur: 0.03, type: 'highpass', freq: 3000, gain: 0.18 }); this.burst({ dur: 0.06, type: 'lowpass', freq: 400, gain: 0.35 }); break;
      case 'headshot': // sharp skull crack + bright double tick, clearly not the body thud
        this.burst({ dur: 0.022, type: 'highpass', freq: 4200, gain: 0.9 });
        this.burst({ t: 0.004, dur: 0.06, type: 'bandpass', freq: 2100, q: 4, gain: 0.5, freqEnd: 1300 });
        this.tone({ dur: 0.07, type: 'square', freq: 3900, freqEnd: 3500, gain: 0.05 });
        this.tone({ t: 0.045, dur: 0.11, type: 'triangle', freq: 5200, freqEnd: 4800, gain: 0.07 });
        this.burst({ dur: 0.07, type: 'lowpass', freq: 520, gain: 0.45 }); break;
      // ---- power-ups ----
      case 'powerDrop': this.tone({ dur: 0.5, type: 'sine', freq: 880, freqEnd: 1320, gain: 0.07, attack: 0.02 }); this.tone({ t: 0.08, dur: 0.6, type: 'triangle', freq: 1760, gain: 0.03, attack: 0.03 }); this.burst({ dur: 0.4, type: 'bandpass', freq: 5000, q: 6, gain: 0.08, attack: 0.05 }); break;
      case 'powerup': { // punchy: sub thump, snap, then a rising three-note stab
        this.tone({ dur: 0.35, type: 'sine', freq: 120, freqEnd: 45, gain: 0.9 });
        this.burst({ dur: 0.05, type: 'highpass', freq: 2500, gain: 0.6 });
        const n = { bounty: [523, 659, 988], resupply: [392, 587, 784], reaper: [311, 370, 466], deadfall: [220, 277, 330] }[o.type] || [440, 554, 659];
        n.forEach((f, i) => { this.tone({ t: 0.05 + i * 0.07, dur: 0.38, type: 'sawtooth', freq: f, gain: 0.055 }); this.tone({ t: 0.05 + i * 0.07, dur: 0.45, type: 'square', freq: f * 2, gain: 0.02 }); });
        this.burst({ t: 0.03, dur: 0.6, type: 'bandpass', freq: 1800, q: 1.2, gain: 0.25, freqEnd: 6000, send: 0.5 }); break; }
      case 'powerEnd': this.tone({ dur: 0.3, type: 'triangle', freq: 880, freqEnd: 330, gain: 0.08 }); this.tone({ t: 0.12, dur: 0.3, type: 'triangle', freq: 660, freqEnd: 250, gain: 0.06 }); break;
      case 'deadfall': // pressure drop, then a huge rolling boom
        this.burst({ dur: 0.5, type: 'lowpass', freq: 300, gain: 0.5, attack: 0.3, freqEnd: 2400 });
        this.tone({ t: 0.32, dur: 2.2, type: 'sine', freq: 70, freqEnd: 22, gain: 1.4 });
        this.burst({ t: 0.32, dur: 2.6, type: 'lowpass', freq: 1400, gain: 1.6, freqEnd: 70, send: 1 });
        this.burst({ t: 0.32, dur: 0.12, type: 'highpass', freq: 1500, gain: 1.0 }); break;
      case 'kill': this.tone({ dur: 0.22, type: 'sine', freq: 140, freqEnd: 45, gain: 0.6 }); this.tone({ t: 0.01, dur: 0.24, type: 'sine', freq: 1250, freqEnd: 1180, gain: 0.12 }); this.burst({ dur: 0.12, type: 'lowpass', freq: 800, gain: 0.5 }); break;
      case 'impact': {
        const metal = o.mat === 'metal', wood = o.mat === 'wood';
        const pan = o.pan || 0, g = o.gain ?? 1;
        if (metal) { this.tone({ dur: 0.12, freq: r(2400, 3600), freqEnd: r(1800, 2400), gain: 0.07 * g, pan }); if (Math.random() < 0.25) this.ricochet(pan, g); }
        this.burst({ dur: 0.05, type: 'bandpass', freq: metal ? 3000 : wood ? 900 : 1500, q: 1.2, gain: 0.22 * g, pan });
        break;
      }
      case 'flesh': this.burst({ dur: 0.07, type: 'lowpass', freq: 700, gain: 0.5 * (o.gain ?? 1), pan: o.pan || 0 }); this.burst({ dur: 0.04, type: 'bandpass', freq: 2000, q: 1, gain: 0.12, pan: o.pan || 0 }); break;
      case 'step': this.burst({ dur: o.sprint ? 0.09 : 0.07, type: 'lowpass', freq: o.sprint ? 900 : 650, gain: o.crouch ? 0.05 : o.sprint ? 0.2 : 0.12, rate: r(0.8, 1.2) }); this.burst({ dur: 0.03, type: 'bandpass', freq: 3000, q: 2, gain: 0.03 }); break;
      case 'land': this.burst({ dur: 0.12, type: 'lowpass', freq: 500, gain: 0.4 * (o.k || 1) }); this.tone({ dur: 0.12, freq: 90, freqEnd: 50, gain: 0.3 * (o.k || 1) }); break;
      case 'jump': this.burst({ dur: 0.06, type: 'lowpass', freq: 800, gain: 0.12 }); break;
      case 'slide': this.burst({ dur: 0.6, type: 'bandpass', freq: 900, q: 0.6, gain: 0.25, attack: 0.03, freqEnd: 400 }); break;
      case 'hurt': this.tone({ dur: 0.25, freq: 110, freqEnd: 60, gain: 0.5 }); this.burst({ dur: 0.15, type: 'lowpass', freq: 600, gain: 0.5 }); break;
      case 'growl': {
        const pan = o.pan || 0, g = (o.gain ?? 1) * (o.brute ? 1.2 : 0.8), f = o.brute ? 260 : 520;
        this.burst({ dur: r(0.3, 0.6), type: 'bandpass', freq: f * r(0.8, 1.3), q: 6, gain: 0.35 * g, pan, attack: 0.05, freqEnd: f * 0.6, rate: 0.6 });
        this.tone({ dur: 0.4, type: 'sawtooth', freq: (o.brute ? 70 : 140) * r(0.9, 1.1), freqEnd: o.brute ? 50 : 90, gain: 0.06 * g, pan, attack: 0.06 });
        break;
      }
      case 'scream': { const pan = o.pan || 0, g = o.gain ?? 1; this.burst({ dur: 0.5, type: 'bandpass', freq: 1300, q: 8, gain: 0.3 * g, pan, attack: 0.02, freqEnd: 500, rate: 0.7 }); break; }
      case 'swing': this.burst({ dur: 0.18, type: 'bandpass', freq: 600, q: 1, gain: 0.3 * (o.gain ?? 1), pan: o.pan || 0, freqEnd: 1600 }); break;
      case 'waveStart': {
        [55, 82.4, 110].forEach((f, i) => this.tone({ dur: 2.6, type: 'sawtooth', freq: f, gain: 0.08, attack: 0.6, send: 0.6, t: i * 0.02 }));
        this.burst({ dur: 2.2, type: 'lowpass', freq: 200, gain: 0.3, attack: 0.5, send: 0.5 });
        break;
      }
      case 'waveEnd': [523, 659, 784].forEach((f, i) => this.tone({ t: i * 0.09, dur: 0.6, type: 'triangle', freq: f, gain: 0.08, send: 0.5 })); break;
      // ---- M14 enemies and special waves
      case 'jumperWind': { const pan = o.pan || 0, g = o.gain ?? 1; this.burst({ dur: 0.6, type: 'bandpass', freq: 500, q: 6, gain: 0.4 * g, pan, attack: 0.15, freqEnd: 1900, rate: 0.9 }); this.tone({ dur: 0.55, type: 'sawtooth', freq: 180, freqEnd: 520, gain: 0.07 * g, pan, attack: 0.2 }); break; }
      case 'jumperLeap': { const pan = o.pan || 0, g = o.gain ?? 1; this.burst({ dur: 0.3, type: 'bandpass', freq: 700, q: 1.2, gain: 0.5 * g, pan, freqEnd: 2200 }); this.tone({ dur: 0.22, freq: 120, freqEnd: 60, gain: 0.25 * g, pan }); break; }
      case 'jumperHop': { const pan = o.pan || 0, g = o.gain ?? 1; this.burst({ dur: 0.14, type: 'bandpass', freq: 900, q: 1.5, gain: 0.3 * g, pan, freqEnd: 1500 }); this.tone({ dur: 0.1, freq: 150, freqEnd: 80, gain: 0.15 * g, pan }); break; }
      case 'jumperLand': { const pan = o.pan || 0, g = o.gain ?? 1; this.tone({ dur: 0.2, freq: 90, freqEnd: 38, gain: 0.5 * g, pan }); this.burst({ dur: 0.14, type: 'lowpass', freq: 700, gain: 0.5 * g, pan, freqEnd: 200 }); break; }
      case 'bruteClang': { const pan = o.pan || 0, g = o.gain ?? 1; this.tone({ dur: 0.35, type: 'square', freq: 640 * r(0.9, 1.1), freqEnd: 590, gain: 0.07 * g, pan }); this.tone({ dur: 0.5, type: 'triangle', freq: 1280 * r(0.95, 1.05), freqEnd: 1240, gain: 0.05 * g, pan }); this.burst({ dur: 0.05, type: 'highpass', freq: 3500, gain: 0.35 * g, pan }); break; }
      case 'cripple': { const pan = o.pan || 0, g = o.gain ?? 1; this.tone({ dur: 0.5, freq: 100, freqEnd: 34, gain: 0.8 * g, pan }); this.burst({ dur: 0.3, type: 'lowpass', freq: 800, gain: 0.7 * g, pan, freqEnd: 200 }); this.burst({ t: 0.05, dur: 0.6, type: 'bandpass', freq: 240, q: 3, gain: 0.5 * g, pan, rate: 0.5, freqEnd: 110 }); break; }
      case 'bruteStep': { const pan = o.pan || 0, g = o.gain ?? 1; this.tone({ dur: 0.28, freq: 62, freqEnd: 26, gain: 0.7 * g, pan }); this.burst({ dur: 0.16, type: 'lowpass', freq: 380, gain: 0.5 * g, pan, freqEnd: 110 }); this.burst({ t: 0.02, dur: 0.04, type: 'highpass', freq: 3000, gain: 0.12 * g, pan }); break; }
      case 'bloatBeat': { const pan = o.pan || 0, g = o.gain ?? 1, k = o.k || 0; this.tone({ dur: 0.18, type: 'sine', freq: 70 + 70 * k, freqEnd: 40 + 30 * k, gain: 0.6 * g, pan }); this.tone({ t: 0.01, dur: 0.12, type: 'triangle', freq: 520 + 600 * k, freqEnd: 420 + 400 * k, gain: 0.05 * g, pan }); this.burst({ dur: 0.1, type: 'bandpass', freq: 900 + 900 * k, q: 4, gain: 0.12 * g, pan }); break; }
      case 'bloaterBurst': { const g = o.gain ?? 1; this.burst({ dur: 0.5, type: 'lowpass', freq: 1800, gain: 1.0 * g, freqEnd: 180, send: 0.4 }); this.burst({ t: 0.02, dur: 0.7, type: 'highpass', freq: 3000, gain: 0.35 * g, attack: 0.02 }); this.tone({ dur: 0.5, freq: 110, freqEnd: 30, gain: 0.8 * g }); break; }
      case 'special': { [98, 147, 196].forEach((f, i) => this.tone({ dur: 1.6, type: 'sawtooth', freq: f, freqEnd: f * 1.5, gain: 0.07, attack: 0.5, send: 0.6, t: i * 0.05 })); this.tone({ t: 0.1, dur: 1.4, type: 'square', freq: 620, freqEnd: 940, gain: 0.04, attack: 0.5, send: 0.5 }); this.burst({ dur: 1.2, type: 'bandpass', freq: 400, q: 2, gain: 0.3, attack: 0.5, freqEnd: 1600, send: 0.5 }); break; }
      case 'sever': this.burst({ dur: 0.09, type: 'lowpass', freq: 900, gain: 0.7 }); this.burst({ dur: 0.05, type: 'bandpass', freq: 2600, q: 2, gain: 0.3 }); this.tone({ dur: 0.1, freq: 160, freqEnd: 70, gain: 0.3 }); break;
      case 'armor': this.tone({ dur: 0.06, type: 'square', freq: 2400, freqEnd: 2100, gain: 0.05 }); this.burst({ dur: 0.04, type: 'highpass', freq: 4500, gain: 0.25 }); break;
      case 'roar': { const g = o.gain ?? 1; this.burst({ dur: 1.4, type: 'bandpass', freq: 220, q: 2, gain: 0.9 * g, attack: 0.1, freqEnd: 120, rate: 0.5, send: 0.5 }); this.tone({ dur: 1.2, type: 'sawtooth', freq: 70, freqEnd: 48, gain: 0.25 * g, attack: 0.1, send: 0.4 }); break; }
      case 'slam': { const g = o.gain ?? 1; this.tone({ dur: 0.7, freq: 70, freqEnd: 28, gain: 0.9 * g }); this.burst({ dur: 0.6, type: 'lowpass', freq: 500, gain: 1.0 * g, freqEnd: 120, send: 0.5 }); break; }
      case 'cylOut': this.burst({ dur: 0.03, type: 'bandpass', freq: 3200, q: 4, gain: 0.4 }); this.burst({ t: 0.04, dur: 0.08, type: 'bandpass', freq: 1400, q: 2, gain: 0.45 }); this.tone({ t: 0.05, dur: 0.12, type: 'triangle', freq: 900, freqEnd: 600, gain: 0.05 }); break;
      case 'casings': for (let i = 0; i < 6; i++) { const f = r(4200, 7400), t = 0.25 + i * r(0.03, 0.07); this.tone({ t, dur: 0.07, freq: f, gain: 0.05 }); this.tone({ t: t + 0.09, dur: 0.05, freq: f * 1.08, gain: 0.03 }); } this.burst({ dur: 0.08, type: 'bandpass', freq: 2500, q: 2, gain: 0.25 }); break;
      case 'speedload': this.burst({ dur: 0.05, type: 'bandpass', freq: 1700, q: 2.5, gain: 0.6 }); this.burst({ t: 0.06, dur: 0.04, type: 'bandpass', freq: 3600, q: 3, gain: 0.35 }); break;
      case 'cylIn': this.burst({ dur: 0.04, type: 'bandpass', freq: 2200, q: 3, gain: 0.8 }); this.tone({ dur: 0.08, freq: 260, freqEnd: 140, gain: 0.25 }); this.burst({ t: 0.02, dur: 0.03, type: 'highpass', freq: 5000, gain: 0.35 }); break;
      // ---- M11: rare guns, salvage crate, forge ----
      case 'lanceShot': { // capacitor snap + descending sci-fi sweep, no gunpowder
        this.tone({ dur: 0.28, type: 'sawtooth', freq: 1900, freqEnd: 180, gain: 0.16, send: 0.5 });
        this.tone({ dur: 0.2, type: 'square', freq: 960, freqEnd: 120, gain: 0.07 });
        this.tone({ dur: 0.35, type: 'sine', freq: 140, freqEnd: 40, gain: 0.7 });
        this.burst({ dur: 0.05, type: 'highpass', freq: 6000, gain: 0.5 }); this.burst({ dur: 0.4, type: 'bandpass', freq: 2400, q: 6, gain: 0.18, freqEnd: 600, send: 0.7 });
        break;
      }
      case 'boltShot': // string twang + limb slap + the bolt hissing away
        this.tone({ dur: 0.18, type: 'triangle', freq: 210, freqEnd: 150, gain: 0.5 }); this.tone({ dur: 0.1, type: 'sawtooth', freq: 420, freqEnd: 300, gain: 0.08 });
        this.burst({ dur: 0.04, type: 'bandpass', freq: 1600, q: 2, gain: 0.8 }); this.burst({ t: 0.02, dur: 0.3, type: 'highpass', freq: 3500, gain: 0.18, freqEnd: 7000 });
        break;
      case 'crateOpen': this.burst({ dur: 0.25, type: 'bandpass', freq: 600, q: 3, gain: 0.5, freqEnd: 900 }); this.burst({ t: 0.22, dur: 0.06, type: 'bandpass', freq: 1800, q: 2, gain: 0.5 }); this.tone({ t: 0.25, dur: 0.9, type: 'triangle', freq: 523, gain: 0.07, send: 0.6 }); this.tone({ t: 0.3, dur: 0.9, type: 'triangle', freq: 784, gain: 0.05, send: 0.6 }); break;
      case 'crateTick': { const f = 1400 - 700 * (o.k || 0); this.tone({ dur: 0.05, type: 'square', freq: f, gain: 0.05 }); this.burst({ dur: 0.02, type: 'bandpass', freq: 4000, q: 5, gain: 0.15 }); break; }
      case 'crateLand': {
        const n = o.rare ? [392, 494, 587, 784, 988] : [440, 554, 659];
        n.forEach((f, i) => this.tone({ t: i * 0.07, dur: 0.7, type: 'triangle', freq: f, gain: 0.08, send: 0.7 }));
        this.tone({ dur: 0.4, type: 'sine', freq: 110, freqEnd: 55, gain: 0.5 }); if (o.rare) this.burst({ dur: 1.2, type: 'bandpass', freq: 5000, q: 2, gain: 0.12, attack: 0.1, send: 0.8 });
        break;
      }
      case 'crateClose': this.burst({ dur: 0.08, type: 'lowpass', freq: 500, gain: 0.7 }); this.tone({ dur: 0.12, type: 'sine', freq: 90, freqEnd: 50, gain: 0.5 }); break;
      case 'crateJam': // gears seizing: grinding noise, sputtering buzz, a sad falling tone
        this.burst({ dur: 0.9, type: 'bandpass', freq: 380, q: 4, gain: 0.6, freqEnd: 120 }); this.tone({ dur: 0.9, type: 'sawtooth', freq: 70, freqEnd: 40, gain: 0.2 });
        for (let i = 0; i < 6; i++) this.burst({ t: 0.1 + i * 0.13, dur: 0.05, type: 'highpass', freq: 3000, gain: 0.3 });
        this.tone({ t: 0.5, dur: 0.8, type: 'triangle', freq: 330, freqEnd: 150, gain: 0.1, send: 0.5 });
        break;
      case 'crateArrive': this.tone({ dur: 0.6, type: 'sine', freq: 660, freqEnd: 990, gain: 0.08, send: 0.6 }); this.burst({ dur: 0.3, type: 'lowpass', freq: 400, gain: 0.5 }); break;
      case 'forgeStart': // heavy motor spinning up, belt whine, hydraulic hiss, sparks crackle; lasts ~3.4 s
        this.burst({ dur: 0.12, type: 'lowpass', freq: 400, gain: 0.8 }); this.tone({ dur: 0.2, type: 'sine', freq: 60, freqEnd: 40, gain: 0.8 });
        this.tone({ t: 0.2, dur: 3.2, type: 'sawtooth', freq: 45, freqEnd: 120, gain: 0.16, attack: 0.6 });
        this.tone({ t: 0.3, dur: 3.1, type: 'square', freq: 220, freqEnd: 660, gain: 0.03, attack: 0.8, send: 0.4 });
        this.burst({ t: 0.25, dur: 3.0, type: 'bandpass', freq: 900, q: 1.5, gain: 0.25, attack: 0.5, freqEnd: 2600 });
        for (let i = 0; i < 14; i++) this.burst({ t: 0.6 + i * 0.2 + Math.random() * 0.1, dur: 0.03, type: 'highpass', freq: 4500, gain: 0.25 });
        break;
      case 'forgeDone': // hydraulic release + anvil clang + bright shimmer
        this.burst({ dur: 0.6, type: 'highpass', freq: 2000, gain: 0.35, freqEnd: 800 });
        [523, 1046, 1568, 2093].forEach((f, i) => this.tone({ t: 0.15, dur: 1.4 - i * 0.2, type: 'sine', freq: f * 1.003, gain: 0.12 / (i + 1), send: 0.8 }));
        this.tone({ t: 0.15, dur: 0.3, type: 'triangle', freq: 180, freqEnd: 120, gain: 0.4 });
        this.burst({ t: 0.4, dur: 1.2, type: 'bandpass', freq: 6000, q: 3, gain: 0.1, attack: 0.2, send: 0.9 });
        break;
      case 'forgeTake': [392, 587, 784, 1175].forEach((f, i) => this.tone({ t: i * 0.05, dur: 0.6, type: 'triangle', freq: f, gain: 0.09, send: 0.6 })); this.tone({ dur: 0.4, type: 'sine', freq: 90, freqEnd: 45, gain: 0.7 }); break;
      // ---- M12 perk drinks: each machine hums its own little motif ----
      case 'drinkHum': {
        const M = { bulwark: [196, 247, 294, 247], snapload: [523, 659, 784, 1046], hairtrigger: [440, 440, 554, 659], lastgasp: [311, 370, 466, 415] }[o.id] || [440, 550];
        const gn = 0.05 * (o.gain ?? 1), wave = { bulwark: 'triangle', snapload: 'square', hairtrigger: 'sawtooth', lastgasp: 'sine' }[o.id];
        M.forEach((f, i) => this.tone({ t: i * 0.16, dur: 0.22, type: wave, freq: f, gain: gn * (wave === 'square' || wave === 'sawtooth' ? 0.5 : 1), send: 0.5 }));
        this.tone({ dur: 1.0, type: 'sine', freq: 60, gain: gn * 1.5, attack: 0.2 }); // compressor hum
        break;
      }
      case 'drinkOpen': this.burst({ dur: 0.12, type: 'highpass', freq: 3000, gain: 0.5, freqEnd: 7000 }); this.burst({ dur: 0.05, type: 'bandpass', freq: 1800, q: 3, gain: 0.5 }); this.tone({ t: 0.05, dur: 0.25, type: 'sine', freq: 900, freqEnd: 1500, gain: 0.05 }); break;
      case 'drinkGulp': for (let i = 0; i < 3; i++) { this.tone({ t: i * 0.24, dur: 0.12, type: 'sine', freq: 180, freqEnd: 90, gain: 0.35 }); this.burst({ t: i * 0.24, dur: 0.1, type: 'lowpass', freq: 500, gain: 0.25 }); } break;
      case 'drinkDone': { const n = { bulwark: [196, 294, 392], snapload: [659, 988, 1319], hairtrigger: [440, 659, 880], lastgasp: [311, 466, 622] }[o.id] || [440, 660, 880]; n.forEach((f, i) => this.tone({ t: i * 0.08, dur: 0.6, type: 'triangle', freq: f, gain: 0.1, send: 0.7 })); this.tone({ dur: 0.4, type: 'sine', freq: 80, freqEnd: 40, gain: 0.6 }); break; }
      case 'secondWind': this.tone({ dur: 1.2, type: 'sine', freq: 40, freqEnd: 120, gain: 0.9, attack: 0.05 }); [233, 311, 466, 622].forEach((f, i) => this.tone({ t: 0.2 + i * 0.1, dur: 1.0, type: 'triangle', freq: f, gain: 0.1, send: 0.8 })); this.burst({ dur: 0.6, type: 'lowpass', freq: 200, gain: 0.9, freqEnd: 3000 }); break;
      case 'gateOpen': // padlock snaps, chain rattles to the ground, heavy gate creaks open and clangs on its stop
        this.burst({ dur: 0.05, type: 'bandpass', freq: 3200, q: 4, gain: 0.7 }); this.tone({ dur: 0.08, type: 'square', freq: 1500, freqEnd: 900, gain: 0.05 });
        for (let i = 0; i < 9; i++) { const t = 0.08 + i * r(0.04, 0.08); this.tone({ t, dur: 0.06, freq: r(2600, 4200), gain: 0.05 }); this.burst({ t, dur: 0.04, type: 'bandpass', freq: r(1800, 3400), q: 4, gain: 0.22 }); }
        this.burst({ t: 0.55, dur: 1.1, type: 'bandpass', freq: 420, q: 9, gain: 0.35, attack: 0.15, freqEnd: 300, rate: 0.6 });
        this.tone({ t: 0.55, dur: 1.0, type: 'sawtooth', freq: 160, freqEnd: 120, gain: 0.04, attack: 0.2 });
        this.tone({ t: 1.6, dur: 0.6, type: 'sine', freq: 110, freqEnd: 60, gain: 0.6 }); this.burst({ t: 1.6, dur: 0.4, type: 'lowpass', freq: 700, gain: 0.7, send: 0.5 }); this.tone({ t: 1.6, dur: 1.2, type: 'triangle', freq: 523, gain: 0.04, send: 0.7 });
        break;
      case 'shutterOpen': // motor clunks on, slats rattle up into the drum, then it locks at the top
        this.tone({ dur: 0.15, type: 'sine', freq: 70, freqEnd: 45, gain: 0.6 }); this.burst({ dur: 0.1, type: 'lowpass', freq: 400, gain: 0.6 });
        this.tone({ t: 0.1, dur: 1.7, type: 'sawtooth', freq: 55, freqEnd: 75, gain: 0.08, attack: 0.2 });
        for (let i = 0; i < 26; i++) this.burst({ t: 0.12 + i * 0.065, dur: 0.035, type: 'bandpass', freq: r(900, 1600), q: 3, gain: 0.2 });
        this.burst({ t: 1.85, dur: 0.08, type: 'bandpass', freq: 2200, q: 3, gain: 0.6 }); this.tone({ t: 1.85, dur: 0.3, type: 'sine', freq: 140, freqEnd: 70, gain: 0.5 }); this.tone({ t: 1.9, dur: 1.0, type: 'triangle', freq: 392, gain: 0.04, send: 0.7 });
        break;
      case 'buy': this.tone({ dur: 0.08, type: 'triangle', freq: 880, gain: 0.12 }); this.tone({ t: 0.07, dur: 0.18, type: 'triangle', freq: 1320, gain: 0.12, send: 0.3 }); this.burst({ dur: 0.05, type: 'highpass', freq: 5000, gain: 0.15 }); break;
      case 'perk': [392, 523, 659, 1046].forEach((f, i) => this.tone({ t: i * 0.06, dur: 0.5, type: 'triangle', freq: f, gain: 0.09, send: 0.6 })); this.burst({ dur: 0.6, type: 'bandpass', freq: 3000, q: 1, gain: 0.12, attack: 0.05, freqEnd: 6000, send: 0.5 }); break;
      case 'shopOpen': this.burst({ dur: 0.5, type: 'lowpass', freq: 300, gain: 0.5, freqEnd: 1200 }); this.tone({ dur: 0.6, type: 'sine', freq: 110, freqEnd: 220, gain: 0.25, send: 0.4 }); break;
      case 'explosion': {
        const g = o.gain ?? 1, k = o.k ?? 1;
        this.burst({ dur: 0.07, type: 'highpass', freq: 1600, gain: 1.1 * g, rate: 0.8 });
        this.burst({ dur: 1.4 * k + 0.3, type: 'lowpass', freq: 1100, gain: 1.7 * g, freqEnd: 90, send: 0.8 });
        this.tone({ dur: 0.9 * k + 0.2, type: 'sine', freq: 80, freqEnd: 26, gain: 1.4 * g });
        this.tone({ dur: 0.25, type: 'triangle', freq: 160, freqEnd: 50, gain: 0.6 * g });
        this.burst({ t: 0.04, dur: 2.4 * k, type: 'lowpass', freq: 420, gain: 0.7 * g, attack: 0.05, freqEnd: 70, send: 0.9 });
        if (k > 0.7) for (let i = 0; i < 7; i++) this.burst({ t: 0.3 + Math.random() * 1.1, dur: 0.05, type: 'bandpass', freq: r(1400, 4200), q: 3, gain: 0.14 * g });
        break;
      }
      case 'click': this.tone({ dur: 0.04, type: 'square', freq: 900, gain: 0.04 }); break;
      // ---- machete ----
      case 'bladeSwing': { const h = o.heavy ? 1.25 : 1;
        this.burst({ dur: 0.2 * h, type: 'bandpass', freq: 700, q: 1.6, gain: 0.55, attack: 0.03, freqEnd: 2600, rate: 0.75 }); // airy swish
        this.burst({ t: 0.04, dur: 0.12, type: 'bandpass', freq: 3200, q: 2.5, gain: 0.2, freqEnd: 5200 });
        this.tone({ dur: 0.16 * h, freq: 140, freqEnd: 80, gain: 0.08, attack: 0.03 }); break; }
      case 'bladeLunge': this.burst({ dur: 0.18, type: 'lowpass', freq: 700, gain: 0.35 }); this.tone({ dur: 0.3, type: 'sawtooth', freq: 140, freqEnd: 90, gain: 0.04 }); break;
      case 'bladeHit': { const n = o.n || 1;
        this.burst({ dur: 0.05, type: 'highpass', freq: 2600, gain: 0.55 });               // edge bite
        this.burst({ t: 0.005, dur: 0.1, type: 'lowpass', freq: 1000, gain: 1.0 });        // meaty chop
        this.tone({ dur: 0.16, freq: 160, freqEnd: 50, gain: 0.75 });                     // body thud
        this.burst({ t: 0.02, dur: 0.24, type: 'bandpass', freq: 700, q: 0.8, gain: 0.55, freqEnd: 260 }); // wet tear
        for (let i = 1; i < n; i++) { this.burst({ t: i * 0.045, dur: 0.07, type: 'lowpass', freq: 850, gain: 0.7 }); this.tone({ t: i * 0.045, dur: 0.12, freq: 120, freqEnd: 50, gain: 0.4 }); }
        this.tone({ t: 0.01, dur: 0.22, type: 'triangle', freq: 2900, freqEnd: 2750, gain: 0.035 }); break; } // blade ring
      case 'bladeDraw': this.burst({ dur: 0.28, type: 'bandpass', freq: 4200, q: 3, gain: 0.28, freqEnd: 6000 }); this.tone({ t: 0.16, dur: 0.45, type: 'triangle', freq: 2300, freqEnd: 2200, gain: 0.05 }); this.tone({ t: 0.16, dur: 0.35, type: 'sine', freq: 3450, gain: 0.025 }); break;
      // ---- throwables ----
      case 'pin': this.burst({ dur: 0.04, type: 'bandpass', freq: 4200, q: 4, gain: 0.35 }); this.tone({ t: 0.03, dur: 0.12, freq: 3100, freqEnd: 2900, gain: 0.05 }); this.burst({ t: 0.12, dur: 0.05, type: 'bandpass', freq: 2400, q: 3, gain: 0.25 }); break;
      case 'tick': this.tone({ dur: 0.035, type: 'square', freq: o.hot ? 1800 : 1250, gain: o.hot ? 0.07 : 0.045 }); break;
      case 'throw': this.burst({ dur: 0.22, type: 'bandpass', freq: 500, q: 1, gain: 0.3, freqEnd: 1500 }); this.burst({ t: 0.02, dur: 0.05, type: 'bandpass', freq: 3600, q: 3, gain: 0.15 }); break;
      case 'bounce': { const g = (o.gain ?? 1) * (0.35 + 0.65 * (o.k ?? 0.5)), pan = o.pan || 0;
        this.burst({ dur: 0.05, type: 'bandpass', freq: o.toy ? 2600 : 1700, q: 2, gain: 0.45 * g, pan });
        this.tone({ dur: o.toy ? 0.18 : 0.09, type: 'triangle', freq: o.toy ? r(1500, 2100) : r(900, 1300), freqEnd: o.toy ? 1200 : 700, gain: 0.08 * g, pan }); break; }
      case 'windup': { const g = o.gain ?? 1, pan = o.pan || 0; for (let i = 0; i < 9; i++) this.burst({ t: i * 0.045, dur: 0.02, type: 'bandpass', freq: 3800 + i * 120, q: 6, gain: 0.3 * g, pan }); break; }
      case 'cymbal': { const g = o.gain ?? 1, pan = o.pan || 0;
        this.burst({ dur: 0.32, type: 'highpass', freq: 5200, q: 0.7, gain: 0.32 * g, pan, send: 0.2 });
        this.burst({ dur: 0.12, type: 'bandpass', freq: 3100, q: 2.5, gain: 0.22 * g, pan });
        this.tone({ dur: 0.25, type: 'square', freq: r(1750, 1850), gain: 0.012 * g, pan }); break; }
      case 'jingle': { // a little music-box riff (original), alternating two bars
        const g = (o.gain ?? 1) * 0.9, pan = o.pan || 0;
        const A = [[784, 0], [988, 0.2], [1175, 0.4], [988, 0.6], [1319, 0.8], [1175, 1.0], [988, 1.2], [784, 1.4]];
        const B = [[880, 0], [1047, 0.2], [1319, 0.4], [1047, 0.6], [1397, 0.8], [1319, 1.0], [1175, 1.2], [1047, 1.4]];
        for (const [f, t] of (o.bar || 0) % 2 ? B : A) { this.tone({ t, dur: 0.3, type: 'triangle', freq: f, gain: 0.09 * g, pan, send: 0.3 }); this.tone({ t, dur: 0.12, type: 'sine', freq: f * 2, gain: 0.03 * g, pan }); }
        break; }
    }
  }
  ricochet(pan, g) { this.tone({ t: 0.01, dur: 0.35, type: 'sine', freq: 4200 + Math.random() * 1500, freqEnd: 1400, gain: 0.06 * g, pan, send: 0.4 }); }
}
