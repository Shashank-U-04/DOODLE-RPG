// Player characters: a soft, rounded person (capsule limbs, a round head, real
// hands) dressed from the library in look.ts — hair, face, hat, a shirt, pants,
// shoes and one extra. Each item has its own fixed colours.
//
// The skeleton is the same as the enemy rigs (rig.ts): hips → torso → head /
// arms → forearms, hips → legs → shins, the gun in the right fist. So the
// engine's walk cycle, katana swing and remote-player code drive it unchanged.
//
// Everything is drawn in "soft ink" (world.ts makeSoftInkMaterial): solid
// colour that still shades with the light, outlined in a dark version of its
// own ink. Primitives sharing a group and an ink are merged into one mesh.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { INK, type InkId, makeSoftInkMaterial } from "./world";
import { buildGun, type Rig } from "./rig";
import { itemId, type Look } from "./look";

/* ------------------------------------------------------------------ *
 * geometry helpers
 * ------------------------------------------------------------------ */

type Tf = { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number };
type Bk = Map<InkId, THREE.BufferGeometry[]>;

const tmpE = new THREE.Euler();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpM = new THREE.Matrix4();

function put(b: Bk, geo: THREE.BufferGeometry, ink: InkId, t: Tf) {
  tmpE.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0);
  tmpQ.setFromEuler(tmpE);
  tmpV.set(t.x ?? 0, t.y ?? 0, t.z ?? 0);
  tmpS.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
  tmpM.compose(tmpV, tmpQ, tmpS);
  geo.applyMatrix4(tmpM);
  const list = b.get(ink);
  if (list) list.push(geo);
  else b.set(ink, [geo]);
}

const sph = (b: Bk, r: number, t: Tf, ink: InkId, seg = 14) => put(b, new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7))), ink, t);
const cap = (b: Bk, r: number, len: number, t: Tf, ink: InkId, seg = 12) => put(b, new THREE.CapsuleGeometry(r, len, 4, seg), ink, t);
const cyl = (b: Bk, rt: number, rb: number, h: number, t: Tf, ink: InkId, seg = 16) => put(b, new THREE.CylinderGeometry(rt, rb, h, seg), ink, t);
const tor = (b: Bk, r: number, tube: number, t: Tf, ink: InkId, arc = Math.PI * 2) => put(b, new THREE.TorusGeometry(r, tube, 6, 22, arc), ink, t);
const cone = (b: Bk, r: number, h: number, t: Tf, ink: InkId, seg = 8) => put(b, new THREE.ConeGeometry(r, h, seg), ink, t);
const rbox = (b: Bk, w: number, h: number, d: number, t: Tf, ink: InkId, rad = 0.012) =>
  // RoundedBoxGeometry comes unindexed; index it so it merges with everything else
  put(b, mergeVertices(new RoundedBoxGeometry(w, h, d, 2, Math.min(rad, w / 2.05, h / 2.05, d / 2.05))), ink, t);
/** the top of a sphere down to polar angle `theta`, optionally leaving a gap in azimuth */
const dome = (b: Bk, r: number, theta: number, t: Tf, ink: InkId, phiStart = 0, phiLen = Math.PI * 2) =>
  put(b, new THREE.SphereGeometry(r, 20, 12, phiStart, phiLen, 0, theta), ink, t);

function flush(parent: THREE.Object3D, b: Bk) {
  for (const [ink, geos] of b) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, makeSoftInkMaterial(ink));
    mesh.frustumCulled = false;
    parent.add(mesh);
    if (merged !== geos[0]) for (const g of geos) g.dispose();
  }
  b.clear();
}

/* ------------------------------------------------------------------ *
 * proportions (metres; root at the feet, ~1.8 m tall)
 * ------------------------------------------------------------------ */

const HIP_Y = 0.92;
const HEAD_Y = 0.64; // head group, above the hip joint
const SH_Y = 0.485; // shoulder joint, above the hip joint
const ARM_X = 0.205;
const UP_ARM = 0.29;
const FOREARM = 0.28;
const LEG_X = 0.095;
const THIGH = 0.44;
const GROUND = -(HIP_Y - 0.02 - THIGH); // the floor, in shin space

const SKIN_INK: Record<string, InkId> = { peach: INK.PEACH, tan: INK.SAND, brown: INK.OCHRE, deep: INK.STONE };

type Ctx = {
  skin: InkId;
  hips: Bk;
  torso: Bk;
  head: Bk;
  arm: [Bk, Bk];
  fore: [Bk, Bk];
  leg: [Bk, Bk];
  shin: [Bk, Bk];
};
const SIDES = [-1, 1] as const;
const si = (side: number) => (side < 0 ? 0 : 1);

/* ------------------------------------------------------------------ *
 * body
 * ------------------------------------------------------------------ */

function body(c: Ctx) {
  const k = c.skin;
  // neck and head
  cyl(c.torso, 0.05, 0.056, 0.12, { y: 0.59 }, k, 12);
  sph(c.head, 0.125, { y: 0.125, sx: 0.95, sy: 1.04 }, k, 20);
  sph(c.head, 0.1, { y: 0.062, z: 0.012, sx: 0.95, sy: 0.8 }, k, 16);
  for (const s of SIDES) sph(c.head, 0.028, { x: s * 0.117, y: 0.11, z: -0.005, sx: 0.5 }, k, 8);
  sph(c.head, 0.02, { y: 0.092, z: 0.121, sy: 1.2, sz: 0.9 }, k, 8);
  // hands: a loose fist with a thumb over it
  for (const s of SIDES) {
    sph(c.fore[si(s)], 0.054, { y: -FOREARM - 0.02, sx: 0.85, sz: 1.05 }, k, 12);
    sph(c.fore[si(s)], 0.022, { x: -s * 0.03, y: -FOREARM, z: 0.03 }, k, 8);
  }
}

/* ------------------------------------------------------------------ *
 * faces
 * ------------------------------------------------------------------ */

function face(c: Ctx, id: string) {
  const b = c.head;
  const K = INK.BLACK;
  const eye = (x: number, r = 0.019) => {
    sph(b, r, { x, y: 0.125, z: 0.112, sy: 1.25, sz: 0.55 }, K, 10);
    sph(b, r * 0.32, { x: x + r * 0.35, y: 0.133, z: 0.122 }, INK.WHITE, 6);
  };
  const closed = (x: number, happy = true) =>
    tor(b, 0.016, 0.005, { x, y: happy ? 0.118 : 0.13, z: 0.116, rz: happy ? 0 : Math.PI }, K, Math.PI);
  const brows = (y = 0.168, tilt = 0) => {
    for (const s of SIDES) rbox(b, 0.045, 0.011, 0.012, { x: s * 0.047, y, z: 0.112, rz: s * tilt }, K, 0.004);
  };
  const smile = (w = 0.032) => tor(b, w, 0.0065, { y: 0.058, z: 0.111, rz: Math.PI }, K, Math.PI);
  const flat = () => rbox(b, 0.04, 0.009, 0.01, { y: 0.05, z: 0.113 }, K, 0.004);

  if (id === "calm") {
    eye(-0.045); eye(0.045); brows(); flat();
  } else if (id === "smile") {
    eye(-0.045); eye(0.045); brows(0.17, -0.1); smile();
  } else if (id === "grin") {
    eye(-0.045); eye(0.045); brows(0.174, -0.15);
    sph(b, 0.04, { y: 0.05, z: 0.1, sy: 0.6, sz: 0.45 }, K, 12);
    rbox(b, 0.05, 0.012, 0.012, { y: 0.064, z: 0.118 }, INK.WHITE, 0.004);
  } else if (id === "wink") {
    eye(0.045); closed(-0.045); brows(0.17, -0.1); smile(0.028);
  } else if (id === "cool") {
    for (const s of SIDES) {
      rbox(b, 0.062, 0.036, 0.014, { x: s * 0.045, y: 0.127, z: 0.122, rz: s * 0.06 }, K, 0.01);
      rbox(b, 0.008, 0.008, 0.11, { x: s * 0.088, y: 0.133, z: 0.07 }, K, 0.003);
    }
    rbox(b, 0.03, 0.007, 0.01, { y: 0.135, z: 0.124 }, K, 0.003);
    tor(b, 0.026, 0.006, { x: 0.01, y: 0.058, z: 0.111, rz: Math.PI + 0.25 }, K, Math.PI * 0.7);
  } else if (id === "surprised") {
    eye(-0.045, 0.023); eye(0.045, 0.023); brows(0.182, -0.12);
    tor(b, 0.015, 0.006, { y: 0.05, z: 0.113 }, K);
  } else if (id === "angry") {
    eye(-0.045); eye(0.045); brows(0.162, 0.45);
    tor(b, 0.028, 0.0065, { y: 0.036, z: 0.111 }, K, Math.PI);
  } else if (id === "sleepy") {
    closed(-0.045, false); closed(0.045, false); brows(0.163);
    rbox(b, 0.026, 0.008, 0.01, { y: 0.05, z: 0.113 }, K, 0.004);
  } else if (id === "freckles") {
    eye(-0.045); eye(0.045); brows(0.17, -0.1); smile();
    for (const s of SIDES) {
      sph(b, 0.018, { x: s * 0.07, y: 0.085, z: 0.1, sz: 0.4 }, INK.PINK, 8);
      for (let i = 0; i < 3; i++) sph(b, 0.0045, { x: s * (0.055 + i * 0.012), y: 0.098 - (i % 2) * 0.008, z: 0.112 }, INK.OCHRE, 5);
    }
  } else if (id === "glasses") {
    eye(-0.045); eye(0.045); brows(0.172); smile(0.026);
    for (const s of SIDES) {
      tor(b, 0.027, 0.0045, { x: s * 0.045, y: 0.126, z: 0.124 }, K);
      rbox(b, 0.006, 0.006, 0.11, { x: s * 0.086, y: 0.13, z: 0.07 }, K, 0.002);
    }
    rbox(b, 0.035, 0.006, 0.006, { y: 0.13, z: 0.126 }, K, 0.002);
  }
}

/* ------------------------------------------------------------------ *
 * hair
 * ------------------------------------------------------------------ */

function hair(c: Ctx, id: string) {
  const b = c.head;
  if (id === "buzz") {
    dome(b, 0.131, 1.25, { y: 0.125, rx: -0.35, sx: 0.97 }, INK.BLACK);
  } else if (id === "part") {
    const H = INK.STONE;
    dome(b, 0.137, 1.35, { y: 0.125, rx: -0.3, sx: 0.98 }, H);
    sph(b, 0.07, { x: 0.035, y: 0.218, z: 0.06, sx: 1.5, sy: 0.5, rz: -0.25 }, H, 12);
    sph(b, 0.05, { x: -0.085, y: 0.18, z: 0.06, sy: 0.7 }, H, 10);
  } else if (id === "spiky") {
    const H = INK.GOLD;
    dome(b, 0.134, 1.3, { y: 0.125, rx: -0.3, sx: 0.97 }, H);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const lean = 0.55;
      cone(b, 0.032, 0.11, {
        x: Math.sin(a) * 0.075,
        y: 0.235,
        z: Math.cos(a) * 0.075 - 0.025,
        rx: Math.cos(a) * lean,
        rz: -Math.sin(a) * lean,
      }, H, 5);
    }
    cone(b, 0.035, 0.12, { y: 0.275, z: -0.02 }, H, 5);
  } else if (id === "long") {
    const H = INK.BLACK;
    dome(b, 0.138, 1.5, { y: 0.125, rx: -0.25, sx: 0.98 }, H);
    cap(b, 0.1, 0.2, { y: -0.01, z: -0.075, sx: 1.25, sz: 0.5 }, H);
    for (const s of SIDES) cap(b, 0.035, 0.17, { x: s * 0.108, y: 0.04, z: -0.005, rz: s * 0.06 }, H, 8);
  } else if (id === "ponytail") {
    const H = INK.OCHRE;
    dome(b, 0.135, 1.4, { y: 0.125, rx: -0.3, sx: 0.97 }, H);
    tor(b, 0.02, 0.009, { y: 0.17, z: -0.135, rx: 0.4 }, INK.RED);
    cap(b, 0.042, 0.2, { y: 0.06, z: -0.17, rx: 0.35 }, H, 10);
  } else if (id === "afro") {
    const H = INK.BLACK;
    sph(b, 0.172, { y: 0.2, z: -0.045 }, H, 18);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const up = i % 2 ? 0.08 : -0.02;
      sph(b, 0.06, { x: Math.sin(a) * 0.15, y: 0.2 + up, z: Math.cos(a) * 0.15 - 0.06 }, H, 10);
    }
  } else if (id === "bob") {
    const H = INK.ORANGE;
    dome(b, 0.142, 1.95, { y: 0.118 }, H, Math.PI / 2 + 0.78, Math.PI * 2 - 1.56);
    dome(b, 0.139, 0.95, { y: 0.125, rx: -0.12 }, H);
  } else if (id === "bun") {
    const H = INK.STONE;
    dome(b, 0.134, 1.35, { y: 0.125, rx: -0.3, sx: 0.97 }, H);
    sph(b, 0.056, { y: 0.255, z: -0.065 }, H, 12);
  } else if (id === "mohawk") {
    const H = INK.PINK;
    for (let i = 0; i < 8; i++) {
      const k = i / 7;
      const a = 0.6 - k * 1.9; // brow to nape
      const len = 0.12 + 0.05 * Math.sin(k * Math.PI);
      cone(b, 0.03, len, { y: 0.125 + Math.cos(a) * 0.13, z: Math.sin(a) * 0.13, rx: a }, H, 4);
    }
  }
}

/* ------------------------------------------------------------------ *
 * hats
 * ------------------------------------------------------------------ */

function hat(c: Ctx, id: string) {
  const b = c.head;
  if (id === "cap") {
    const R = INK.RED;
    dome(b, 0.143, 1.35, { y: 0.13, rx: -0.12 }, R);
    cyl(b, 0.105, 0.105, 0.012, { y: 0.17, z: 0.11, rx: 0.14, sz: 0.85 }, R, 20);
    sph(b, 0.014, { y: 0.273, z: -0.015 }, INK.WHITE, 8);
  } else if (id === "beanie") {
    const C = INK.BLUE;
    dome(b, 0.145, 1.5, { y: 0.125, rx: -0.1, sy: 1.08 }, C);
    cyl(b, 0.147, 0.147, 0.05, { y: 0.14, z: -0.005, rx: -0.1 }, C, 20);
    sph(b, 0.042, { y: 0.29, z: -0.02 }, INK.WHITE, 10);
  } else if (id === "cowboy") {
    const C = INK.OCHRE;
    cyl(b, 0.1, 0.116, 0.13, { y: 0.27, z: -0.01, sz: 0.88 }, C, 18);
    cyl(b, 0.25, 0.25, 0.014, { y: 0.205, sz: 0.92 }, C, 28);
    tor(b, 0.25, 0.014, { y: 0.215, rx: Math.PI / 2, sy: 0.92 }, C);
    cyl(b, 0.115, 0.117, 0.026, { y: 0.222, z: -0.01, sz: 0.88 }, INK.STONE, 18);
  } else if (id === "tophat") {
    cyl(b, 0.105, 0.1, 0.26, { y: 0.34, z: -0.005 }, INK.BLACK, 20);
    cyl(b, 0.19, 0.19, 0.014, { y: 0.212 }, INK.BLACK, 24);
    cyl(b, 0.107, 0.107, 0.036, { y: 0.24, z: -0.005 }, INK.RED, 20);
  } else if (id === "headphones") {
    tor(b, 0.142, 0.013, { y: 0.12 }, INK.GREY, Math.PI);
    for (const s of SIDES) {
      cyl(b, 0.048, 0.048, 0.04, { x: s * 0.133, y: 0.11, rz: Math.PI / 2 }, INK.PINK, 16);
      cyl(b, 0.038, 0.038, 0.02, { x: s * 0.108, y: 0.11, rz: Math.PI / 2 }, INK.BLACK, 14);
    }
  } else if (id === "crown") {
    const G = INK.GOLD;
    tor(b, 0.122, 0.022, { y: 0.225, rx: Math.PI / 2 }, G);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      cone(b, 0.032, 0.09, { x: Math.sin(a) * 0.12, y: 0.285, z: Math.cos(a) * 0.12 }, G, 4);
      sph(b, 0.012, { x: Math.sin(a) * 0.12, y: 0.335, z: Math.cos(a) * 0.12 }, G, 6);
    }
    sph(b, 0.018, { y: 0.226, z: 0.142 }, INK.RED, 8);
  } else if (id === "bandana") {
    const R = INK.RED;
    dome(b, 0.139, 1.25, { y: 0.125, rx: -0.2 }, R);
    sph(b, 0.03, { y: 0.15, z: -0.137 }, R, 10);
    for (const s of SIDES) rbox(b, 0.03, 0.1, 0.01, { x: s * 0.02, y: 0.1, z: -0.15, rz: s * 0.3, rx: 0.2 }, R, 0.004);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      sph(b, 0.008, { x: Math.sin(a) * 0.1, y: 0.24, z: Math.cos(a) * 0.1 - 0.02 }, INK.WHITE, 5);
    }
  } else if (id === "beret") {
    sph(b, 0.156, { x: -0.02, y: 0.235, z: -0.01, sy: 0.32, rz: 0.18 }, INK.BLACK, 18);
    cyl(b, 0.012, 0.012, 0.03, { x: -0.03, y: 0.285 }, INK.BLACK, 6);
  } else if (id === "helmet") {
    const G = INK.GREEN;
    dome(b, 0.158, 1.6, { y: 0.115, z: -0.005 }, G);
    tor(b, 0.157, 0.014, { y: 0.112, z: -0.005, rx: Math.PI / 2 }, G);
    for (const s of SIDES) rbox(b, 0.012, 0.13, 0.012, { x: s * 0.112, y: 0.04, z: 0.02 }, INK.BLACK, 0.004);
  }
}

/* ------------------------------------------------------------------ *
 * shirts
 * ------------------------------------------------------------------ */

type Sleeve = "none" | "short" | "long";
const SHIRT: Record<string, { ink: InkId; sleeve: Sleeve; cuff?: InkId }> = {
  tee: { ink: INK.WHITE, sleeve: "short" },
  hoodie: { ink: INK.RED, sleeve: "long" },
  stripes: { ink: INK.WHITE, sleeve: "short" },
  denim: { ink: INK.DENIM, sleeve: "long" },
  flannel: { ink: INK.GREEN, sleeve: "long", cuff: INK.BLACK },
  leather: { ink: INK.BLACK, sleeve: "long" },
  jersey: { ink: INK.ORANGE, sleeve: "short" },
  sweater: { ink: INK.PURPLE, sleeve: "long" },
  tank: { ink: INK.TURQ, sleeve: "none" },
  blazer: { ink: INK.BLUE, sleeve: "long" },
};

function shirt(c: Ctx, id: string) {
  const spec = SHIRT[id] ?? SHIRT.tee;
  const S = spec.ink;
  const t = c.torso;
  // the torso itself: belly, chest, shoulders, hem
  cap(t, 0.128, 0.1, { y: 0.19, sz: 0.78 }, S, 16);
  cap(t, 0.155, 0.07, { y: 0.37, sx: 1.06, sz: 0.74 }, S, 16);
  for (const s of SIDES) sph(t, 0.074, { x: s * 0.192, y: 0.475 }, spec.sleeve === "none" ? c.skin : S, 12);
  tor(t, 0.128, 0.016, { y: 0.115, rx: Math.PI / 2, sy: 0.8 }, S);

  // arms: sleeves where the shirt has them, skin where it doesn't
  for (const s of SIDES) {
    const a = c.arm[si(s)];
    const f = c.fore[si(s)];
    if (spec.sleeve === "long") cap(a, 0.066, 0.2, { y: -0.14 }, S);
    else {
      cap(a, 0.06, 0.2, { y: -0.14 }, c.skin);
      if (spec.sleeve === "short") cyl(a, 0.077, 0.073, 0.15, { y: -0.065 }, S, 14);
    }
    if (spec.sleeve === "long") {
      cap(f, 0.057, 0.17, { y: -0.12 }, S);
      cyl(f, 0.061, 0.061, 0.035, { y: -0.235 }, spec.cuff ?? S, 14);
    } else cap(f, 0.051, 0.17, { y: -0.12 }, c.skin);
  }

  const front = (y: number) => (y > 0.3 ? 0.116 : 0.1); // the chest surface, roughly
  if (id === "tee") {
    tor(t, 0.056, 0.01, { y: 0.56, rx: Math.PI / 2 }, INK.GREY);
  } else if (id === "hoodie") {
    tor(t, 0.09, 0.04, { y: 0.555, z: -0.04, rx: 1.35, sy: 0.85 }, S);
    sph(t, 0.09, { y: 0.53, z: -0.13, sy: 0.7, sz: 0.6 }, S, 12);
    rbox(t, 0.2, 0.09, 0.03, { y: 0.2, z: 0.1 }, S, 0.012);
    for (const s of SIDES) cyl(t, 0.006, 0.006, 0.12, { x: s * 0.035, y: 0.47, z: 0.122 }, INK.WHITE, 5);
  } else if (id === "stripes") {
    for (const y of [0.16, 0.24, 0.33, 0.42]) {
      const r = y < 0.28 ? 0.13 : 0.158;
      tor(t, r, 0.011, { y, rx: Math.PI / 2, sx: y < 0.28 ? 1 : 1.06, sy: y < 0.28 ? 0.79 : 0.75 }, INK.BLUE);
    }
    for (const s of SIDES) tor(c.arm[si(s)], 0.076, 0.009, { y: -0.1, rx: Math.PI / 2 }, INK.BLUE);
    tor(t, 0.056, 0.01, { y: 0.56, rx: Math.PI / 2 }, INK.BLUE);
  } else if (id === "denim") {
    rbox(t, 0.1, 0.3, 0.02, { y: 0.38, z: 0.108 }, INK.WHITE, 0.006);
    for (const s of SIDES) {
      rbox(t, 0.085, 0.05, 0.025, { x: s * 0.065, y: 0.55, z: 0.08, rx: -0.4, rz: s * 0.45 }, S, 0.008);
      rbox(t, 0.055, 0.05, 0.015, { x: s * 0.085, y: 0.42, z: 0.115 }, S, 0.006);
      sph(t, 0.007, { x: s * 0.085, y: 0.44, z: 0.124 }, INK.GOLD, 5);
    }
  } else if (id === "flannel") {
    for (const y of [0.15, 0.25, 0.35, 0.45]) {
      const r = y < 0.28 ? 0.13 : 0.158;
      tor(t, r, 0.006, { y, rx: Math.PI / 2, sx: y < 0.28 ? 1 : 1.06, sy: y < 0.28 ? 0.79 : 0.75 }, INK.BLACK);
    }
    for (const x of [-0.08, -0.03, 0.03, 0.08]) {
      rbox(t, 0.008, 0.38, 0.008, { x, y: 0.31, z: 0.106 }, INK.BLACK, 0.003);
      rbox(t, 0.008, 0.38, 0.008, { x, y: 0.31, z: -0.106 }, INK.BLACK, 0.003);
    }
    for (const s of SIDES) for (const y of [-0.08, -0.18]) tor(c.arm[si(s)], 0.067, 0.005, { y, rx: Math.PI / 2 }, INK.BLACK);
  } else if (id === "leather") {
    rbox(t, 0.012, 0.38, 0.012, { x: 0.03, y: 0.33, z: front(0.33) + 0.004, rz: 0.08 }, INK.GREY, 0.004);
    for (const s of SIDES) {
      rbox(t, 0.09, 0.07, 0.025, { x: s * 0.07, y: 0.53, z: 0.085, rx: -0.35, rz: s * 0.5 }, S, 0.01);
      sph(t, 0.008, { x: s * 0.1, y: 0.3, z: 0.106 }, INK.GREY, 5);
    }
    tor(t, 0.131, 0.02, { y: 0.12, rx: Math.PI / 2, sy: 0.8 }, S);
  } else if (id === "jersey") {
    for (const z of [0.116, -0.116]) {
      rbox(t, 0.025, 0.11, 0.01, { y: 0.36, z }, INK.WHITE, 0.004);
      rbox(t, 0.03, 0.022, 0.01, { x: -0.014, y: 0.405, z, rz: 0.5 }, INK.WHITE, 0.004);
    }
    tor(t, 0.058, 0.012, { y: 0.56, rx: Math.PI / 2 }, INK.WHITE);
    for (const s of SIDES) tor(c.arm[si(s)], 0.073, 0.01, { y: -0.135, rx: Math.PI / 2 }, INK.WHITE);
  } else if (id === "sweater") {
    cyl(t, 0.064, 0.07, 0.09, { y: 0.585 }, S, 14);
    for (const y of [0.11, 0.135]) tor(t, 0.129, 0.012, { y, rx: Math.PI / 2, sy: 0.8 }, S);
    sph(t, 0.022, { x: -0.06, y: 0.4, z: 0.118 }, INK.GOLD, 8);
  } else if (id === "tank") {
    tor(t, 0.07, 0.01, { y: 0.5, z: 0.04, rx: Math.PI / 2 + 0.4 }, INK.WHITE);
    for (const s of SIDES) rbox(t, 0.012, 0.32, 0.02, { x: s * 0.13, y: 0.3, z: 0.0 }, INK.WHITE, 0.004);
  } else if (id === "blazer") {
    put(t, new THREE.ConeGeometry(0.05, 0.16, 3), INK.WHITE, { y: 0.48, z: 0.105, rz: Math.PI, sz: 0.3 });
    rbox(t, 0.025, 0.2, 0.012, { y: 0.41, z: 0.12 }, INK.RED, 0.005);
    sph(t, 0.016, { y: 0.52, z: 0.115 }, INK.RED, 8);
    for (const s of SIDES) rbox(t, 0.05, 0.16, 0.02, { x: s * 0.05, y: 0.47, z: 0.11, rz: s * -0.35 }, S, 0.006);
    for (const y of [0.26, 0.2]) sph(t, 0.009, { x: 0.03, y, z: 0.1 }, INK.GOLD, 6);
    rbox(t, 0.05, 0.012, 0.01, { x: -0.085, y: 0.43, z: 0.117 }, INK.WHITE, 0.004);
  }
}

/* ------------------------------------------------------------------ *
 * pants
 * ------------------------------------------------------------------ */

type Leg = "long" | "shorts" | "skirt";
const PANT: Record<string, { ink: InkId; leg: Leg; belt?: InkId; buckle?: InkId }> = {
  jeans: { ink: INK.DENIM, leg: "long", belt: INK.BLACK, buckle: INK.GOLD },
  black: { ink: INK.BLACK, leg: "long", belt: INK.STONE, buckle: INK.GREY },
  chinos: { ink: INK.SAND, leg: "long", belt: INK.OCHRE, buckle: INK.GOLD },
  cargo: { ink: INK.GREEN, leg: "long", belt: INK.BLACK, buckle: INK.GREY },
  track: { ink: INK.RED, leg: "long" },
  shorts: { ink: INK.DENIM, leg: "shorts", belt: INK.STONE, buckle: INK.GOLD },
  gym: { ink: INK.BLACK, leg: "shorts" },
  ripped: { ink: INK.DENIM, leg: "long", belt: INK.BLACK, buckle: INK.GREY },
  joggers: { ink: INK.GREY, leg: "long" },
  skirt: { ink: INK.BLUE, leg: "skirt" },
};

function pants(c: Ctx, id: string) {
  const spec = PANT[id] ?? PANT.jeans;
  const P = spec.ink;
  sph(c.hips, 0.148, { y: 0.02, sy: 0.72, sz: 0.78 }, P, 16);
  if (spec.belt) {
    tor(c.hips, 0.142, 0.017, { y: 0.085, rx: Math.PI / 2, sy: 0.8 }, spec.belt);
    rbox(c.hips, 0.04, 0.03, 0.012, { y: 0.085, z: 0.118 }, spec.buckle ?? INK.GREY, 0.004);
  }
  for (const s of SIDES) {
    const l = c.leg[si(s)];
    const n = c.shin[si(s)];
    if (spec.leg === "long") {
      cap(l, 0.083, 0.28, { y: -0.21 }, P);
      cap(n, 0.065, 0.24, { y: -0.16 }, P);
      cyl(n, 0.069, 0.069, 0.05, { y: -0.33 }, P, 14);
    } else {
      cap(l, 0.074, 0.28, { y: -0.21 }, c.skin);
      cap(n, 0.057, 0.24, { y: -0.16 }, c.skin);
      if (spec.leg === "shorts") cyl(l, 0.093, 0.088, 0.2, { y: -0.09 }, P, 16);
    }
  }

  if (id === "cargo") {
    for (const s of SIDES) rbox(c.leg[si(s)], 0.05, 0.09, 0.06, { x: s * 0.078, y: -0.25 }, P, 0.01);
  } else if (id === "track") {
    for (const s of SIDES) {
      rbox(c.leg[si(s)], 0.012, 0.36, 0.02, { x: s * 0.083, y: -0.21 }, INK.WHITE, 0.004);
      rbox(c.shin[si(s)], 0.012, 0.3, 0.02, { x: s * 0.065, y: -0.17 }, INK.WHITE, 0.004);
    }
    tor(c.hips, 0.14, 0.016, { y: 0.085, rx: Math.PI / 2, sy: 0.8 }, P);
  } else if (id === "shorts") {
    for (const s of SIDES) tor(c.leg[si(s)], 0.089, 0.012, { y: -0.19, rx: Math.PI / 2 }, P);
  } else if (id === "gym") {
    for (const s of SIDES) rbox(c.leg[si(s)], 0.012, 0.2, 0.025, { x: s * 0.09, y: -0.09 }, INK.ORANGE, 0.004);
    tor(c.hips, 0.14, 0.016, { y: 0.085, rx: Math.PI / 2, sy: 0.8 }, INK.ORANGE);
  } else if (id === "ripped") {
    for (const s of SIDES) {
      sph(c.shin[si(s)], 0.032, { y: 0.0, z: 0.057, sy: 0.7, sz: 0.45 }, c.skin, 10);
      for (const dy of [-0.016, 0.016]) rbox(c.shin[si(s)], 0.05, 0.005, 0.006, { y: dy, z: 0.071 }, INK.WHITE, 0.002);
      sph(c.leg[si(s)], 0.025, { x: s * 0.02, y: -0.16, z: 0.074, sy: 0.6, sz: 0.45 }, c.skin, 8);
    }
  } else if (id === "joggers") {
    for (const s of SIDES) tor(c.shin[si(s)], 0.066, 0.016, { y: -0.335, rx: Math.PI / 2 }, P);
    tor(c.hips, 0.14, 0.018, { y: 0.085, rx: Math.PI / 2, sy: 0.8 }, P);
    for (const s of SIDES) cyl(c.hips, 0.005, 0.005, 0.08, { x: s * 0.018, y: 0.05, z: 0.122 }, INK.WHITE, 5);
  } else if (id === "skirt") {
    cyl(c.hips, 0.16, 0.25, 0.3, { y: -0.11, sz: 0.85 }, P, 20);
    tor(c.hips, 0.165, 0.016, { y: 0.04, rx: Math.PI / 2, sy: 0.85 }, P);
    for (const y of [-0.05, -0.18]) {
      const r = 0.16 + (0.25 - 0.16) * ((0.04 - y) / 0.3);
      tor(c.hips, r + 0.002, 0.006, { y, rx: Math.PI / 2, sy: 0.85 }, INK.WHITE);
    }
  }
}

/* ------------------------------------------------------------------ *
 * shoes
 * ------------------------------------------------------------------ */

function shoes(c: Ctx, id: string) {
  const G = GROUND;
  for (const s of SIDES) {
    const b = c.shin[si(s)];
    const upper = (ink: InkId, sx = 1.12, sy = 0.9) => cap(b, 0.058, 0.11, { y: G + 0.058, z: 0.045, rx: Math.PI / 2, sx, sy }, ink);
    const sole = (ink: InkId, h = 0.028, w = 0.125) => rbox(b, w, h, 0.26, { y: G + h / 2, z: 0.045 }, ink, 0.01);
    const shaft = (ink: InkId, h: number, r = 0.068) => cyl(b, r, r * 0.95, h, { y: G + 0.07 + h / 2 }, ink, 14);
    const laces = (ink: InkId, n = 3) => {
      for (let i = 0; i < n; i++) rbox(b, 0.05, 0.006, 0.008, { y: G + 0.08 + i * 0.022, z: 0.075 - i * 0.012, rx: -0.5 }, ink, 0.002);
    };
    const stripe = (ink: InkId) => rbox(b, 0.006, 0.026, 0.13, { x: s * 0.062, y: G + 0.055, z: 0.035, rx: -0.15 }, ink, 0.002);

    if (id === "sneakers") {
      upper(INK.WHITE); sole(INK.GREY); stripe(INK.BLUE); laces(INK.GREY, 2);
    } else if (id === "boots") {
      upper(INK.BLACK); shaft(INK.BLACK, 0.12); sole(INK.STONE, 0.034); laces(INK.GREY);
    } else if (id === "hightops") {
      upper(INK.RED); shaft(INK.RED, 0.1); sole(INK.WHITE, 0.032);
      sph(b, 0.05, { y: G + 0.045, z: 0.13, sy: 0.65, sz: 0.8 }, INK.WHITE, 12); laces(INK.WHITE);
    } else if (id === "work") {
      upper(INK.OCHRE, 1.18, 0.95); shaft(INK.OCHRE, 0.09, 0.066); sole(INK.STONE, 0.04, 0.135); laces(INK.BLACK);
    } else if (id === "sandals") {
      cap(b, 0.045, 0.12, { y: G + 0.05, z: 0.045, rx: Math.PI / 2, sx: 1.05, sy: 0.8 }, c.skin);
      sole(INK.STONE, 0.022);
      rbox(b, 0.108, 0.016, 0.022, { y: G + 0.06, z: 0.09 }, INK.STONE, 0.005);
      rbox(b, 0.108, 0.016, 0.022, { y: G + 0.065, z: 0.0 }, INK.STONE, 0.005);
    } else if (id === "runners") {
      upper(INK.ORANGE); sole(INK.BLACK, 0.034); stripe(INK.WHITE); laces(INK.WHITE, 2);
    } else if (id === "dress") {
      upper(INK.BLACK, 1.0, 0.8); sole(INK.BLACK, 0.02, 0.11);
    } else if (id === "rain") {
      upper(INK.GOLD); shaft(INK.GOLD, 0.2, 0.07); sole(INK.BLACK, 0.026);
    } else if (id === "skate") {
      upper(INK.GREY, 1.28, 0.95); sole(INK.WHITE, 0.036, 0.14); stripe(INK.PINK); laces(INK.WHITE, 2);
    } else if (id === "combat") {
      upper(INK.STONE); shaft(INK.STONE, 0.16); sole(INK.BLACK, 0.036); laces(INK.BLACK, 4);
      rbox(b, 0.075, 0.014, 0.01, { y: G + 0.2, z: 0.062 }, INK.GREY, 0.004);
    }
  }
}

/* ------------------------------------------------------------------ *
 * extras
 * ------------------------------------------------------------------ */

function extra(c: Ctx, id: string) {
  const t = c.torso;
  if (id === "backpack") {
    rbox(t, 0.24, 0.28, 0.12, { y: 0.33, z: -0.18 }, INK.BLUE, 0.04);
    rbox(t, 0.17, 0.1, 0.04, { y: 0.25, z: -0.245 }, INK.BLUE, 0.015);
    tor(t, 0.03, 0.007, { y: 0.48, z: -0.18 }, INK.BLACK, Math.PI);
    for (const s of SIDES) {
      rbox(t, 0.035, 0.3, 0.015, { x: s * 0.08, y: 0.37, z: 0.112 }, INK.BLACK, 0.005);
      rbox(t, 0.035, 0.015, 0.2, { x: s * 0.09, y: 0.53, z: -0.02 }, INK.BLACK, 0.005);
    }
  } else if (id === "cape") {
    const R = INK.RED;
    rbox(t, 0.36, 0.035, 0.06, { y: 0.54, z: -0.11 }, R, 0.012);
    for (const s of [-1, 0, 1]) {
      rbox(t, 0.15, 0.92, 0.02, { x: s * 0.13, y: 0.09, z: -0.18 - Math.abs(s) * 0.01, rx: 0.1, rz: -s * 0.06 }, R, 0.008);
    }
    for (const s of SIDES) sph(t, 0.018, { x: s * 0.09, y: 0.53, z: 0.09 }, INK.GOLD, 8);
  } else if (id === "katana") {
    cyl(t, 0.026, 0.022, 0.8, { x: -0.02, y: 0.34, z: -0.16, rz: -0.78 }, INK.BLACK, 8);
    cyl(t, 0.018, 0.018, 0.2, { x: 0.24, y: 0.66, z: -0.16, rz: -0.78 }, INK.STONE, 8);
    rbox(t, 0.1, 0.02, 0.05, { x: 0.18, y: 0.6, z: -0.16, rz: -0.78 }, INK.GOLD, 0.006);
    rbox(t, 0.045, 0.42, 0.015, { y: 0.36, z: 0.11, rz: 0.75 }, INK.STONE, 0.005);
  } else if (id === "guitar") {
    const a = 0.5;
    const d = [-Math.sin(a), Math.cos(a)];
    const at = (k: number) => ({ x: 0.06 + d[0] * k, y: 0.18 + d[1] * k });
    sph(t, 0.15, { ...at(0), z: -0.18, sz: 0.3 }, INK.ORANGE, 18);
    sph(t, 0.11, { ...at(0.17), z: -0.18, sz: 0.3 }, INK.ORANGE, 16);
    cyl(t, 0.04, 0.04, 0.01, { ...at(0.05), z: -0.226, rx: Math.PI / 2 }, INK.BLACK, 14);
    rbox(t, 0.045, 0.42, 0.022, { ...at(0.45), z: -0.2, rz: a }, INK.STONE, 0.006);
    rbox(t, 0.06, 0.09, 0.024, { ...at(0.7), z: -0.2, rz: a }, INK.BLACK, 0.008);
    rbox(t, 0.04, 0.45, 0.015, { y: 0.34, z: 0.112, rz: -0.6 }, INK.BLACK, 0.005);
  } else if (id === "wings") {
    for (const s of SIDES) {
      for (let i = 0; i < 4; i++) {
        const len = 0.36 - i * 0.05;
        const phi = s * (0.55 + i * 0.32);
        const r = len / 2 + 0.05;
        cap(t, 0.032, len, { x: s * 0.07 + Math.sin(phi) * r, y: 0.42 + Math.cos(phi) * r, z: -0.2 - i * 0.01, rz: -phi, sz: 0.45 }, INK.WHITE, 8);
      }
    }
  } else if (id === "jetpack") {
    for (const s of SIDES) {
      cyl(t, 0.06, 0.06, 0.3, { x: s * 0.07, y: 0.36, z: -0.2 }, INK.GREY, 14);
      sph(t, 0.06, { x: s * 0.07, y: 0.51, z: -0.2 }, INK.GREY, 12);
      cone(t, 0.045, 0.07, { x: s * 0.07, y: 0.18, z: -0.2, rz: Math.PI }, INK.ORANGE, 12);
      tor(t, 0.061, 0.01, { x: s * 0.07, y: 0.42, z: -0.2, rx: Math.PI / 2 }, INK.RED);
      rbox(t, 0.035, 0.3, 0.015, { x: s * 0.08, y: 0.37, z: 0.112 }, INK.BLACK, 0.005);
    }
  } else if (id === "scarf") {
    tor(t, 0.07, 0.032, { y: 0.56, rx: Math.PI / 2 }, INK.RED);
    rbox(t, 0.05, 0.22, 0.02, { x: 0.05, y: 0.44, z: 0.125, rz: 0.1 }, INK.RED, 0.008);
    rbox(t, 0.05, 0.16, 0.02, { x: 0.0, y: 0.47, z: 0.13, rz: -0.15 }, INK.RED, 0.008);
    for (const y of [0.38, 0.42]) rbox(t, 0.052, 0.01, 0.022, { x: 0.056, y, z: 0.126, rz: 0.1 }, INK.WHITE, 0.003);
  } else if (id === "quiver") {
    cyl(t, 0.05, 0.045, 0.42, { x: 0.06, y: 0.36, z: -0.18, rz: -0.35 }, INK.OCHRE, 12);
    for (let i = 0; i < 4; i++) {
      const ox = 0.13 + (i % 2) * 0.025;
      const oy = 0.6 + (i >> 1) * 0.02;
      cyl(t, 0.006, 0.006, 0.14, { x: ox, y: oy, z: -0.17 - (i % 2) * 0.02, rz: -0.35 }, INK.STONE, 5);
      cone(t, 0.016, 0.05, { x: ox + 0.026, y: oy + 0.07, z: -0.17 - (i % 2) * 0.02, rz: -0.35 }, INK.WHITE, 4);
    }
    rbox(t, 0.04, 0.42, 0.015, { y: 0.36, z: 0.112, rz: 0.7 }, INK.STONE, 0.005);
  } else if (id === "skateboard") {
    const a = 0.25;
    rbox(t, 0.2, 0.62, 0.025, { y: 0.32, z: -0.17, rz: a }, INK.PINK, 0.012);
    for (const u of [-0.22, 0.22]) {
      const cx = -Math.sin(a) * u;
      const cy = 0.32 + Math.cos(a) * u;
      rbox(t, 0.12, 0.02, 0.02, { x: cx, y: cy, z: -0.195, rz: a }, INK.GREY, 0.005);
      for (const w of [-0.07, 0.07]) {
        cyl(t, 0.026, 0.026, 0.03, { x: cx + Math.cos(a) * w, y: cy + Math.sin(a) * w, z: -0.215, rz: Math.PI / 2 + a }, INK.WHITE, 10);
      }
    }
    rbox(t, 0.035, 0.3, 0.015, { x: -0.08, y: 0.37, z: 0.112 }, INK.BLACK, 0.005);
  }
}

/* ------------------------------------------------------------------ *
 * the character
 * ------------------------------------------------------------------ */

/** A dressed player character holding `weapon` (a rig weapon: rifle, shotgun, sniper, blade, pistol; "" for empty hands). */
export function makeAvatar(look: Look, weapon: string): Rig {
  const root = new THREE.Group();
  const nb = (): Bk => new Map();
  const c: Ctx = {
    skin: SKIN_INK[itemId(look, "skin")] ?? INK.PEACH,
    hips: nb(),
    torso: nb(),
    head: nb(),
    arm: [nb(), nb()],
    fore: [nb(), nb()],
    leg: [nb(), nb()],
    shin: [nb(), nb()],
  };
  body(c);
  face(c, itemId(look, "face"));
  hair(c, itemId(look, "hair"));
  hat(c, itemId(look, "hat"));
  shirt(c, itemId(look, "shirt"));
  pants(c, itemId(look, "pants"));
  shoes(c, itemId(look, "shoes"));
  extra(c, itemId(look, "extra"));

  const hips = new THREE.Group();
  hips.position.y = HIP_Y;
  root.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);
  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  torso.add(head);
  flush(hips, c.hips);
  flush(torso, c.torso);
  flush(head, c.head);

  const arms = SIDES.map((s) => {
    const arm = new THREE.Group();
    arm.position.set(s * ARM_X, SH_Y, 0);
    torso.add(arm);
    const fore = new THREE.Group();
    fore.position.y = -UP_ARM;
    arm.add(fore);
    flush(arm, c.arm[si(s)]);
    flush(fore, c.fore[si(s)]);
    return { arm, fore };
  });
  const legs = SIDES.map((s) => {
    const leg = new THREE.Group();
    leg.position.set(s * LEG_X, -0.02, 0);
    hips.add(leg);
    const shin = new THREE.Group();
    shin.position.y = -THIGH;
    leg.add(shin);
    flush(leg, c.leg[si(s)]);
    flush(shin, c.shin[si(s)]);
    return { leg, shin };
  });

  const gun = new THREE.Group();
  gun.position.set(0, -FOREARM - 0.06, 0.04);
  arms[1].fore.add(gun);
  if (weapon) buildGun(gun, weapon);

  return {
    root,
    parts: {
      hips,
      torso,
      head,
      armL: arms[0].arm,
      armR: arms[1].arm,
      foreL: arms[0].fore,
      foreR: arms[1].fore,
      legL: legs[0].leg,
      legR: legs[1].leg,
      shinL: legs[0].shin,
      shinR: legs[1].shin,
      gun,
      shield: null,
    },
    headWorldY: HIP_Y + HEAD_Y + 0.125,
    hitHeads: [head],
  };
}
