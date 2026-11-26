// Remote players carry their gun in both hands (src/game/characters.ts): the
// arms are solved onto points on the gun every frame. These check the pieces
// that does not need a loaded model for: the two-bone reach, the guns' hand
// points, and where a barrel ends.
//
// Excluded from this package's `tsc`, like the adapter test: it imports the
// frontend, which the root `tsc -b` type-checks.
import assert from "assert";
import * as THREE from "three";

import { gunMuzzle, reach } from "../../src/game/characters.js";
import { rigGunPoints } from "../../src/game/guns.js";

/** shoulder at the origin, a 0.3 m upper arm and a 0.28 m forearm hanging down */
function arm() {
  const root = new THREE.Group();
  const upper = new THREE.Bone();
  const lower = new THREE.Bone();
  const hand = new THREE.Bone();
  lower.position.set(0, -0.3, 0);
  hand.position.set(0, -0.28, 0);
  upper.add(lower);
  lower.add(hand);
  root.add(upper);
  // a turned, offset body, so the solve has to work in world space
  root.rotation.y = 0.8;
  root.position.set(3, 1.4, -2);
  root.updateMatrixWorld(true);
  return { root, upper, lower, hand };
}
const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

describe("holding a gun", () => {
  it("puts the hand on a reachable point, the elbow bending towards the pole", () => {
    const { upper, lower, hand } = arm();
    const target = world(upper).add(new THREE.Vector3(0.25, -0.1, 0.3));
    reach(upper, lower, hand, target, new THREE.Vector3(0, -1, 0));
    assert.ok(world(hand).distanceTo(target) < 1e-3, `hand ${world(hand).toArray()} on ${target.toArray()}`);
    // the bones keep their lengths
    assert.ok(Math.abs(world(upper).distanceTo(world(lower)) - 0.3) < 1e-4);
    assert.ok(Math.abs(world(lower).distanceTo(world(hand)) - 0.28) < 1e-4);
    // and the elbow went down, not up
    const mid = world(upper).lerp(target, 0.5);
    assert.ok(world(lower).y < mid.y, "elbow below the shoulder-hand line");
  });

  it("reaches straight towards a point it cannot get to", () => {
    const { upper, lower, hand } = arm();
    const target = world(upper).add(new THREE.Vector3(0, 0, 2));
    reach(upper, lower, hand, target, new THREE.Vector3(0, -1, 0));
    const along = target.clone().sub(world(upper)).normalize();
    const got = world(hand).sub(world(upper));
    assert.ok(got.length() > 0.57, "arm all but straight");
    assert.ok(got.normalize().dot(along) > 0.999, "pointing at it");
  });

  it("knows each gun's grip, support hand and muzzle, front to back", () => {
    for (const kind of ["rifle", "shotgun", "sniper", "revolver"]) {
      const p = rigGunPoints(kind);
      assert.ok(p.muzzle.z > p.support.z || kind === "revolver", `${kind}: support behind the muzzle`);
      assert.ok(p.muzzle.z > p.grip.z, `${kind}: grip behind the muzzle`);
      assert.ok(p.grip.y < 0, `${kind}: the grip is below the bore`);
    }
    // a long gun's support hand is out on the handguard
    assert.ok(rigGunPoints("rifle").support.z > 0.2);
  });

  it("finds where a barrel ends from the gun's own geometry", () => {
    const gun = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.4));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.3).rotateX(Math.PI / 2));
    barrel.position.set(0, 0.03, 0.35);
    gun.add(body, barrel);
    const m = gunMuzzle(gun);
    assert.ok(Math.abs(m.z - 0.5) < 1e-6, `muzzle z ${m.z}`);
    assert.ok(Math.abs(m.y - 0.03) < 1e-3, `on the bore, y ${m.y}`);
    assert.strictEqual(gunMuzzle(gun), m, "computed once");
  });
});
