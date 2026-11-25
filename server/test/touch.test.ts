// Touch controls: saved settings are repaired, never trusted, and every
// preset fits a small phone held sideways without buttons on top of each other.
//
// Excluded from this package's `tsc`, like the adapter test: it imports the
// frontend, which the root `tsc -b` type-checks.
import assert from "assert";

import { PRESETS, loadTouchSettings, type ButtonId } from "../../src/game/touch.js";

/** a Map-backed localStorage for Node */
function withStorage(initial: Record<string, string>, fn: () => void) {
  const store = new Map(Object.entries(initial));
  const g = globalThis as { localStorage?: unknown };
  const before = g.localStorage;
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  try {
    fn();
  } finally {
    g.localStorage = before;
  }
}

/** the round buttons (the weapon strip and the pause pair are bars, checked by eye) */
const ROUND: ButtonId[] = [
  "fire",
  "fireL",
  "aim",
  "jump",
  "crouch",
  "dash",
  "grenade",
  "reload",
  "melee",
  "peekL",
  "peekR",
];

describe("touch controls", () => {
  it("starts from the two-thumb preset when nothing is saved", () => {
    withStorage({}, () => {
      const s = loadTouchSettings();
      assert.strictEqual(s.preset, "thumbs");
      assert.deepStrictEqual(s.layout, PRESETS.thumbs.layout);
      assert.strictEqual(s.gyro, "off");
      assert.strictEqual(s.peekScope, true);
    });
  });

  it("repairs saved settings instead of trusting them", () => {
    const saved = {
      preset: "nope",
      sens: 9999,
      gyro: "sideways",
      gyroSens: "fast",
      peekScope: false,
      layout: { fire: { x: 2, y: -1, size: 10, opacity: 0 }, jump: "x" },
    };
    withStorage({ dd_touch: JSON.stringify(saved) }, () => {
      const s = loadTouchSettings();
      assert.strictEqual(s.preset, "custom");
      assert.strictEqual(s.sens, 400);
      assert.strictEqual(s.gyro, "off");
      assert.strictEqual(s.gyroSens, 100);
      assert.strictEqual(s.peekScope, false);
      assert.deepStrictEqual(s.layout.fire, { x: 1, y: 0, size: 32, opacity: 0.15 });
      assert.deepStrictEqual(s.layout.jump, PRESETS.thumbs.layout.jump);
    });
    withStorage({ dd_touch: "{not json" }, () => assert.strictEqual(loadTouchSettings().preset, "thumbs"));
  });

  for (const [id, preset] of Object.entries(PRESETS)) {
    it(`"${preset.name}" fits an 844×390 phone with no buttons overlapping`, () => {
      const W = 844;
      const H = 390;
      for (const a of ROUND) {
        const p = preset.layout[a];
        const r = p.size / 2;
        assert.ok(p.x * W - r >= 0 && p.x * W + r <= W, `${id}.${a} inside horizontally`);
        assert.ok(p.y * H - r >= 0 && p.y * H + r <= H, `${id}.${a} inside vertically`);
        for (const b of ROUND) {
          if (a >= b) continue;
          const q = preset.layout[b];
          const d = Math.hypot((p.x - q.x) * W, (p.y - q.y) * H);
          assert.ok(d >= (p.size + q.size) / 2, `${id}: ${a} and ${b} overlap (${d.toFixed(0)} px apart)`);
        }
      }
    });
  }
});
