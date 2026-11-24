// THE GREAT PYRAMID — one open desert arena.
//
// A single map on one floor (y = 0), built around a hollow great pyramid you
// can walk straight through (doorways north and south, a columned hall
// inside) and climb (a stair up the east and west faces to a ledge 6 m up).
// Around it: two smaller walk-in pyramids, a roofed temple, the sphinx,
// obelisks along the processional way, an oasis, a market, ruins and dunes,
// all inside a ring of cliffs.
//
// There is nothing to open, pull or trigger: every space is reachable on foot
// from the first frame, so waves path cleanly and an online match is the same
// map for every player.
//
// Everything visible is merged per (ink, fill, side) like the district builder,
// so the whole arena costs a handful of draw calls. Only structural geometry
// joins the collider list; glyphs, masonry dressing and sand ripples are
// decoration and stay out of the physics loop.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { INK, makeInkMaterial, type Collider, type InkId } from "./world";

/** The paper the ink sits on: sun-bleached parchment and a warm sky. */
export type Mood = {
  paper: [number, number, number];
  background: number;
};

export type PyramidMap = {
  title: string;
  sub: string;
  group: THREE.Group;
  colliders: Collider[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  floorY: number;
  spawnPoints: THREE.Vector3[];
  start: THREE.Vector3;
  startYaw: number;
  mood: Mood;
  /** torch flicker */
  update: (t: number) => void;
};

export const PYRAMID_START = new THREE.Vector3(0, 0.2, 48);

/* ============================== builder ============================== */

type Bucket = { ink: InkId; fill: boolean; side: THREE.Side; geos: THREE.BufferGeometry[] };

/** Geometry, colliders and spawn pads for the arena; every height is above the floor at y = 0. */
class Site {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly spawns: THREE.Vector3[] = [];
  private buckets = new Map<string, Bucket>();

  addGeo(geo: THREE.BufferGeometry, ink: InkId, fill = false, side: THREE.Side = THREE.FrontSide) {
    const key = `${ink}|${fill ? 1 : 0}|${side}`;
    const found = this.buckets.get(key);
    if (found) found.geos.push(geo);
    else this.buckets.set(key, { ink, fill, side, geos: [geo] });
  }

  /** one collider box: centre x/z, bottom y, size */
  collide(cx: number, y: number, cz: number, w: number, h: number, d: number) {
    this.colliders.push({
      minX: cx - w / 2,
      maxX: cx + w / 2,
      minY: y,
      maxY: y + h,
      minZ: cz - d / 2,
      maxZ: cz + d / 2,
    });
  }

  /** a box whose bottom face sits at height `y` */
  box(cx: number, y: number, cz: number, w: number, h: number, d: number, ink: InkId, fill = false, collide = true) {
    const ww = Math.max(0.01, w);
    const hh = Math.max(0.01, h);
    const dd = Math.max(0.01, d);
    const geo = new THREE.BoxGeometry(ww, hh, dd);
    geo.translate(cx, y + hh / 2, cz);
    this.addGeo(geo, ink, fill);
    if (collide) this.collide(cx, y, cz, ww, hh, dd);
  }

  /** a floor/roof plate between two corners with its top at `yTop` */
  slab(x1: number, z1: number, x2: number, z2: number, yTop: number, thick: number, ink: InkId, collide = true) {
    this.box(
      (x1 + x2) / 2,
      yTop - thick,
      (z1 + z2) / 2,
      Math.abs(x2 - x1),
      thick,
      Math.abs(z2 - z1),
      ink,
      false,
      collide,
    );
  }

  /** wall along X at a constant z, minus door holes ([a, b, y0, y1] along the run) */
  wallX(
    x0: number,
    x1: number,
    z: number,
    y0: number,
    h: number,
    t: number,
    holes: [number, number, number?, number?][] = [],
    ink: InkId = INK.STONE,
  ) {
    this.wallRun("x", x0, x1, z, y0, h, t, holes, ink);
  }

  /** wall along Z at a constant x */
  wallZ(
    z0: number,
    z1: number,
    x: number,
    y0: number,
    h: number,
    t: number,
    holes: [number, number, number?, number?][] = [],
    ink: InkId = INK.STONE,
  ) {
    this.wallRun("z", z0, z1, x, y0, h, t, holes, ink);
  }

  private wallRun(
    axis: "x" | "z",
    a0: number,
    a1: number,
    fixed: number,
    y0: number,
    h: number,
    t: number,
    holes: [number, number, number?, number?][],
    ink: InkId,
  ) {
    // split the run at every hole edge, then cut each slice into solid spans
    const cuts = new Set<number>([a0, a1]);
    for (const hl of holes) {
      cuts.add(Math.min(Math.max(hl[0], a0), a1));
      cuts.add(Math.min(Math.max(hl[1], a0), a1));
    }
    const xs = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i];
      const b = xs[i + 1];
      if (b - a < 0.01) continue;
      const mid = (a + b) / 2;
      const cover: [number, number][] = [];
      for (const hl of holes) if (hl[0] <= mid && hl[1] >= mid) cover.push([hl[2] ?? 0, hl[3] ?? h]);
      cover.sort((p, q) => p[0] - q[0]);
      let top = 0;
      const pieces: [number, number][] = [];
      for (const [s0, s1] of cover) {
        if (s0 > top + 0.01) pieces.push([top, s0]);
        top = Math.max(top, s1);
      }
      if (top < h - 0.01) pieces.push([top, h]);
      for (const [ya, yb] of pieces) {
        if (yb - ya < 0.01) continue;
        if (axis === "x") this.box(mid, y0 + ya, fixed, b - a, yb - ya, t, ink);
        else this.box(fixed, y0 + ya, mid, t, yb - ya, b - a, ink);
      }
    }
  }

  /** a straight flight; each step is a solid box from `y0` up to its tread */
  stairs(
    x: number,
    y0: number,
    z: number,
    dir: "+x" | "-x" | "+z" | "-z",
    steps: number,
    width: number,
    rise: number,
    run: number,
    ink: InkId = INK.OCHRE,
  ) {
    const dx = dir === "+x" ? 1 : dir === "-x" ? -1 : 0;
    const dz = dir === "+z" ? 1 : dir === "-z" ? -1 : 0;
    for (let i = 0; i < steps; i++) {
      const j = (i + 0.5) * run;
      this.box(x + dx * j, y0, z + dz * j, dx ? run + 0.004 : width, (i + 1) * rise, dz ? run + 0.004 : width, ink);
    }
  }

  cyl(x: number, y: number, z: number, r: number, h: number, ink: InkId, fill = false, collide = true, seg = 12) {
    const geo = new THREE.CylinderGeometry(r, r, Math.max(0.01, h), seg);
    geo.translate(x, y + h / 2, z);
    this.addGeo(geo, ink, fill);
    if (collide) this.collide(x, y, z, r * 1.64, h, r * 1.64);
  }

  taper(
    x: number,
    y: number,
    z: number,
    rBottom: number,
    rTop: number,
    h: number,
    ink: InkId,
    seg = 4,
    fill = false,
    collide = true,
  ) {
    const geo = new THREE.CylinderGeometry(rTop, rBottom, Math.max(0.01, h), seg);
    geo.translate(x, y + h / 2, z);
    this.addGeo(geo, ink, fill);
    if (collide) {
      const half = Math.max(rBottom, rTop) * 0.72;
      this.collide(x, y, z, half * 2, h, half * 2);
    }
  }

  sphere(x: number, y: number, z: number, r: number, ink: InkId, fill = false, sy = 1, seg = 10) {
    const geo = new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.7)));
    geo.scale(1, sy, 1);
    geo.translate(x, y, z);
    this.addGeo(geo, ink, fill);
  }

  /**
   * A half-buried dune you can climb over: the smooth mound is the drawing,
   * the physics is a short flight of steps hidden inside it.
   */
  dune(x: number, z: number, r: number, height: number) {
    const geo = new THREE.SphereGeometry(r, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    geo.scale(1, height / r, 0.78);
    geo.translate(x, 0, z);
    this.addGeo(geo, INK.SAND);
    const steps = Math.max(3, Math.ceil(height / 0.48));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const f = Math.sqrt(Math.max(0, 1 - t * t));
      this.collide(x, 0, z, 2 * r * f, height * t, 2 * r * f * 0.78);
    }
  }

  /** a flat disc lying on the floor */
  disc(x: number, y: number, z: number, r: number, ink: InkId, fill = true, seg = 20) {
    const geo = new THREE.CircleGeometry(r, seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate(x, y, z);
    this.addGeo(geo, ink, fill);
  }

  ring(x: number, y: number, z: number, r: number, tube: number, ink: InkId, fill = true) {
    const geo = new THREE.TorusGeometry(r, tube, 5, 18);
    geo.rotateX(Math.PI / 2);
    geo.translate(x, y, z);
    this.addGeo(geo, ink, fill);
  }

  /**
   * A band of hieroglyphs on a wall face (decoration only). `x`/`z` put the
   * band's middle on the face plane; `face` is the way that face looks (+1 or
   * -1 along the axis across the run), so the marks stand proud of the panel
   * toward the viewer.
   */
  glyphs(x: number, y: number, z: number, along: "x" | "z", width: number, height: number, rows: number, face: 1 | -1) {
    const cols = Math.max(3, Math.floor(width / 0.7));
    const border = 0.16;
    const panel = face * 0.025;
    const mark = face * 0.06;
    if (along === "x")
      this.box(x, y, z + panel, width + border * 2, height + border * 2, 0.05, INK.OCHRE, false, false);
    else this.box(x + panel, y, z, 0.05, height + border * 2, width + border * 2, INK.OCHRE, false, false);
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < cols; i++) {
        const f = hash01(i, r, along === "x" ? 1 : 2);
        const cell = width / cols;
        const along0 = -width / 2 + cell * (i + 0.5);
        const gy = y + border + ((height - border * 2) / rows) * (r + 0.5);
        const gw = cell * (0.28 + f * 0.36);
        const gh = ((height - border * 2) / rows) * (0.24 + f * 0.4);
        const ink = f > 0.72 ? INK.TURQ : INK.STONE;
        if (along === "x") {
          this.box(x + along0, gy - gh / 2, z + mark, gw, gh, 0.04, ink, false, false);
          if (f > 0.4)
            this.box(x + along0, gy + gh * 0.35, z + mark, cell * 0.55, 0.035, 0.035, INK.GOLD, false, false);
        } else {
          this.box(x + mark, gy - gh / 2, z + along0, 0.04, gh, gw, ink, false, false);
          if (f > 0.4)
            this.box(x + mark, gy + gh * 0.35, z + along0, 0.035, 0.035, cell * 0.55, INK.GOLD, false, false);
        }
      }
    }
  }

  flush() {
    for (const { ink, fill, side, geos } of this.buckets.values()) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, makeInkMaterial(ink, fill, side));
      mesh.frustumCulled = false;
      this.group.add(mesh);
      if (merged !== geos[0]) for (const g of geos) g.dispose();
    }
    this.buckets.clear();
  }
}

/**
 * A cheap deterministic hash in [0, 1). Weathering must come out identical on
 * every load, so a screenshot still matches the map a moment later.
 */
function hash01(a: number, b = 0, c = 0): number {
  const s = Math.sin(a * 41.913 + b * 78.233 + c * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/* ============================== props ============================== */

type Flame = { flame: THREE.Mesh; glow: THREE.Mesh; phase: number };

function torch(b: Site, x: number, y: number, z: number, flames: Flame[]) {
  b.box(x, y, z, 0.2, 0.2, 0.2, INK.STONE, false, false);
  b.cyl(x, y, z, 0.1, 0.7, INK.OCHRE, true, false, 6);
  b.cyl(x, y + 0.66, z, 0.24, 0.16, INK.GOLD, true, false, 8);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), makeInkMaterial(INK.GOLD, true));
  flame.position.set(x, y + 1.0, z);
  flame.scale.set(0.8, 1.5, 0.8);
  b.group.add(flame);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), makeInkMaterial(INK.ORANGE, true));
  glow.position.set(x, y + 1.0, z);
  glow.scale.set(1, 1.2, 1);
  b.group.add(glow);
  flames.push({ flame, glow, phase: x * 0.7 + z * 0.3 });
}

function anubis(b: Site, x: number, z: number, s = 1) {
  b.box(x, 0, z, 2.2 * s, 0.5 * s, 2.2 * s, INK.STONE, false, false);
  b.box(x, 0.5 * s, z, 1.5 * s, 2.3 * s, 1.05 * s, INK.BLACK, false, false);
  b.box(x, 0.62 * s, z, 1.56 * s, 0.45 * s, 1.1 * s, INK.GOLD, true, false);
  b.box(x, 2.15 * s, z, 1.4 * s, 0.34 * s, 1.0 * s, INK.TURQ, true, false);
  b.box(x, 1.6 * s, z + 0.58 * s, 1.5 * s, 0.2 * s, 0.2 * s, INK.GOLD, true, false);
  b.box(x, 1.85 * s, z + 0.6 * s, 1.15 * s, 0.2 * s, 0.2 * s, INK.GOLD, true, false);
  b.box(x + 1.03 * s, 0.5 * s, z + 0.6 * s, 0.11 * s, 3.5 * s, 0.11 * s, INK.GOLD, false, false);
  // jackal head: skull, long snout, tall ears
  b.box(x, 2.6 * s, z + 0.05 * s, 0.72 * s, 0.78 * s, 0.72 * s, INK.BLACK, false, false);
  b.box(x, 2.7 * s, z + 0.57 * s, 0.32 * s, 0.3 * s, 0.62 * s, INK.BLACK, false, false);
  b.box(x - 0.27 * s, 3.3 * s, z - 0.02 * s, 0.17 * s, 0.8 * s, 0.18 * s, INK.BLACK, false, false);
  b.box(x + 0.27 * s, 3.3 * s, z - 0.02 * s, 0.17 * s, 0.8 * s, 0.18 * s, INK.BLACK, false, false);
  b.box(x - 0.18 * s, 2.9 * s, z + 0.42 * s, 0.12 * s, 0.09 * s, 0.04 * s, INK.GOLD, true, false);
  b.box(x + 0.18 * s, 2.9 * s, z + 0.42 * s, 0.12 * s, 0.09 * s, 0.04 * s, INK.GOLD, true, false);
  b.collide(x, 0, z, 2.2 * s, 3.6 * s, 2.2 * s);
}

/** The arena's guardian, authored facing local +z and turned as one assembly by `yaw`. */
function sphinx(b: Site, x: number, z: number, yaw = Math.PI) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const wx = (lx: number, lz: number) => x + lx * c + lz * s;
  const wz = (lx: number, lz: number) => z - lx * s + lz * c;
  const part = (
    lx: number,
    y: number,
    lz: number,
    w: number,
    h: number,
    d: number,
    ink: InkId,
    fill = false,
    solid = false,
  ) => b.box(wx(lx, lz), y, wz(lx, lz), w, h, d, ink, fill, solid);
  const ball = (lx: number, y: number, lz: number, r: number, ink: InkId, squash = 1) =>
    b.sphere(wx(lx, lz), y, wz(lx, lz), r, ink, false, squash, 10);

  // stepped plinth
  part(0, 0, 0, 15.5, 0.5, 12.6, INK.STONE, false, true);
  part(0, 0.5, 0, 14.2, 0.34, 11.4, INK.OCHRE, false, true);
  part(0, 0.84, -0.2, 12.6, 0.2, 10.2, INK.SAND, false, true);
  // lion body: a long rear mass, a lifted chest and a stepped spine
  part(0, 1.04, -1.5, 8.8, 2.15, 3.9, INK.SAND, false, true);
  part(0, 3.19, -1.8, 7.1, 0.5, 2.9, INK.SAND, false, true);
  part(0, 1.04, 1.25, 5.6, 3.3, 3.4, INK.OCHRE, false, true);
  part(0, 4.34, 1.05, 5.2, 0.45, 3.0, INK.SAND, false, true);
  ball(-3.0, 1.75, -1.9, 1.75, INK.SAND, 0.85);
  ball(3.0, 1.75, -1.9, 1.75, INK.SAND, 0.85);
  // carved rear stair: 0.54 m risers, inside the 0.55 m step allowance
  const RISE = 0.54;
  for (let i = 0; i < 3; i++) {
    const top = 1.04 + RISE * (i + 1);
    const rear = -5.02 + i * 0.5;
    part(-0.4, 1.04, rear + 0.25, 3.2, top - 1.04, 0.5, i === 1 ? INK.OCHRE : INK.SAND, false, true);
  }
  // forelegs stretched toward the approach
  for (const side of [-1, 1] as const) {
    part(side * 1.9, 1.04, 2.4, 1.45, 1.25, 4.9, INK.SAND, false, true);
    part(side * 1.9, 1.04, 4.5, 1.7, 0.72, 1.9, INK.OCHRE, false, true);
    for (let t = 0; t < 3; t++) part(side * (1.45 + t * 0.45), 1.04, 5.36, 0.34, 0.42, 0.42, INK.BONE);
  }
  // tail along the right flank
  part(4.1, 1.6, -1.8, 0.55, 0.55, 3.2, INK.OCHRE);
  part(3.6, 1.3, -3.3, 1.5, 0.55, 0.55, INK.OCHRE);
  // head and nemes headdress with gold stripes
  part(0, 4.35, 2.0, 2.6, 2.55, 2.4, INK.OCHRE, false, true);
  part(0, 4.3, 3.05, 1.95, 2.35, 0.55, INK.SAND);
  part(-1.5, 4.2, 1.9, 0.62, 2.8, 2.6, INK.SAND);
  part(1.5, 4.2, 1.9, 0.62, 2.8, 2.6, INK.SAND);
  for (let i = 0; i < 4; i++) {
    part(-1.5, 4.55 + i * 0.62, 3.12, 0.64, 0.16, 0.1, INK.GOLD, true);
    part(1.5, 4.55 + i * 0.62, 3.12, 0.64, 0.16, 0.1, INK.GOLD, true);
  }
  part(0, 4.75, 3.28, 1.55, 0.3, 0.18, INK.TURQ, true);
  part(-0.45, 5.35, 3.3, 0.3, 0.1, 0.05, INK.GOLD, true);
  part(0.45, 5.35, 3.3, 0.3, 0.1, 0.05, INK.GOLD, true);
  part(0, 4.9, 3.4, 0.75, 0.3, 0.12, INK.BONE);
  part(0, 4.45, 3.4, 0.35, 0.3, 0.1, INK.STONE);
  part(0, 3.95, 3.32, 0.3, 0.7, 0.14, INK.TURQ, true);
  // collar across the chest
  part(0, 3.55, 2.9, 4.8, 0.24, 0.4, INK.GOLD);
  part(0, 3.3, 2.92, 4.0, 0.18, 0.34, INK.TURQ);
}

function obelisk(b: Site, x: number, z: number) {
  b.box(x, 0, z, 2.7, 0.55, 2.7, INK.STONE);
  b.box(x, 0.55, z, 2.15, 0.32, 2.15, INK.OCHRE, false, false);
  const half0 = 0.86;
  const half1 = 0.52;
  const shaft = 9.4;
  const shaftGeo = new THREE.CylinderGeometry(half1 * Math.SQRT2, half0 * Math.SQRT2, shaft, 4);
  shaftGeo.rotateY(Math.PI / 4);
  shaftGeo.translate(x, 0.87 + shaft / 2, z);
  b.addGeo(shaftGeo, INK.SAND);
  for (const [by, f] of [
    [2.5, 0.79],
    [4.9, 0.72],
    [7.2, 0.65],
  ] as const) {
    const band = new THREE.CylinderGeometry((f + 0.02) * Math.SQRT2, (f + 0.045) * Math.SQRT2, 0.17, 4);
    band.rotateY(Math.PI / 4);
    band.translate(x, by, z);
    b.addGeo(band, INK.GOLD);
  }
  const cap = new THREE.CylinderGeometry(0, half1 * Math.SQRT2, 1.15, 4);
  cap.rotateY(Math.PI / 4);
  cap.translate(x, 0.87 + shaft + 0.56, z);
  b.addGeo(cap, INK.GOLD);
  for (let i = 0; i < 3; i++) {
    const py = 1.7 + i * 2.2;
    const f = half0 + (half1 - half0) * ((py - 0.87) / shaft);
    b.box(x, py, z + f + 0.015, 0.62, 1.1, 0.05, INK.STONE, false, false);
    b.box(x + f + 0.015, py + 0.3, z, 0.05, 0.8, 0.52, INK.OCHRE, false, false);
  }
  b.collide(x, 0, z, 1.9, 10.8, 1.9);
}

/** One continuous palm frond: a tapered, folded ribbon swept along a curve. */
function palmFrond(
  b: Site,
  cx: number,
  cy: number,
  cz: number,
  angle: number,
  len: number,
  lift: number,
  droop: number,
  ink: InkId,
) {
  const segs = 8;
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);
  const sideX = -dirZ;
  const sideZ = dirX;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    const rho = len * t;
    const px = cx + dirX * rho;
    const pz = cz + dirZ * rho;
    const py = cy + lift * len * Math.sin(Math.PI * Math.min(1, t * 0.78)) - droop * len * t * t;
    const w = (0.24 + 0.2 * Math.sin(Math.PI * t)) * (1 - 0.52 * t);
    const th = 0.035 * (1 - 0.45 * t);
    pos.push(
      px - sideX * w,
      py,
      pz - sideZ * w,
      px,
      py + th,
      pz,
      px + sideX * w,
      py,
      pz + sideZ * w,
      px,
      py - th * 0.65,
      pz,
    );
  }
  for (let k = 0; k < segs; k++) {
    const a = k * 4;
    const c = (k + 1) * 4;
    for (let e = 0; e < 4; e++) {
      const n = (e + 1) % 4;
      idx.push(a + e, a + n, c + e, a + n, c + n, c + e);
    }
  }
  const base = pos.length / 3;
  pos.push(cx, cy, cz);
  const tip = pos.length / 3;
  pos.push(cx + dirX * len, cy + lift * len * Math.sin(Math.PI * 0.78) - droop * len, cz + dirZ * len);
  const last = segs * 4;
  for (let e = 0; e < 4; e++) {
    const n = (e + 1) % 4;
    idx.push(base, e, n);
    idx.push(tip, last + n, last + e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(((segs + 1) * 4 + 2) * 2).fill(0), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  b.addGeo(geo, ink, false, THREE.DoubleSide);
}

function palm(b: Site, x: number, z: number, h = 5.4) {
  const leanX = 0.25 + hash01(x, z) * 0.5;
  const leanZ = (hash01(z, x) - 0.5) * 0.55;
  const rings = 9;
  const radial = 8;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const cx = x + leanX * Math.pow(t, 1.7);
    const cz = z + leanZ * Math.pow(t, 1.7);
    const r = 0.36 * (1 - 0.46 * t) + 0.012 * Math.sin(t * 14 + x);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(cx + Math.cos(a) * r, h * t, cz + Math.sin(a) * r);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const c = i * radial + ((j + 1) % radial);
      const d = (i + 1) * radial + j;
      const e = (i + 1) * radial + ((j + 1) % radial);
      idx.push(a, d, c, d, e, c);
    }
  }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  trunk.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((rings + 1) * radial * 2).fill(0), 2));
  trunk.setIndex(idx);
  trunk.computeVertexNormals();
  b.addGeo(trunk, INK.OCHRE, false, THREE.DoubleSide);

  const crownX = x + leanX;
  const crownZ = z + leanZ;
  const crownY = h + 0.06;
  const seed = hash01(x, z, 3);
  b.sphere(crownX, h + 0.02, crownZ, 0.34, INK.OCHRE, false, 0.65, 8);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + seed * 1.9;
    const len = 2.45 + hash01(i * 3.1, x, z) * 1.15 + (i % 3) * 0.12;
    const lift = 0.2 + hash01(i, z, x) * 0.13;
    const droop = 0.48 + hash01(i * 5.3, x, 4.2) * 0.28;
    palmFrond(b, crownX, crownY, crownZ, a, len, lift, droop, i % 7 === 4 ? INK.OCHRE : INK.GREEN);
  }
  for (let i = 0; i < 2; i++)
    palmFrond(b, crownX, crownY - 0.12, crownZ, 0.8 + i * 2.6 + seed * 0.7, 1.8 + i * 0.35, 0.05, 1.05, INK.OCHRE);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.sphere(
      crownX + Math.cos(a) * 0.3,
      h - 0.32 - (i % 2) * 0.12,
      crownZ + Math.sin(a) * 0.3,
      0.12,
      INK.GOLD,
      false,
      0.9,
      6,
    );
  }
  b.collide(x, 0, z, 0.62, h, 0.62);
}

function cactus(b: Site, x: number, z: number) {
  b.cyl(x, 0, z, 0.26, 1.9, INK.GREEN, true, true, 7);
  b.cyl(x - 0.42, 0.7, z, 0.16, 0.8, INK.GREEN, true, false, 6);
  b.cyl(x + 0.38, 1.0, z, 0.15, 0.7, INK.GREEN, true, false, 6);
  b.sphere(x, 1.95, z, 0.28, INK.GREEN, true, 0.6, 6);
}

function crate(b: Site, x: number, z: number, s = 1) {
  b.box(x, 0, z, 1.2 * s, 1.05 * s, 1.2 * s, INK.OCHRE);
  for (const [y, w] of [
    [0.08, 1.32],
    [0.52, 1.27],
    [0.96, 1.24],
  ] as const)
    b.box(x, y * s, z, w * s, 0.11 * s, w * s, INK.STONE, false, false);
  b.box(x, 1.05 * s, z, 0.16 * s, 0.06 * s, 1.26 * s, INK.SAND, false, false);
}

function tent(b: Site, x: number, z: number, ink: InkId) {
  for (const [dx, dz] of [
    [-1.6, -1.6],
    [1.6, -1.6],
    [-1.6, 1.6],
    [1.6, 1.6],
  ] as const)
    b.box(x + dx, 0, z + dz, 0.12, 2.5, 0.12, INK.OCHRE, false, true);
  b.taper(x, 2.4, z, 2.5, 0.06, 1.5, ink, 4, false, false);
  b.box(x, 1.4, z, 3.8, 0.12, 3.8, ink, true, false);
  b.box(x + 0.6, 0, z + 0.3, 1.2, 0.9, 1.0, INK.OCHRE);
  b.box(x - 0.4, 0, z + 1.1, 1.0, 1.0, 0.9, INK.SAND);
}

/** a sealed stone coffin: solid cover in the middle of a chamber */
function sarcophagus(b: Site, x: number, z: number, s = 1) {
  b.box(x, 0, z, 1.15 * s, 0.34 * s, 2.8 * s, INK.STONE);
  b.box(x, 0.34 * s, z, 0.96 * s, 0.62 * s, 2.55 * s, INK.OCHRE);
  for (let i = 0; i < 4; i++) {
    b.box(x - 0.5 * s, 0.4 * s, z - 1.0 * s + i * 0.6 * s, 0.04 * s, 0.5 * s, 0.24 * s, INK.GOLD, true, false);
    b.box(x + 0.5 * s, 0.4 * s, z - 1.0 * s + i * 0.6 * s, 0.04 * s, 0.5 * s, 0.24 * s, INK.GOLD, true, false);
  }
  b.box(x, 0.96 * s, z, 1.1 * s, 0.24 * s, 2.9 * s, INK.SAND);
  b.box(x, 1.2 * s, z + 0.92 * s, 0.62 * s, 0.3 * s, 0.66 * s, INK.GOLD, true, false);
  b.box(x, 1.08 * s, z + 0.95 * s, 1.16 * s, 0.16 * s, 1.1 * s, INK.TURQ, true, false);
}

function treasurePile(b: Site, x: number, z: number, n = 5) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.35 + (i % 3) * 0.22;
    b.sphere(
      x + Math.cos(a) * r,
      0.12,
      z + Math.sin(a) * r,
      0.22 + (i % 2) * 0.1,
      i % 3 === 0 ? INK.TURQ : INK.GOLD,
      true,
      0.55,
      6,
    );
  }
  b.sphere(x, 0.16, z, 0.42, INK.GOLD, true, 0.4, 7);
}

/** a scatter of broken masonry: decoration only, it never blocks a step */
function rubble(b: Site, x: number, z: number, n: number, spread: number) {
  const count = Math.max(2, Math.round(n * 0.7));
  for (let i = 0; i < count; i++) {
    const f = hash01(x + i * 1.9, z + i * 4.3, i);
    const a = f * Math.PI * 2;
    const r = (0.2 + hash01(i, x, z) * 0.8) * spread;
    const w = 0.22 + f * 0.7;
    const h = 0.12 + f * 0.32;
    const d = 0.26 + hash01(i * 2, z, x) * 0.7;
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(f * 1.6);
    g.translate(x + Math.cos(a) * r, h / 2 + 0.01, z + Math.sin(a) * r);
    b.addGeo(g, i % 3 === 0 ? INK.STONE : i % 3 === 1 ? INK.OCHRE : INK.SAND);
  }
}

/** a fallen column drum, half sunk in the sand */
function columnDrum(b: Site, x: number, z: number, r = 0.55, len = 1.6) {
  const g = new THREE.CylinderGeometry(r, r, len, 12);
  g.rotateZ(Math.PI / 2);
  g.rotateY(hash01(x, z) * 1.2);
  g.translate(x, r * 0.82, z);
  b.addGeo(g, INK.OCHRE);
  b.collide(x, 0, z, len * 0.9, r * 1.65, r * 1.65);
}

/** a broken shrine: podium, a half wall and two surviving columns */
function ruin(b: Site, x: number, z: number) {
  b.box(x, 0, z, 6.2, 0.32, 6.2, INK.STONE);
  b.box(x, 0.32, z, 5.6, 0.16, 5.6, INK.OCHRE, false, false);
  b.wallX(x - 2.6, x + 2.6, z - 2.6, 0.32, 2.4, 0.5, [[x - 0.9, x + 1.4, 0, 1.8]], INK.SAND);
  b.wallZ(z - 2.6, z + 1.1, x - 2.6, 0.32, 1.6, 0.5, [], INK.SAND);
  for (const [px, pz, ph] of [
    [x + 1.9, z + 1.9, 2.6],
    [x - 1.8, z + 1.7, 1.5],
  ] as const) {
    b.cyl(px, 0.32, pz, 0.42, ph, INK.SAND, false, true, 9);
    b.box(px, 0.32 + ph, pz, 1.0, 0.24, 1.0, INK.OCHRE, false, false);
    b.box(px, 0.32, pz, 1.1, 0.22, 1.1, INK.OCHRE, false, false);
  }
  b.box(x + 2.4, 0.32, z + 0.2, 0.9, 1.7, 2.2, INK.SAND);
  b.box(x - 1.7, 0.32, z - 2.1, 2.4, 0.8, 1.0, INK.OCHRE);
  b.glyphs(x, 0.4, z - 2.35, "x", 2.6, 1.1, 2, 1);
  rubble(b, x + 0.4, z + 0.4, 4, 2.7);
}

/** two tents, crates, a stall and rugs: low cover with a bit of colour */
function market(b: Site, x: number, z: number) {
  tent(b, x, z, INK.RED);
  tent(b, x + 7, z - 3, INK.OCHRE);
  crate(b, x - 6.2, z + 3.1);
  crate(b, x - 5.1, z + 4.2, 0.78);
  b.box(x + 3.5, 0, z + 2.4, 3.4, 0.8, 1.2, INK.OCHRE);
  b.box(x + 3.5, 0.8, z + 2.4, 1.2, 0.5, 1.1, INK.TURQ, true, false);
  b.box(x - 4.4, 0, z + 1.2, 1.4, 1.4, 1.4, INK.ORANGE);
  b.box(x - 3.1, 0, z + 1.6, 1.0, 1.0, 1.0, INK.SAND);
  b.box(x + 1.1, 0.02, z + 0.2, 3.4, 0.035, 2.3, INK.TURQ, false, false);
  for (let i = 0; i < 4; i++)
    b.box(x + 1.1, 0.025, z - 0.7 + i * 0.6, 3.2, 0.045, 0.14, i % 2 ? INK.GOLD : INK.RED, false, false);
  for (const [jx, jz, s] of [
    [x - 2.4, z + 1.9, 1],
    [x - 1.8, z + 2.5, 0.8],
    [x - 3.0, z + 2.3, 0.85],
  ] as const) {
    b.cyl(jx, 0, jz, 0.3 * s, 0.6 * s, INK.OCHRE, false, false, 8);
    b.sphere(jx, 0.64 * s, jz, 0.29 * s, INK.OCHRE, false, 1.4, 8);
  }
  rubble(b, x - 1.6, z + 4.2, 4, 1.4);
}

/** an expedition camp: crates, bedroll, fire ring and a lean-to */
function camp(b: Site, x: number, z: number) {
  crate(b, x + 1.6, z + 3.2, 0.95);
  crate(b, x + 2.9, z + 3.9, 0.7);
  b.box(x, 0.01, z, 3.4, 0.05, 2.2, INK.RED, false, false);
  b.box(x - 1.4, 0.06, z - 0.3, 0.6, 0.16, 1.5, INK.BONE, false, false);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.box(x + 3.2 + Math.cos(a) * 0.7, 0, z + Math.sin(a) * 0.7, 0.24, 0.24, 0.24, INK.STONE, false, false);
  }
  b.sphere(x + 3.2, 0.12, z, 0.5, INK.ORANGE, true, 0.7, 7);
  b.box(x - 2.2, 0, z + 1.2, 2.2, 0.72, 1.1, INK.OCHRE);
  b.box(x - 2.2, 0.72, z + 1.2, 2.4, 0.08, 1.25, INK.SAND, false, false);
  b.box(x + 2.5, 1.4, z + 4.9, 3.4, 0.12, 2.0, INK.RED, false, false);
  for (const [px, pz] of [
    [x + 1.0, z + 5.9],
    [x + 4.0, z + 5.9],
    [x + 1.0, z + 4.0],
    [x + 4.0, z + 4.0],
  ] as const)
    b.box(px, 0, pz, 0.12, 1.46, 0.12, INK.OCHRE, false, true);
  rubble(b, x + 0.6, z - 2.2, 5, 1.8);
}

/** a capped well: a coffer of stones, two posts and a bucket */
function well(b: Site, x: number, z: number) {
  b.cyl(x, 0, z, 1.05, 0.72, INK.STONE, false, false, 12);
  b.ring(x, 0.74, z, 0.9, 0.11, INK.OCHRE, false);
  b.disc(x, 0.75, z, 0.72, INK.BLACK, true, 14);
  for (const side of [-1, 1] as const) b.box(x + side * 0.85, 0, z, 0.14, 2.3, 0.14, INK.OCHRE, false, false);
  b.box(x, 2.25, z, 2.1, 0.14, 0.16, INK.STONE, false, false);
  b.box(x, 1.55, z, 0.38, 0.34, 0.38, INK.OCHRE, false, false);
  b.collide(x, 0, z, 2.2, 0.75, 2.2);
}

/** a distant pyramid: silhouette only, far outside the playable bounds */
function farPyramid(b: Site, cx: number, cz: number, baseHalf: number, tiers: number, tierH: number) {
  const step = baseHalf / Math.max(1, tiers);
  for (let i = 0; i < tiers; i++) {
    const half = baseHalf - i * step;
    b.box(cx, i * tierH, cz, half * 2, tierH, half * 2, i % 2 === 0 ? INK.SAND : INK.OCHRE, false, false);
  }
  const cap = new THREE.CylinderGeometry(0, step * 0.75, tierH * 0.85, 4);
  cap.rotateY(Math.PI / 4);
  cap.translate(cx, tiers * tierH + tierH * 0.4, cz);
  b.addGeo(cap, INK.GOLD);
}

/** a far cliff block, layered so the skyline is not a row of identical boxes */
function farRidge(b: Site, x: number, z: number, w: number, h: number, d: number) {
  b.box(x, 0, z, w, h * 0.55, d, INK.OCHRE, false, false);
  b.box(x + w * 0.08, h * 0.4, z - d * 0.04, w * 0.72, h * 0.42, d * 0.8, INK.SAND, false, false);
  const crown = new THREE.CylinderGeometry(w * 0.18, w * 0.42, h * 0.35, 5);
  crown.translate(x - w * 0.05, h * 0.86, z);
  b.addGeo(crown, INK.BONE);
}

/* ============================== pyramids ============================== */

type Face = { axis: "x" | "z"; sign: 1 | -1; plane: number; center: number; half: number };

/**
 * Dress one tier face with stone courses: warm ochre and golden sandstone with
 * a few pale and dark blocks, so the monument never reads as the sand around
 * it. `blocked` keeps a doorway clear. Decoration only.
 */
function dressMasonry(
  b: Site,
  face: Face,
  y: number,
  h: number,
  seed: number,
  blockW: number,
  rows: number,
  erosion: number,
  blocked?: (a0: number, a1: number, y1: number) => boolean,
) {
  const a0 = face.center - face.half + 0.58;
  const a1 = face.center + face.half - 0.58;
  if (a1 - a0 < 1.2) return;
  const gap = 0.055;
  const rowH = h / rows;
  for (let r = 0; r < rows; r++) {
    const by = y + r * rowH + 0.05;
    const bh = rowH - 0.1;
    let a = a0;
    let i = 0;
    while (a < a1 - 0.7) {
      const f = hash01(seed + r * 2.3, 0.5, a * 0.37);
      // running bond: every course after the first starts with a short block
      let w = r > 0 && i === 0 ? blockW * (0.3 + hash01(seed + r * 7.1, 1.7) * 0.5) : blockW * (0.62 + f * 0.95);
      if (a + w > a1) w = a1 - a;
      if (w < 0.7) break;
      const bb = Math.min(a1, a + w);
      const g = hash01(seed + 5.7, i + r * 13, bb * 0.21);
      const hInk = hash01(seed + 11.3, i + r * 7, a * 0.11);
      const nearCorner = a - a0 < 1.7 || a1 - bb < 1.7;
      const fallen = g > (nearCorner ? 1 - erosion : 0.985);
      const mid = (a + bb) / 2;
      if (!fallen && (!blocked || !blocked(a, bb, by + bh))) {
        const worn = g > 0.86 ? 0.1 + f * 0.22 : 0;
        const depth = 0.05 + hash01(seed + 9.1, i, a) * 0.055;
        const ink: InkId =
          hInk < 0.52
            ? INK.OCHRE
            : hInk < 0.78
              ? INK.SAND
              : hInk < 0.88
                ? INK.GOLD
                : hInk < 0.97
                  ? INK.STONE
                  : INK.ORANGE;
        const top = Math.max(by + 0.18, by + bh - worn);
        const at = face.plane + face.sign * (0.005 + depth / 2);
        if (face.axis === "x") b.box(mid, by, at, bb - a - gap, top - by, depth, ink, false, false);
        else b.box(at, by, mid, depth, top - by, bb - a - gap, ink, false, false);
      } else if (fallen) {
        // a missing block leaves a shallow dark pocket, not a hole
        const at = face.plane + face.sign * 0.014;
        const pw = (bb - a - gap) * 0.84;
        const ph = Math.min(bh * 0.8, 1.1);
        if (face.axis === "x") b.box(mid, by + (bh - ph) * 0.5, at, pw, ph, 0.022, INK.STONE, false, false);
        else b.box(at, by + (bh - ph) * 0.5, mid, 0.022, ph, pw, INK.STONE, false, false);
      }
      a = bb + gap;
      i++;
    }
  }
}

/**
 * A carved portal around a doorway on a north (`sign` -1) or south (+1) face:
 * jambs, lintel, a winged sun disc on the tier above and a threshold stone.
 */
function doorFrame(
  b: Site,
  cx: number,
  plane: number,
  upperPlane: number,
  doorW: number,
  doorH: number,
  s: number,
  sign: 1 | -1,
) {
  const jw = 0.55 * s;
  const out = (k: number) => plane + sign * k;
  for (const side of [-1, 1] as const) {
    b.box(cx + side * (doorW / 2 + jw / 2 - 0.02), 0, out(0.22), jw, doorH, 0.6 * s, INK.STONE, false, false);
    b.box(
      cx + side * (doorW / 2 + jw + 0.2 * s),
      0,
      out(0.1),
      0.42 * s,
      doorH - 0.6 * s,
      0.26 * s,
      INK.OCHRE,
      false,
      false,
    );
  }
  b.box(cx, doorH + 0.02, out(0.24), doorW + jw * 2, 0.3 * s, 0.62 * s, INK.STONE, false, false);
  b.box(cx, doorH + 0.32 * s, out(0.24), doorW + jw * 2.2, 0.1 * s, 0.6 * s, INK.OCHRE, false, false);
  const panelBottom = doorH + 0.55 * s;
  const panelH = 1.05 * s;
  const up = (k: number) => upperPlane + sign * k;
  b.box(cx, panelBottom, up(0.32), doorW + 1.5 * s, panelH, 0.09, INK.STONE, false, false);
  b.box(cx, panelBottom + 0.09, up(0.39), doorW + 1.1 * s, panelH - 0.22, 0.07, INK.BONE, false, false);
  b.box(cx, panelBottom + panelH - 0.12, up(0.43), doorW + 1.2 * s, 0.09, 0.05, INK.TURQ, false, false);
  const disc = new THREE.CylinderGeometry(0.4 * s, 0.4 * s, 0.09, 16);
  disc.rotateX(Math.PI / 2);
  disc.translate(cx, panelBottom + panelH * 0.55, up(0.48));
  b.addGeo(disc, INK.GOLD, true);
  for (const side of [-1, 1] as const) {
    const wing = new THREE.BoxGeometry(1.3 * s, 0.15 * s, 0.08);
    wing.rotateZ(side * 0.2);
    wing.translate(cx + side * 1.25 * s, panelBottom + panelH * 0.55, up(0.46));
    b.addGeo(wing, INK.TURQ);
  }
  b.box(cx, 0, out(-0.56), doorW + 0.7 * s, 0.16, 0.86, INK.BONE, false, false);
}

type DoorSide = "north" | "south";

/**
 * A stepped pyramid whose tiers are hollow rings, so the inside is one tall
 * corbelled hall. `doors` cuts an open doorway into the ground tier of the
 * north and/or south face.
 */
function pyramid(
  b: Site,
  cx: number,
  cz: number,
  baseHalf: number,
  tiers: number,
  tierH: number,
  thick: number,
  doorW: number,
  doorH: number,
  doors: DoorSide[],
) {
  const step = (baseHalf - thick) / Math.max(1, tiers - 1);
  const blockW = Math.max(2.4, Math.min(4.2, baseHalf * 0.26));
  const rows = baseHalf > 14 ? 2 : 1;
  const erosion = baseHalf > 14 ? 0.22 : 0.14;
  const has = (d: DoorSide) => doors.includes(d);
  for (let i = 0; i < tiers; i++) {
    const half = baseHalf - i * step;
    const y = i * tierH;
    const runX = (zFace: number, door: boolean) => {
      if (!door) {
        b.box(cx, y, zFace, half * 2, tierH, thick, INK.OCHRE);
        return;
      }
      const side = (half * 2 - doorW) / 2;
      b.box(cx - half + side / 2, y, zFace, side, tierH, thick, INK.OCHRE);
      b.box(cx + half - side / 2, y, zFace, side, tierH, thick, INK.OCHRE);
      if (doorH < tierH) b.box(cx, y + doorH, zFace, doorW, tierH - doorH, thick, INK.OCHRE);
    };
    runX(cz + half - thick / 2, i === 0 && has("south"));
    runX(cz - half + thick / 2, i === 0 && has("north"));
    b.box(cx + half - thick / 2, y, cz, thick, tierH, half * 2, INK.OCHRE);
    b.box(cx - half + thick / 2, y, cz, thick, tierH, half * 2, INK.OCHRE);
    const faces: Face[] = [
      { axis: "x", sign: 1, plane: cz + half, center: cx, half },
      { axis: "x", sign: -1, plane: cz - half, center: cx, half },
      { axis: "z", sign: 1, plane: cx + half, center: cz, half },
      { axis: "z", sign: -1, plane: cx - half, center: cz, half },
    ];
    for (const face of faces) {
      const doorFace = i === 0 && face.axis === "x" && has(face.sign === 1 ? "south" : "north");
      const blocked = doorFace
        ? (a0: number, a1: number, y1: number) =>
            y1 < doorH + 0.35 && a1 > cx - doorW / 2 - 0.6 && a0 < cx + doorW / 2 + 0.6
        : undefined;
      dressMasonry(b, face, y, tierH, i * 3.7 + face.plane * 0.11 + face.sign, blockW, rows, erosion, blocked);
    }
  }
  // a stepped plinth with walkable steps all round
  const mid = baseHalf + 0.9;
  const outer = baseHalf + 1.8;
  const put = (x: number, z: number, w: number, d: number, h: number) => b.box(x, 0, z, w, h, d, INK.OCHRE);
  put(cx, cz + (mid + outer) / 2, outer * 2, outer - mid, 0.17);
  put(cx, cz - (mid + outer) / 2, outer * 2, outer - mid, 0.17);
  put(cx + (mid + outer) / 2, cz, outer - mid, mid * 2, 0.17);
  put(cx - (mid + outer) / 2, cz, outer - mid, mid * 2, 0.17);
  put(cx, cz + (baseHalf + mid) / 2, mid * 2, mid - baseHalf, 0.34);
  put(cx, cz - (baseHalf + mid) / 2, mid * 2, mid - baseHalf, 0.34);
  put(cx + (baseHalf + mid) / 2, cz, mid - baseHalf, baseHalf * 2, 0.34);
  put(cx - (baseHalf + mid) / 2, cz, mid - baseHalf, baseHalf * 2, 0.34);
  // capstone and a gold pyramidion
  const capY = tiers * tierH;
  b.box(cx, capY, cz, thick * 2, 0.4, thick * 2, INK.OCHRE);
  b.box(cx, capY + 0.4, cz, thick * 2 + 0.12, 0.16, thick * 2 + 0.12, INK.TURQ, false, false);
  const pyH = Math.max(1.5, thick * 0.9);
  const py = new THREE.CylinderGeometry(0, thick * 0.707 * 1.02, pyH, 4);
  py.rotateY(Math.PI / 4);
  py.translate(cx, capY + 0.56 + pyH / 2, cz);
  b.addGeo(py, INK.GOLD);
  const s = Math.max(0.7, doorW / 3.4);
  if (has("south")) doorFrame(b, cx, cz + baseHalf, cz + baseHalf - step, doorW, doorH, s, 1);
  if (has("north")) doorFrame(b, cx, cz - baseHalf, cz - baseHalf + step, doorW, doorH, s, -1);
  // the hall's floor
  const inner = baseHalf - thick;
  b.slab(cx - inner, cz - inner, cx + inner, cz + inner, 0.04, 0.1, INK.OCHRE, false);
  return { step };
}

/* ============================== terrain ============================== */

/** where each hollow pyramid sits, so the sand field stays below its floor */
const HOLLOWS: { x: number; z: number; inner: number }[] = [
  { x: 0, z: 0, inner: 15.4 },
  { x: -36, z: 28, inner: 7.2 },
  { x: 36, z: -26, inner: 7.2 },
];

const SWELLS: { x: number; z: number; rx: number; rz: number; h: number }[] = [
  { x: -46, z: 4, rx: 14, rz: 15, h: 0.36 },
  { x: 50, z: 8, rx: 15, rz: 16, h: 0.32 },
  { x: -10, z: -50, rx: 17, rz: 14, h: 0.4 },
  { x: 54, z: -48, rx: 14, rz: 15, h: 0.36 },
  { x: -54, z: -50, rx: 14, rz: 14, h: 0.34 },
  { x: -50, z: 52, rx: 12, rz: 12, h: 0.28 },
];

/** compacted ground where a rug, slab or the water must stay visible */
const FLATS: { x: number; z: number; r: number }[] = [
  { x: -28, z: 46, r: 5.2 }, // oasis
  { x: 14, z: 36, r: 8 }, // market
  { x: -16, z: 44, r: 5 }, // camp
  { x: -34, z: -32, r: 13 }, // temple platform
];

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** height of the visual sand field; the floor collider stays flat at y = 0 */
export function groundY(x: number, z: number): number {
  // a 13 cm base keeps every low point above the floor without a hard crease
  let h = 0.13;
  for (const s of SWELLS) {
    const dx = (x - s.x) / s.rx;
    const dz = (z - s.z) / s.rz;
    h += s.h * Math.exp(-(dx * dx + dz * dz) * 1.6);
  }
  // two shallow wind ridges
  h += 0.07 * Math.sin(x * 0.36 + 1.5 * Math.sin(z * 0.13) + 0.4);
  h += 0.045 * Math.sin(z * 0.52 + 1.1 * Math.sin(x * 0.17) + 1.7);
  for (const p of HOLLOWS) {
    const d = Math.max(Math.abs(x - p.x), Math.abs(z - p.z));
    const k = 1 - smoothstep(p.inner - 0.6, p.inner + 1.8, d);
    h = h * (1 - k) + 0.012 * k;
  }
  for (const f of FLATS) {
    const k = 1 - smoothstep(f.r, f.r + 3.5, Math.hypot(x - f.x, z - f.z));
    h = h * (1 - k) + 0.012 * k;
  }
  return h;
}

/** the sand field: one smoothly shaded mesh, no internal edges */
function sandField(b: Site) {
  const N = 72;
  const X0 = -62;
  const X1 = 62;
  const step = (X1 - X0) / N;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let iz = 0; iz <= N; iz++) {
    for (let ix = 0; ix <= N; ix++) {
      const x = X0 + ix * step;
      const z = X0 + iz * step;
      pos.push(x, groundY(x, z), z);
    }
  }
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const a = iz * (N + 1) + ix;
      idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  b.addGeo(geo, INK.SAND);
}

/** the compacted processional way, following the terrain, from the south edge to the great door */
function processionalWay(b: Site) {
  const rows = 40;
  const cols = 4;
  const z0 = 21.4;
  const z1 = 56;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const z = z0 + ((z1 - z0) * i) / rows;
    const cx = 0.62 * Math.sin((z - 20) * 0.17) + 0.35 * Math.sin((z - 20) * 0.07 + 1.2);
    const w = 6.2 + 0.45 * Math.sin(z * 0.28 + 0.4);
    for (let j = 0; j <= cols; j++) {
      const x = cx + (j / cols - 0.5) * w;
      pos.push(x, groundY(x, z) + 0.035, z);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j;
      idx.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((rows + 1) * (cols + 1) * 2).fill(0), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  b.addGeo(geo, INK.OCHRE);
}

/* ============================== the map ============================== */

export function buildPyramid(scene: THREE.Scene): PyramidMap {
  const b = new Site();
  const flames: Flame[] = [];

  // --- floor, sand and the way in ---
  b.box(0, -1, 0, 126, 1, 126, INK.SAND);
  sandField(b);
  processionalWay(b);

  // --- boundary cliffs: chunky, irregular and impassable ---
  for (let i = 0; i < 9; i++) {
    const t = -58 + i * 14.5;
    b.box(-62, 0, t, 6 + (i % 3) * 2, 9 + (i % 4) * 2.2, 15, INK.OCHRE);
    b.box(62, 0, t, 6 + ((i + 1) % 3) * 2, 8 + ((i + 2) % 4) * 2.4, 15, INK.SAND);
    b.box(t, 0, -62, 15, 8.5 + (i % 3) * 2.6, 6, INK.SAND);
    b.box(t, 0, 62, 15, 10 + ((i + 2) % 3) * 2.1, 6, INK.OCHRE);
  }
  for (const [x, z, r, h] of [
    [-50, 52, 3.2, 5],
    [50, 50, 4, 6.5],
    [52, -50, 3.6, 5.5],
    [-50, -52, 4.5, 7],
  ] as const)
    b.taper(x, 0, z, r, r * 0.55, h, INK.OCHRE, 6);

  // --- the horizon: sister pyramids and ridges, silhouette only ---
  farPyramid(b, -92, -118, 30, 8, 5.4);
  farPyramid(b, 86, -96, 21, 6, 4.8);
  farPyramid(b, -14, -164, 44, 9, 5.8);
  farPyramid(b, 110, 70, 26, 7, 5);
  farRidge(b, 88, -18, 42, 17, 26);
  farRidge(b, -92, 34, 38, 14, 30);
  farRidge(b, -38, -104, 52, 20, 20);
  farRidge(b, 44, -116, 46, 15, 22);
  farRidge(b, -70, 100, 40, 16, 24);

  // --- the great pyramid: walk through it, or climb it ---
  const GH = 18; // base half-width
  const great = pyramid(b, 0, 0, GH, 9, 3, 2.6, 3.4, 2.9, ["north", "south"]);
  // causeway steps up to both doors
  b.box(0, 0, 20.7, 9.2, 0.17, 1.1, INK.OCHRE);
  b.box(0, 0, -20.7, 9.2, 0.17, 1.1, INK.OCHRE);
  // the hall: a ring of columns around a sealed sarcophagus
  for (const [x, z] of [
    [-6.4, -6.4],
    [6.4, -6.4],
    [-6.4, 6.4],
    [6.4, 6.4],
    [-9.4, 0],
    [9.4, 0],
  ] as const) {
    b.cyl(x, 0, z, 0.85, 7.4, INK.SAND, false, true, 10);
    b.ring(x, 5.4, z, 0.9, 0.13, INK.GOLD);
    b.box(x, 7.2, z, 2.3, 0.4, 2.3, INK.OCHRE);
  }
  sarcophagus(b, 0, 0, 1.35);
  treasurePile(b, -3.4, 3.6, 5);
  treasurePile(b, 3.4, -3.6, 4);
  // glyph bands either side of each doorway and down the side walls
  const inner = GH - 2.6;
  for (const x of [-7, 7]) {
    b.glyphs(x, 0.7, inner, "x", 8, 1.8, 2, -1);
    b.glyphs(x, 0.7, -inner, "x", 8, 1.8, 2, 1);
  }
  b.glyphs(inner, 0.7, 0, "z", 12, 1.8, 2, -1);
  b.glyphs(-inner, 0.7, 0, "z", 12, 1.8, 2, 1);
  for (const [x, z] of [
    [-2.6, 13.6],
    [2.6, 13.6],
    [-2.6, -13.6],
    [2.6, -13.6],
  ] as const)
    torch(b, x, 0, z, flames);
  anubis(b, -4.2, 12.4, 0.72);
  anubis(b, 4.2, 12.4, 0.72);
  // Stairs up the east and west faces: one flight from the sand onto the
  // first terrace (3 m), then a second along that terrace up to the ledge
  // that runs right round the pyramid at 6 m — the arena's high ground.
  const ledge = GH - great.step; // inner edge of the first terrace
  const terraceX = (GH + ledge) / 2;
  for (const side of [-1, 1] as const) {
    b.stairs(side * (GH + 6 * 0.9), 0, 8, side === 1 ? "-x" : "+x", 6, 3.2, 0.5, 0.9, INK.SAND);
    b.stairs(side * terraceX, 3, 6.2, "-z", 6, GH - ledge - 0.04, 0.5, 0.75, INK.SAND);
  }
  rubble(b, 13.5, 21.2, 4, 2.0);
  rubble(b, -14.8, 21.6, 3, 1.8);
  rubble(b, -21.6, -3.5, 3, 1.9);
  rubble(b, 14.8, -21.4, 3, 1.7);

  // --- two smaller walk-in pyramids, doorways turned toward the middle ---
  const small = (cx: number, cz: number, door: DoorSide) => {
    pyramid(b, cx, cz, 9, 5, 2.2, 1.8, 2.4, 2.1, [door]);
    const face = door === "south" ? 1 : -1;
    b.glyphs(cx, 0.5, cz - face * 7.2, "x", 5, 1.1, 2, face);
    torch(b, cx - 3, 0.8, cz - face * 3, flames);
    torch(b, cx + 3, 0.8, cz - face * 3, flames);
    sarcophagus(b, cx - 2, cz - face * 1.5);
    treasurePile(b, cx + 3, cz - face * 2.6);
  };
  small(-36, 28, "north");
  small(36, -26, "south");

  // --- the temple: pylon gate, a roofed columned hall and a sanctum ---
  const TX = -34;
  const TZ = -34;
  b.slab(TX - 12, TZ - 9, TX + 12, TZ + 9, 0.9, 0.9, INK.OCHRE);
  b.stairs(TX, 0, TZ + 10.4, "-z", 3, 8, 0.3, 0.55, INK.SAND);
  for (const x of [TX - 10, TX + 10]) {
    b.box(x, 0.9, TZ + 7.8, 5.2, 9.4, 5.2, INK.SAND);
    b.box(x, 10.3, TZ + 7.8, 5.7, 0.7, 5.7, INK.OCHRE);
    b.box(x, 10.65, TZ + 7.8, 6.0, 0.34, 6.0, INK.SAND, false, false);
    b.box(x, 9.7, TZ + 7.8, 5.5, 0.16, 5.5, INK.TURQ, false, false);
    b.glyphs(x, 3.2, TZ + 10.4, "x", 3.6, 4.4, 3, 1);
  }
  b.box(TX, 10.3, TZ + 7.8, 15, 1.1, 4.2, INK.OCHRE);
  for (const x of [TX - 7, TX - 3.5, TX, TX + 3.5, TX + 7]) {
    b.cyl(x, 0.9, TZ + 5, 0.82, 8.2, INK.SAND, false, true, 10);
    b.ring(x, 7.4, TZ + 5, 0.86, 0.13, INK.TURQ);
    b.box(x, 8.4, TZ + 5, 2.1, 0.5, 2.1, INK.OCHRE);
  }
  b.box(TX, 8.9, TZ + 5, 16, 0.6, 2.6, INK.OCHRE);
  b.slab(TX - 11.4, TZ - 8.4, TX + 11.4, TZ + 7.6, 9.5, 0.55, INK.SAND);
  b.box(TX, 8.95, TZ + 8.52, 23.6, 0.22, 0.16, INK.TURQ, false, false);
  for (let i = 0; i < 6; i++) b.box(TX - 9 + i * 3.6, 8.95, TZ + 8.62, 0.55, 0.22, 0.08, INK.GOLD, false, false);
  b.box(TX - 4.55, 0.9, TZ + 8.42, 0.9, 7.0, 0.55, INK.STONE, false, false);
  b.box(TX + 4.55, 0.9, TZ + 8.42, 0.9, 7.0, 0.55, INK.STONE, false, false);
  b.box(TX, 7.9, TZ + 8.42, 10.0, 0.75, 0.6, INK.OCHRE, false, false);
  torch(b, TX - 5.9, 0, TZ + 12.1, flames);
  torch(b, TX + 5.9, 0, TZ + 12.1, flames);
  // facade with the great doorway, side doors east and west, and the sanctum screen
  b.wallX(TX - 11.5, TX + 11.5, TZ + 8, 0.9, 8.4, 1, [[TX - 4, TX + 4, 0, 6.4]], INK.SAND);
  b.wallZ(TZ - 8.5, TZ + 8, TX - 11.5, 0.9, 8.4, 1, [[TZ + 1, TZ + 4, 0, 4.2]], INK.SAND);
  b.wallZ(TZ - 8.5, TZ + 8, TX + 11.5, 0.9, 8.4, 1, [[TZ + 1, TZ + 4, 0, 4.2]], INK.SAND);
  b.wallX(TX - 11.5, TX + 11.5, TZ - 8.5, 0.9, 8.4, 1, [], INK.SAND);
  b.wallX(TX - 11.5, TX + 11.5, TZ - 2, 0.9, 8.4, 0.9, [[TX - 1.7, TX + 1.7, 0, 4.6]], INK.OCHRE);
  b.glyphs(TX - 7.4, 2.2, TZ + 7.5, "x", 6, 3.4, 3, -1);
  b.glyphs(TX + 7.4, 2.2, TZ + 7.5, "x", 6, 3.4, 3, -1);
  // the pharaoh in the sanctum
  b.box(TX, 0.9, TZ - 5, 2.6, 0.8, 2.6, INK.STONE);
  b.box(TX, 1.7, TZ - 5, 1.5, 3.2, 1.2, INK.GOLD);
  b.box(TX, 3.0, TZ - 5, 1.8, 0.6, 1.4, INK.TURQ, true, false);
  b.box(TX, 4.9, TZ - 5, 1.1, 1.2, 1.1, INK.GOLD);
  b.box(TX, 4.4, TZ - 5, 1.7, 0.35, 1.7, INK.TURQ, true, false);
  treasurePile(b, TX + 7, TZ - 5);
  treasurePile(b, TX - 7, TZ - 5);
  // short stairs from the side doors down to the sand
  b.stairs(TX + 11.5 + 0.5 + 3 * 0.55, 0, TZ + 2.5, "-x", 3, 3.2, 0.3, 0.55, INK.SAND);
  b.stairs(TX - 11.5 - 0.5 - 3 * 0.55, 0, TZ + 2.5, "+x", 3, 3.2, 0.3, 0.55, INK.SAND);
  columnDrum(b, TX - 13.6, TZ + 11.6, 0.55, 1.7);
  columnDrum(b, TX + 14, TZ + 11.2, 0.52, 1.5);
  rubble(b, TX, TZ + 12.4, 4, 2.0);

  // --- the sphinx guards the south-east, facing the plaza ---
  sphinx(b, 34, 34, Math.PI);

  // --- obelisks along the processional way and behind the pyramid ---
  obelisk(b, -7, 31);
  obelisk(b, 7, 31);
  obelisk(b, -7, -30);
  obelisk(b, 7, -30);

  // --- ruins: broken shrines as mid-field cover ---
  ruin(b, 27, 9);
  ruin(b, -26, -8);
  ruin(b, 14, -42);
  ruin(b, -8, -42);
  columnDrum(b, 22, 18, 0.5, 1.4);
  columnDrum(b, -23, 15, 0.55, 1.6);

  // --- market, camp, oasis and a well ---
  market(b, 14, 36);
  camp(b, -16, 44);
  well(b, 30, 48);
  b.disc(-28, 0.03, 46, 4.6, INK.TURQ, false, 22);
  b.ring(-28, 0.06, 46, 4.6, 0.32, INK.SAND, false);
  for (const [x, z] of [
    [-33.5, 43],
    [-28, 51],
    [-22.5, 43.5],
    [-32.5, 49.5],
    [-23.5, 50],
  ] as const)
    palm(b, x, z, 4.6 + (Math.abs(x) % 3) * 0.3);
  for (const [x, z] of [
    [-12, 30],
    [12, 24],
    [-22, 22],
    [44, 12],
    [-44, -18],
    [25, -12],
  ] as const)
    palm(b, x, z, 5 - (Math.abs(x) % 2) * 0.4);
  cactus(b, 46, 26);
  cactus(b, -46, 8);
  cactus(b, 24, -48);

  // --- dunes and boulders at the margins ---
  b.dune(-46, -52, 9, 2.6);
  b.dune(46, -50, 9, 2.4);
  b.dune(50, 20, 8, 2.2);
  b.dune(-52, 44, 7, 1.8);
  const boulder = (x: number, z: number, r: number, h: number) => {
    b.sphere(x, h * 0.5, z, r, INK.OCHRE, false, h / (2 * r), 7);
    b.sphere(x + r * 0.55, h * 0.33, z - r * 0.35, r * 0.46, INK.STONE, false, 0.66, 6);
    b.collide(x, 0, z, r * 1.45, h * 0.92, r * 1.45);
  };
  boulder(-24, 30, 1.0, 0.75);
  boulder(24, -4, 0.9, 0.8);
  boulder(-12, -24, 0.7, 0.55);
  boulder(40, 0, 0.8, 0.6);
  boulder(-40, 40, 0.9, 0.7);
  boulder(2, -50, 0.7, 0.55);

  // --- spawn pads: open sand all round, clear of every structure ---
  for (const [x, z] of [
    [-10, 40],
    [10, 46],
    [-26, 4],
    [28, -2],
    [0, -26],
    [-44, -2],
    [46, 4],
    [-30, -14],
    [20, -52],
    [-20, -52],
    [38, 18],
    [-50, 6],
    [44, -40],
    [-14, 26],
    [16, 22],
    [0, 56],
  ] as const) {
    b.spawns.push(new THREE.Vector3(x, 0.2, z));
  }

  b.flush();
  scene.add(b.group);

  return {
    title: "THE GREAT PYRAMID",
    sub: "open desert · climb it or cut through it",
    group: b.group,
    colliders: b.colliders,
    bounds: { minX: -59, maxX: 59, minZ: -59, maxZ: 59 },
    floorY: 0,
    spawnPoints: b.spawns,
    start: PYRAMID_START.clone(),
    startYaw: 0,
    // sun-bleached parchment: the hatching supplies the warmth, the paper stays readable
    mood: { paper: [0.96, 0.925, 0.815], background: 0xead7a8 },
    update(t: number) {
      for (const f of flames) {
        const k = 1 + Math.sin(t * 11 + f.phase) * 0.12 + Math.sin(t * 23 + f.phase * 2) * 0.06;
        f.flame.scale.set(0.8 * k, 1.5 * k, 0.8 * k);
        f.glow.scale.setScalar(k);
      }
    },
  };
}
