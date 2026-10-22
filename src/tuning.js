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
//   brutes    how many brutes are mixed into the wave
//   pace      multiplier on brute / spitter base speed (3.5 / 4.6 m/s)
// Waves past the end of the table extend the last row with LATE_GROWTH.
// ============================================================================
export const WAVES = [
  //       count gap  maxAlive  hp    dmg   shamble runners sprinters brutes pace
  /* 1 */ { count: 8, gap: 2.4, maxAlive: 6, hp: 0.75, dmg: 0.6, shamble: 1.0, runners: 0, sprinters: 0, brutes: 0, pace: 0.5 },
  /* 2 */ { count: 11, gap: 2.0, maxAlive: 8, hp: 0.85, dmg: 0.7, shamble: 1.1, runners: 0, sprinters: 0, brutes: 0, pace: 0.55 },
  /* 3 */ { count: 14, gap: 1.7, maxAlive: 10, hp: 0.95, dmg: 0.8, shamble: 1.2, runners: 0.05, sprinters: 0, brutes: 1, pace: 0.6 },
  /* 4 */ { count: 18, gap: 1.45, maxAlive: 12, hp: 1.0, dmg: 0.85, shamble: 1.3, runners: 0.18, sprinters: 0, brutes: 1, pace: 0.65 },
  /* 5 */ { count: 12, gap: 1.6, maxAlive: 10, hp: 1.05, dmg: 0.9, shamble: 1.35, runners: 0.22, sprinters: 0, brutes: 0, pace: 0.7 }, // boss
  /* 6 */ { count: 24, gap: 1.2, maxAlive: 16, hp: 1.12, dmg: 0.95, shamble: 1.45, runners: 0.3, sprinters: 0, brutes: 2, pace: 0.75 },
  /* 7 */ { count: 27, gap: 1.05, maxAlive: 18, hp: 1.2, dmg: 1.0, shamble: 1.55, runners: 0.38, sprinters: 0, brutes: 2, pace: 0.8 },
  /* 8 */ { count: 30, gap: 0.95, maxAlive: 20, hp: 1.28, dmg: 1.05, shamble: 1.65, runners: 0.45, sprinters: 0, brutes: 3, pace: 0.85 },
  /* 9 */ { count: 33, gap: 0.85, maxAlive: 22, hp: 1.36, dmg: 1.1, shamble: 1.75, runners: 0.5, sprinters: 0.04, brutes: 3, pace: 0.9 },
  /* 10 */ { count: 22, gap: 0.9, maxAlive: 22, hp: 1.45, dmg: 1.15, shamble: 1.85, runners: 0.5, sprinters: 0.1, brutes: 0, pace: 0.95 }, // boss
  /* 11 */ { count: 38, gap: 0.7, maxAlive: 26, hp: 1.55, dmg: 1.2, shamble: 1.95, runners: 0.5, sprinters: 0.15, brutes: 4, pace: 1.0 },
  /* 12 */ { count: 42, gap: 0.6, maxAlive: 30, hp: 1.65, dmg: 1.25, shamble: 2.0, runners: 0.5, sprinters: 0.2, brutes: 4, pace: 1.0 },
];
export const LATE_GROWTH = { count: 4, gap: 0.95, minGap: 0.3, maxAlive: 2, aliveCap: 42, hp: 0.1, dmg: 0.04, dmgCap: 1.6, sprinters: 0.03, sprinterCap: 0.4, brutes: 0.5 };
export const RUNNER_SPEED = [3.0, 3.8];   // m/s, joggers from wave 3-4
export const SPRINTER_SPEED = [5.0, 5.8]; // m/s, only late
export const BOSS_EVERY = 5;              // boss on waves 5, 10, 15...
export const SPITTERS = { fromWave: 4, baseChance: 0.16, perWave: 0.012, maxAlive: (w) => 2 + Math.floor(w / 4) };
export const IDLE_CHANCE = 0.25;          // share of husks that spawn wandering, unaware

export function waveParams(n) {
  if (n <= WAVES.length) return { ...WAVES[Math.max(1, n) - 1] };
  const last = WAVES[WAVES.length - 1], k = n - WAVES.length, g = LATE_GROWTH;
  return {
    count: last.count + g.count * k, gap: Math.max(g.minGap, last.gap * Math.pow(g.gap, k)), maxAlive: Math.min(g.aliveCap, last.maxAlive + g.maxAlive * k),
    hp: last.hp + g.hp * k, dmg: Math.min(g.dmgCap, last.dmg + g.dmg * k), shamble: last.shamble, runners: last.runners,
    sprinters: Math.min(g.sprinterCap, last.sprinters + g.sprinters * k), brutes: Math.floor(last.brutes + g.brutes * k), pace: last.pace,
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
    { id: 'lastgasp', name: 'LAST GASP TONIC', blurb: 'Get back up once when you would die', price: 4000, color: '#b47bff', x: -6, z: -25, ry: 0, revive: { hp: 60, immune: 3, push: 7, dmg: 150 } },
  ],
};
