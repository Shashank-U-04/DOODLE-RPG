// A player's character: a skin tone plus one item from each library shelf
// (hair, face, hat, shirt, pants, shoes, extra). Every item has its own fixed
// design; there are no colour pickers. Saved in this browser (localStorage, no
// account) and sent to the match server on join, so friends see the same
// character you built in Customize Character.
//
// On the wire a look is a short code: the version digit "2", then one base-36
// digit per slot. The server only checks the alphabet and length; every reader
// decodes here and falls back slot by slot, so a code from a newer build (or a
// hand-edited one) still draws a sensible character.
//
// Looks are cosmetic only. Hit tests use the body's position and a fixed
// capsule (world.ts), never the rig's meshes, so a tall hat or a pair of wings
// is not a bigger target.

import { LOOK_MAX } from "../../server/src/shared/rules.js";

export const LOOK_STORAGE_KEY = "dd_look";
const VERSION = "2";

export type Item = { id: string; label: string };

export const SKINS: Item[] = [
  { id: "peach", label: "peach" },
  { id: "tan", label: "tan" },
  { id: "brown", label: "brown" },
  { id: "deep", label: "deep" },
];

export const HAIRS: Item[] = [
  { id: "bald", label: "bald" },
  { id: "buzz", label: "buzz cut" },
  { id: "part", label: "side part" },
  { id: "spiky", label: "spiky" },
  { id: "long", label: "long" },
  { id: "ponytail", label: "ponytail" },
  { id: "afro", label: "afro" },
  { id: "bob", label: "bob" },
  { id: "bun", label: "bun" },
  { id: "mohawk", label: "mohawk" },
];

export const FACES: Item[] = [
  { id: "calm", label: "calm" },
  { id: "smile", label: "smile" },
  { id: "grin", label: "big grin" },
  { id: "wink", label: "wink" },
  { id: "cool", label: "shades" },
  { id: "surprised", label: "surprised" },
  { id: "angry", label: "angry" },
  { id: "sleepy", label: "sleepy" },
  { id: "freckles", label: "freckles" },
  { id: "glasses", label: "glasses" },
];

export const HATS: Item[] = [
  { id: "none", label: "no hat" },
  { id: "cap", label: "red cap" },
  { id: "beanie", label: "beanie" },
  { id: "cowboy", label: "cowboy" },
  { id: "tophat", label: "top hat" },
  { id: "headphones", label: "headphones" },
  { id: "crown", label: "crown" },
  { id: "bandana", label: "bandana" },
  { id: "beret", label: "beret" },
  { id: "helmet", label: "army helmet" },
];

export const SHIRTS: Item[] = [
  { id: "tee", label: "white tee" },
  { id: "hoodie", label: "red hoodie" },
  { id: "stripes", label: "striped tee" },
  { id: "denim", label: "denim jacket" },
  { id: "flannel", label: "flannel" },
  { id: "leather", label: "leather jacket" },
  { id: "jersey", label: "jersey" },
  { id: "sweater", label: "sweater" },
  { id: "tank", label: "tank top" },
  { id: "blazer", label: "blazer & tie" },
];

export const PANTS: Item[] = [
  { id: "jeans", label: "blue jeans" },
  { id: "black", label: "black jeans" },
  { id: "chinos", label: "chinos" },
  { id: "cargo", label: "cargo pants" },
  { id: "track", label: "track pants" },
  { id: "shorts", label: "denim shorts" },
  { id: "gym", label: "gym shorts" },
  { id: "ripped", label: "ripped jeans" },
  { id: "joggers", label: "joggers" },
  { id: "skirt", label: "pleated skirt" },
];

export const SHOES: Item[] = [
  { id: "sneakers", label: "sneakers" },
  { id: "boots", label: "black boots" },
  { id: "hightops", label: "high-tops" },
  { id: "work", label: "work boots" },
  { id: "sandals", label: "sandals" },
  { id: "runners", label: "runners" },
  { id: "dress", label: "dress shoes" },
  { id: "rain", label: "rain boots" },
  { id: "skate", label: "skate shoes" },
  { id: "combat", label: "combat boots" },
];

export const EXTRAS: Item[] = [
  { id: "none", label: "nothing" },
  { id: "backpack", label: "backpack" },
  { id: "cape", label: "cape" },
  { id: "katana", label: "katana" },
  { id: "guitar", label: "guitar" },
  { id: "wings", label: "wings" },
  { id: "jetpack", label: "jetpack" },
  { id: "scarf", label: "scarf" },
  { id: "quiver", label: "quiver" },
  { id: "skateboard", label: "skateboard" },
];

export type Look = {
  skin: number;
  hair: number;
  face: number;
  hat: number;
  shirt: number;
  pants: number;
  shoes: number;
  extra: number;
};
export type Slot = keyof Look;

/** the shelves, in the order the editor shows them */
export const SHELVES: { slot: Slot; title: string; items: Item[] }[] = [
  { slot: "hair", title: "HAIR", items: HAIRS },
  { slot: "face", title: "FACE", items: FACES },
  { slot: "hat", title: "HAT", items: HATS },
  { slot: "shirt", title: "SHIRT", items: SHIRTS },
  { slot: "pants", title: "PANTS", items: PANTS },
  { slot: "shoes", title: "SHOES", items: SHOES },
  { slot: "extra", title: "EXTRA", items: EXTRAS },
  { slot: "skin", title: "SKIN", items: SKINS },
];

/** the order the code stores the slots in */
const SLOTS: Slot[] = ["skin", "hair", "face", "hat", "shirt", "pants", "shoes", "extra"];
const LISTS: Record<Slot, Item[]> = {
  skin: SKINS,
  hair: HAIRS,
  face: FACES,
  hat: HATS,
  shirt: SHIRTS,
  pants: PANTS,
  shoes: SHOES,
  extra: EXTRAS,
};

/** the id of the item a look wears in a slot */
export function itemId(look: Look, slot: Slot): string {
  const list = LISTS[slot];
  return (list[look[slot]] ?? list[0]).id;
}

type StarterSpec = { name: string; blurb: string } & Record<Slot, string>;
const pick = (s: StarterSpec): Look => {
  const out = {} as Look;
  for (const k of SLOTS) out[k] = Math.max(0, LISTS[k].findIndex((i) => i.id === s[k]));
  return out;
};

/** ready-made characters; pick one, then swap any item */
const STARTERS: StarterSpec[] = [
  { name: "ROOKIE", blurb: "fresh out of the sketchbook", skin: "peach", hair: "buzz", face: "smile", hat: "cap", shirt: "tee", pants: "jeans", shoes: "sneakers", extra: "none" },
  { name: "SKATER", blurb: "lands every kickflip (eventually)", skin: "tan", hair: "spiky", face: "grin", hat: "beanie", shirt: "stripes", pants: "ripped", shoes: "skate", extra: "skateboard" },
  { name: "ROCKER", blurb: "one more encore", skin: "peach", hair: "mohawk", face: "cool", hat: "none", shirt: "leather", pants: "black", shoes: "boots", extra: "guitar" },
  { name: "SPORTY", blurb: "the warm-up never ends", skin: "brown", hair: "ponytail", face: "smile", hat: "headphones", shirt: "jersey", pants: "gym", shoes: "runners", extra: "none" },
  { name: "SCHOLAR", blurb: "has read the manual", skin: "deep", hair: "part", face: "glasses", hat: "none", shirt: "blazer", pants: "chinos", shoes: "dress", extra: "backpack" },
  { name: "RANGER", blurb: "lives out in the long grass", skin: "tan", hair: "long", face: "calm", hat: "cowboy", shirt: "flannel", pants: "cargo", shoes: "work", extra: "quiver" },
  { name: "NINJA", blurb: "quiet steps, sharp edges", skin: "peach", hair: "bun", face: "angry", hat: "bandana", shirt: "hoodie", pants: "joggers", shoes: "combat", extra: "katana" },
  { name: "ROYAL", blurb: "rules the scoreboard", skin: "brown", hair: "bob", face: "freckles", hat: "crown", shirt: "sweater", pants: "skirt", shoes: "rain", extra: "cape" },
  { name: "FLYER", blurb: "the sky is a shortcut", skin: "deep", hair: "afro", face: "surprised", hat: "helmet", shirt: "tank", pants: "track", shoes: "hightops", extra: "jetpack" },
];

export const CHARACTERS = STARTERS.map((s) => ({ name: s.name, blurb: s.blurb }));

export function starterLook(i: number): Look {
  return pick(STARTERS[i] ?? STARTERS[0]);
}

export const DEFAULT_LOOK: Look = starterLook(0);

const same = (a: Look, b: Look) => SLOTS.every((k) => a[k] === b[k]);

/** the starter this look is exactly, or -1 once any item was swapped */
export function starterOf(look: Look): number {
  return STARTERS.findIndex((_, i) => same(look, starterLook(i)));
}

export function encodeLook(look: Look): string {
  return VERSION + SLOTS.map((k) => Math.max(0, Math.min(35, look[k] | 0)).toString(36)).join("");
}

/** A code from storage or the wire → a look, or null if it is not one at all. */
export function decodeLook(code: unknown): Look | null {
  if (typeof code !== "string" || code.length < 2 || code.length > LOOK_MAX || code[0] !== VERSION) return null;
  if (!/^[0-9a-z]+$/.test(code)) return null;
  const out = { ...DEFAULT_LOOK };
  SLOTS.forEach((k, i) => {
    const ch = code[i + 1];
    if (ch === undefined) return;
    const v = parseInt(ch, 36);
    if (Number.isFinite(v) && v >= 0 && v < LISTS[k].length) out[k] = v;
  });
  return out;
}

/** "ROOKIE", "custom", or "" when the code is not a look (an older client). */
export function lookLabel(code: unknown): string {
  const look = decodeLook(code);
  if (!look) return "";
  const s = starterOf(look);
  return s >= 0 ? CHARACTERS[s].name : "custom";
}

export function loadLook(): Look {
  try {
    return decodeLook(localStorage.getItem(LOOK_STORAGE_KEY)) ?? DEFAULT_LOOK;
  } catch {
    return DEFAULT_LOOK;
  }
}

export function saveLook(look: Look) {
  try {
    localStorage.setItem(LOOK_STORAGE_KEY, encodeLook(look));
  } catch {
    // private mode / storage full: the look still applies for this visit
  }
}

/** What goes in the join options: the saved code, or "" for "draw me the default". */
export function savedLookCode(): string {
  try {
    const raw = localStorage.getItem(LOOK_STORAGE_KEY);
    return decodeLook(raw) ? (raw as string) : "";
  } catch {
    return "";
  }
}

export function randomLook(): Look {
  const out = {} as Look;
  for (const k of SLOTS) out[k] = Math.floor(Math.random() * LISTS[k].length);
  return out;
}
