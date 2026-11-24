// The online match session: what the pages use from it, and the shapes it
// hands them. Online play runs on the Colyseus match server (src/game/colyseus.ts,
// server/). Kept free of browser globals so the server's tests can import it
// under Node.

import type { MatchConfig } from "./maps";
import type { NetCombatIntent, NetPlayerState, NetShotLanded } from "./types";

/** the connection's state, as the lobby shows it */
export type SignalState = "idle" | "connecting" | "open" | "retrying" | "lost" | "closed";

/** One player as the lobby and the scoreboard see them. */
export type NetPlayer = {
  id: string;
  name: string;
  /** ink palette index, so every player reads as a different doodle */
  ink: number;
  /** their Locker look code (src/game/look.ts); unset or "" draws the default */
  look?: string;
  isMe: boolean;
  isHost: boolean;
  kills: number;
  deaths: number;
  state: NetPlayerState;
  /** false once their state stops arriving (closed tab, lost connection, …) */
  online: boolean;
  /** lobby ready state; the host is always ready */
  ready: boolean;
};

/** What a session reports back to the page. */
export type NetHandlers = {
  /** a remote player's transform arrived — hand it straight to the engine */
  onRemoteState?: (id: string, state: NetPlayerState) => void;
  /** the host restarted the match: clear the scoreboard and drop the overlay */
  onRematch?: () => void;
  /** the host said go; adopt `config` if it is present (it is authoritative) */
  onStart?: (config?: MatchConfig) => void;
  /** the host's match rules changed, or arrived for the first time */
  onConfig?: (config: MatchConfig) => void;
  onFeed?: (text: string, hot: boolean) => void;
  onStatus?: (text: string) => void;
  /** the connection's state changed — separate from errors */
  onSignal?: (state: SignalState, detail?: string) => void;
  onError?: (text: string) => void;
  /** the roster or a score changed — re-render */
  onChange?: () => void;
  /** a peer left (cleanly, or by going silent) — drop whatever we cached for them */
  onPeerGone?: (id: string) => void;
};

type Env = Record<string, unknown>;

/** `import.meta.env` under Vite; empty under plain Node (scripts, tests). */
export function viteEnv(): Env {
  return ((import.meta as { env?: Env }).env ?? {}) as Env;
}

/** The local server from server/README.md; only ever used by a development build. */
export const DEV_COLYSEUS_URL = "http://localhost:2567";

/**
 * Where the match server lives: `VITE_COLYSEUS_URL`, or the local server in a
 * development build. A production build without it has no server to talk to,
 * and says so instead of guessing.
 */
export function readColyseusUrl(env: Env): string | null {
  const raw = String(env.VITE_COLYSEUS_URL ?? "").trim();
  if (raw) return /^(https?|wss?):\/\/[^\s/]+/i.test(raw) ? raw.replace(/\/+$/, "") : null;
  return env.DEV ? DEV_COLYSEUS_URL : null;
}

/** Who took the match, as the arena's overlay shows it. */
export type MatchWinner = { id: string; name: string; kills: number; isMe: boolean };

/**
 * The match's winner, or null while it is undecided.
 *
 * A server-refereed session names it (`winnerId`, "" while undecided), and its
 * word stands even if the winner has since left: combat stays stopped until a
 * rematch, so the overlay must stay up for the host. A session that names
 * no referee (undefined) falls back to the score counted here.
 */
export function matchWinner(
  players: NetPlayer[],
  winnerId: string | undefined,
  killsToWin: number,
): MatchWinner | null {
  if (winnerId === undefined) {
    const p = players.find((x) => x.kills >= killsToWin);
    return p ? { id: p.id, name: p.name, kills: p.kills, isMe: p.isMe } : null;
  }
  if (!winnerId) return null;
  const p = players.find((x) => x.id === winnerId);
  return p
    ? { id: p.id, name: p.name, kills: p.kills, isMe: p.isMe }
    : { id: winnerId, name: "A PLAYER WHO LEFT", kills: killsToWin, isMe: false };
}

/** Callbacks a session may call, including the server-authoritative combat ones. */
export type MatchHandlers = NetHandlers & {
  /** the server confirmed one of our attacks landed */
  onShotLanded?: (hit: NetShotLanded) => void;
  /** the server took health off us (`killerId` null: our own grenade, a trap) */
  onHurt?: (damage: number, killerId: string | null) => void;
  /** the server's word on our health, whenever it changes */
  onHealth?: (hp: number, alive: boolean, killerId: string | null) => void;
  /** the session is over for good (server restarted or unreachable, seat gone); the arena must stop */
  onLost?: (text: string) => void;
};

/** Everything Online.tsx uses from a session; ColyseusSession implements it over the server. */
export interface MatchSession {
  readonly code: string;
  readonly isHost: boolean;
  /** our own id within the room, once known */
  readonly me: string;
  /** the room has confirmed our seat */
  readonly joined: boolean;
  connect(): void;
  close(): void;
  resume(): void;
  suspend(): void;
  setHandlers(patch: MatchHandlers): void;
  getPlayers(): NetPlayer[];
  getConfig(): MatchConfig;
  setConfig(patch: Partial<MatchConfig>): void;
  setReady(ready: boolean): void;
  beginMatch(): void;
  rematch(): void;
  setStateProvider(fn: (() => NetPlayerState) | null): void;
  startTicking(): void;
  /** log-safe connection details for a console warning */
  diagnostics(): unknown;
  /** hand an attack to the server, which decides what it did */
  reportCombat(intent: NetCombatIntent): void;
  /** the winner the server declared ("" while undecided) */
  readonly winnerId: string;
}
