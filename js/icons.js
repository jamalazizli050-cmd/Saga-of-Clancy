// Procedural inventory icons — silhouette-style SVG, no external art. Added
// because item cells used to be a plain color swatch with zero shape
// information (a known gap noted in the texture manifest) and nobody's
// drawing bespoke icon art for this. Every icon is a flat `currentColor`
// shape on a transparent background so CSS controls the tint (see
// .item-icon/.item-icon-rare in style.css) — the DOM node itself never sets
// a fill color directly.
//
// Three lookup tables, one per item family, each keyed by the exact field
// the corresponding generator already produces:
//   - WEAPON_ICONS keyed by `weapon.noun` (see weapons.js's WEAPON_NOUNS —
//     rolled once at generation time now specifically so this doesn't have
//     to parse the noun back out of the localized display name).
//   - ARMOR_ICONS keyed by `item.slotType` ('helm' | 'chest').
//   - ACCESSORY_ICONS keyed by the one non-zero key in `item.mods` (see
//     equipment.js's ACCESSORY_AFFIXES — each accessory rolls exactly one).
// getItemIconMarkup(entry) below is the single entry point everything else
// (hud.js) should call — it does the kind/slotType/mods dispatch so callers
// never need to know these tables exist.

const WEAPON_ICONS = {
  // Cleaver: a wide, THIN blade (not a square block, so it doesn't collapse
  // into "hammer" at a glance) with a short handle.
  'тесак': `
    <rect x="6" y="10" width="36" height="10" rx="1" />
    <rect x="18" y="20" width="10" height="20" rx="2" />
  `,
  // Sickle: a thick curved stroke (arc) for the hooked blade, plus a short
  // straight handle continuing the same curve — the arc immediately reads
  // as "curved blade" without needing a filled crescent shape.
  'серп': `
    <path d="M 13 33 A 15 15 0 1 1 33 15" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
    <line x1="13" y1="33" x2="9" y2="40" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
  `,
  // Hammer: a heavy rectangular head, perpendicular to a long thin handle.
  'молот': `
    <rect x="10" y="8" width="22" height="12" rx="1" />
    <rect x="18" y="18" width="6" height="24" rx="2" />
  `,
  // Dagger: a long, narrow, POINTED blade — width stays well under the
  // crossguard's so the blade (not the crossguard) dominates the silhouette;
  // the earlier version got this backwards and read as a flag/pin marker.
  'кинжал': `
    <polygon points="24,4 30,28 18,28" />
    <rect x="16" y="27" width="16" height="3" rx="1" />
    <rect x="21" y="30" width="6" height="12" rx="2" />
  `,
  // Axe: a double-bit/labrys silhouette — a shaft with a wedge blade
  // flaring out on EACH side. Every single-bit version tried (a wedge on
  // just one side of a long handle, rounded or pointed) read as a flag
  // pennant regardless of the head's exact outline — putting a blade on
  // BOTH sides breaks that "pole + one flap" silhouette entirely, and a
  // double-headed axe is a real, recognizable weapon shape in its own right.
  'топор': `
    <rect x="21" y="6" width="6" height="36" rx="2" />
    <path d="M 21 12 L 6 20 L 21 26 Z" />
    <path d="M 27 12 L 42 20 L 27 26 Z" />
  `,
  // Scythe: deliberately a DIFFERENT composition from серп above, not just
  // a bigger version of it (which, at icon size, was indistinguishable from
  // the sickle) — a long straight handle spanning most of the icon, with a
  // small hook blade only at the very top, like the classic reaper profile.
  'коса': `
    <line x1="12" y1="42" x2="30" y2="8" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
    <path d="M 27 11 A 11 11 0 1 1 38 22" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
  `,
};

const ARMOR_ICONS = {
  // Helm: a rounded dome with a horizontal visor slit cut out of it.
  helm: `
    <path d="M 24 8 C 33 8 39 15 39 25 L 39 30 L 9 30 L 9 25 C 9 15 15 8 24 8 Z" />
    <rect x="9" y="21" width="30" height="5" fill="#000" opacity="0.55" />
  `,
  // Chestplate: a torso-shaped plate — shoulder notches at top, tapered waist.
  chest: `
    <path d="M 24 8 L 34 12 L 39 18 L 34 20 L 34 40 L 14 40 L 14 20 L 9 18 L 14 12 Z" />
    <line x1="24" y1="12" x2="24" y2="38" stroke="#000" stroke-width="2" opacity="0.4" />
  `,
};

const ACCESSORY_ICONS = {
  // сапоги / speedBonus: a boot silhouette.
  speedBonus: `
    <path d="M 16 8 L 26 8 L 26 24 L 36 30 C 39 31 40 33 40 36 L 40 38 L 10 38 L 10 20 L 16 20 Z" />
  `,
  // печать / goldFind: a coin/seal — ring with a stamped star.
  goldFind: `
    <circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" stroke-width="4" />
    <polygon points="24,15 27,21 33,21 28,25 30,31 24,27 18,31 20,25 15,21 21,21" />
  `,
  // кольцо / cooldownReduction: a plain ring (donut).
  cooldownReduction: `
    <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="6" />
  `,
  // клеймо / damageBonus: a flame/brand mark. A circle-with-slash (the
  // earlier version) universally reads as "forbidden" in UI iconography —
  // exactly backwards for a damage BUFF — so this uses a flame silhouette
  // instead, which also ties into "клеймо" meaning a (hot) brand/stamp.
  damageBonus: `
    <path d="M 24 6 C 30 16 36 20 32 30 C 30 36 24 40 18 36 C 12 32 12 24 16 20 C 18 24 20 22 19 18 C 22 20 24 16 24 6 Z" />
  `,
  // оберег / bonusHp: a heart — the most immediately legible "this is HP"
  // symbol available, more so than the loop-and-teardrop talisman it
  // replaced.
  bonusHp: `
    <path d="M 24 38 C 8 27 8 12 19 12 C 22 12 24 14 24 17 C 24 14 26 12 29 12 C 40 12 40 27 24 38 Z" />
  `,
  // пластина / damageReduction: a small heater-shield shape.
  damageReduction: `
    <path d="M 24 7 L 38 12 L 38 24 C 38 33 32 39 24 42 C 16 39 10 33 10 24 L 10 12 Z" />
  `,
};

// Single dispatch point — figures out kind/slotType/affix from the entry
// shape itself so callers (hud.js) never touch the tables above directly.
// entry: { kind: 'weapon' | 'gear', item }.
function getItemIconMarkup(entry) {
  if (entry.kind === 'weapon') {
    return WEAPON_ICONS[entry.item.noun] || WEAPON_ICONS['тесак'];
  }
  const item = entry.item;
  if (item.slotType === 'helm' || item.slotType === 'chest') {
    return ARMOR_ICONS[item.slotType];
  }
  // Accessory: find the one mod key it actually rolled.
  const key = EQUIP_MOD_KEYS.find((k) => item.mods[k] !== 0);
  return ACCESSORY_ICONS[key] || ACCESSORY_ICONS.bonusHp;
}

// Builds the actual <svg> DOM node (viewBox 0 0 48 48, currentColor fill)
// used everywhere an item icon is shown (inventory grid, equipped-slot
// cells, scrapper grid).
function buildItemIconSvg(entry) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('class', 'item-icon-svg');
  svg.innerHTML = getItemIconMarkup(entry);
  return svg;
}
