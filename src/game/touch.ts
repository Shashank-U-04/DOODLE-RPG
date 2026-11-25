// Touch play: who gets on-screen controls, their layouts (three presets and
// the player's own edits), the settings, and haptics. The controls themselves
// are src/components/TouchControls.tsx.

/* -------------------------------- detection -------------------------------- */

/** `?touch=1` / `?touch=0` force it (and remember the choice); otherwise a coarse pointer means touch. */
export function wantsTouchControls(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search).get("touch");
    if (q === "1" || q === "0") localStorage.setItem("dd_touch_force", q);
    const forced = localStorage.getItem("dd_touch_force");
    if (forced === "1") return true;
    if (forced === "0") return false;
  } catch {
    /* private mode: fall through to detection */
  }
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const fine = typeof matchMedia === "function" && matchMedia("(any-pointer: fine)").matches;
  return coarse || (navigator.maxTouchPoints > 0 && !fine);
}

/* --------------------------------- layout --------------------------------- */

export type ButtonId =
  | "fire"
  | "fireL"
  | "aim"
  | "jump"
  | "crouch"
  | "dash"
  | "grenade"
  | "reload"
  | "melee"
  | "peekL"
  | "peekR"
  | "weapons"
  | "pause";

/** a button's centre as a fraction of the play area, its diameter in px, and its opacity */
export type ButtonPlace = { x: number; y: number; size: number; opacity: number };
export type Layout = Record<ButtonId, ButtonPlace>;

const B = (x: number, y: number, size: number, opacity = 0.75): ButtonPlace => ({ x, y, size, opacity });

export const PRESETS: Record<string, { name: string; layout: Layout }> = {
  // both thumbs: move on the left, everything else under the right thumb
  thumbs: {
    name: "2 thumbs",
    layout: {
      fire: B(0.85, 0.66, 96, 0.8),
      fireL: B(0.09, 0.42, 66),
      aim: B(0.7, 0.52, 62),
      jump: B(0.95, 0.5, 60),
      crouch: B(0.72, 0.76, 54),
      dash: B(0.6, 0.72, 50),
      grenade: B(0.94, 0.88, 48),
      reload: B(0.8, 0.3, 48),
      melee: B(0.6, 0.5, 48),
      peekL: B(0.21, 0.26, 52),
      peekR: B(0.31, 0.26, 52),
      weapons: B(0.55, 0.93, 36, 0.85),
      pause: B(0.5, 0.16, 38, 0.7),
    },
  },
  // a left index finger on the second FIRE, up in the corner
  claw3: {
    name: "3 fingers",
    layout: {
      fire: B(0.86, 0.68, 92, 0.8),
      fireL: B(0.08, 0.2, 70),
      aim: B(0.71, 0.54, 60),
      jump: B(0.95, 0.5, 58),
      crouch: B(0.73, 0.78, 54),
      dash: B(0.61, 0.74, 50),
      grenade: B(0.94, 0.88, 46),
      reload: B(0.8, 0.3, 46),
      melee: B(0.61, 0.52, 46),
      peekL: B(0.21, 0.24, 50),
      peekR: B(0.3, 0.24, 50),
      weapons: B(0.55, 0.93, 36, 0.85),
      pause: B(0.5, 0.16, 38, 0.7),
    },
  },
  // both index fingers on top: FIRE left, SCOPE and DUCK right; thumbs move and look
  claw4: {
    name: "4-finger claw",
    layout: {
      fire: B(0.85, 0.7, 88, 0.8),
      fireL: B(0.08, 0.2, 70),
      aim: B(0.77, 0.22, 64),
      jump: B(0.95, 0.5, 58),
      crouch: B(0.66, 0.22, 56),
      dash: B(0.62, 0.74, 50),
      grenade: B(0.94, 0.9, 46),
      reload: B(0.72, 0.5, 46),
      melee: B(0.58, 0.5, 46),
      peekL: B(0.21, 0.24, 50),
      peekR: B(0.3, 0.24, 50),
      weapons: B(0.55, 0.93, 36, 0.85),
      pause: B(0.5, 0.16, 38, 0.7),
    },
  },
};

/* -------------------------------- settings -------------------------------- */

export type TouchSettings = {
  preset: string;
  layout: Layout;
  /** look speed for a thumb drag, percent */
  sens: number;
  gyro: "off" | "scope" | "always";
  /** gyroscope speed, percent */
  gyroSens: number;
  /** PEEK also opens the scope while held (the "peek & open scope" style) */
  peekScope: boolean;
  /** buzz on hits and kills (Android; iPhones have no web vibration) */
  haptics: boolean;
};

const SETTINGS_KEY = "dd_touch";

const defaults = (): TouchSettings => ({
  preset: "thumbs",
  layout: structuredClone(PRESETS.thumbs.layout),
  sens: 100,
  gyro: "off",
  gyroSens: 100,
  peekScope: true,
  haptics: true,
});

const clampNum = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** Saved settings, repaired: anything missing or out of range falls back to the default. */
export function loadTouchSettings(): TouchSettings {
  const d = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<TouchSettings> | null;
    if (!raw || typeof raw !== "object") return d;
    const layout = { ...d.layout };
    for (const id of Object.keys(layout) as ButtonId[]) {
      const p = raw.layout?.[id];
      if (p && typeof p === "object")
        layout[id] = {
          x: clampNum(p.x, 0, 1, layout[id].x),
          y: clampNum(p.y, 0, 1, layout[id].y),
          size: clampNum(p.size, 32, 150, layout[id].size),
          opacity: clampNum(p.opacity, 0.15, 1, layout[id].opacity),
        };
    }
    return {
      preset: typeof raw.preset === "string" && PRESETS[raw.preset] ? raw.preset : "custom",
      layout,
      sens: clampNum(raw.sens, 20, 400, d.sens),
      gyro: raw.gyro === "scope" || raw.gyro === "always" ? raw.gyro : "off",
      gyroSens: clampNum(raw.gyroSens, 20, 400, d.gyroSens),
      peekScope: typeof raw.peekScope === "boolean" ? raw.peekScope : d.peekScope,
      haptics: typeof raw.haptics === "boolean" ? raw.haptics : d.haptics,
    };
  } catch {
    return d;
  }
}

export function saveTouchSettings(s: TouchSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode: the settings still apply for this visit */
  }
}

/** A short buzz for a hit (longer for a kill), when haptics are on and the device can. */
export function buzz(kill: boolean) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  if (!loadTouchSettings().haptics) return;
  try {
    navigator.vibrate(kill ? [18, 40, 28] : 12);
  } catch {
    /* some browsers throw before the first user gesture */
  }
}
