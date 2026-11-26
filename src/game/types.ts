export type HudState = {
  score: number;
  combo: string;
  wave: number;
  left: number;
  modifier: string;
  hp: number;
  maxHp: number;
  mag: number;
  reserve: number;
  reloading: boolean;
  nades: number;
  weapon: string;
  hint: string;
  slots: string[];
  slot: number;
  focus: number;
  focusOn: boolean;
  /** enemies in the player's own frame: x = right, z = forward, both -1..1 */
  blips: { x: number; z: number; boss: boolean }[];
  /** the map's name, shown in the HUD corner */
  area?: string;
};

/** The HUD before the first frame is pushed — shared by every game screen. */
export const EMPTY_HUD: HudState = {
  score: 0,
  combo: "",
  wave: 0,
  left: 0,
  modifier: "",
  hp: 120,
  maxHp: 120,
  mag: -1,
  reserve: -1,
  reloading: false,
  nades: 0,
  weapon: "RIFLE",
  hint: "",
  slots: [],
  slot: 0,
  focus: 0,
  focusOn: false,
  blips: [],
  area: "",
};

export type GameOverStats = {
  wave: number;
  kills: number;
  score: number;
  best: boolean;
};

/** ------------------------------------------------------------------ *
 * Online play (PvP)
 *
 * The net layer (src/game/net.ts) keeps the roster and the transport; the
 * engine only knows how to draw remote players and how to trade damage with
 * them. These types are the whole contract between the two.
 * ------------------------------------------------------------------ */

/** One player's transform + vitals, exactly as it goes over the wire. */
export type NetPlayerState = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  moving: boolean;
  firing: boolean;
  /** weapon name, so a remote's gun reads the same as ours */
  weapon: string;
  /**
   * Generation of this body. Bumped every time it is *teleported* (respawn,
   * rematch, a focus dash) rather than walked. Peers snap to a new epoch and
   * refuse anything older, which is what stops the packets still in flight when
   * a player died from dragging their fresh body back to the death spot.
   */
  epoch: number;
  /**
   * Packet counter within one epoch. A transform that arrives out of order (the
   * host relays two guests into one stream, so this happens) would otherwise
   * rewind an avatar by one packet and read as jitter.
   */
  seq: number;
};

/** Where a shot was fired from, so the victim can check it against the world. */
export type NetShotOrigin = { x: number; y: number; z: number };

/**
 * Server-authoritative combat (the Colyseus transport): what the engine sends
 * instead of deciding hits itself. Positions and directions are world space;
 * `dir` is the unscattered aim (the server rolls the spread).
 */
export type NetCombatIntent =
  | { kind: "fire"; weapon: string; origin: NetShotOrigin; dir: NetShotOrigin; ads: boolean; air: boolean }
  | { kind: "slash"; origin: NetShotOrigin; dir: NetShotOrigin }
  | { kind: "dash"; origin: NetShotOrigin; dir: NetShotOrigin }
  | { kind: "throw"; origin: NetShotOrigin; dir: NetShotOrigin }
  | { kind: "reload"; weapon: string };

/** The server confirmed one of our attacks landed: draw the splash and the hitmarker. */
export type NetShotLanded = {
  x: number;
  y: number;
  z: number;
  head: boolean;
  kill: boolean;
  /** a katana hit charges the focus meter */ focus: boolean;
};

/** A remote player the engine should draw this frame. */
export type NetRemotePlayer = {
  id: string;
  name: string;
  /** ink index (0-5) so every player can be told apart at a glance */
  ink: number;
  /** their Locker look code (src/game/look.ts); unset or "" draws the default */
  look?: string;
  state: NetPlayerState;
};

export type EngineCallbacks = {
  onHud: (hud: HudState) => void;
  onMessage: (title: string, sub: string | null, dur: number) => void;
  onTip: (text: string, dur: number) => void;
  onKillFeed: (text: string, hot: boolean) => void;
  onHitmarker: (kill: boolean, crit: boolean) => void;
  onBoss: (name: string | null, frac: number) => void;
  onGameOver: (stats: GameOverStats) => void;
  onPause: (state: { wave: number; score: number }) => void;
  onResume: () => void;
  onAim: (ads: boolean) => void;
  // ---- online only: none of these fire during a solo run ----
  /** we were erased; killerId names the remote that did it (null = self/void) */
  onNetDeath?: (killerId: string | null) => void;
  /** server combat only: we attacked; the server decides what it did */
  onNetCombat?: (intent: NetCombatIntent) => void;
};

export interface GameHandle {
  start(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  toMenu(): void;
  setSensitivity(v: number): void;
  setInvert(on: boolean): void;
  /** AWM: hold the left button to scope in and let go to fire (off: the left button fires at once) */
  setHoldToScope(on: boolean): void;
  setMusic(on: boolean): void;
  dispose(): void;
  // ---- online play: every one of these is a no-op in a solo run ----
  /**
   * Turn the arena into a free-for-all deathmatch: no waves, no enemies. The
   * match server owns hits, damage and health: attacks become onNetCombat
   * intents, and nothing local (our own grenade, a trap, a chest) changes our
   * health. Tracers, muzzle flashes and sounds are still drawn at once.
   */
  setPvp(on: boolean): void;
  /** Our own transform + vitals, for the net layer to broadcast. */
  netState(): NetPlayerState;
  /** Authoritative list of remote players to draw (positions are smoothed). */
  setRemotePlayers(players: NetRemotePlayer[]): void;
  /**
   * Back into the fight after a death (full health).
   * `preferIndex` pins the spawn to a numbered pad — the match uses it to hand
   * everyone a different corner at the start; without it the spawn furthest
   * from the other players wins.
   */
  netRespawn(preferIndex?: number): void;
  /** True while our own player is still standing. */
  isAlive(): boolean;
  /** The server says one of our attacks landed. */
  showNetHit(hit: NetShotLanded): void;
  /** The server took `dmg` off us (`killerId` null: our own doing): the hurt feedback only; health follows syncNetHealth. */
  netDamage(dmg: number, killerId: string | null): void;
  /** The server's word on our health; corrects drift and enforces its deaths. */
  syncNetHealth(hp: number, alive: boolean, killerId: string | null): void;
}
