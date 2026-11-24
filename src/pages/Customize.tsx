// Customize Character: pick the battle character you play as online. The pick
// is saved in this browser straight away (no account needed) and goes with you
// into online rooms, where friends see the same character
// (src/game/look.ts, src/game/characters.ts).

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import DotField from "@/components/DotField";
import { createLockerPreview, type LockerPreview } from "@/game/preview";
import { CHARACTER_LIST } from "@/game/characters";
import { loadLook, saveLook } from "@/game/look";

/** what the turntable can hand the character, by rig weapon id */
const PREVIEW_GUNS: [string, string][] = [
  ["rifle", "AK-47"],
  ["shotgun", "M1887"],
  ["sniper", "AWM"],
  ["blade", "katana"],
  ["pistol", "Deagle"],
];

export default function Customize() {
  const navigate = useNavigate();
  const [char, setChar] = useState(() => loadLook().char);
  const [weapon, setWeapon] = useState("rifle");
  const stage = useRef<HTMLDivElement>(null);
  const preview = useRef<LockerPreview | null>(null);
  const first = useRef(char);

  useEffect(() => {
    if (!stage.current) return;
    let p: LockerPreview | null = null;
    try {
      p = createLockerPreview(stage.current, first.current);
    } catch (err) {
      // no WebGL: the cards still work (as names) and still save
      console.error("[customize] preview unavailable", err);
    }
    preview.current = p;
    return () => {
      p?.dispose();
      preview.current = null;
    };
  }, []);

  useEffect(() => {
    preview.current?.setCharacter(char);
    saveLook({ char });
  }, [char]);

  useEffect(() => {
    preview.current?.setWeapon(weapon);
  }, [weapon]);

  const who = CHARACTER_LIST[char] ?? CHARACTER_LIST[0];

  return (
    <div className="dd-landing">
      <DotField />
      <div className="dd-screen">
        <div className="panel dd-locker">
          <h1>CUSTOMIZE CHARACTER</h1>
          <h2>pick your fighter · friends see it online</h2>

          <div className="lk-body">
            <div className="lk-left">
              <div className="lk-stage" ref={stage} data-testid="locker-stage" />
              <div className="lk-name">{who.name}</div>
              <div className="lk-blurb">{who.blurb}</div>
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
              <div className="lk-items lk-roster" data-testid="locker-items">
                {CHARACTER_LIST.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    className={i === char ? "on" : ""}
                    onClick={() => setChar(i)}
                    title={c.blurb}
                  >
                    {/* pre-drawn through the ink pass, so the page only downloads the model you pick */}
                    <span className="pic">
                      <img src={`/characters/thumbs/${c.id}.png`} alt="" draggable={false} loading="lazy" />
                    </span>
                    <span className="lbl">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lk-note">
            saved in this browser · looks are cosmetic, everyone has the same hitbox · models by Quaternius, Polygonal
            Mind, mastjie, Vaporworks, J-Toastie and Zsky (CC0 / CC-BY 3.0, see /characters/CREDITS.md)
          </div>

          <div className="mainbtns">
            <button type="button" onClick={() => navigate("/")}>
              DONE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
