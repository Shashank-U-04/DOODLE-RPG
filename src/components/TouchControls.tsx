// On-screen controls for phones and tablets, laid out for two thumbs in
// landscape (or three or four fingers, with the claw presets).
//
//  - left: a floating stick that appears where the thumb lands; push it to
//    the rim to run, drag it up past the rim onto RUN to keep running
//  - right: drag anywhere to look; FIRE fires while held and aims as you drag
//    it; a second FIRE on the left lets the right thumb keep steering
//  - SCOPE, JUMP, DUCK, DASH, grenade, reload, blade, a weapon strip, and the
//    two PEEK buttons, which lean out from cover (and can open the scope)
//  - optional gyroscope aim (while scoped, or always), haptics on hits
//  - a layout editor: drag, resize and fade every button; presets; saved in
//    this browser (src/game/touch.ts)
//
// Everything goes through the GameHandle's touch API (touchMove, touchLook,
// touchHold, touchPress); the engine merges it with the keyboard and mouse.
// Every handler reads which control it is from the element's data-id, so no
// handler is built during render.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as RPE,
  type ReactNode,
} from "react";
import type { GameHandle, HudState, TouchAction, TouchHold } from "@/game/types";
import { weaponLabel } from "@/game/arsenal";
import {
  PRESETS,
  loadTouchSettings,
  saveTouchSettings,
  type ButtonId,
  type ButtonPlace,
  type TouchSettings,
} from "@/game/touch";

const LABEL: Record<ButtonId, string> = {
  fire: "FIRE",
  fireL: "FIRE",
  aim: "SCOPE",
  jump: "JUMP",
  crouch: "DUCK",
  dash: "DASH",
  grenade: "✳",
  reload: "RELOAD",
  melee: "BLADE",
  peekL: "◀ PEEK",
  peekR: "PEEK ▶",
  weapons: "GUNS",
  pause: "II",
};

/** the one-shot buttons and what they do */
const PRESS: Partial<Record<ButtonId, TouchAction>> = {
  jump: "jump",
  dash: "dash",
  grenade: "grenade",
  reload: "reload",
  melee: "melee",
  pause: "pause",
};

const STICK_R = 56;
/** drag the stick this far up (in radii) to lock running */
const LOCK_AT = 1.75;

type Props = {
  handle: GameHandle | null;
  /** live play: controls on. Anything else (a panel, down, over) hides them and lets go of everything */
  live: boolean;
  hud: HudState;
  /** the engine's word on aiming down the sights (onAim): drives "gyroscope while scoped" */
  ads: boolean;
};

type Stick = { id: number; ox: number; oy: number; kx: number; ky: number; lock: boolean };

const idOf = (e: RPE<HTMLElement>) => e.currentTarget.dataset.id as ButtonId;

export default function TouchControls({ handle, live, hud, ads }: Props) {
  const [settings, setSettings] = useState<TouchSettings>(loadTouchSettings);
  const [panel, setPanel] = useState<"none" | "settings" | "editor">("none");
  const [stick, setStick] = useState<Stick | null>(null);
  const [sprintLock, setSprintLock] = useState(false);
  const [aimOn, setAimOn] = useState(false);
  const [crouchOn, setCrouchOn] = useState(false);
  const [held, setHeld] = useState<Partial<Record<ButtonId, boolean>>>({});
  const [selected, setSelected] = useState<ButtonId>("fire");
  const [wasLive, setWasLive] = useState(live);
  const areaRef = useRef<HTMLDivElement>(null);
  const looks = useRef(new Map<number, { x: number; y: number }>());
  const fires = useRef(new Set<number>());
  const peekWasAim = useRef<boolean | null>(null);
  const triedFullscreen = useRef(false);
  const drag = useRef<{ id: ButtonId; pointer: number } | null>(null);
  const L = settings.layout;

  // Leaving live play (a panel, down, the result): every control lets go, so
  // nothing is still "held" when play comes back.
  if (live !== wasLive) {
    setWasLive(live);
    if (!live) {
      setStick(null);
      setSprintLock(false);
      setAimOn(false);
      setCrouchOn(false);
      setHeld({});
    }
  }
  useEffect(() => {
    if (live) return;
    handle?.touchMove(0, 0);
    handle?.touchHold({ fire: false, aim: false, sprint: false, crouch: false, lean: 0 });
    looks.current.clear();
    fires.current.clear();
    peekWasAim.current = null;
  }, [live, handle]);

  const update = useCallback((patch: Partial<TouchSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveTouchSettings(next);
      return next;
    });
  }, []);

  // the engine: touch mode on for as long as these controls are mounted
  useEffect(() => {
    if (!handle) return;
    handle.setTouchMode(true);
    return () => handle.setTouchMode(false);
  }, [handle]);
  useEffect(() => handle?.setTouchSensitivity(settings.sens), [handle, settings.sens]);

  const hold = useCallback((patch: Partial<TouchHold>) => handle?.touchHold(patch), [handle]);
  const press = (id: ButtonId, on: boolean) => setHeld((h) => ({ ...h, [id]: on }));

  /* ---- fullscreen + landscape, on the first touch (Android; iPhones cannot) ---- */
  const goFullscreen = useCallback(() => {
    if (triedFullscreen.current) return;
    triedFullscreen.current = true;
    const el = document.documentElement;
    if (document.fullscreenElement || typeof el.requestFullscreen !== "function") return;
    el.requestFullscreen({ navigationUI: "hide" })
      .then(() => {
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        return o?.lock?.("landscape");
      })
      .catch(() => {
        /* refused or unsupported: the game plays the same inside the browser */
      });
  }, []);

  /* ---- gyroscope: turn the view by turning the phone ---- */
  useEffect(() => {
    if (!handle || !live || settings.gyro === "off") return;
    if (settings.gyro === "scope" && !ads) return;
    let last = 0;
    const onMotion = (e: DeviceMotionEvent) => {
      const r = e.rotationRate;
      const now = performance.now();
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      if (!r || dt === 0 || r.beta == null || r.gamma == null) return;
      const k = (Math.PI / 180) * dt * (settings.gyroSens / 100);
      // In landscape the phone's x axis points up (turning is yaw) and its y
      // axis runs across the view (tilting is pitch); which way round depends
      // on the side the phone is turned to.
      const angle = (((screen.orientation?.angle ?? 90) % 360) + 360) % 360;
      const sign = angle === 270 ? 1 : -1;
      handle.touchLook(sign * r.beta * k, sign * r.gamma * k, "rad");
    };
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [handle, live, ads, settings.gyro, settings.gyroSens]);

  /* ---------------------------------- stick ---------------------------------- */
  const stopRunning = () => {
    setSprintLock(false);
    hold({ sprint: false });
    handle?.touchMove(0, 0);
  };
  const stickDown = (e: RPE<HTMLElement>) => {
    e.preventDefault();
    goFullscreen();
    if (stick) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // touching the stick again ends a sprint lock
    if (sprintLock) stopRunning();
    setStick({ id: e.pointerId, ox: e.clientX, oy: e.clientY, kx: 0, ky: 0, lock: false });
  };
  const stickMove = (e: RPE<HTMLElement>) => {
    if (!stick || e.pointerId !== stick.id) return;
    const dx = e.clientX - stick.ox;
    const dy = e.clientY - stick.oy;
    const len = Math.hypot(dx, dy);
    const lock = -dy > STICK_R * LOCK_AT && Math.abs(dx) < STICK_R;
    const k = len > STICK_R ? STICK_R / len : 1;
    const kx = dx * k;
    const ky = dy * k;
    const x = kx / STICK_R;
    const y = -ky / STICK_R;
    // a small dead zone, so a resting thumb does not creep
    const mag = Math.hypot(x, y);
    if (mag < 0.12) handle?.touchMove(0, 0);
    else handle?.touchMove(x, y);
    // pushed to the rim, forward: run
    hold({ sprint: lock || (mag > 0.94 && y > 0.6) });
    setStick({ ...stick, kx, ky, lock });
  };
  const stickUp = (e: RPE<HTMLElement>) => {
    if (!stick || e.pointerId !== stick.id) return;
    if (stick.lock) {
      setSprintLock(true);
      handle?.touchMove(0, 1);
      hold({ sprint: true });
    } else {
      handle?.touchMove(0, 0);
      hold({ sprint: false });
    }
    setStick(null);
  };

  /* ------------------------------ look (a drag) ------------------------------ */
  const lookDown = (e: RPE<HTMLElement>) => {
    e.preventDefault();
    goFullscreen();
    e.currentTarget.setPointerCapture(e.pointerId);
    looks.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const lookMove = (e: RPE<HTMLElement>) => {
    const p = looks.current.get(e.pointerId);
    if (!p) return;
    handle?.touchLook(e.clientX - p.x, e.clientY - p.y, "px");
    p.x = e.clientX;
    p.y = e.clientY;
  };
  const lookUp = (e: RPE<HTMLElement>) => {
    looks.current.delete(e.pointerId);
  };

  /* ------------------------- FIRE (and aim by dragging it) ------------------------- */
  const fireDown = (e: RPE<HTMLElement>) => {
    lookDown(e);
    fires.current.add(e.pointerId);
    hold({ fire: true });
    press(idOf(e), true);
  };
  const fireUp = (e: RPE<HTMLElement>) => {
    lookUp(e);
    fires.current.delete(e.pointerId);
    if (fires.current.size === 0) hold({ fire: false });
    press(idOf(e), false);
  };

  /* ------------------------------ tap buttons ------------------------------ */
  const tapDown = (e: RPE<HTMLElement>) => {
    e.preventDefault();
    goFullscreen();
    const id = idOf(e);
    press(id, true);
    if (id === "aim") {
      setAimOn(!aimOn);
      hold({ aim: !aimOn });
    } else if (id === "crouch") {
      setCrouchOn(!crouchOn);
      hold({ crouch: !crouchOn });
    } else {
      const action = PRESS[id];
      if (action) handle?.touchPress(action);
    }
  };
  const tapUp = (e: RPE<HTMLElement>) => press(idOf(e), false);

  /* ---------------- PEEK: lean while held (and open the scope) ---------------- */
  const peekDown = (e: RPE<HTMLElement>) => {
    e.preventDefault();
    goFullscreen();
    e.currentTarget.setPointerCapture(e.pointerId);
    const id = idOf(e);
    press(id, true);
    hold({ lean: id === "peekL" ? -1 : 1 });
    if (settings.peekScope && peekWasAim.current === null) {
      peekWasAim.current = aimOn;
      hold({ aim: true });
    }
  };
  const peekUp = (e: RPE<HTMLElement>) => {
    press(idOf(e), false);
    hold({ lean: 0 });
    if (peekWasAim.current !== null) {
      hold({ aim: peekWasAim.current });
      peekWasAim.current = null;
    }
  };

  const weaponDown = (e: RPE<HTMLElement>) => {
    e.preventDefault();
    handle?.touchPress({ weapon: Number(e.currentTarget.dataset.slot) });
  };
  const openSettings = (e: RPE<HTMLElement>) => {
    e.preventDefault();
    handle?.touchPress("pause");
    setPanel("settings");
  };

  const place = (id: ButtonId, extra?: CSSProperties): CSSProperties => ({
    left: `${L[id].x * 100}%`,
    top: `${L[id].y * 100}%`,
    width: L[id].size,
    height: L[id].size,
    opacity: L[id].opacity,
    fontSize: Math.max(12, L[id].size * 0.22),
    ...extra,
  });

  /* ------------------------------ layout editor ------------------------------ */
  const editDown = (e: RPE<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const id = idOf(e);
    setSelected(id);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, pointer: e.pointerId };
  };
  const editMove = (e: RPE<HTMLElement>) => {
    const d = drag.current;
    const area = areaRef.current?.getBoundingClientRect();
    if (!d || d.pointer !== e.pointerId || !area) return;
    const x = Math.min(0.98, Math.max(0.02, (e.clientX - area.left) / area.width));
    const y = Math.min(0.98, Math.max(0.02, (e.clientY - area.top) / area.height));
    setSettings((s) => ({ ...s, preset: "custom", layout: { ...s.layout, [d.id]: { ...s.layout[d.id], x, y } } }));
  };
  const editUp = () => {
    if (!drag.current) return;
    drag.current = null;
    saveTouchSettings(settings);
  };
  const setPlace = (patch: Partial<ButtonPlace>) =>
    update({ preset: "custom", layout: { ...L, [selected]: { ...L[selected], ...patch } } });

  const enableGyro = async (mode: TouchSettings["gyro"]) => {
    // iPhones ask once, and only from a tap
    const DME = typeof DeviceMotionEvent === "undefined" ? undefined : DeviceMotionEvent;
    const ask = (DME as unknown as { requestPermission?: () => Promise<string> } | undefined)?.requestPermission;
    if (mode !== "off" && typeof ask === "function") {
      try {
        if ((await ask.call(DME)) !== "granted") return update({ gyro: "off" });
      } catch {
        return update({ gyro: "off" });
      }
    }
    update({ gyro: mode });
  };

  const ids = Object.keys(L) as ButtonId[];
  const showControls = live && panel === "none";

  /** a round button: tap (one-shot or toggle) */
  const tapButton = (id: ButtonId, label: string, on = false, extra?: ReactNode) => (
    <button
      type="button"
      data-id={id}
      className={`dd-tc-btn ${held[id] ? "down" : ""} ${on ? "on" : ""}`}
      style={place(id)}
      onPointerDown={tapDown}
      onPointerUp={tapUp}
      onPointerCancel={tapUp}
    >
      {label}
      {extra}
    </button>
  );

  return (
    <div className="dd-touch-layer">
      {/* portrait: the game is played sideways */}
      <div className="dd-rotate">
        <div className="phone" />
        <p>turn your phone sideways to play</p>
      </div>

      <div
        ref={areaRef}
        className="dd-touch-area"
        style={{ display: showControls || panel === "editor" ? undefined : "none" }}
      >
        {showControls && (
          <>
            {/* the look zone fills the screen behind every other control */}
            <div
              className="dd-tc-look"
              onPointerDown={lookDown}
              onPointerMove={lookMove}
              onPointerUp={lookUp}
              onPointerCancel={lookUp}
            />
            <div
              className="dd-tc-stickzone"
              onPointerDown={stickDown}
              onPointerMove={stickMove}
              onPointerUp={stickUp}
              onPointerCancel={stickUp}
            >
              {stick && (
                <div className="dd-tc-stick" style={{ left: stick.ox, top: stick.oy }}>
                  <div className={`lock ${stick.lock ? "on" : ""}`} style={{ top: -STICK_R * LOCK_AT - 22 }}>
                    RUN
                  </div>
                  <div className="knob" style={{ transform: `translate(${stick.kx}px, ${stick.ky}px)` }} />
                </div>
              )}
              {!stick && !sprintLock && <div className="dd-tc-stickhint">move</div>}
            </div>
            {sprintLock && (
              <button
                type="button"
                className="dd-tc-btn dd-tc-sprintlock"
                onPointerDown={(e) => {
                  e.preventDefault();
                  stopRunning();
                }}
              >
                RUNNING · tap to stop
              </button>
            )}

            {(["fire", "fireL"] as const).map((id) => (
              <button
                type="button"
                key={id}
                data-id={id}
                className={`dd-tc-btn fire ${held[id] ? "down" : ""}`}
                style={place(id)}
                onPointerDown={fireDown}
                onPointerMove={lookMove}
                onPointerUp={fireUp}
                onPointerCancel={fireUp}
              >
                {LABEL[id]}
              </button>
            ))}
            {tapButton("aim", LABEL.aim, aimOn)}
            {tapButton("jump", LABEL.jump)}
            {tapButton("crouch", LABEL.crouch, crouchOn)}
            {tapButton("dash", LABEL.dash)}
            {tapButton("grenade", LABEL.grenade, false, <small>{hud.nades}</small>)}
            {tapButton("reload", LABEL.reload, hud.reloading)}
            {tapButton("melee", hud.weapon === "KATANA" && hud.focusOn ? "FOCUS" : LABEL.melee, hud.focusOn)}
            {(["peekL", "peekR"] as const).map((id) => (
              <button
                type="button"
                key={id}
                data-id={id}
                className={`dd-tc-btn ${held[id] ? "on" : ""}`}
                style={place(id)}
                onPointerDown={peekDown}
                onPointerUp={peekUp}
                onPointerCancel={peekUp}
              >
                {LABEL[id]}
              </button>
            ))}

            <div className="dd-tc-weapons" style={place("weapons", { width: "auto", height: L.weapons.size })}>
              {hud.slots.map((name, i) => (
                <button
                  type="button"
                  key={name}
                  data-slot={i}
                  className={`dd-tc-slot ${i === hud.slot ? "on" : ""}`}
                  onPointerDown={weaponDown}
                >
                  {weaponLabel(name).replace("DESERT EAGLE", "DEAGLE")}
                </button>
              ))}
            </div>

            <div className="dd-tc-top" style={place("pause", { width: "auto", height: L.pause.size })}>
              <button
                type="button"
                data-id="pause"
                className="dd-tc-btn small"
                aria-label="pause"
                onPointerDown={tapDown}
                onPointerUp={tapUp}
              >
                {LABEL.pause}
              </button>
              <button
                type="button"
                className="dd-tc-btn small"
                aria-label="touch settings"
                onPointerDown={openSettings}
              >
                ⚙
              </button>
            </div>
          </>
        )}

        {panel === "editor" && (
          <div className="dd-tc-editor" onPointerMove={editMove} onPointerUp={editUp} onPointerCancel={editUp}>
            {ids.map((id) => (
              <div
                key={id}
                data-id={id}
                className={`dd-tc-btn ghost ${selected === id ? "sel" : ""} ${id === "weapons" ? "wide" : ""}`}
                style={place(id, id === "weapons" ? { width: L.weapons.size * 5 } : undefined)}
                onPointerDown={editDown}
              >
                {id === "pause" ? "II ⚙" : LABEL[id]}
              </div>
            ))}
            <div
              className={`dd-tc-editbar ${L[selected].y < 0.35 ? "low" : ""}`}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <b>{LABEL[selected]}</b>
              <label>
                size
                <input
                  type="range"
                  min={32}
                  max={150}
                  value={L[selected].size}
                  onChange={(e) => setPlace({ size: Number(e.target.value) })}
                />
              </label>
              <label>
                see-through
                <input
                  type="range"
                  min={15}
                  max={100}
                  value={Math.round(L[selected].opacity * 100)}
                  onChange={(e) => setPlace({ opacity: Number(e.target.value) / 100 })}
                />
              </label>
              <button type="button" onClick={() => setPanel("settings")}>
                DONE
              </button>
            </div>
          </div>
        )}
      </div>

      {panel === "settings" && (
        <div className="dd-screen dd-tc-settings">
          <div className="panel">
            <h1>TOUCH CONTROLS</h1>
            <div className="settings">
              <label>
                look speed
                <input
                  type="range"
                  min={20}
                  max={400}
                  value={settings.sens}
                  onChange={(e) => update({ sens: Number(e.target.value) })}
                />
                <span className="k">{settings.sens}%</span>
              </label>
              <label>
                gyroscope aim
                <select
                  value={settings.gyro}
                  onChange={(e) => void enableGyro(e.target.value as TouchSettings["gyro"])}
                >
                  <option value="off">off</option>
                  <option value="scope">while scoped</option>
                  <option value="always">always</option>
                </select>
              </label>
              {settings.gyro !== "off" && (
                <label>
                  gyroscope speed
                  <input
                    type="range"
                    min={20}
                    max={400}
                    value={settings.gyroSens}
                    onChange={(e) => update({ gyroSens: Number(e.target.value) })}
                  />
                  <span className="k">{settings.gyroSens}%</span>
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={settings.peekScope}
                  onChange={(e) => update({ peekScope: e.target.checked })}
                />
                PEEK opens the scope
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.haptics}
                  onChange={(e) => update({ haptics: e.target.checked })}
                />
                buzz on hits
              </label>
              <label>
                layout
                <select
                  value={PRESETS[settings.preset] ? settings.preset : "custom"}
                  onChange={(e) => {
                    const p = PRESETS[e.target.value];
                    if (p) update({ preset: e.target.value, layout: structuredClone(p.layout) });
                  }}
                >
                  {Object.entries(PRESETS).map(([id, p]) => (
                    <option key={id} value={id}>
                      {p.name}
                    </option>
                  ))}
                  {!PRESETS[settings.preset] && <option value="custom">custom</option>}
                </select>
              </label>
            </div>
            <div className="mainbtns">
              <button type="button" onClick={() => setPanel("editor")}>
                EDIT LAYOUT<i>drag, resize and fade each button</i>
              </button>
              <button type="button" className="start" onClick={() => setPanel("none")}>
                DONE<i>back to the pause menu</i>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
