// Real-world weapon models, built in code from their actual side profiles.
//
// Every gun here is drawn the way a gunsmith's drawing is: as millimetre
// outlines along the bore (u = distance forward, v = height above the bore),
// which are extruded with a small bevel for the flat parts (receivers, stocks,
// grips, magazines) and lathed for the round ones (barrels, muzzle brakes,
// scope tubes). It is the same code-only approach CryptClaw uses for its crypt
// (ExtrudeGeometry/LatheGeometry instead of stacked boxes), and it is what
// lets an AK-47 read as an AK-47: the curved magazine, the slanted pistol grip,
// the gas tube over the barrel and the front sight hood are all in the outline.
//
//   rifle    → AK-47           shotgun → Winchester M1887 (lever action)
//   sniper   → AI AWM          revolver → Desert Eagle (.50 AE)
//   katana   → katana, with a swept blade (mune, shinogi, edge)
//
// One description feeds two consumers:
//   * the first-person view model (engine.ts), at full detail, with the moving
//     parts split out (charging handle, lever, bolt, slide, magazine) so the
//     actions and reloads can be animated, and
//   * the third-person guns other players and the enemies hold (rig.ts), at a
//     low level of detail and true metric scale.
//
// Coordinates of the returned geometry: x right, y up, the muzzle down -z, in
// view-model units, with the origin at the trigger (the katana: the guard).

import * as THREE from "three";
import { INK, type InkId } from "./world";

export type GunKind = "rifle" | "shotgun" | "sniper" | "revolver" | "katana";

export type GunPiece = { geo: THREE.BufferGeometry; ink: InkId; fill: boolean };

export type GunPart = {
  /** where the part's group sits; its pieces are stored relative to this point */
  pivot: THREE.Vector3;
  pieces: GunPiece[];
};

export type GunSpec = {
  kind: GunKind;
  /** "body" is the static gun; the rest move (charge, mag, lever, hammer, bolt, slide) */
  parts: Map<string, GunPart>;
  /** a point on the sight line at the rear sight (the scope's eyepiece for the AWM) */
  sight: THREE.Vector3;
  /** how far in front of the eye the rear sight sits when aimed */
  eyeRelief: number;
  muzzle: THREE.Vector3;
  /** where a spent case leaves the gun, or null (the katana) */
  eject: THREE.Vector3 | null;
  /** right hand (trigger hand) and left hand (support hand) */
  grip: THREE.Vector3;
  support: THREE.Vector3;
  /** millimetres → view-model units for this gun */
  unit: number;
};

type Seg = readonly [number, number] | { q: readonly [number, number, number, number] };

function trace<T extends THREE.Path>(p: T, segs: readonly Seg[]): T {
  const first = segs[0] as readonly [number, number];
  p.moveTo(first[0], first[1]);
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i];
    if ("q" in s) p.quadraticCurveTo(s.q[0], s.q[1], s.q[2], s.q[3]);
    else p.lineTo(s[0], s[1]);
  }
  return p;
}

/** Position + normal only, non-indexed, no groups: every piece merges with every other. */
function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo !== g) g.dispose();
  for (const k of Object.keys(geo.attributes)) if (k !== "position" && k !== "normal") geo.deleteAttribute(k);
  geo.clearGroups();
  if (!geo.getAttribute("normal")) geo.computeVertexNormals();
  return geo;
}

type At = { x?: number; rx?: number; ry?: number; rz?: number };

/**
 * A gun under construction. Everything is written in millimetres in "model
 * axes" (X right, Y up, Z = -u, i.e. back toward the shooter); `put` scales to
 * view-model units and moves the origin to the trigger.
 */
class Kit {
  readonly parts = new Map<string, GunPart>();
  private cur!: GunPart;
  readonly S: number;
  readonly origin: number;
  readonly lod: boolean;

  constructor(S: number, origin: number, lod: boolean) {
    this.S = S;
    this.origin = origin;
    this.lod = lod;
    this.part("body", origin, 0);
  }

  /** start (or return to) a moving part whose group pivots at (u, v, x) */
  part(name: string, u: number, v: number, x = 0) {
    let p = this.parts.get(name);
    if (!p) {
      p = { pivot: this.P(u, v, x), pieces: [] };
      this.parts.set(name, p);
    }
    this.cur = p;
    return this;
  }

  /** a gun-space point (mm) in view-model units */
  P(u: number, v: number, x = 0) {
    return new THREE.Vector3(x * this.S, v * this.S, -(u - this.origin) * this.S);
  }

  private put(geo: THREE.BufferGeometry, ink: InkId, fill: boolean) {
    geo.scale(this.S, this.S, this.S);
    geo.translate(-this.cur.pivot.x, -this.cur.pivot.y, this.origin * this.S - this.cur.pivot.z);
    this.cur.pieces.push({ geo: clean(geo), ink, fill });
  }

  /** a side profile (u, v) extruded `width` mm across the gun, edges softened */
  side(
    path: readonly Seg[],
    width: number,
    ink: InkId,
    fill = false,
    o: { x?: number; bevel?: number; holes?: readonly (readonly Seg[])[] } = {},
  ) {
    const shape = trace(new THREE.Shape(), path);
    for (const h of o.holes ?? []) shape.holes.push(trace(new THREE.Path(), h));
    const bev = this.lod ? 0 : Math.min(o.bevel ?? 1.6, width * 0.3);
    const depth = Math.max(0.3, width - 2 * bev);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bev > 0,
      bevelThickness: bev,
      bevelSize: bev,
      bevelOffset: -bev,
      bevelSegments: 2,
      curveSegments: this.lod ? 3 : 10,
    });
    geo.translate(0, 0, -depth / 2);
    geo.rotateY(Math.PI / 2); // shape x (u) → -Z, extrusion → X
    geo.translate(o.x ?? 0, 0, 0);
    this.put(geo, ink, fill);
  }

  /** a body of revolution around a line parallel to the bore; profile is [u, radius] with u increasing */
  lathe(
    profile: readonly (readonly [number, number])[],
    ink: InkId,
    fill = false,
    o: { v?: number; x?: number; seg?: number; sx?: number } = {},
  ) {
    const pts = profile.map(([u, r]) => new THREE.Vector2(Math.max(0, r), u));
    const geo = new THREE.LatheGeometry(pts, this.lod ? 8 : (o.seg ?? 20));
    geo.rotateX(-Math.PI / 2); // +Y (u) → -Z
    if (o.sx) geo.scale(o.sx, 1, 1);
    geo.translate(o.x ?? 0, o.v ?? 0, 0);
    this.put(geo, ink, fill);
  }

  /** a straight round bar along the bore direction */
  tube(
    u0: number,
    u1: number,
    r: number,
    ink: InkId,
    fill = false,
    o: { v?: number; x?: number; seg?: number; r1?: number; sx?: number; sy?: number } = {},
  ) {
    const geo = new THREE.CylinderGeometry(o.r1 ?? r, r, u1 - u0, this.lod ? 8 : (o.seg ?? 18));
    geo.rotateX(-Math.PI / 2); // top (+Y) → forward
    if (o.sx || o.sy) geo.scale(o.sx ?? 1, o.sy ?? 1, 1);
    geo.translate(o.x ?? 0, o.v ?? 0, -(u0 + u1) / 2);
    this.put(geo, ink, fill);
  }

  box(u0: number, u1: number, v0: number, v1: number, w: number, ink: InkId, fill = false, o: At = {}) {
    const geo = new THREE.BoxGeometry(w, v1 - v0, u1 - u0);
    geo.rotateX(o.rx ?? 0);
    geo.rotateY(o.ry ?? 0);
    geo.rotateZ(o.rz ?? 0);
    geo.translate(o.x ?? 0, (v0 + v1) / 2, -(u0 + u1) / 2);
    this.put(geo, ink, fill);
  }

  /** a round bar running across the gun (knobs, pins, turrets on the side) */
  across(u: number, v: number, x0: number, x1: number, r: number, ink: InkId, fill = false) {
    const geo = new THREE.CylinderGeometry(r, r, Math.abs(x1 - x0), this.lod ? 8 : 14);
    geo.rotateZ(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, v, -u);
    this.put(geo, ink, fill);
  }

  /** a vertical round bar (a turret on top) */
  upright(u: number, v0: number, v1: number, r: number, ink: InkId, fill = false, x = 0) {
    const geo = new THREE.CylinderGeometry(r, r, v1 - v0, this.lod ? 8 : 16);
    geo.translate(x, (v0 + v1) / 2, -u);
    this.put(geo, ink, fill);
  }

  ball(u: number, v: number, x: number, r: number, ink: InkId, fill = false) {
    const geo = new THREE.SphereGeometry(r, this.lod ? 6 : 12, this.lod ? 4 : 9);
    geo.translate(x, v, -u);
    this.put(geo, ink, fill);
  }

  /** a round bar between two gun-space points [u, v, x] */
  rod(a: readonly [number, number, number], b: readonly [number, number, number], r: number, ink: InkId, fill = false) {
    const pa = new THREE.Vector3(a[2], a[1], -a[0]);
    const pb = new THREE.Vector3(b[2], b[1], -b[0]);
    const d = pb.clone().sub(pa);
    const geo = new THREE.CylinderGeometry(r, r, d.length(), this.lod ? 6 : 10);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    geo.translate((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2);
    this.put(geo, ink, fill);
  }

  /** a flat plate seen face-on down the bore (a katana guard), `thick` mm along u */
  plate(shape: THREE.Shape, u0: number, thick: number, ink: InkId, fill = false) {
    const bev = this.lod ? 0 : Math.min(1.2, thick * 0.3);
    const depth = Math.max(0.3, thick - 2 * bev);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bev > 0,
      bevelThickness: bev,
      bevelSize: bev,
      bevelOffset: -bev,
      bevelSegments: 1,
      curveSegments: this.lod ? 8 : 24,
    });
    // extrusion runs +Z = back toward the shooter; seat it so it spans u0 → u0+thick
    geo.translate(0, 0, -u0 - thick + bev);
    this.put(geo, ink, fill);
  }

  /** raw geometry already in model axes (mm) */
  raw(geo: THREE.BufferGeometry, ink: InkId, fill = false) {
    this.put(geo, ink, fill);
  }
}

/* ------------------------------------------------------------------ *
 * AK-47 — 7.62×39, wood furniture, curved 30-round magazine
 * (butt at u = 0, muzzle at u ≈ 914)
 * ------------------------------------------------------------------ */
function ak47(lod: boolean): GunSpec {
  const k = new Kit(0.00125, 365, lod);
  const WOOD = INK.OCHRE;
  const DARK = INK.STONE;
  const M = INK.BLACK;

  // buttstock: the classic drop from the receiver down to a tall butt
  k.side(
    [[262, 12], [140, -12], [10, -38], [10, -152], [130, -118], [236, -74], { q: [256, -62, 262, -36] }],
    36,
    WOOD,
    false,
    { bevel: 5 },
  );
  k.side(
    [
      [0, -36],
      [11, -37],
      [11, -153],
      [0, -155],
    ],
    38,
    M,
    true,
    { bevel: 1.5 },
  ); // steel butt plate
  // receiver with the stamped dust cover and its rounded rear
  k.side(
    [
      [255, 18],
      [525, 18],
      [540, 10],
      [540, -22],
      [520, -34],
      [262, -34],
      [255, -26],
    ],
    28,
    M,
    false,
    { bevel: 2 },
  );
  k.side([[258, 18], { q: [258, 31, 274, 31] }, [500, 31], [512, 26], [512, 18]], 30, M, false, { bevel: 3 });
  if (!lod) for (const u of [300, 440, 520]) for (const x of [-14.6, 14.6]) k.ball(u, -22, x, 2.2, M, true); // rivets
  // rear sight block and the tangent leaf, notch at the top
  k.side(
    [
      [505, 18],
      [562, 18],
      [562, 30],
      [550, 35],
      [512, 35],
    ],
    26,
    M,
    false,
    { bevel: 2 },
  );
  k.side(
    [
      [518, 34],
      [556, 38],
      [556, 46],
      [518, 40],
    ],
    20,
    M,
    true,
    { bevel: 1 },
  );
  for (const x of [-7, 7]) k.box(548, 556, 44, 54, 5, M, true, { x });
  // wooden handguards over the gas tube and under the barrel
  k.side(
    [[560, 14], [700, 14], [700, 28], { q: [700, 38, 690, 38] }, [572, 38], { q: [560, 38, 560, 28] }],
    32,
    WOOD,
    false,
    { bevel: 6 },
  );
  k.side(
    [[562, -4], [752, -4], [756, -24], { q: [752, -40, 736, -42] }, [584, -44], { q: [566, -44, 562, -30] }],
    44,
    WOOD,
    false,
    { bevel: 7 },
  );
  k.box(540, 562, -38, 14, 30, M, false); // rear handguard retainer
  k.box(752, 762, -36, -2, 40, M, true); // front retainer band
  // barrel, gas tube, gas block, cleaning rod
  k.tube(540, 884, 11, M, false, { seg: 16 });
  k.tube(560, 760, 9, M, false, { v: 26, seg: 12 });
  k.side(
    [
      [748, -10],
      [790, -10],
      [790, 8],
      [778, 34],
      [748, 34],
    ],
    24,
    M,
    false,
    { bevel: 2 },
  );
  k.tube(560, 892, 3, M, true, { v: -17, seg: 6 });
  // front sight base, the hooded post, bayonet lug, muzzle nut
  k.side(
    [
      [848, -14],
      [884, -14],
      [884, 12],
      [878, 20],
      [852, 20],
    ],
    24,
    M,
    false,
    { bevel: 2 },
  );
  for (const x of [-9, 9]) k.box(856, 876, 20, 56, 5, M, true, { x });
  k.box(863, 868, 20, 52.5, 3, M, true);
  k.box(850, 880, -22, -14, 10, M, true);
  k.lathe(
    [
      [884, 0],
      [884, 13],
      [905, 13],
      [914, 11],
      [914, 0],
    ],
    M,
    false,
    { seg: 16 },
  );
  // pistol grip, trigger guard, trigger, magazine catch, selector
  k.side(
    [
      [336, -30],
      [380, -30],
      { q: [372, -60, 352, -132] },
      { q: [348, -146, 330, -146] },
      [312, -144],
      { q: [300, -140, 302, -128] },
      [330, -60],
    ],
    28,
    DARK,
    false,
    { bevel: 5 },
  );
  k.side(
    [
      [380, -32],
      [458, -32],
      [458, -40],
      [440, -62],
      [384, -62],
      [376, -54],
    ],
    8,
    M,
    true,
    {
      bevel: 1,
      holes: [
        [
          [388, -36],
          [450, -36],
          [436, -56],
          [388, -56],
        ],
      ],
    },
  );
  k.side([[398, -34], [404, -34], { q: [408, -46, 402, -56] }, [398, -54], { q: [402, -46, 398, -38] }], 6, M, true, {
    bevel: 1,
  });
  k.side(
    [
      [446, -36],
      [456, -36],
      [456, -62],
      [446, -58],
    ],
    10,
    M,
    true,
    { bevel: 1 },
  );
  k.box(290, 470, -5, 4, 3, M, true, { x: 15.6 });
  k.box(460, 474, -20, 4, 3, M, true, { x: 15.6 });

  // the curved 30-round magazine rocks out around its front lug
  k.part("mag", 520, -32);
  k.side(
    [[456, -30], [522, -30], { q: [526, -170, 596, -262] }, [588, -272], [516, -286], { q: [462, -214, 458, -36] }],
    26,
    M,
    false,
    { bevel: 3 },
  );
  k.side(
    [
      [512, -280],
      [592, -266],
      [597, -277],
      [514, -292],
    ],
    28,
    M,
    true,
    { bevel: 1.5 },
  );
  if (!lod) {
    k.side(
      [
        [466, -56],
        [524, -56],
        [526, -62],
        [467, -62],
      ],
      27,
      M,
      true,
      { bevel: 0.5 },
    );
    k.side(
      [
        [468, -96],
        [528, -96],
        [530, -102],
        [470, -102],
      ],
      27,
      M,
      true,
      { bevel: 0.5 },
    );
  }

  // charging handle: rides back with the bolt carrier on every shot
  k.part("charge", 490, 6, 16);
  k.box(468, 520, 0, 11, 5, M, false, { x: 16 });
  k.across(490, 6, 16, 33, 5.5, M, false);
  k.ball(490, 6, 34, 7, M, false);

  return {
    kind: "rifle",
    parts: k.parts,
    sight: k.P(552, 53),
    eyeRelief: 0.46,
    muzzle: k.P(916, 0),
    eject: k.P(470, 14, 16),
    grip: k.P(336, -82),
    support: k.P(655, -30),
    unit: k.S,
  };
}

/* ------------------------------------------------------------------ *
 * Winchester M1887 — lever action, tube magazine, straight-grip stock
 * ------------------------------------------------------------------ */
function m1887(lod: boolean): GunSpec {
  const k = new Kit(0.00118, 385, lod);
  const WOOD = INK.OCHRE;
  const M = INK.BLACK;

  k.side(
    [
      [345, 2],
      [250, -6],
      [120, -16],
      [12, -26],
      [12, -150],
      { q: [60, -138, 150, -112] },
      [262, -62],
      [318, -50],
      [345, -48],
    ],
    40,
    WOOD,
    false,
    { bevel: 6 },
  );
  k.side(
    [
      [0, -24],
      [12, -26],
      [12, -150],
      [0, -153],
    ],
    42,
    M,
    true,
    { bevel: 1.5 },
  );
  // the tall receiver with its rounded nose
  k.side(
    [
      [340, -50],
      [340, 8],
      { q: [342, 18, 356, 20] },
      [470, 22],
      { q: [526, 24, 530, -6] },
      [530, -30],
      [512, -46],
      [490, -50],
    ],
    40,
    M,
    false,
    { bevel: 3 },
  );
  if (!lod) {
    for (const [u, v] of [
      [376, -22],
      [452, -6],
      [484, -34],
    ] as const)
      for (const x of [-1, 1]) k.across(u, v, x * 19, x * 21.2, 3.6, INK.GOLD, true);
  }
  // barrel over the magazine tube, barrel band, bead on a ramp
  k.tube(526, 1010, 13, M, false, { seg: 18 });
  k.lathe(
    [
      [998, 0],
      [998, 14.5],
      [1010, 14.5],
      [1010, 0],
    ],
    M,
    false,
  );
  k.tube(526, 968, 11, M, false, { v: -26, seg: 16 });
  k.tube(968, 977, 12, M, true, { v: -26, seg: 16 });
  k.side(
    [
      [938, 14],
      [956, 14],
      [956, -40],
      [938, -40],
    ],
    30,
    M,
    true,
    { bevel: 6 },
  );
  k.box(986, 1004, 10, 28, 6, M, true);
  k.ball(996, 31, 0, 3.6, INK.GOLD, true);
  // forend wrapped round the tube, with finger grooves
  k.side(
    [
      [528, -8],
      [745, -8],
      { q: [754, -8, 754, -20] },
      [754, -36],
      { q: [752, -47, 738, -47] },
      [540, -49],
      { q: [528, -47, 528, -34] },
    ],
    40,
    WOOD,
    false,
    { bevel: 8 },
  );
  if (!lod) for (const u of [600, 640, 680]) k.box(u, u + 3, -40, -14, 41, INK.STONE, true);
  // trigger, inside the lever's loop
  k.side([[388, -50], [394, -50], { q: [398, -62, 390, -72] }, [386, -70], { q: [390, -62, 388, -54] }], 6, M, true, {
    bevel: 1,
  });

  // hammer: rocked back as the lever opens
  k.part("hammer", 348, 4);
  k.side([[344, 0], [356, 0], [352, 20], [344, 34], { q: [334, 40, 330, 34] }, [340, 20]], 10, M, true, { bevel: 1.5 });

  // lever: pivots at the front of the receiver, finger loop behind the trigger
  k.part("lever", 508, -48);
  k.side(
    [
      [512, -44],
      [512, -56],
      [380, -60],
      [372, -52],
      [430, -48],
    ],
    12,
    M,
    false,
    { bevel: 2 },
  );
  {
    const loop = new THREE.Shape();
    loop.absellipse(0, 0, 42, 30, 0, Math.PI * 2, false, 0);
    const hole = new THREE.Path();
    hole.absellipse(0, 0, 31, 19, 0, Math.PI * 2, true, 0);
    loop.holes.push(hole);
    const bev = lod ? 0 : 2;
    const geo = new THREE.ExtrudeGeometry(loop, {
      depth: 12 - 2 * bev,
      bevelEnabled: bev > 0,
      bevelThickness: bev,
      bevelSize: bev,
      bevelOffset: -bev,
      bevelSegments: 2,
      curveSegments: lod ? 8 : 24,
    });
    geo.translate(0, 0, -(12 - 2 * bev) / 2);
    geo.rotateZ(0.32);
    geo.translate(348, -84, 0);
    geo.rotateY(Math.PI / 2);
    k.raw(geo, M, false);
  }

  return {
    kind: "shotgun",
    parts: k.parts,
    sight: k.P(470, 34),
    eyeRelief: 0.4,
    muzzle: k.P(1012, 0),
    eject: k.P(500, 26, 0),
    grip: k.P(320, -50),
    support: k.P(640, -34),
    unit: k.S,
  };
}

/* ------------------------------------------------------------------ *
 * Accuracy International AWM — thumbhole chassis, fluted barrel,
 * muzzle brake, folded bipod, 3-12×50 scope
 * ------------------------------------------------------------------ */
function awm(lod: boolean): GunSpec {
  const k = new Kit(0.00106, 430, lod);
  const STOCK = INK.GREEN;
  const M = INK.BLACK;
  const SCOPE_V = 76;

  k.side(
    [
      [20, -4],
      [318, -4],
      [338, -30],
      [906, -30],
      [912, -44],
      [906, -70],
      [480, -74],
      [462, -80],
      { q: [444, -120, 438, -168] },
      { q: [432, -182, 412, -182] },
      [360, -180],
      [40, -186],
      [20, -182],
    ],
    44,
    STOCK,
    false,
    {
      bevel: 6,
      holes: [
        [
          [70, -48],
          [330, -48],
          { q: [352, -52, 360, -72] },
          [392, -150],
          { q: [392, -156, 384, -156] },
          [90, -156],
          { q: [70, -156, 70, -140] },
        ],
      ],
    },
  );
  k.side(
    [[110, -6], [290, -6], [290, 10], { q: [290, 17, 280, 17] }, [120, 17], { q: [110, 17, 110, 8] }],
    40,
    STOCK,
    false,
    { bevel: 6 },
  ); // cheek piece
  k.side(
    [
      [6, -2],
      [20, -4],
      [20, -184],
      [6, -187],
    ],
    46,
    M,
    true,
    { bevel: 2 },
  ); // recoil pad
  // receiver, rail, ejection port
  k.tube(330, 640, 22, M, false, { seg: 20 });
  k.box(330, 640, -28, -6, 36, M, false);
  k.box(340, 660, 20, 28, 22, M, true);
  if (!lod) for (let u = 350; u < 650; u += 18) k.box(u, u + 6, 27, 29.5, 22.4, M, false);
  k.box(400, 470, 5, 18, 2, M, true, { x: 21.5 });
  // fluted heavy barrel and the brake
  k.lathe(
    [
      [640, 0],
      [640, 17],
      [700, 15],
      [1150, 13],
      [1150, 0],
    ],
    M,
    false,
    { seg: 18 },
  );
  if (!lod) {
    for (const x of [-13, 13]) k.box(720, 1100, -2, 2, 1.6, M, true, { x });
    for (const v of [-13, 13]) k.box(720, 1100, v - 0.8, v + 0.8, 4, M, true);
  }
  k.lathe(
    [
      [1150, 0],
      [1150, 19],
      [1218, 19],
      [1222, 16],
      [1222, 0],
    ],
    M,
    false,
    { seg: 18 },
  );
  for (const u of [1164, 1190]) k.box(u, u + 14, -8, 8, 40, M, true);
  // trigger guard and trigger
  k.side(
    [
      [404, -74],
      [480, -74],
      [476, -100],
      [410, -102],
    ],
    10,
    M,
    true,
    {
      bevel: 1,
      holes: [
        [
          [414, -78],
          [470, -78],
          [466, -94],
          [416, -96],
        ],
      ],
    },
  );
  k.side([[434, -76], [440, -76], { q: [444, -88, 436, -98] }, [432, -96], { q: [436, -88, 434, -80] }], 6, M, true, {
    bevel: 1,
  });
  // folded bipod under the forend
  k.box(858, 892, -86, -70, 30, M, false);
  for (const x of [-12, 12]) {
    k.rod([875, -80, x], [660, -86, x * 1.15], 4.5, M, false);
    k.box(648, 666, -92, -80, 10, M, true, { x: x * 1.15 });
  }
  // the scope: eyepiece, tube, objective bell, turrets, rings
  k.lathe(
    [
      [296, 0],
      [296, 21],
      [340, 22],
      [352, 16],
      [372, 15.5],
      [690, 15.5],
      [730, 27],
      [790, 28],
      [790, 0],
    ],
    M,
    false,
    { v: SCOPE_V, seg: 24 },
  );
  k.tube(306, 328, 23, M, true, { v: SCOPE_V, seg: 24 });
  k.tube(788, 792, 25, INK.TURQ, true, { v: SCOPE_V, seg: 24 });
  k.tube(293, 296.5, 14, INK.TURQ, true, { v: SCOPE_V, seg: 24 });
  k.box(520, 560, 62, 94, 34, M, false);
  k.upright(540, 91, 118, 14, M, false);
  k.upright(540, 116, 121, 15, M, true);
  k.across(540, SCOPE_V, 15, 44, 13, M, false);
  k.across(540, SCOPE_V, -36, -15, 12, M, false);
  for (const u of [410, 640]) {
    k.tube(u, u + 18, 19, M, true, { v: SCOPE_V, seg: 20 });
    k.box(u - 4, u + 22, 26, 60, 24, M, true);
  }

  // bolt: lifts, runs back, closes — handle on the right with a big knob
  k.part("bolt", 372, 0);
  k.tube(296, 336, 15, M, false, { seg: 16 });
  k.rod([372, 4, 14], [372, -14, 50], 5.5, M, false);
  k.ball(372, -16, 54, 12, M, false);

  // detachable box magazine
  k.part("mag", 522, -74);
  k.side(
    [
      [488, -60],
      [556, -60],
      [556, -112],
      [488, -112],
    ],
    30,
    M,
    false,
    { bevel: 2 },
  );
  k.side(
    [
      [484, -112],
      [560, -112],
      [560, -120],
      [484, -120],
    ],
    32,
    M,
    true,
    { bevel: 1.5 },
  );

  return {
    kind: "sniper",
    parts: k.parts,
    sight: k.P(296, SCOPE_V),
    eyeRelief: 0.17,
    muzzle: k.P(1224, 0),
    eject: k.P(430, 12, 22),
    grip: k.P(415, -124),
    support: k.P(760, -54),
    unit: k.S,
  };
}

/* ------------------------------------------------------------------ *
 * Desert Eagle Mark XIX — .50 AE, flat-sided barrel with integral rail,
 * squared trigger guard, slide behind the fixed barrel
 * ------------------------------------------------------------------ */
function deagle(lod: boolean): GunSpec {
  // real proportions: 270 mm long, ~150 mm tall, 6" barrel; u = 0 at the slide's rear
  const k = new Kit(0.00125, 112, lod);
  const M = INK.BLACK;

  // The fixed barrel: tall flat sides, the full-length rail on top, the lower
  // front edge swept up into the muzzle, and the .50 bore.
  k.side(
    [
      [118, -14],
      [252, -14],
      [270, -7],
      [270, 22],
      [266, 26],
      [118, 26],
    ],
    30,
    M,
    false,
    { bevel: 2.5 },
  );
  k.side(
    [
      [126, 25],
      [268, 25],
      [268, 32],
      [126, 32],
    ],
    19,
    M,
    false,
    { bevel: 1.5 },
  );
  if (!lod) {
    for (let u = 130; u < 260; u += 13) k.box(u, u + 6, 30, 33, 19.6, M, true);
    for (const x of [-15.2, 15.2]) k.box(138, 258, -6, -3, 1, M, true, { x }); // the flat's lower lip
  }
  k.tube(269, 271.5, 6.5, M, true, { seg: 16 });
  k.side(
    [
      [254, 32],
      [266, 32],
      [265, 36.5],
      [257, 36.5],
    ],
    4,
    M,
    true,
    { bevel: 0.8 },
  ); // front blade
  // Frame: dust cover under the barrel with its slanted nose, beavertail tang
  k.side(
    [
      [-14, -18],
      [-6, -12],
      [232, -12],
      [232, -16],
      [222, -34],
      [176, -34],
      [96, -34],
      [6, -34],
      [-10, -28],
    ],
    28,
    M,
    false,
    { bevel: 2 },
  );
  // squared trigger guard with the hooked front
  k.side(
    [
      [94, -33],
      [178, -33],
      { q: [184, -38, 178, -46] },
      [168, -50],
      [162, -74],
      { q: [158, -80, 150, -80] },
      [102, -80],
      { q: [94, -80, 92, -72] },
    ],
    13,
    M,
    false,
    {
      bevel: 2,
      holes: [
        [
          [104, -37],
          [162, -37],
          [152, -73],
          [104, -73],
        ],
      ],
    },
  );
  k.side([[110, -35], [118, -35], { q: [125, -51, 116, -66] }, [110, -64], { q: [116, -51, 110, -39] }], 7, M, true, {
    bevel: 1,
  });
  k.across(96, -46, -14.5, 14.5, 4.5, M, true); // magazine release
  // grip: raked ~18°, with textured panels
  k.side(
    [
      [-16, -22],
      [6, -32],
      [92, -33],
      { q: [84, -60, 62, -136] },
      { q: [58, -148, 46, -148] },
      [-12, -148],
      { q: [-24, -147, -24, -136] },
      [-12, -80],
      { q: [-4, -48, -16, -30] },
    ],
    30,
    M,
    false,
    { bevel: 4 },
  );
  k.side([[6, -44], [80, -44], [58, -132], [-6, -132], { q: [-16, -132, -14, -120] }, [-6, -84]], 32.6, M, true, {
    bevel: 2.5,
  });
  if (!lod) for (const x of [-16.6, 16.6]) k.across(46, -58, x - 0.6, x + 0.6, 7, INK.GOLD, true); // medallion
  // ring hammer
  k.side([[-10, -14], [2, -14], [2, 8], { q: [0, 24, -10, 24] }, { q: [-19, 22, -17, 8] }], 10, M, false, {
    bevel: 1.5,
    holes: [[[-12, 7], [-4, 7], { q: [-4, 18, -9, 18] }, { q: [-14, 16, -12, 9] }]],
  });
  // slide stop and takedown lever on the left
  k.box(70, 118, -18, -11, 2.4, M, true, { x: -15.2 });
  k.box(132, 150, -26, -15, 2.4, M, true, { x: -15.2 });

  // slide: rides back over the frame on every shot
  k.part("slide", 60, 0);
  k.side(
    [
      [2, 26],
      [124, 26],
      [124, 4],
      [104, -12],
      [6, -12],
      [0, 20],
    ],
    32,
    M,
    false,
    { bevel: 2.5 },
  );
  if (!lod)
    for (let i = 0; i < 8; i++) for (const x of [-16.2, 16.2]) k.box(10 + i * 5, 12 + i * 5, -6, 22, 1, M, true, { x });
  k.box(68, 112, 6, 20, 1, M, true, { x: 16.2 }); // ejection port
  for (const x of [-17.5, 17.5])
    k.side(
      [
        [12, 12],
        [30, 14],
        [30, 21],
        [14, 21],
      ],
      3,
      M,
      true,
      { x, bevel: 0.6 },
    ); // ambi safety
  for (const x of [-8, 8]) k.box(4, 18, 26, 37, 7, M, true, { x }); // rear sight ears

  // magazine: hidden in the grip until a reload drops it
  k.part("mag", 20, -140);
  k.side(
    [
      [10, -36],
      [78, -36],
      [52, -140],
      [-8, -140],
    ],
    22,
    M,
    false,
    { bevel: 1.5 },
  );
  k.side(
    [
      [-14, -148],
      [50, -148],
      [52, -157],
      [-16, -157],
    ],
    30,
    M,
    true,
    { bevel: 2 },
  );

  return {
    kind: "revolver",
    parts: k.parts,
    sight: k.P(11, 36.5),
    eyeRelief: 0.4,
    muzzle: k.P(273, 0),
    eject: k.P(90, 14, 16),
    grip: k.P(30, -84),
    support: k.P(18, -98, -34),
    unit: k.S,
  };
}

/* ------------------------------------------------------------------ *
 * Katana — curved blade swept along its length (mune, shinogi-ji, ji,
 * polished edge), habaki, tsuba, wrapped tsuka with its diamonds
 * ------------------------------------------------------------------ */
function katana(lod: boolean): GunSpec {
  const k = new Kit(0.00145, 260, lod);
  const M = INK.BLACK;
  const GOLD = INK.GOLD;

  // tsuka: dark wrap over the ray-skin core, white diamonds showing through
  k.tube(14, 246, 1, M, true, { seg: 14, sx: 13, sy: 16 });
  if (!lod) {
    for (let i = 0; i < 7; i++) {
      const u = 30 + i * 32;
      for (const x of [-12.6, 12.6]) k.box(u - 6, u + 6, -6, 6, 2, INK.BONE, true, { x, rx: Math.PI / 4 });
      for (const v of [-15.6, 15.6]) k.box(u - 6, u + 6, v - 1, v + 1, 7, INK.BONE, true, { ry: Math.PI / 4 });
    }
    for (const x of [-13.2, 13.2]) k.box(118, 146, -5, 5, 3, GOLD, true, { x }); // menuki
  }
  k.tube(236, 256, 17.5, GOLD, false, { seg: 20, sx: 0.82 }); // fuchi
  k.lathe(
    [
      [0, 0],
      [0, 12],
      [5, 16.5],
      [16, 17],
      [16, 0],
    ],
    GOLD,
    false,
    { seg: 20, sx: 0.82 },
  ); // kashira
  // tsuba with its two small openings, seppa either side
  {
    const guard = new THREE.Shape();
    guard.absellipse(0, 0, 36, 41, 0, Math.PI * 2, false, 0);
    for (const x of [-21, 21]) {
      const h = new THREE.Path();
      h.absellipse(x, 2, 5, 9, 0, Math.PI * 2, true, 0);
      guard.holes.push(h);
    }
    k.plate(guard, 256, 7, M, false);
    for (const u of [254.5, 263]) {
      const s = new THREE.Shape();
      s.absellipse(0, -1, 19, 24, 0, Math.PI * 2, false, 0);
      k.plate(s, u, 1.6, GOLD, true);
    }
  }
  k.box(264, 292, -18, 16, 11, GOLD, false); // habaki

  // the blade: a 7-sided section swept along a curve
  const L = 700;
  const u0 = 264;
  const N = lod ? 10 : 36;
  const ring: THREE.Vector3[][] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const body = Math.min(1, s / 0.9);
    const kk = s <= 0.9 ? 0 : (s - 0.9) / 0.1;
    const spine = 15 + 18 * s * s - 3 * kk * kk; // the sori: the tip rises
    const w = (32 - 8 * body) * Math.sqrt(Math.max(0, 1 - kk * kk));
    const t = (7.5 - 2.5 * body) * (1 - 0.7 * kk);
    const u = u0 + s * L;
    const pts: [number, number][] = [
      [0, spine],
      [t * 0.32, spine - 0.05 * w],
      [t * 0.5, spine - 0.3 * w],
      [t * 0.18, spine - 0.8 * w],
      [0, spine - w],
      [-t * 0.18, spine - 0.8 * w],
      [-t * 0.5, spine - 0.3 * w],
      [-t * 0.32, spine - 0.05 * w],
    ];
    ring.push(pts.map(([x, v]) => new THREE.Vector3(x, v, -u)));
  }
  // faces between ring i and i+1 for side j → j+1, sorted by finish
  const bands: Record<"mune" | "ji" | "ha", number[]> = { mune: [], ji: [], ha: [] };
  const finish = (j: number) => (j === 0 || j === 7 || j === 1 || j === 6 ? "mune" : j === 2 || j === 5 ? "ji" : "ha");
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < 8; j++) {
      const j2 = (j + 1) % 8;
      const a = ring[i][j];
      const b = ring[i][j2];
      const c = ring[i + 1][j2];
      const d = ring[i + 1][j];
      const out = bands[finish(j)];
      // wound so the outside faces the viewer (the material draws front faces)
      out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
    }
  }
  const look: Record<"mune" | "ji" | "ha", [InkId, boolean]> = {
    mune: [M, true],
    ji: [M, false],
    ha: [INK.BONE, true],
  };
  for (const key of ["mune", "ji", "ha"] as const) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(bands[key], 3));
    g.computeVertexNormals();
    k.raw(g, look[key][0], look[key][1]);
  }

  return {
    kind: "katana",
    parts: k.parts,
    sight: k.P(200, 0),
    eyeRelief: 0.3,
    muzzle: k.P(u0 + L, 0),
    eject: null,
    grip: k.P(212, 0),
    support: k.P(62, 0),
    unit: k.S,
  };
}

const BUILD: Record<GunKind, (lod: boolean) => GunSpec> = {
  rifle: ak47,
  shotgun: m1887,
  sniper: awm,
  revolver: deagle,
  katana,
};

/** The full-detail model for the first-person view. */
export function buildGunSpec(kind: string): GunSpec {
  return (BUILD[kind as GunKind] ?? ak47)(false);
}

const rigCache = new Map<string, GunPiece[]>();

/**
 * The same gun for a third-person rig: low detail, every part merged in its
 * resting place, turned to point down +z and scaled to true size (metres), with
 * the origin at the trigger. Callers get fresh copies they may consume.
 */
export function rigGunPieces(kind: string): GunPiece[] {
  let base = rigCache.get(kind);
  if (!base) {
    const spec = (BUILD[kind as GunKind] ?? ak47)(true);
    const m = new THREE.Matrix4()
      .makeRotationY(Math.PI)
      .multiply(new THREE.Matrix4().makeScale(0.001 / spec.unit, 0.001 / spec.unit, 0.001 / spec.unit));
    base = [];
    for (const [name, part] of spec.parts) {
      if (name.startsWith("hand")) continue;
      for (const p of part.pieces) {
        const g = p.geo.clone();
        g.translate(part.pivot.x, part.pivot.y, part.pivot.z);
        g.applyMatrix4(m);
        base.push({ geo: g, ink: p.ink, fill: p.fill });
        p.geo.dispose();
      }
    }
    rigCache.set(kind, base);
  }
  return base.map((p) => ({ geo: p.geo.clone(), ink: p.ink, fill: p.fill }));
}

/**
 * The same gun's hand and barrel points, in the rig frame rigGunPieces uses
 * (metres, trigger at the origin, muzzle down +z): where the shooting hand
 * grips, where the support hand holds, and where the barrel ends.
 */
export function rigGunPoints(kind: string): { grip: THREE.Vector3; support: THREE.Vector3; muzzle: THREE.Vector3 } {
  const spec = (BUILD[kind as GunKind] ?? ak47)(true);
  const m = new THREE.Matrix4()
    .makeRotationY(Math.PI)
    .multiply(new THREE.Matrix4().makeScale(0.001 / spec.unit, 0.001 / spec.unit, 0.001 / spec.unit));
  for (const part of spec.parts.values()) for (const p of part.pieces) p.geo.dispose();
  return {
    grip: spec.grip.clone().applyMatrix4(m),
    support: spec.support.clone().applyMatrix4(m),
    muzzle: spec.muzzle.clone().applyMatrix4(m),
  };
}
