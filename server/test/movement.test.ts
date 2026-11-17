import assert from "assert";

import {
  ARRIVALS,
  clampPitch,
  clampToEnvelope,
  DASH_GRANT_MS,
  DASH_REACH,
  ENVELOPES,
  grantDash,
  isArrival,
  MAX_SPEED,
  MOVE_BURST,
  newMotion,
  stepMotion,
  TELEPORT_BURST,
  wrapAngle,
  type Vec3,
} from "../src/movement.js";
import { MAP_IDS } from "../src/rules.js";

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
/** Movement tests that never jump do not care where a body may land. */
const NONE: Vec3[] = [];

describe("movement rules", () => {
  const district = ENVELOPES.district;
  const pyramid = ENVELOPES.pyramid;
  const pads = ARRIVALS.district;

  it("clamps a position into the map's volume", () => {
    assert.deepStrictEqual(clampToEnvelope({ x: 0, y: 1, z: 0 }, district), { x: 0, y: 1, z: 0 });
    assert.deepStrictEqual(clampToEnvelope({ x: 999, y: -50, z: -999 }, district), { x: 55, y: -8, z: -55 });
  });

  it("clamps a position into the pyramid's volume", () => {
    // on the 6 m ledge: inside
    assert.deepStrictEqual(clampToEnvelope({ x: 15, y: 6, z: 2 }, pyramid), { x: 15, y: 6, z: 2 });
    // far below the floor or out past the cliffs: pulled back in
    assert.deepStrictEqual(clampToEnvelope({ x: 80, y: -20, z: -80 }, pyramid), { x: 59, y: -8, z: -59 });
  });

  it("normalizes angles", () => {
    assert.ok(near(wrapAngle(0), 0));
    assert.ok(near(wrapAngle(Math.PI * 3), Math.PI));
    assert.ok(near(wrapAngle(-Math.PI / 2 - Math.PI * 4), -Math.PI / 2));
    assert.strictEqual(clampPitch(5), Math.PI / 2);
    assert.strictEqual(clampPitch(-5), -Math.PI / 2);
  });

  it("knows where each map puts bodies, all inside its volume", () => {
    for (const map of MAP_IDS) {
      assert.ok(ARRIVALS[map].length >= 6, `${map} has arrival points`);
      for (const a of ARRIVALS[map]) {
        assert.deepStrictEqual(clampToEnvelope(a, ENVELOPES[map]), a, `${map} arrival ${JSON.stringify(a)} inside the volume`);
        assert.ok(isArrival(a, ARRIVALS[map]));
      }
    }
  });

  it("places a body that has no position yet on an arrival, or on the nearest one", () => {
    const pad = pads[3];
    const onPad = stepMotion(newMotion(0), null, { ...pad, x: pad.x + 1 }, false, 0, district, pads);
    assert.deepStrictEqual(onPad, { pos: { ...pad, x: pad.x + 1 }, teleported: true, adoptEpoch: true, refusedTeleport: false });

    // a first move into the middle of nowhere lands on the nearest arrival instead
    const off = stepMotion(newMotion(0), null, { x: 70, y: 30, z: 3 }, false, 0, district, pads);
    assert.strictEqual(off.refusedTeleport, true);
    assert.ok(isArrival(off.pos, pads), `put on a pad: ${JSON.stringify(off.pos)}`);
  });

  it("accepts ordinary movement within the allowance", () => {
    const m = newMotion(0);
    const from = { x: 0, y: 0, z: 0 };
    const r = stepMotion(m, from, { x: 3, y: 0, z: 4 }, false, 50, district, NONE);
    assert.deepStrictEqual(r, { pos: { x: 3, y: 0, z: 4 }, teleported: false, adoptEpoch: false, refusedTeleport: false });
  });

  it("limits a step that is too long to the banked allowance", () => {
    const m = newMotion(0);
    const from = { x: 0, y: 0, z: 0 };
    const r = stepMotion(m, from, { x: 50, y: 0, z: 0 }, false, 0, district, NONE);
    assert.strictEqual(r.teleported, false);
    assert.ok(near(r.pos.x, MOVE_BURST), `moved ${r.pos.x}`);
    // spent: nothing more until time passes
    const again = stepMotion(m, r.pos, { x: 50, y: 0, z: 0 }, false, 0, district, NONE);
    assert.ok(near(again.pos.x, MOVE_BURST));
  });

  it("refills the allowance at MAX_SPEED, capped at the burst", () => {
    const m = newMotion(0);
    m.allowance = 0;
    const from = { x: 0, y: 0, z: 0 };
    const r = stepMotion(m, from, { x: 50, y: 0, z: 0 }, false, 100, district, NONE); // 0.1 s later
    assert.ok(near(r.pos.x, MAX_SPEED * 0.1), `moved ${r.pos.x}`);
    m.allowance = 0;
    stepMotion(m, from, from, false, 100 + 60_000, district, NONE); // a minute idle
    assert.strictEqual(m.allowance, MOVE_BURST);
  });

  it("keeps sustained speed at MAX_SPEED however packets are timed", () => {
    const m = newMotion(0);
    let pos = { x: -50, y: 0, z: 0 };
    // claim 120 m/s for two seconds, at 20 Hz
    for (let t = 50; t <= 2000; t += 50) pos = stepMotion(m, pos, { x: pos.x + 6, y: 0, z: 0 }, false, t, district, NONE).pos;
    const travelled = pos.x + 50;
    assert.ok(travelled <= MOVE_BURST + MAX_SPEED * 2 + 1e-6, `travelled ${travelled}`);
  });

  it("lets a teleport to an arrival skip the speed limit, a few at a time", () => {
    const m = newMotion(0);
    const from = { x: -40, y: 0, z: -40 };
    const far = pads.filter((p) => dist(p, from) > MOVE_BURST);
    for (let i = 0; i < TELEPORT_BURST; i++) {
      assert.deepStrictEqual(stepMotion(m, from, far[i], true, 0, district, pads), {
        pos: far[i],
        teleported: true,
        adoptEpoch: true,
        refusedTeleport: false,
      });
    }
    // out of teleports: the same request becomes a speed-limited step
    const r = stepMotion(m, from, far[0], true, 0, district, pads);
    assert.strictEqual(r.teleported, false);
    assert.strictEqual(r.refusedTeleport, true);
    assert.ok(dist(from, r.pos) <= MOVE_BURST + 1e-9);
    // one second later there is one again
    assert.strictEqual(stepMotion(m, from, far[0], true, 1000, district, pads).teleported, true);
  });

  it("refuses a teleport to anywhere else: the body walks toward it instead", () => {
    const m = newMotion(0);
    const from = { x: -40, y: 0, z: -40 };
    const nowhere = { x: 30, y: 25, z: 30 }; // a rooftop, far from any pad
    assert.strictEqual(isArrival(nowhere, pads), false);
    const r = stepMotion(m, from, nowhere, true, 0, district, pads);
    assert.deepStrictEqual({ teleported: r.teleported, adoptEpoch: r.adoptEpoch, refusedTeleport: r.refusedTeleport }, {
      teleported: false,
      adoptEpoch: false,
      refusedTeleport: true,
    });
    assert.ok(near(dist(from, r.pos), MOVE_BURST), `walked ${dist(from, r.pos)}`);
    assert.strictEqual(m.teleports, TELEPORT_BURST, "a refused jump costs no teleport");
  });

  it("takes a new epoch that is really a step as a step", () => {
    // a reconnected client restarts its epochs wherever it stands
    const m = newMotion(0);
    const from = { x: 10, y: 0, z: 10 };
    const r = stepMotion(m, from, { x: 11, y: 0, z: 10 }, true, 50, district, pads);
    assert.deepStrictEqual(r, { pos: { x: 11, y: 0, z: 10 }, teleported: false, adoptEpoch: true, refusedTeleport: false });
  });

  it("allows one short jump right after an accepted focus dash", () => {
    const from = { x: -40, y: 0, z: -40 };
    const hop = { x: -40 + DASH_REACH - 1, y: 0, z: -40 }; // nowhere special, within reach
    assert.strictEqual(isArrival(hop, pads), false);

    const m = newMotion(0);
    grantDash(m, 0);
    assert.strictEqual(stepMotion(m, from, hop, true, 100, district, pads).teleported, true, "the dash's jump");
    assert.strictEqual(stepMotion(m, from, hop, true, 200, district, pads).teleported, false, "one jump per dash");

    const late = newMotion(0);
    grantDash(late, 0);
    assert.strictEqual(stepMotion(late, from, hop, true, DASH_GRANT_MS + 1, district, pads).teleported, false, "too late");

    const tooFar = newMotion(0);
    grantDash(tooFar, 0);
    const beyond = { x: -40 + DASH_REACH + 5, y: 0, z: -40 };
    assert.strictEqual(stepMotion(tooFar, from, beyond, true, 100, district, pads).teleported, false, "beyond a dash's reach");
  });
});
