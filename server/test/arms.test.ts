// The first-person arms wear the player's character: sampleArmInks reads the
// sleeve and hand inks off a loaded model by bone weight.
//
// Excluded from this package's `tsc`, like the adapter test: it imports the
// frontend, which the root `tsc -b` type-checks.
import assert from "assert";
import * as THREE from "three";

import { sampleArmInks } from "../../src/game/characters.js";
import { INK, makeSoftInkMaterial, type InkId } from "../../src/game/world.js";

/**
 * A tiny skinned "arm": one triangle per entry, every vertex of it bound
 * fully to `bone` and drawn in `ink`. Bone names are as GLTFLoader leaves them
 * ("LowerArm.R" → "LowerArmR").
 */
function arm(tris: { bone: string; ink: InkId }[], rigid?: { under: string; ink: InkId }) {
  const names = [...new Set(["Root", ...tris.map((t) => t.bone), ...(rigid ? [rigid.under] : [])])];
  const bones = names.map((n) => Object.assign(new THREE.Bone(), { name: n }));
  for (const b of bones.slice(1)) bones[0].add(b);
  const inks = [...new Set(tris.map((t) => t.ink))];
  const geo = new THREE.BufferGeometry();
  const n = tris.length * 3;
  geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  const idx = new Uint16Array(n * 4);
  const wgt = new Float32Array(n * 4);
  // groups are per material, so order the triangles by ink
  const ordered = [...tris].sort((a, b) => inks.indexOf(a.ink) - inks.indexOf(b.ink));
  ordered.forEach((t, i) => {
    for (let v = 0; v < 3; v++) {
      idx[(i * 3 + v) * 4] = names.indexOf(t.bone);
      wgt[(i * 3 + v) * 4] = 1;
    }
  });
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(wgt, 4));
  let start = 0;
  inks.forEach((ink, m) => {
    const count = ordered.filter((t) => t.ink === ink).length * 3;
    geo.addGroup(start, count, m);
    start += count;
  });
  const mesh = new THREE.SkinnedMesh(
    geo,
    inks.map((ink) => makeSoftInkMaterial(ink)),
  );
  const root = new THREE.Group();
  root.add(bones[0], mesh);
  mesh.bind(new THREE.Skeleton(bones));
  if (rigid) {
    const piece = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), makeSoftInkMaterial(rigid.ink));
    bones[names.indexOf(rigid.under)].add(piece);
  }
  return root;
}

const many = (bone: string, ink: InkId, count: number) => Array.from({ length: count }, () => ({ bone, ink }));

describe("first-person arms from the character model", () => {
  it("takes the forearm's ink as the sleeve and the hand's as the glove", () => {
    const model = arm([
      ...many("LowerArmR", INK.GREY, 6),
      ...many("LowerArmR", INK.PEACH, 1), // a sliver of wrist skin loses the vote
      ...many("WristR", INK.BLACK, 4),
      ...many("Index1R", INK.BLACK, 3),
      ...many("UpperArmR", INK.RED, 20), // the shoulder does not count
      ...many("LowerArmL", INK.GREEN, 20), // nor the other arm
    ]);
    assert.deepStrictEqual(sampleArmInks(model), { sleeve: INK.GREY, hand: INK.BLACK });
  });

  it("gives a short-sleeved character a bare forearm", () => {
    const model = arm([...many("LowerArmR", INK.PEACH, 5), ...many("PalmR", INK.PEACH, 5)]);
    assert.deepStrictEqual(sampleArmInks(model), { sleeve: INK.PEACH, hand: INK.PEACH });
  });

  it("counts a rigid fist hung off the hand bone, and borrows the sleeve when there is no hand", () => {
    const fist = arm([...many("LowerArmR", INK.DENIM, 3)], { under: "FistR", ink: INK.GOLD });
    assert.deepStrictEqual(sampleArmInks(fist), { sleeve: INK.DENIM, hand: INK.GOLD });
    const stump = arm([...many("LowerArmR", INK.DENIM, 3)]);
    assert.deepStrictEqual(sampleArmInks(stump), { sleeve: INK.DENIM, hand: INK.DENIM });
  });

  it("returns null for a model with no right arm to read", () => {
    assert.strictEqual(sampleArmInks(arm([...many("SpineX", INK.RED, 3)])), null);
  });
});
