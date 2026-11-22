// Real-world props for the pickups and thrown grenades, in the game's inks:
// a pack of rifle rounds with a Mk2 pineapple grenade beside it, a green
// first-aid case, and the round frag grenade (red fuse plug) that gets thrown. Geometry is built once and
// shared; each call returns a fresh group of meshes.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { INK, type InkId, makeInkMaterial } from "./world";

type Piece = { geo: THREE.BufferGeometry; ink: InkId; fill: boolean; at?: [number, number, number]; rot?: [number, number, number] };

const cache = new Map<string, Piece[]>();

function build(pieces: Piece[]): THREE.Group {
  const g = new THREE.Group();
  for (const p of pieces) {
    const m = new THREE.Mesh(p.geo, makeInkMaterial(p.ink, p.fill));
    if (p.at) m.position.set(...p.at);
    if (p.rot) m.rotation.set(...p.rot);
    g.add(m);
  }
  return g;
}

function cached(key: string, make: () => Piece[]) {
  let p = cache.get(key);
  if (!p) {
    p = make();
    cache.set(key, p);
  }
  return build(p);
}

/** a round frag grenade: green ball, red fuse plug, lever and pin; origin at its centre */
function grenadePieces(s = 1): Piece[] {
  const pieces: Piece[] = [
    { geo: new THREE.SphereGeometry(0.085 * s, 18, 14), ink: INK.GREEN, fill: false },
    // a thin seam round the middle
    { geo: new THREE.TorusGeometry(0.0855 * s, 0.004 * s, 5, 22), ink: INK.GREEN, fill: true, rot: [Math.PI / 2, 0, 0] },
    // the fuse: a green collar and the red plug on top
    { geo: new THREE.CylinderGeometry(0.03 * s, 0.036 * s, 0.03 * s, 14), ink: INK.GREEN, fill: true, at: [0, 0.09 * s, 0] },
    { geo: new THREE.CylinderGeometry(0.026 * s, 0.03 * s, 0.032 * s, 14), ink: INK.RED, fill: true, at: [0, 0.118 * s, 0] },
    { geo: new THREE.SphereGeometry(0.026 * s, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), ink: INK.RED, fill: true, at: [0, 0.134 * s, 0] },
    // the spoon, curving down the side
    { geo: new THREE.BoxGeometry(0.028 * s, 0.11 * s, 0.008 * s), ink: INK.BLACK, fill: true, at: [0, 0.07 * s, 0.072 * s], rot: [-0.45, 0, 0] },
    // pin and ring
    { geo: new THREE.CylinderGeometry(0.004 * s, 0.004 * s, 0.06 * s, 6), ink: INK.GOLD, fill: true, at: [0.034 * s, 0.11 * s, 0], rot: [0, 0, Math.PI / 2] },
    { geo: new THREE.TorusGeometry(0.022 * s, 0.004 * s, 5, 14), ink: INK.GOLD, fill: true, at: [0.07 * s, 0.11 * s, 0], rot: [0, Math.PI / 2, 0] },
  ];
  return pieces;
}

export function makeGrenade(): THREE.Group {
  return cached("grenade", () => grenadePieces(1.15));
}

/**
 * The ammo pickup: a black slotted holder packed with upright rifle rounds
 * (brass cases, copper-tipped bullets) and a Mk2 "pineapple" frag grenade
 * standing beside it, since this pickup hands out ammunition and a grenade.
 * About three times life size so it reads at play distance; origin near its
 * middle.
 */
export function makeAmmoPack(): THREE.Group {
  return cached("ammo", () => {
    const pieces: Piece[] = [];
    const PACK_X = -0.11;
    const BASE_Y = -0.1;

    // the rounds: one lathed case and bullet, copied over a 5 × 5 grid and merged
    const caseProfile: [number, number][] = [
      [0, 0], [0.018, 0], [0.018, 0.006], [0.015, 0.008], [0.015, 0.011], [0.0175, 0.013],
      [0.0167, 0.1], [0.012, 0.113], [0.0118, 0.136], [0, 0.136],
    ];
    const bulletProfile: [number, number][] = [
      [0, 0.133], [0.0119, 0.133], [0.0118, 0.15], [0.0105, 0.17], [0.0065, 0.188], [0.002, 0.2], [0, 0.201],
    ];
    const lathe = (pts: [number, number][]) => new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), 12);
    const caseGeo = lathe(caseProfile);
    const bulletGeo = lathe(bulletProfile);
    const cases: THREE.BufferGeometry[] = [];
    const bullets: THREE.BufferGeometry[] = [];
    const N = 5;
    const STEP = 0.041;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = PACK_X + (i - (N - 1) / 2) * STEP;
        const z = (j - (N - 1) / 2) * STEP;
        const y = BASE_Y + 0.012;
        cases.push(caseGeo.clone().translate(x, y, z));
        bullets.push(bulletGeo.clone().translate(x, y, z));
      }
    }
    pieces.push({ geo: mergeGeometries(cases, false)!, ink: INK.GOLD, fill: true });
    pieces.push({ geo: mergeGeometries(bullets, false)!, ink: INK.ORANGE, fill: true });

    // the holder: a base plate and slotted walls, a bar between every round
    const SIDE = N * STEP + 0.014;
    const WALL_H = 0.095;
    pieces.push({ geo: new THREE.BoxGeometry(SIDE + 0.01, 0.014, SIDE + 0.01), ink: INK.BLACK, fill: true, at: [PACK_X, BASE_Y + 0.007, 0] });
    const bars: THREE.BufferGeometry[] = [];
    for (let k = 0; k <= N; k++) {
      const t = (k - N / 2) * STEP;
      for (const side of [-1, 1]) {
        bars.push(new THREE.BoxGeometry(0.012, WALL_H, 0.008).translate(PACK_X + t, BASE_Y + WALL_H / 2, (side * SIDE) / 2));
        bars.push(new THREE.BoxGeometry(0.008, WALL_H, 0.012).translate(PACK_X + (side * SIDE) / 2, BASE_Y + WALL_H / 2, t));
      }
    }
    // a rail round the top ties the bars together
    for (const side of [-1, 1]) {
      bars.push(new THREE.BoxGeometry(SIDE + 0.008, 0.01, 0.008).translate(PACK_X, BASE_Y + WALL_H - 0.005, (side * SIDE) / 2));
      bars.push(new THREE.BoxGeometry(0.008, 0.01, SIDE + 0.008).translate(PACK_X + (side * SIDE) / 2, BASE_Y + WALL_H - 0.005, 0));
    }
    pieces.push({ geo: mergeGeometries(bars, false)!, ink: INK.BLACK, fill: true });

    // Mk2 "pineapple": an olive egg cut into segments, fuse, spoon and pin
    const GX = 0.17;
    const RX = 0.07;
    const RY = 0.09;
    const GY = BASE_Y + RY + 0.004;
    const body = new THREE.SphereGeometry(RX, 20, 16);
    body.scale(1, RY / RX, 1);
    pieces.push({ geo: body, ink: INK.GREEN, fill: false, at: [GX, GY, 0] });
    const grooves: THREE.BufferGeometry[] = [];
    for (const f of [-0.62, -0.31, 0, 0.31, 0.62]) {
      const y = f * RY;
      const r = RX * Math.sqrt(1 - f * f) + 0.0008;
      grooves.push(new THREE.TorusGeometry(r, 0.0035, 4, 28).rotateX(Math.PI / 2).translate(GX, GY + y, 0));
    }
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.TorusGeometry(RX + 0.0008, 0.0035, 4, 32);
      ring.scale(1, RY / RX, 1);
      ring.rotateY((i / 4) * Math.PI);
      grooves.push(ring.translate(GX, GY, 0));
    }
    pieces.push({ geo: mergeGeometries(grooves, false)!, ink: INK.GREEN, fill: true });
    const topY = GY + RY;
    pieces.push({ geo: new THREE.CylinderGeometry(0.024, 0.03, 0.022, 14), ink: INK.GREEN, fill: true, at: [GX, topY + 0.006, 0] });
    pieces.push({ geo: new THREE.CylinderGeometry(0.02, 0.022, 0.04, 14), ink: INK.BLACK, fill: false, at: [GX, topY + 0.035, 0] });
    pieces.push({ geo: new THREE.CylinderGeometry(0.014, 0.02, 0.014, 14), ink: INK.BLACK, fill: true, at: [GX, topY + 0.062, 0] });
    // the spoon: over the top and down the side
    pieces.push({ geo: new THREE.BoxGeometry(0.026, 0.008, 0.05), ink: INK.GREEN, fill: true, at: [GX, topY + 0.058, -0.012] });
    pieces.push({ geo: new THREE.BoxGeometry(0.026, 0.11, 0.008), ink: INK.GREEN, fill: true, at: [GX, topY - 0.005, -0.046], rot: [0.32, 0, 0] });
    // pin and ring
    pieces.push({ geo: new THREE.CylinderGeometry(0.003, 0.003, 0.05, 6), ink: INK.BONE, fill: true, at: [GX + 0.025, topY + 0.035, 0], rot: [0, 0, Math.PI / 2] });
    pieces.push({ geo: new THREE.TorusGeometry(0.024, 0.0045, 5, 16), ink: INK.BONE, fill: true, at: [GX + 0.058, topY + 0.035, 0], rot: [0, Math.PI / 2, 0] });
    return pieces;
  });
}

/** a green first-aid case standing on its edge: white plus both faces, handle, latches */
export function makeMedkit(): THREE.Group {
  return cached("medkit", () => {
    const W = 0.52;
    const H = 0.38;
    const D = 0.17;
    const pieces: Piece[] = [
      { geo: new RoundedBoxGeometry(W, H, D, 3, 0.035), ink: INK.GREEN, fill: false },
      // the seam where the two halves close
      { geo: new THREE.BoxGeometry(W + 0.004, H + 0.004, 0.012), ink: INK.BLACK, fill: true },
      { geo: new THREE.TorusGeometry(0.075, 0.014, 6, 14, Math.PI), ink: INK.BLACK, fill: true, at: [0, H / 2 + 0.005, 0] },
    ];
    for (const z of [D / 2 + 0.004, -D / 2 - 0.004]) {
      pieces.push({ geo: new THREE.BoxGeometry(0.22, 0.07, 0.012), ink: INK.BONE, fill: true, at: [0, 0, z] });
      pieces.push({ geo: new THREE.BoxGeometry(0.07, 0.22, 0.012), ink: INK.BONE, fill: true, at: [0, 0, z] });
    }
    for (const x of [-0.17, 0.17]) pieces.push({ geo: new RoundedBoxGeometry(0.05, 0.035, D + 0.02, 2, 0.008), ink: INK.BONE, fill: true, at: [x, H / 2 - 0.02, 0] });
    return pieces;
  });
}
