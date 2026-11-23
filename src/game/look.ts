// A player's look: which battle character they play as (src/game/characters.ts).
// Saved in this browser (localStorage, no account) and sent to the match
// server on join, so friends see the character you picked.
//
// On the wire it is a short code: the version digit "3", then the character's
// index in base 36. The server only checks the alphabet and length. Codes from
// older builds (the clothes editor, "1…"/"2…") decode to null and draw the
// default doodle.

import { LOOK_MAX } from "../../server/src/shared/rules.js";
import { CHARACTER_LIST } from "./characters";

export const LOOK_STORAGE_KEY = "dd_look";
const VERSION = "3";

export type Look = { char: number };

export const DEFAULT_LOOK: Look = { char: 0 };

export function encodeLook(look: Look): string {
  return VERSION + Math.max(0, Math.min(35, look.char | 0)).toString(36);
}

/** A code from storage or the wire → a look, or null if it is not one we can draw. */
export function decodeLook(code: unknown): Look | null {
  if (typeof code !== "string" || code.length < 2 || code.length > LOOK_MAX || code[0] !== VERSION) return null;
  if (!/^[0-9a-z]+$/.test(code)) return null;
  const char = parseInt(code[1], 36);
  return Number.isFinite(char) && char >= 0 && char < CHARACTER_LIST.length ? { char } : null;
}

/** "SWAT", or "" when the code is not a look this build knows. */
export function lookLabel(code: unknown): string {
  const look = decodeLook(code);
  return look ? CHARACTER_LIST[look.char].name : "";
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
    // private mode / storage full: the pick still applies for this visit
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
