// Guns you spawn with (up to 3 carried; the rest are bought from wall-buys / the shop)
export const START_LOADOUT = ['ar', 'sg'];

// Per-weapon handling. Angles in degrees unless noted. Distances in meters.
export const WEAPONS = [
  {
    id: 'ar', name: 'AR-7 VANGUARD', short: 'AR-7', type: 'Assault rifle', slot: 1,
    auto: true, rpm: 750, pellets: 1,
    damage: 28, damageMin: 19, falloffStart: 22, falloffEnd: 50, headMult: 1.7, limbMult: 0.8,
    mag: 30, reserve: 240, reload: 2.05, reloadEmpty: 2.55,
    hipSpread: 2.4, adsSpread: 0.12, moveSpread: 2.0, bloomPerShot: 0.18, bloomMax: 1.6, bloomRecover: 5,
    recoil: { up: 0.34, upRamp: 0.022, upMax: 0.58, side: 0.12, pattern: [0, 0.04, 0.1, 0.15, 0.08, -0.04, -0.15, -0.2, -0.15, -0.04, 0.08, 0.16, 0.2, 0.16, 0.04, -0.08], adsMult: 0.6, recover: 8 },
    kick: { back: 0.052, up: 0.011, pitch: 0.08, yaw: 0.022, roll: 0.055, cam: 0.8 },
    adsTime: 0.21, adsFov: 52, vmAdsFov: 40, weight: 1.0, sight: 'iron',
    sound: { body: 1.0, crack: 0.9, thump: 110, tail: 1.0, pitch: 1.0 },
    tracerChance: 0.65,
  },
  {
    id: 'sg', name: 'KS-12 BREACHER', short: 'KS-12', cost: 1500, type: 'Pump shotgun', slot: 2,
    auto: false, rpm: 75, pellets: 10, pump: true,
    damage: 17, damageMin: 3, falloffStart: 7, falloffEnd: 24, headMult: 1.4, limbMult: 0.9,
    mag: 7, reserve: 42, reloadStart: 0.42, reloadShell: 0.48, reloadEnd: 0.42,
    hipSpread: 5.6, adsSpread: 3.6, moveSpread: 0.6, bloomPerShot: 0, bloomMax: 0, bloomRecover: 5,
    recoil: { up: 3.0, upRamp: 0, upMax: 3.0, side: 0.7, pattern: [0], adsMult: 0.8, recover: 5.5 },
    kick: { back: 0.15, up: 0.04, pitch: 0.36, yaw: 0.05, roll: 0.12, cam: 2.8 },
    adsTime: 0.25, adsFov: 62, vmAdsFov: 44, weight: 1.25, sight: 'iron',
    sound: { body: 1.5, crack: 0.7, thump: 70, tail: 1.5, pitch: 0.75 },
    tracerChance: 0.35,
  },
  {
    id: 'mr', name: 'MR-30 LONGBOW', short: 'MR-30', cost: 1750, type: 'Marksman rifle', slot: 3,
    auto: false, rpm: 260, pellets: 1,
    damage: 92, damageMin: 76, falloffStart: 45, falloffEnd: 90, headMult: 2.4, limbMult: 0.85, pierce: 1,
    mag: 12, reserve: 84, reload: 2.45, reloadEmpty: 2.95,
    hipSpread: 3.4, adsSpread: 0.0, moveSpread: 3.0, bloomPerShot: 0.6, bloomMax: 1.5, bloomRecover: 3,
    recoil: { up: 1.7, upRamp: 0, upMax: 1.7, side: 0.3, pattern: [0.1, -0.15, 0.2, -0.1], adsMult: 0.7, recover: 6.5 },
    kick: { back: 0.11, up: 0.025, pitch: 0.22, yaw: 0.04, roll: 0.09, cam: 1.9 },
    adsTime: 0.28, adsFov: 38, vmAdsFov: 34, weight: 1.45, sight: 'reddot',
    sound: { body: 1.3, crack: 1.4, thump: 85, tail: 1.8, pitch: 0.82 },
    tracerChance: 1,
  },
];
