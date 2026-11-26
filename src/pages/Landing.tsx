// The title screen: paper sheet, panel, PLAY VS COMPUTER / PLAY WITH FRIENDS
// buttons, settings and the control list. Each button opens the setup screen,
// which picks the battlefield before anything runs.

import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { wakeMatchServer } from "@/game/wake";
import DotField from "@/components/DotField";

const KEYBOARD: [string, string][] = [
  ["WASD", "move &nbsp; · &nbsp; <b>Mouse</b> look &nbsp; · &nbsp; <b>Shift</b> sprint"],
  ["LMB", "fire / slash &nbsp; · &nbsp; <b>RMB</b> aim down sights / block"],
  ["Space", "jump &nbsp; · &nbsp; again in the air for a double jump"],
  ["C / Ctrl", "crouch &nbsp; · &nbsp; <b>X</b> dash"],
  ["F", "katana slash &nbsp; · &nbsp; <b>R</b> reload &nbsp; · &nbsp; <b>G</b> grenade"],
  ["1-5 / wheel", "AK-47 · M1887 · AWM · katana · Desert Eagle"],
  ["AWM", "hold <b>LMB</b> to scope in &nbsp; · &nbsp; let go to fire"],
  ["M", "music &nbsp; · &nbsp; <b>P / Esc</b> pause"],
];

export default function Landing() {
  const navigate = useNavigate();
  const [sens, setSens] = useState(() => Number(localStorage.getItem("dd_sens") || 100));
  const [invert, setInvert] = useState(() => localStorage.getItem("dd_invert") === "1");
  const [music, setMusic] = useState(() => localStorage.getItem("dd_music") !== "0");
  const [best] = useState(() => Number(localStorage.getItem("dd_best") || 0));
  const [note] = useState<string | null>(null);

  // Both modes open the same setup screen; it picks the map first. Solo
  // starts there, friends goes on to the room lobby.
  const solo = useCallback(() => {
    navigate("/setup?mode=solo");
  }, [navigate]);
  const online = useCallback(() => {
    // Start waking a sleeping match server while the player sets up the room
    // (src/game/wake.ts). Fire-and-forget; solo play sends nothing.
    wakeMatchServer();
    navigate("/setup?mode=friends");
  }, [navigate]);

  return (
    <div className="dd-landing">
      <DotField />
      <button type="button" className="dd-side-custom" onClick={() => navigate("/customize")}>
        <svg viewBox="0 0 40 56" aria-hidden="true">
          <circle cx="20" cy="11" r="8" />
          <path d="M8 50 L10 26 Q20 20 30 26 L32 50 M10 30 L3 42 M30 30 L37 42 M15 50 L15 38 M25 50 L25 38" />
          <path d="M12 7 Q20 -1 28 7" />
        </svg>
        <b>CUSTOMIZE CHARACTER</b>
        <i>pick your battle fighter</i>
      </button>
      <div className="dd-screen">
        <div className="panel">
          <h1>DOODLE RPG</h1>
          <h2>a scribbled survival shooter</h2>

          <div className="mainbtns">
            <button type="button" className="start" onClick={solo}>
              PLAY VS COMPUTER<i>pick a battlefield · survive the waves</i>
            </button>
            <button type="button" className="start" onClick={online}>
              PLAY WITH FRIENDS<i>online · share a code, play a friend</i>
            </button>
          </div>

          <div className="cols">
            <div>
              <div className="colhead">MOUSE + KEYBOARD</div>
              {KEYBOARD.map(([key, rest]) => (
                <div key={key}>
                  <b>{key}</b> <span dangerouslySetInnerHTML={{ __html: rest }} />
                </div>
              ))}
            </div>
          </div>

          <div className="settings">
            <label>
              look sensitivity
              <input
                type="range"
                min={25}
                max={250}
                step={5}
                value={sens}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSens(v);
                  localStorage.setItem("dd_sens", String(v));
                }}
              />
              <b>{sens}%</b>
            </label>
            <label>
              <input
                type="checkbox"
                checked={invert}
                onChange={(e) => {
                  setInvert(e.target.checked);
                  localStorage.setItem("dd_invert", e.target.checked ? "1" : "0");
                }}
              />
              invert vertical look
            </label>
            <label>
              <input
                type="checkbox"
                checked={music}
                onChange={(e) => {
                  setMusic(e.target.checked);
                  localStorage.setItem("dd_music", e.target.checked ? "1" : "0");
                }}
              />
              music <span className="k">(M)</span>
            </label>
          </div>

          {note && <div className="beststat">{note}</div>}
          {best > 0 && <div className="beststat">best score: {best}</div>}
        </div>
      </div>
    </div>
  );
}
