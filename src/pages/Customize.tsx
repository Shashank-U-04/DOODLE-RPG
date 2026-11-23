// Customize Character: start from a ready-made character, then swap any item
// from the library shelves (10 of each: hair, faces, hats, shirts, pants, shoes,
// extras). Every change is saved in this browser straight away (no account
// needed) and goes with you into online rooms, where friends see the same
// character (src/game/look.ts, src/game/avatar.ts).

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import DotField from "@/components/DotField";
import { createLockerPreview, createThumbnailer, type LockerPreview, type Thumbnailer } from "@/game/preview";
import {
  CHARACTERS,
  SHELVES,
  loadLook,
  randomLook,
  saveLook,
  starterLook,
  starterOf,
  type Look,
  type Slot,
} from "@/game/look";

/** what the turntable can hand the character, by rig weapon id */
const PREVIEW_GUNS: [string, string][] = [
  ["rifle", "AK-47"],
  ["shotgun", "M1887"],
  ["sniper", "AWM"],
  ["blade", "katana"],
  ["pistol", "Deagle"],
];

/** the plain model every item card is pictured on: the ROOKIE without a hat */
const MANNEQUIN: Look = { ...starterLook(0), hat: 0 };

export default function Customize() {
  const navigate = useNavigate();
  const [look, setLook] = useState<Look>(() => loadLook());
  const [shelf, setShelf] = useState<Slot>("hair");
  const [weapon, setWeapon] = useState("rifle");
  const [thumbs, setThumbs] = useState<Partial<Record<Slot, string[]>>>({});
  const stage = useRef<HTMLDivElement>(null);
  const preview = useRef<LockerPreview | null>(null);
  const shooter = useRef<Thumbnailer | null>(null);
  const drawn = useRef<Partial<Record<Slot, string[]>>>({});
  const first = useRef(look);
  // the last character picked from the row, so RESET knows where to go back to
  const [base, setBase] = useState(() => Math.max(0, starterOf(look)));

  useEffect(() => {
    if (!stage.current) return;
    let p: LockerPreview | null = null;
    let s: Thumbnailer | null = null;
    try {
      p = createLockerPreview(stage.current, first.current);
      s = createThumbnailer();
    } catch (err) {
      // no WebGL: the shelves still work (as names) and still save
      console.error("[customize] preview unavailable", err);
    }
    preview.current = p;
    shooter.current = s;
    return () => {
      p?.dispose();
      s?.dispose();
      preview.current = null;
      shooter.current = null;
    };
  }, []);

  // Item pictures, the open shelf first and then the rest, one card per tick
  // so the page never stalls while they are drawn.
  useEffect(() => {
    let cancelled = false;
    const order = [shelf, ...SHELVES.map((s) => s.slot).filter((s) => s !== shelf)];
    (async () => {
      for (const slot of order) {
        if (!shooter.current || cancelled) return;
        if (drawn.current[slot]) continue;
        const items = SHELVES.find((s) => s.slot === slot)!.items;
        const urls: string[] = [];
        for (let i = 0; i < items.length; i++) {
          await new Promise((r) => setTimeout(r, 0));
          if (cancelled || !shooter.current) return;
          urls.push(shooter.current.shot({ ...MANNEQUIN, [slot]: i }, slot));
        }
        if (cancelled) return;
        drawn.current[slot] = urls;
        setThumbs({ ...drawn.current });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shelf]);

  useEffect(() => {
    preview.current?.setLook(look);
    saveLook(look);
  }, [look]);

  useEffect(() => {
    preview.current?.setWeapon(weapon);
  }, [weapon]);

  const starter = starterOf(look);
  const who = starter >= 0 ? CHARACTERS[starter] : null;
  const open = SHELVES.find((s) => s.slot === shelf)!;
  const pics = thumbs[shelf];

  return (
    <div className="dd-landing">
      <DotField />
      <div className="dd-screen">
        <div className="panel dd-locker">
          <h1>CUSTOMIZE CHARACTER</h1>
          <h2>pick a character · swap any item · friends see it online</h2>

          <div className="lk-body">
            <div className="lk-left">
              <div className="lk-stage" ref={stage} data-testid="locker-stage" />
              <div className="lk-name">{who ? who.name : "YOUR OWN"}</div>
              <div className="lk-blurb">{who ? who.blurb : `started from ${CHARACTERS[base].name.toLowerCase()} · all yours now`}</div>
              <div className="lk-chips lk-weapons">
                {PREVIEW_GUNS.map(([id, label]) => (
                  <button key={id} type="button" className={weapon === id ? "on" : ""} onClick={() => setWeapon(id)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="lk-right">
              <div className="colhead">CHARACTERS</div>
              <div className="lk-chars">
                {CHARACTERS.map((c, i) => (
                  <button
                    key={c.name}
                    type="button"
                    className={i === starter ? "on" : ""}
                    onClick={() => {
                      setBase(i);
                      setLook(starterLook(i));
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>

              <div className="lk-tabs">
                {SHELVES.map((s) => (
                  <button key={s.slot} type="button" className={shelf === s.slot ? "on" : ""} onClick={() => setShelf(s.slot)}>
                    {s.title}
                  </button>
                ))}
              </div>

              <div className="lk-items" data-testid="locker-items">
                {open.items.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    className={look[shelf] === i ? "on" : ""}
                    onClick={() => setLook((l) => ({ ...l, [shelf]: i }))}
                    title={item.label}
                  >
                    <span className="pic">{pics?.[i] ? <img src={pics[i]} alt="" draggable={false} /> : <i />}</span>
                    <span className="lbl">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lk-note">saved in this browser · looks are cosmetic, everyone has the same hitbox</div>

          <div className="mainbtns">
            <button type="button" onClick={() => navigate("/")}>
              DONE
            </button>
            <button type="button" onClick={() => setLook(randomLook())}>
              SURPRISE ME
            </button>
            <button type="button" className="alt" disabled={starter === base} onClick={() => setLook(starterLook(base))}>
              RESET TO {CHARACTERS[base].name}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
