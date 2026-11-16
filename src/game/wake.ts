// Waking the match server before anyone needs it.
//
// The hosted match server runs on a free instance that sleeps after about 15
// minutes without traffic and takes up to a minute to wake. The first request
// after a sleep is what wakes it, so whoever asks first waits. Creating a room
// used to be that first request: the lobby knocked on /online's mount, and the
// usual way in (setup → /online?create=1) creates the room at that same mount.
//
// So the menus knock earlier: when the player picks PLAY WITH FRIENDS on the
// title screen, and whenever the setup screen is in friends mode, before they
// reach the lobby. Opening the title screen and solo play send nothing.
// A knock is one fire-and-forget GET of the public /health probe. Nothing waits
// for it, reads its answer (so it needs nothing from the server's CORS rules),
// or retries it; a failure or a slow answer changes nothing for the player.
//
// Kept small and free of the SDK, so the title screen can use it without
// pulling in the lobby's code.

import { NET_TRANSPORT, readColyseusUrl, viteEnv, type NetTransport } from "./transport";

/**
 * A knock within this long of the last one is skipped. PLAY WITH FRIENDS, the
 * setup screen and the lobby then cost one request between them, while a
 * player who lingers on a menu long enough for the server to doze off again
 * (15 minutes) still sends a fresh one when they move on.
 */
export const WAKE_REPEAT_MS = 60_000;

export type WakeDeps = {
  /** server URL; defaults to VITE_COLYSEUS_URL (or the local server in dev) */
  url?: string | null;
  /** which transport the build uses; defaults to VITE_NET_TRANSPORT */
  transport?: NetTransport;
  now?: () => number;
  fetch?: (input: string, init: RequestInit) => Promise<unknown>;
};

/** When the last knock went out in this page, or null after none (or after one failed). */
let lastKnockAt: number | null = null;

/** The server's public /health probe, over HTTP(S) even for a ws(s):// URL. */
export function healthUrl(url: string): string {
  return `${url.replace(/^ws/i, "http").replace(/\/+$/, "")}/health`;
}

/**
 * Knock on the match server so it is awake by the time the player creates or
 * joins a room. Does nothing in a PeerJS build, without a server URL, or within
 * WAKE_REPEAT_MS of the last knock. Never throws and never blocks: the request
 * runs on its own. Returns whether a request went out.
 */
export function wakeMatchServer(deps: WakeDeps = {}): boolean {
  try {
    if ((deps.transport ?? NET_TRANSPORT) !== "colyseus") return false;
    const url = deps.url === undefined ? readColyseusUrl(viteEnv()) : deps.url;
    if (!url) return false;
    const now = (deps.now ?? Date.now)();
    if (lastKnockAt !== null && now - lastKnockAt < WAKE_REPEAT_MS) return false;
    const send =
      deps.fetch ??
      (typeof globalThis.fetch === "function" ? (input: string, init: RequestInit) => globalThis.fetch(input, init) : null);
    if (!send) return false; // no fetch here (old browsers, some tests): creating or joining a room wakes it anyway
    lastKnockAt = now;
    const knockedAt = now;
    // A knock that fails (offline, blocked) does not hold back the next trigger.
    const forget = () => {
      if (lastKnockAt === knockedAt) lastKnockAt = null;
    };
    try {
      void Promise.resolve(send(healthUrl(url), { mode: "no-cors", cache: "no-store" })).catch(forget);
    } catch {
      forget();
      return false;
    }
    return true;
  } catch {
    // waking is a courtesy: nothing here may get in the player's way
    return false;
  }
}

/** Tests only: forget the last knock. */
export function resetWakeForTests() {
  lastKnockAt = null;
}
