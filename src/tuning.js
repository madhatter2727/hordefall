// ============================================================================
// HORDEFALL wave pacing: every number that sets how hard a wave is lives here.
// Player reference speeds: walk 5.4 m/s, sprint 8.4 m/s.
//
// Per wave:
//   count     husks spawned (boss waves: the Colossus comes on top of these)
//   gap       seconds between spawns (randomised ±50%)
//   maxAlive  cap on living husks at once (spawning pauses at the cap)
//   hp, dmg   multipliers on base health / hit damage
//   shamble   walking speed of ordinary husks, m/s (randomised ±15%)
//   runners   fraction of husks that jog   (RUNNER_SPEED)
//   sprinters fraction of husks that sprint (SPRINTER_SPEED)
//   pace      multiplier on Brute / Bloater / Jumper base speed
// Brutes, Bloaters and Jumpers are scheduled separately: see ENEMY_SCHEDULE below.
// Waves past the end of the table extend the last row with LATE_GROWTH.
// ============================================================================
export const WAVES = [
  //       count gap  maxAlive  hp    dmg   shamble runners sprinters pace
  /* 1 */ { count: 8, gap: 2.4, maxAlive: 6, hp: 0.75, dmg: 0.6, shamble: 1.0, runners: 0, sprinters: 0, pace: 0.5 },
  /* 2 */ { count: 11, gap: 2.0, maxAlive: 8, hp: 0.85, dmg: 0.7, shamble: 1.1, runners: 0, sprinters: 0, pace: 0.55 },
  /* 3 */ { count: 14, gap: 1.7, maxAlive: 10, hp: 0.95, dmg: 0.8, shamble: 1.2, runners: 0.05, sprinters: 0, pace: 0.6 },
  /* 4 */ { count: 18, gap: 1.45, maxAlive: 12, hp: 1.0, dmg: 0.85, shamble: 1.3, runners: 0.18, sprinters: 0, pace: 0.65 },
  /* 5 */ { count: 12, gap: 1.6, maxAlive: 10, hp: 1.05, dmg: 0.9, shamble: 1.35, runners: 0.22, sprinters: 0, pace: 0.7 }, // boss
  /* 6 */ { count: 24, gap: 1.2, maxAlive: 16, hp: 1.12, dmg: 0.95, shamble: 1.45, runners: 0.3, sprinters: 0, pace: 0.75 },
  /* 7 */ { count: 27, gap: 1.05, maxAlive: 18, hp: 1.2, dmg: 1.0, shamble: 1.55, runners: 0.38, sprinters: 0, pace: 0.8 },
  /* 8 */ { count: 30, gap: 0.95, maxAlive: 20, hp: 1.28, dmg: 1.05, shamble: 1.65, runners: 0.45, sprinters: 0, pace: 0.85 },
  /* 9 */ { count: 33, gap: 0.85, maxAlive: 22, hp: 1.36, dmg: 1.1, shamble: 1.75, runners: 0.5, sprinters: 0.04, pace: 0.9 },
  /* 10 */ { count: 22, gap: 0.9, maxAlive: 22, hp: 1.45, dmg: 1.15, shamble: 1.85, runners: 0.5, sprinters: 0.1, pace: 0.95 }, // boss
  /* 11 */ { count: 38, gap: 0.7, maxAlive: 26, hp: 1.55, dmg: 1.2, shamble: 1.95, runners: 0.5, sprinters: 0.15, pace: 1.0 },
  /* 12 */ { count: 42, gap: 0.6, maxAlive: 30, hp: 1.65, dmg: 1.25, shamble: 2.0, runners: 0.5, sprinters: 0.2, pace: 1.0 },
];
export const LATE_GROWTH = { count: 4, gap: 0.95, minGap: 0.3, maxAlive: 2, aliveCap: 42, hp: 0.1, dmg: 0.04, dmgCap: 1.6, sprinters: 0.03, sprinterCap: 0.4 };
export const RUNNER_SPEED = [3.0, 3.8];   // m/s, joggers from wave 3-4
export const SPRINTER_SPEED = [5.0, 5.8]; // m/s, only late
export const BOSS_EVERY = 5;              // boss on waves 5, 10, 15...
export const IDLE_CHANCE = 0.25;          // share of husks that spawn wandering, unaware

export function waveParams(n) {
  if (n <= WAVES.length) return { ...WAVES[Math.max(1, n) - 1] };
  const last = WAVES[WAVES.length - 1], k = n - WAVES.length, g = LATE_GROWTH;
  return {
    count: last.count + g.count * k, gap: Math.max(g.minGap, last.gap * Math.pow(g.gap, k)), maxAlive: Math.min(g.aliveCap, last.maxAlive + g.maxAlive * k),
    hp: last.hp + g.hp * k, dmg: Math.min(g.dmgCap, last.dmg + g.dmg * k), shamble: last.shamble, runners: last.runners,
    sprinters: Math.min(g.sprinterCap, last.sprinters + g.sprinters * k), pace: last.pace,
  };
}

// ============================================================================
// Power-up drops (M10). A killed husk (never the Colossus) may drop one glowing pickup.
//   chance    per-kill drop chance: base + perWave * (wave - 1), capped at max (rarer early on)
//   perWave   most drops allowed in one wave (by wave number)
//   minGap    seconds between two drops
//   life      seconds a pickup stays on the ground; it blinks for the last `blink` seconds
//   weights   how likely each type is when something drops
// ============================================================================
export const POWERUPS = {
  chance: { base: 0.03, perWave: 0.005, max: 0.07 },
  perWave: (w) => (w <= 3 ? 1 : w <= 7 ? 3 : w <= 11 ? 4 : 5),     // cap on drops in one wave (random + guaranteed)
  guaranteed: (w) => (w < 4 ? 0 : w < 8 ? 1 : w < 12 ? 2 : 3),      // minimum drops per wave from wave 4 on
  forceAt: 0.7, // if the rolls haven't paid out the guaranteed drops by 70% of the wave's kills, force them (spread out)
  minGap: 8, life: 22, blink: 6, pickRadius: 1.35, maxOnMap: 4,
  weights: { bounty: 30, resupply: 28, reaper: 26, deadfall: 16 },
  bounty: { time: 30, mult: 2 },       // BOUNTY ×2: every point you earn counts double
  reaper: { time: 20 },                // REAPER: any hit kills an ordinary husk (the Colossus is immune)
  deadfall: { bonus: 400, bossDmg: 0.25 }, // DEADFALL: kills every husk; the Colossus loses 25% of its max health instead
};

// Hit feedback (M10)
export const FEEDBACK = {
  slowmo: { dur: 0.85, scale: 0.3, zoom: 7, pitch: 0.72 }, // last husk of a wave: seconds (real time), time scale, FOV zoom-in (deg), audio pitch
  dmgNumLife: 0.75,
};

// Stuck safety net (every enemy type). Checked once a second; each failed check (no progress while trying
// to reach you) escalates: sidestep -> nudge along its own flow field -> hop/vault -> teleport to the nearest
// walkable spot you can't see.
export const STUCK = { sidestep: 2, nudge: 3, vault: 4, relocate: 7, relocateBoss: 7 };

// points for every hit on the Colossus (weak points: glowing head + back core; armor: everywhere else)
export const BOSS_HIT = { weak: 20, armor: 5 };

// ============================================================================
// M11 — Mystery weapon crate ("SALVAGE CRATE")
//   cost       points per spin
//   spin       seconds the roulette of floating guns spins before it lands
//   hold       seconds the winning gun floats in the open crate before it sinks back in
//   pool       weight of each gun in the roulette (rare ones can't be bought anywhere else)
//   jam        chance per spin (after `jamAfter` spins at the same spot) that the crate seizes up:
//              you get your points back, it hauls itself away to another spot and a sign marks where it went
//   moveTime   seconds before it shows up at its new spot
//   spots      where it can sit (x, z, facing)
// ============================================================================
export const CRATE = {
  cost: 950, spin: 4.2, hold: 10, jam: 0.18, jamAfter: 3, moveTime: 6,
  pool: { sg: 12, smg: 12, mr: 11, lmg: 10, rv: 10, ar: 8, lance: 5, hail: 5 },
  spots: [
    { x: -14, z: 3, ry: Math.PI / 2 },
    { x: 16, z: -26, ry: 0 },
    { x: -8, z: 24, ry: Math.PI },
    { x: 26, z: -6, ry: -Math.PI / 2 },
    { x: 30, z: 33.5, ry: Math.PI, area: 'underpass' }, // only once THE UNDERPASS is open
  ],
};

// ============================================================================
// M11 — Weapon upgrade machine ("THE FORGE")
//   cost       points per upgrade; unlockWave = the wave it powers up on (before that you can still
//              force it open for `earlyCost`)
//   time       seconds the gun spends inside (it comes out on its own, then you take it)
//   damage / mag / reserve   multipliers for the upgraded gun; one tier per gun
//   names      new names for upgraded guns
// ============================================================================
export const FORGE = {
  cost: 3000, earlyCost: 5000, unlockWave: 6, time: 3.4,
  x: -20, z: -20.5, ry: 0,
  damage: 2.0, mag: 1.5, reserve: 2.0, rof: 1.1, headMult: 1.15,
  names: {
    ar: 'AR-7 SUPERNOVA', sg: 'KS-12 WRECKING BALL', mr: 'MR-30 HEARTSEEKER', smg: 'VX-9 KILLER BEES', lmg: 'HX-60 IRON CURTAIN',
    rv: 'R-44 JUDGEMENT', lance: 'NX-2 DAYBREAK LANCE', hail: 'SKV-3 FIRESTORM',
  },
};

// ============================================================================
// M12 — Perk drinks (four vending machines). Perks last the whole run and are lost when you die.
//   limit      most drinks you can carry at once
//   price      points per drink
//   x, z, ry   where the machine stands and which way it faces
//   hp         BULWARK BREW: extra max health
//   reload     SNAPLOAD SODA: reload speed multiplier (1.5 = 50% faster)
//   rof        HAIRTRIGGER POP: fire-rate multiplier
//   revive     LAST GASP TONIC: when a hit would kill you, you get back up once with `hp` health,
//              `immune` seconds of invulnerability and a shockwave that throws back nearby husks; then it's used up
//   drinkTime  seconds of the first-person drink animation
// ============================================================================
export const DRINKS = {
  limit: 4, drinkTime: 1.7, humRange: 7,
  list: [
    { id: 'bulwark', name: 'BULWARK BREW', blurb: 'Max health 100 → 200', price: 2500, color: '#ff3b3b', x: -26, z: 10, ry: Math.PI / 2, hp: 100 },
    { id: 'snapload', name: 'SNAPLOAD SODA', blurb: 'Reload 50% faster', price: 3000, color: '#5cff6a', x: 10, z: 25, ry: Math.PI, reload: 1.5 },
    { id: 'hairtrigger', name: 'HAIRTRIGGER POP', blurb: 'Fire rate +33%', price: 2000, color: '#ffb02e', x: 26, z: -24, ry: -Math.PI / 4, rof: 1.33 },
    { id: 'lastgasp', name: 'LAST GASP TONIC', blurb: 'Get back up once when you would die', price: 4000, color: '#b47bff', x: -33, z: -31.5, y: 3.2, ry: Math.PI / 2, area: 'roof', revive: { hp: 60, immune: 3, push: 7, dmg: 150 } },
  ],
};

// ============================================================================
// M13 — Locked areas behind buyable barriers. Opened areas stay open for the whole run.
//   price        points to open
//   rect         footprint on the map (x0, z0, x1, z1); shown on the minimap as locked/open
//   barrier      the blocking piece the prompt sits on (centre, facing normal), kind = gate | shutter
//   spawns       zombie spawn points inside; they only switch on once the area is open
//   spawnShare   chance that a zombie comes from an opened area's spawn instead of a street gate
// ============================================================================
export const AREAS = {
  spawnShare: 0.25,
  list: [
    { id: 'roof', name: 'THE DEPOT ROOF', blurb: 'Rooftop over the old depot', price: 1000, kind: 'gate',
      rect: [-36, -36, -20.2, -27.2], roofY: 3.2,
      barrier: { x: -20.3, z: -30, nx: 1, nz: 0, w: 2.8 },
      spawns: [[-30, 3.2, -34.2], [-34.2, 3.2, -28.8]] },
    { id: 'underpass', name: 'THE UNDERPASS', blurb: 'Old subway concourse', price: 1500, kind: 'shutter',
      rect: [26, 27, 36, 36],
      barrier: { x: 31, z: 27, nx: 0, nz: -1, w: 3 },
      spawns: [[33.4, 0, 32.6]] },
  ],
};

// ============================================================================
// M13 — Nightfall. 0 = sunset, 1 = full night; set by the wave number and eased in between waves.
//   stage(w)      night amount for wave w (sunset 1-3, dusk 4-9, night 10+)
//   blend         seconds to ease from one wave's look to the next
//   sun/hemi/env  light intensities at sunset -> night (the sun becomes cold moonlight)
//   fog           fog density at sunset -> night
//   exposure      tone-mapping exposure at sunset -> night (keeps a readable minimum brightness)
//   lampBoost     street lamps and fires get this much brighter at full night (pools of light)
//   lampFlicker   extra flicker on every other lamp at night
//   flashlight    weapon light at full night (no shadows); comes on from night amount `flashOn`
//   eyeGlow       zombie eye emissive at full night
// ============================================================================
export const NIGHT = {
  stage: (w) => (w <= 3 ? 0 : w >= 10 ? 1 : (w - 3) / 7),
  blend: 10,
  sun: [3.4, 0.55], hemi: [1.1, 0.55], env: [0.5, 0.2], fog: [0.0115, 0.024], exposure: [1.05, 1.32],
  lampBoost: 1.1, lampFlicker: 0.12, flashlight: 34, flashOn: 0.35, eyeGlow: 5.5,
};

// ============================================================================
// M14 — new enemies. Husks (runner) and the Colossus are unchanged.
//   JUMPER   lean and quick. Crouches (windup, with a screech) then leaps at you from range; also hops over cars,
//            crates and other low cover on its way. Replaces the old acid Spitter (gone completely).
//   BRUTE    slow armoured hulk. Head/body take little damage, the LEGS are the weak point: leg hits deal bonus
//            damage and, once enough build up, cripple it (slow limp). Explosives do extra. Hits very hard.
//   BLOATER  swollen, glowing, slow-ish. Bursts when it dies: a blast that hurts zombies (a lot) and you (less).
//            It pulses faster the closer it is to death. Shoot it from range into a crowd.
//   CRAWLER  low fast crawling husk, used by the CRAWLER RUSH special wave.
// ============================================================================
export const ENEMIES = {
  jumper: {
    hp: 130, speed: 5.4, scale: 0.97, dmg: 24, points: 200,
    leapMin: 3.6, leapMax: 10, windup: 0.6, cooldown: [2.4, 3.8], air: [0.48, 0.8], // seconds crouching, then seconds in the air (longer for longer jumps)
    hopCooldown: 0.9, hopWindup: 0.18, hopAhead: 2.4, hopMaxHeight: 1.9,           // hops over low cover: reach ahead (m), tallest thing it will clear (m)
    landRadius: 1.5, knock: 5,                                                       // landing hit: radius around the player, knockback
  },
  brute: {
    hp: 780, speed: 2.9, scale: 1.55, dmg: 46, points: 450,
    armor: { body: 0.3, head: 0.4, limb: 0.5, explosive: 1.5, melee: 0.35 },       // damage multipliers (1 = normal)
    legMult: 2.6, crippleAt: 0.35, crippleSpeed: 0.4, crippleDmgMul: 0.8,            // legs: bonus damage; leg damage (share of max health) that cripples; speed left when crippled
    charge: 1.6,                                                                     // speed multiplier while rushing at close range
  },
  bloater: {
    hp: 270, speed: 2.5, scale: 1.3, dmg: 12, points: 250,
    blast: { radius: 5.6, zombieDmg: 340, playerDmg: 46, fuse: 0.14 },              // blast radius (m), peak damage to zombies / to you, seconds from death to burst
    pulse: [1.1, 7.5],                                                               // glow pulses per second at full health -> near death
    warnAt: 0.5,                                                                     // below this health share the blast ring shows on the ground
  },
  crawler: { hp: 58, speed: 4.3, scale: 0.95, dmg: 12, points: 70 },
};
// Spawn schedule. Wave 1-3 mix is unchanged (husks only); Jumpers and Bloaters/Brutes are mixed into the wave's `count`.
//   jumpers: from wave `from`, each spawn has chance `base + perWave * wave` of being a Jumper, at most `maxAlive(w)` at once
//   brutes / bloaters: appear only on some waves: wave `from`, then every `every` waves (a boss wave shifts it one wave
//   earlier/later), count = first + floor(k * grow) where k counts the appearances
export const ENEMY_SCHEDULE = {
  jumpers: { from: 4, base: 0.14, perWave: 0.012, maxAlive: (w) => 2 + Math.floor(w / 4) },
  brutes: { from: 6, every: 3, first: 1, grow: 0.6, shift: -1, maxAlive: 4 },
  bloaters: { from: 7, every: 3, first: 1, grow: 0.5, shift: 1, maxAlive: 3 },
};
export function scheduledCount(S, wave) {
  for (let k = 0; ; k++) {
    let w = S.from + k * S.every; if (w % BOSS_EVERY === 0) w += S.shift;
    if (w > wave) return 0;
    if (w === wave) return S.first + Math.floor(k * S.grow);
  }
}

// ============================================================================
// M14 — special waves: every 5th wave starting at 3 (3, 8, 13, 18, ...), so never a boss wave (5, 10, 15, ...).
// Each one is harder than the last: special number s = 0, 1, 2 ... and every multiplier below grows with s.
//   order     the rotation of types
//   scale     per special number: count x(1+count*s), health x(1+hp*s), spawn gap x(1-gap*s) (min 0.4), alive cap +alive*s
//   types     per type: base multipliers (applied on top of the wave's normal numbers) + its own settings
//   bonus     points for clearing it (x(1+s)), extra for a flawless clear (never dropped under `flawlessHp` of your health), plus a guaranteed reward drop
// ============================================================================
export const SPECIAL = {
  first: 3, every: 5,
  order: ['crawler', 'fog', 'sprinter', 'blackout', 'armored'],
  scale: { count: 0.12, hp: 0.14, gap: 0.08, alive: 1 },
  bonus: { clear: 400, flawless: 600, flawlessHp: 0.3, reward: 1 },
  types: {
    crawler:  { name: 'CRAWLER RUSH', sub: 'Low, fast, and coming from every gate', color: '#ff9a3a', count: 1.45, hp: 1, gap: 0.62, alive: 1.5, speed: [3.5, 4.6] },
    fog:      { name: 'FOG WAVE', sub: 'You will hear them before you see them', color: '#9fd4ff', count: 1.05, hp: 1.05, gap: 0.9, alive: 1, fog: 4.5, fogColor: [0.52, 0.54, 0.58], groan: 2.2 },
    sprinter: { name: 'SPRINTER WAVE', sub: 'Every one of them runs', color: '#ff5a5a', count: 0.9, hp: 0.85, gap: 0.8, alive: 1.1, speed: [4.9, 5.7] },
    blackout: { name: 'BLACKOUT', sub: 'The lights are out. Your flashlight is all you have', color: '#c58bff', count: 1.0, hp: 1, gap: 0.9, alive: 1, lamps: 0.03, ambient: 0.55, flashlight: 1.3 },
    armored:  { name: 'ARMORED WAVE', sub: 'Thick hides. Extra drops to make up for it', color: '#9fb4c8', count: 0.85, hp: 2.0, gap: 1.0, alive: 1, drops: 2, tint: [0.5, 0.58, 0.7] },
  },
  ease: 3, // seconds to fade a special's weather / lighting in and out
};

// the special wave for wave n, or null. Every multiplier grows with the special's number s (0, 1, 2 ...).
export function specialFor(n) {
  const S = SPECIAL;
  if (n < S.first || (n - S.first) % S.every !== 0 || n % BOSS_EVERY === 0) return null;
  const s = (n - S.first) / S.every, type = S.order[s % S.order.length], T = S.types[type], k = S.scale;
  return { ...T, type, index: s, repeat: Math.floor(s / S.order.length), count: T.count * (1 + k.count * s), hp: T.hp * (1 + k.hp * s),
    gap: T.gap * Math.max(0.4, 1 - k.gap * s), alive: T.alive, aliveAdd: Math.round(k.alive * s) };
}
