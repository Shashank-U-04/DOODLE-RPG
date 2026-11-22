// Real-world props for the pickups and thrown grenades, in the game's inks:
// a curved rifle magazine with rounds at the lips, a green first-aid case, and
// a round frag grenade with its red fuse plug. Geometry is built once and
// shared; each call returns a fresh group of meshes.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
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
 * The ammo pickup: a curved 30-round rifle magazine standing on its floorplate,
 * with brass rounds showing at the feed lips. Its side profile is the AK
 * magazine's from guns.ts, scaled up to read at play distance.
 */
export function makeAmmoMag(): THREE.Group {
  return cached("ammo", () => {
    const k = 0.0024; // mm → m, about twice life size so it reads at play distance
    const profile = (pts: ([number, number] | [number, number, number, number])[]) => {
      const sh = new THREE.Shape();
      const [u0, v0] = pts[0] as [number, number];
      sh.moveTo(u0, v0);
      for (const p of pts.slice(1)) {
        if (p.length === 4) sh.quadraticCurveTo(p[0], p[1], p[2], p[3]);
        else sh.lineTo(p[0], p[1]);
      }
      return sh;
    };
    const slab = (shape: THREE.Shape, width: number, bevel: number) => {
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: width - 2 * bevel,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelOffset: -bevel,
        bevelSegments: 2,
        curveSegments: 10,
      });
      g.translate(-490, 150, -(width - 2 * bevel) / 2); // centre the magazine on its own middle
      g.scale(k, k, k);
      return g;
    };
    const body = profile([[456, -30], [522, -30], [526, -170, 596, -262], [588, -272], [516, -286], [462, -214, 458, -36]]);
    const plate = profile([[512, -280], [592, -266], [597, -277], [514, -292]]);
    const pieces: Piece[] = [
      { geo: slab(body, 26, 3), ink: INK.BLACK, fill: false },
      { geo: slab(plate, 29, 1.5), ink: INK.BLACK, fill: true },
    ];
    for (const v of [-58, -98]) {
      pieces.push({ geo: slab(profile([[464, v], [526, v], [528, v - 6], [466, v - 6]]), 27.5, 0.5), ink: INK.BLACK, fill: true });
    }
    // two rounds in the feed lips, staggered, bullets pointing forward (+x)
    for (const [du, dv, dz] of [[0, 0, 4.5], [-6, -9, -4.5]] as const) {
      const cx = (468 + 30 + du - 490) * k;
      const cy = (-30 + 6 + dv + 150) * k;
      const z = dz * k;
      const caseG = new THREE.CylinderGeometry(5.6 * k, 5.6 * k, 38 * k, 10);
      caseG.rotateZ(-Math.PI / 2);
      caseG.translate(cx, cy, z);
      const tipG = new THREE.ConeGeometry(4 * k, 18 * k, 10);
      tipG.rotateZ(-Math.PI / 2);
      tipG.translate(cx + 28 * k, cy, z);
      pieces.push({ geo: caseG, ink: INK.GOLD, fill: true });
      pieces.push({ geo: tipG, ink: INK.ORANGE, fill: true });
    }
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
