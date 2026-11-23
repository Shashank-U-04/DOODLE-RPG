// Room codes as the lobby handles them: how they travel in a link, and what
// the lobby accepts as one. The match server draws the codes
// (server/src/shared/rules.ts); a tab's seat in a room is held by the
// Colyseus session itself (src/game/colyseus.ts).

import { drawRoomCode } from "../../server/src/shared/rules.js";

/**
 * The query parameter that carries a room code to /online (`/online?room=K7QM`).
 *
 * Not `code`: when the app ran Convex Auth, it treated `?code=` on any page as
 * its sign-in callback, stripped it, and signed the player out when the room
 * code failed as a sign-in code. That provider is gone; `code` is still read
 * for old links.
 */
export const ROOM_PARAM = "room";
export const LEGACY_ROOM_PARAM = "code";
const CODE_SHAPE = /^[A-Z0-9]{3,8}$/;

/** A room code the lobby will accept: uppercase letters/digits, 3–8 long. */
export function normalizeRoomCode(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

/** True when `code` is a syntactically valid room code. */
export function isValidRoomCode(code: string): boolean {
  return CODE_SHAPE.test(code);
}

/** Draw a code from the unambiguous alphabet (no O/0, no I/1): the match server's own function. */
export { drawRoomCode };
