// Between-wave upgrades. Each perk stacks up to `max` levels; the shop deals three you can still take.
const svg = (body) => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const PERKS = [
  { id: 'dmg', name: 'HOLLOW POINTS', cat: 'offense', max: 4, desc: '+15% damage with every gun',
    icon: svg('<path d="M14 34 L30 18"/><path d="M30 18 l6-6 4 4-6 6z"/><circle cx="14" cy="34" r="5"/><path d="M8 40l3-3M20 40l-3-3M8 28l3 3"/>') },
  { id: 'rof', name: 'HAIR TRIGGER', cat: 'offense', max: 3, desc: '+12% fire rate',
    icon: svg('<path d="M10 30h14l4-8h10"/><path d="M24 30c0 6 4 9 8 9"/><path d="M30 12l4 6M36 9l2 7M24 10l6 7"/>') },
  { id: 'reload', name: 'SLEIGHT OF HAND', cat: 'utility', max: 3, desc: '25% faster reloads',
    icon: svg('<rect x="17" y="10" width="14" height="22" rx="2"/><path d="M20 15h8M20 20h8M20 25h8"/><path d="M10 36c6 6 22 6 28 0"/><path d="M34 32l4 4-5 2"/>') },
  { id: 'hp', name: 'IRON HIDE', cat: 'defense', max: 4, desc: '+25 max health',
    icon: svg('<path d="M24 40C12 32 8 24 8 17a8 8 0 0 1 16-3 8 8 0 0 1 16 3c0 7-4 15-16 23z"/><path d="M24 18v12M18 24h12"/>') },
  { id: 'regen', name: 'SECOND WIND', cat: 'defense', max: 3, desc: 'Health regen starts sooner and runs 50% faster',
    icon: svg('<path d="M8 26h8l4-10 6 20 4-10h10"/><path d="M36 12a10 10 0 0 1 4 6"/>') },
  { id: 'speed', name: 'FLEET FOOT', cat: 'utility', max: 3, desc: '+8% movement speed',
    icon: svg('<path d="M14 36l6-10 8 4 4-12"/><circle cx="30" cy="11" r="3"/><path d="M6 20h8M4 26h7M6 32h6"/>') },
  { id: 'mag', name: 'EXTENDED MAGS', cat: 'utility', max: 3, desc: '+30% magazine size and ammo capacity',
    icon: svg('<path d="M18 8h12l3 30H15z"/><path d="M18 16h12M17 23h14M16 30h16"/>') },
  { id: 'head', name: 'DEADEYE', cat: 'offense', max: 3, desc: '+30% headshot damage',
    icon: svg('<circle cx="24" cy="24" r="12"/><circle cx="24" cy="24" r="3"/><path d="M24 6v8M24 34v8M6 24h8M34 24h8"/>') },
  { id: 'boom', name: 'EXPLOSIVE ROUNDS', cat: 'offense', max: 3, desc: 'Hits have a 10% chance to detonate (+10% per level)',
    icon: svg('<path d="M24 6l4 10 10-4-4 10 10 4-10 4 4 10-10-4-4 10-4-10-10 4 4-10-10-4 10-4-4-10 10 4z"/>') },
  { id: 'greed', name: 'BLOOD MONEY', cat: 'utility', max: 3, desc: '+25% points from kills',
    icon: svg('<circle cx="24" cy="24" r="14"/><path d="M29 18c-1-2-3-3-5-3-3 0-5 2-5 4 0 6 10 3 10 9 0 2-2 4-5 4-2 0-4-1-5-3M24 12v4M24 32v4"/>') },
];
export const PERK = Object.fromEntries(PERKS.map((p) => [p.id, p]));

export function dealPerks(levels, n = 3) {
  const open = PERKS.filter((p) => (levels[p.id] || 0) < p.max);
  for (let i = open.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [open[i], open[j]] = [open[j], open[i]]; }
  return open.slice(0, n);
}

// shop prices (points)
export const SHOP = {
  ammo: { name: 'AMMO RESUPPLY', desc: 'Refill reserve ammo for every gun you carry', cost: 400 },
  armor: { name: 'ARMOR PLATE', desc: '+50 armor (soaks 70% of each hit)', cost: 650, max: 150 },
};
