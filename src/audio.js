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
    const ctx = this.ctx, now = ctx.currentTime + t;
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
    const ctx = this.ctx, now = ctx.currentTime + t;
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
      case 'headshot': this.tone({ dur: 0.18, type: 'sine', freq: 3200, freqEnd: 2900, gain: 0.18 }); this.tone({ dur: 0.12, type: 'triangle', freq: 1600, gain: 0.12 }); this.burst({ dur: 0.08, type: 'lowpass', freq: 500, gain: 0.55 }); break;
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
      case 'spitCharge': { const pan = o.pan || 0, g = o.gain ?? 1; this.burst({ dur: 0.8, type: 'bandpass', freq: 400, q: 5, gain: 0.35 * g, pan, attack: 0.3, freqEnd: 1400, rate: 0.8 }); break; }
      case 'spit': { const pan = o.pan || 0, g = o.gain ?? 1; this.burst({ dur: 0.18, type: 'bandpass', freq: 900, q: 1.5, gain: 0.6 * g, pan, freqEnd: 300 }); this.tone({ dur: 0.12, freq: 260, freqEnd: 120, gain: 0.2 * g, pan }); break; }
      case 'splash': { const g = o.gain ?? 1, pan = o.pan || 0; this.burst({ dur: 0.35, type: 'lowpass', freq: 1400, gain: 0.7 * g, pan, freqEnd: 300 }); this.burst({ t: 0.02, dur: 0.5, type: 'highpass', freq: 3500, gain: 0.25 * g, pan, attack: 0.02 }); break; }
      case 'sever': this.burst({ dur: 0.09, type: 'lowpass', freq: 900, gain: 0.7 }); this.burst({ dur: 0.05, type: 'bandpass', freq: 2600, q: 2, gain: 0.3 }); this.tone({ dur: 0.1, freq: 160, freqEnd: 70, gain: 0.3 }); break;
      case 'armor': this.tone({ dur: 0.06, type: 'square', freq: 2400, freqEnd: 2100, gain: 0.05 }); this.burst({ dur: 0.04, type: 'highpass', freq: 4500, gain: 0.25 }); break;
      case 'roar': { const g = o.gain ?? 1; this.burst({ dur: 1.4, type: 'bandpass', freq: 220, q: 2, gain: 0.9 * g, attack: 0.1, freqEnd: 120, rate: 0.5, send: 0.5 }); this.tone({ dur: 1.2, type: 'sawtooth', freq: 70, freqEnd: 48, gain: 0.25 * g, attack: 0.1, send: 0.4 }); break; }
      case 'slam': { const g = o.gain ?? 1; this.tone({ dur: 0.7, freq: 70, freqEnd: 28, gain: 0.9 * g }); this.burst({ dur: 0.6, type: 'lowpass', freq: 500, gain: 1.0 * g, freqEnd: 120, send: 0.5 }); break; }
      case 'cylOut': this.burst({ dur: 0.03, type: 'bandpass', freq: 3200, q: 4, gain: 0.4 }); this.burst({ t: 0.04, dur: 0.08, type: 'bandpass', freq: 1400, q: 2, gain: 0.45 }); this.tone({ t: 0.05, dur: 0.12, type: 'triangle', freq: 900, freqEnd: 600, gain: 0.05 }); break;
      case 'casings': for (let i = 0; i < 6; i++) { const f = r(4200, 7400), t = 0.25 + i * r(0.03, 0.07); this.tone({ t, dur: 0.07, freq: f, gain: 0.05 }); this.tone({ t: t + 0.09, dur: 0.05, freq: f * 1.08, gain: 0.03 }); } this.burst({ dur: 0.08, type: 'bandpass', freq: 2500, q: 2, gain: 0.25 }); break;
      case 'speedload': this.burst({ dur: 0.05, type: 'bandpass', freq: 1700, q: 2.5, gain: 0.6 }); this.burst({ t: 0.06, dur: 0.04, type: 'bandpass', freq: 3600, q: 3, gain: 0.35 }); break;
      case 'cylIn': this.burst({ dur: 0.04, type: 'bandpass', freq: 2200, q: 3, gain: 0.8 }); this.tone({ dur: 0.08, freq: 260, freqEnd: 140, gain: 0.25 }); this.burst({ t: 0.02, dur: 0.03, type: 'highpass', freq: 5000, gain: 0.35 }); break;
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
    }
  }
  ricochet(pan, g) { this.tone({ t: 0.01, dur: 0.35, type: 'sine', freq: 4200 + Math.random() * 1500, freqEnd: 1400, gain: 0.06 * g, pan, send: 0.4 }); }
}
