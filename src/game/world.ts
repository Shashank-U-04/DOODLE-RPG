// Game world building: materials, colliders, arena, and sketchy ragdoll enemies.

import * as THREE from "three";
import { INK_FRAG, INK_SKIN_VERT, INK_VERT } from "./shaders";

export const INK = {
  BLUE: 0,
  RED: 1,
  BLACK: 2,
  ORANGE: 3,
  GREEN: 4,
  PINK: 5,
  // Desert palette. The rendering pipeline hands an ink *index* to the post
  // pass, so extending the palette is how a new map gets its own colours
  // without a second material system: sand, ochre, tomb stone, turquoise and
  // gold all shade and hatch exactly like the six original inks.
  SAND: 6,
  OCHRE: 7,
  STONE: 8,
  TURQ: 9,
  GOLD: 10,
  BONE: 11,
  // Clothes and skin for the player characters (src/game/avatar.ts): a
  // peach skin tone, denim, purple, a clean white and a neutral grey.
  PEACH: 12,
  DENIM: 13,
  PURPLE: 14,
  WHITE: 15,
  GREY: 16,
} as const;
export type InkId = (typeof INK)[keyof typeof INK];

// The reference game's ink palette, verbatim, plus the five warm desert inks
// and the bleached bandage ink the mummies are wrapped in.
export const INK_RGB: Record<InkId, [number, number, number]> = {
  [INK.BLUE]: [0.1, 0.19, 0.76],
  [INK.RED]: [0.86, 0.12, 0.2],
  [INK.BLACK]: [0.18, 0.2, 0.26],
  [INK.ORANGE]: [0.92, 0.55, 0.08],
  [INK.GREEN]: [0.12, 0.6, 0.3],
  [INK.PINK]: [0.9, 0.4, 0.66],
  [INK.SAND]: [0.86, 0.71, 0.44],
  [INK.OCHRE]: [0.72, 0.47, 0.24],
  [INK.STONE]: [0.35, 0.27, 0.21],
  [INK.TURQ]: [0.19, 0.56, 0.54],
  [INK.GOLD]: [0.93, 0.73, 0.25],
  [INK.BONE]: [0.89, 0.86, 0.76],
  [INK.PEACH]: [0.96, 0.78, 0.64],
  [INK.DENIM]: [0.27, 0.4, 0.62],
  [INK.PURPLE]: [0.5, 0.3, 0.72],
  [INK.WHITE]: [0.99, 0.99, 0.97],
  [INK.GREY]: [0.55, 0.56, 0.6],
};

export const INK_HEX: Record<InkId, string> = {
  [INK.BLUE]: "#1a30c2",
  [INK.RED]: "#db1f33",
  [INK.BLACK]: "#2e3342",
  [INK.ORANGE]: "#eb8c14",
  [INK.GREEN]: "#1f994d",
  [INK.PINK]: "#e666a8",
  [INK.SAND]: "#dbb570",
  [INK.OCHRE]: "#b8783d",
  [INK.STONE]: "#594536",
  [INK.TURQ]: "#308f8a",
  [INK.GOLD]: "#edba40",
  [INK.BONE]: "#e3dbc2",
  [INK.PEACH]: "#f5c7a3",
  [INK.DENIM]: "#45669e",
  [INK.PURPLE]: "#804db8",
  [INK.WHITE]: "#fcfcf7",
  [INK.GREY]: "#8c8f99",
};

/**
 * One ink per seat in an online match (a player's `ink` index picks theirs):
 * as many as the server's INK_COUNT, the first six being the original ones.
 */
export const PVP_INKS: InkId[] = [
  INK.BLUE,
  INK.RED,
  INK.BLACK,
  INK.ORANGE,
  INK.GREEN,
  INK.PINK,
  INK.PURPLE,
  INK.TURQ,
  INK.GOLD,
  INK.DENIM,
];

/** The CSS colour of seat `ink` (the roster dots and the scoreboard). */
export function pvpInkHex(ink: number): string {
  const n = PVP_INKS.length;
  return INK_HEX[PVP_INKS[((ink % n) + n) % n]];
}

/** Every ink, in index order — what the post pass' `uInks` array is filled from. */
export const INK_LIST: InkId[] = [
  INK.BLUE,
  INK.RED,
  INK.BLACK,
  INK.ORANGE,
  INK.GREEN,
  INK.PINK,
  INK.SAND,
  INK.OCHRE,
  INK.STONE,
  INK.TURQ,
  INK.GOLD,
  INK.BONE,
  INK.PEACH,
  INK.DENIM,
  INK.PURPLE,
  INK.WHITE,
  INK.GREY,
];

/**
 * The post pass' ink colours: a 1×INK_SLOTS texture shared by every paper pass
 * (the game and the menu previews). The first INK_LIST.length texels are the
 * fixed inks; the rest are claimed at runtime by the colours of loaded
 * character models (inkForColor), so a model keeps its own olive, khaki or
 * hazmat yellow, and a textured model keeps its painted colours.
 */
export const INK_SLOTS = 1024;
const paletteData = new Float32Array(INK_SLOTS * 4);
INK_LIST.forEach((ink, i) => paletteData.set([...INK_RGB[ink], 1], i * 4));
export const INK_PALETTE = new THREE.DataTexture(paletteData, INK_SLOTS, 1, THREE.RGBAFormat, THREE.FloatType);
INK_PALETTE.minFilter = THREE.NearestFilter;
INK_PALETTE.magFilter = THREE.NearestFilter;
INK_PALETTE.needsUpdate = true;
const claimed = new Map<string, number>();
/** An ink for an sRGB colour (0-1): a fixed ink when one is very close, else a runtime slot. */
export function inkForColor(r: number, g: number, b: number): InkId {
  for (let i = 0; i < INK_LIST.length; i++) {
    const [ir, ig, ib] = INK_RGB[INK_LIST[i]];
    if (Math.abs(ir - r) + Math.abs(ig - g) + Math.abs(ib - b) < 0.05) return INK_LIST[i];
  }
  const key = [r, g, b].map((v) => Math.round(v * 40)).join(",");
  let slot = claimed.get(key);
  if (slot === undefined) {
    slot = INK_LIST.length + claimed.size;
    if (slot >= INK_SLOTS) return INK.BLACK; // palette full: never expected with the shipped models
    paletteData.set([r, g, b, 1], slot * 4);
    INK_PALETTE.needsUpdate = true;
    claimed.set(key, slot);
  }
  return slot as InkId;
}

/** The sRGB colour (0-1) an ink prints in: a fixed ink or a claimed runtime slot. */
export function inkRgb(ink: InkId): [number, number, number] {
  const i = Math.max(0, Math.min(INK_SLOTS - 1, ink | 0)) * 4;
  return [paletteData[i], paletteData[i + 1], paletteData[i + 2]];
}

// paper: (0.965, 0.955, 0.905) in the reference renderer
export const PAPER_RGB: [number, number, number] = [0.965, 0.955, 0.905];
export const PAPER = 0xf6f4e7;

// The sketch "studio light": kept in view space, so the shading is anchored
// to the camera the way the reference game does it.
export const LIGHT_DIR_WORLD = new THREE.Vector3(0.38, 0.82, 0.42).normalize();

export const shared = {
  uTime: { value: 0 },
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },
};

// One material per (ink, fill mode, side, flat flag), shared by everything that
// uses it. Without the cache every bullet, every shard, every splat and every
// bucket of every enemy rig allocated its own ShaderMaterial — hundreds of new
// materials per wave, which the renderer has to register, upload uniforms for
// and garbage-collect, exactly when the screen is busiest. Nothing mutates a
// material's uniforms after creation, so sharing is safe.
const inkMaterials = new Map<number, THREE.ShaderMaterial>();

export function makeInkMaterial(
  ink: InkId,
  fill = false,
  side: THREE.Side = THREE.FrontSide,
  flat = false,
): THREE.ShaderMaterial {
  // The ink index gets its own byte: the palette grew past 8, so packing it
  // into the low bits would make `SAND` collide with a filled `BLUE`.
  const key =
    ink * 128 + (fill ? 8 : 0) + (side === THREE.BackSide ? 16 : side === THREE.DoubleSide ? 32 : 0) + (flat ? 64 : 0);
  const cached = inkMaterials.get(key);
  if (cached) return cached;
  const made = new THREE.ShaderMaterial({
    uniforms: {
      uInk: { value: ink },
      uFill: { value: fill ? 1 : 0 },
      uFlat: { value: flat ? 1 : 0 },
      uShadeScale: { value: 1 },
      uShadeBias: { value: 0 },
      uLightDir: shared.uLightDir,
      uTime: shared.uTime,
    },
    vertexShader: INK_VERT,
    fragmentShader: INK_FRAG,
    side,
  });
  inkMaterials.set(key, made);
  return made;
}

/**
 * Solid ink that still turns with the light: the player characters' material.
 * The post pass draws it as a flat fill shaded lighter or darker, with a few
 * strokes on the shadow side, and outlines it in a dark version of its ink.
 */
const softMaterials = new Map<number, THREE.ShaderMaterial>();
export function makeSoftInkMaterial(ink: InkId): THREE.ShaderMaterial {
  const cached = softMaterials.get(ink);
  if (cached) return cached;
  const made = makeInkMaterial(ink, true).clone();
  // the skinned vertex shader: also draws animated (skinned) character models
  made.vertexShader = INK_SKIN_VERT;
  made.uniforms.uFill.value = 2;
  made.uniforms.uLightDir = shared.uLightDir;
  made.uniforms.uTime = shared.uTime;
  softMaterials.set(ink, made);
  return made;
}

/* ============================== AABB colliders ============================== */

export type AABB = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

export function box(w: number, h: number, d: number, x: number, y: number, z: number): AABB {
  return { minX: x - w / 2, maxX: x + w / 2, minY: y, maxY: y + h, minZ: z - d / 2, maxZ: z + d / 2 };
}

export type Collider = AABB;

/**
 * Does a body of `radius`/`height` standing at (x, y, z) intersect `c`?
 *
 * Strict inequalities on purpose: standing exactly on a surface, or exactly
 * against a wall, is *not* inside it. Every geometric question in the engine —
 * movement, spawn pads, unsticking — goes through this one predicate, so none
 * of them can disagree about what counts as an overlap.
 */
export function bodyHits(x: number, y: number, z: number, radius: number, height: number, c: Collider): boolean {
  return (
    x + radius > c.minX &&
    x - radius < c.maxX &&
    z + radius > c.minZ &&
    z - radius < c.maxZ &&
    y < c.maxY &&
    y + height > c.minY
  );
}

/**
 * Is this a spot a body can actually stand on: clear of every collider, with a
 * floor within `reach` of its feet?
 *
 * This is the test a spawn pad has to pass. A pad inside a building, under a
 * walkway or hanging over a void passes a naive "is it in the list?" check and
 * fails here — which is the whole point, because a teleport into geometry is a
 * player who cannot move.
 */
export function isStandable(
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
  colliders: Collider[],
  reach = 1.2,
): boolean {
  for (const c of colliders) if (bodyHits(x, y, z, radius, height, c)) return false;

  let floor = -Infinity;
  for (const c of colliders) {
    // the collider has to be under the footprint…
    if (x + radius <= c.minX || x - radius >= c.maxX) continue;
    if (z + radius <= c.minZ || z - radius >= c.maxZ) continue;
    // …below the feet (anything at or above them is an obstruction, and was
    // already rejected as an overlap above)…
    if (c.maxY > y + 0.05) continue;
    // …and close enough to be the surface we would stand on rather than a kerb
    // far below that we would step off into thin air.
    if (c.maxY < y - reach) continue;
    if (c.maxY > floor) floor = c.maxY;
  }
  return floor > -Infinity;
}

/**
 * AABB depth-penetration resolution for a *teleport*: the shortest way out of
 * whatever the body is overlapping, return true if it moved.
 *
 * Deliberately narrower than the version inside resolveMove, which is allowed to
 * drop a body out of the bottom of a box because movement put it there. A
 * teleport has no such excuse, and "down" is how a respawn ends up under the
 * ground with no way back — so this variant only ever escapes sideways or up.
 */
export function depenetrate(
  pos: THREE.Vector3,
  radius: number,
  height: number,
  colliders: Collider[],
  iterations = 4,
): boolean {
  let moved = false;
  for (let i = 0; i < iterations; i++) {
    let hit: Collider | null = null;
    for (const c of colliders) {
      if (bodyHits(pos.x, pos.y, pos.z, radius, height, c)) {
        hit = c;
        break;
      }
    }
    if (!hit) break;
    moved = true;
    const c = hit;
    const up = c.maxY - pos.y; // stand on top of it
    const px = c.maxX + radius - pos.x;
    const nx = pos.x - (c.minX - radius);
    const pz = c.maxZ + radius - pos.z;
    const nz = pos.z - (c.minZ - radius);
    const side = Math.min(px, nx, pz, nz);
    if (up <= side) {
      pos.y = c.maxY; // knee-high overlap: treat it as a step
    } else if (px <= nx && px <= pz && px <= nz) {
      pos.x = c.maxX + radius;
    } else if (nx <= pz && nx <= nz) {
      pos.x = c.minX - radius;
    } else if (pz <= nz) {
      pos.z = c.maxZ + radius;
    } else {
      pos.z = c.minZ - radius;
    }
  }
  return moved;
}

/** What makes one spawn pad better than another, once it is safe at all. */
export type SpawnScoring = {
  radius: number;
  height: number;
  colliders: Collider[];
  /** ignore pads above this height — keeps a respawn at street level */
  groundOnly?: number;
  /** higher wins; equal scores keep the earlier pad */
  score?: (pad: THREE.Vector3) => number;
};

/**
 * The best *safe* pad of `candidates`, or null when every one of them is inside
 * geometry.
 *
 * Callers keep a list of known-good corners as the next resort, so one broken
 * pad degrades into a good spawn instead of a stuck player.
 */
export function pickSafeSpawn(candidates: THREE.Vector3[], opts: SpawnScoring): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null;
  let bestScore = -Infinity;
  for (const pad of candidates) {
    if (opts.groundOnly !== undefined && pad.y > opts.groundOnly) continue;
    if (!isStandable(pad.x, pad.y, pad.z, opts.radius, opts.height, opts.colliders)) continue;
    const s = opts.score ? opts.score(pad) : 0;
    if (best === null || s > bestScore) {
      best = pad;
      bestScore = s;
    }
  }
  return best;
}

/**
 * `pads` reordered so that consecutive entries are as far apart as possible:
 * first the pad nearest `from`, then each time the pad farthest from all those
 * already taken. Deterministic, so every client hands pad n to the same player,
 * and the first few players of a match start spread across the map rather than
 * in whichever neighbouring pads were placed next to each other in the list.
 */
export function spreadSpawns(pads: THREE.Vector3[], from: THREE.Vector3): THREE.Vector3[] {
  const left = pads.slice();
  const out: THREE.Vector3[] = [];
  const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
  while (left.length > 0) {
    let bestI = 0;
    let bestD = out.length === 0 ? Infinity : -Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = out.length === 0 ? flat(left[i], from) : Math.min(...out.map((o) => flat(left[i], o)));
      if (out.length === 0 ? d < bestD : d > bestD) {
        bestD = d;
        bestI = i;
      }
    }
    out.push(left.splice(bestI, 1)[0]);
  }
  return out;
}

/* ============================== combat geometry ============================== */

/**
 * The melee test: is `point` inside a forward cone — within `reach` of the eye
 * and inside `cosArc` of where we are looking?
 *
 * A cone is the honest shape for a blade: it has no magazine, no tracer and no
 * travel time, so the question is only ever "is it in front of me and close",
 * which is what a player expects a slash to answer. `cosArc` is a cosine, so
 * 0.35 is roughly ±70°.
 */
export function meleeHits(
  eye: THREE.Vector3,
  fwd: THREE.Vector3,
  point: THREE.Vector3,
  reach: number,
  cosArc: number,
): boolean {
  const to = point.clone().sub(eye);
  const d = to.length();
  if (d > reach) return false;
  if (d < 1e-4) return true;
  return to.divideScalar(d).dot(fwd) >= cosArc;
}

export function resolveMove(
  pos: THREE.Vector3,
  vel: THREE.Vector3,
  radius: number,
  height: number,
  colliders: Collider[],
  dt: number,
  stepHeight = 0.55,
): { onGround: boolean; hitCeiling: boolean; hitWall: boolean } {
  let onGround = false;
  let hitCeiling = false;
  let hitWall = false;

  // Does the body (a box of `radius` around x/z, `height` tall from y up)
  // intersect this collider? The shared predicate, so a move and a spawn test
  // can never disagree about whether the body is inside something.
  const hits = (x: number, y: number, z: number, c: Collider) => bodyHits(x, y, z, radius, height, c);

  const anyHit = () => {
    for (const c of colliders) if (hits(pos.x, pos.y, pos.z, c)) return c;
    return null;
  };

  // Depenetration: push the body out of whatever it overlaps, along the
  // shortest escape. This is what makes the old "wedged between a wall and a
  // staircase with no way out" impossible — an overlap can never survive a
  // frame, so the player can always move free again.
  const depenetrate = () => {
    for (let i = 0; i < 3; i++) {
      const c = anyHit();
      if (!c) return;
      const up = c.maxY - pos.y; // climb out over the top
      const down = pos.y + height - c.minY; // slip out below the bottom
      const px = c.maxX + radius - pos.x;
      const nx = pos.x - (c.minX - radius);
      const pz = c.maxZ + radius - pos.z;
      const nz = pos.z - (c.minZ - radius);
      const side = Math.min(px, nx, pz, nz);
      if (up <= side && up <= stepHeight + 0.3) {
        // stair-scale overlap: step out on top, as if it were a tread
        pos.y = c.maxY;
        onGround = true;
      } else if (side <= down) {
        if (px <= nx && px <= pz && px <= nz) pos.x = c.maxX + radius;
        else if (nx <= pz && nx <= nz) pos.x = c.minX - radius;
        else if (pz <= nz) pos.z = c.maxZ + radius;
        else pos.z = c.minZ - radius;
      } else {
        pos.y = c.minY - height;
        vel.y = Math.min(vel.y, 0);
        hitCeiling = true;
      }
    }
  };

  // If a previous frame left us inside geometry — squeezed between boxes, or
  // spawned into a prop — get clear BEFORE moving, not after.
  depenetrate();

  const tryAxis = (axis: "x" | "y" | "z", delta: number) => {
    if (delta === 0) return;
    const saved = pos[axis];
    pos[axis] = saved + delta;
    for (const c of colliders) {
      if (!hits(pos.x, pos.y, pos.z, c)) continue;
      if (axis === "y") {
        if (delta < 0) {
          pos.y = c.maxY;
          onGround = true;
          vel.y = 0;
        } else {
          pos.y = c.minY - height;
          hitCeiling = true;
          vel.y = 0;
        }
      } else {
        // Step-up assist: a knee-high ledge becomes floor — but only if the
        // whole body clears the space above it. Lifting into a lintel, rail or
        // ceiling is exactly how players used to end up jammed inside walls.
        if (c.maxY - pos.y <= stepHeight && c.maxY - pos.y > -0.01) {
          const oldY = pos.y;
          pos.y = c.maxY;
          if (!anyHit()) continue;
          pos.y = oldY;
        }
        // Clamp back out only when this move is what entered the box. If the
        // body was already inside it, clamping would drag us through the wall
        // to the far side — often into the next box, where two opposing
        // clamps pinned the player permanently. Leave those to depenetration.
        const wasInside = hits(axis === "x" ? saved : pos.x, pos.y, axis === "z" ? saved : pos.z, c);
        if (wasInside) continue;
        pos[axis] = delta > 0 ? (axis === "x" ? c.minX : c.minZ) - radius : (axis === "x" ? c.maxX : c.maxZ) + radius;
        vel[axis] = 0;
        hitWall = true;
      }
    }
  };

  tryAxis("x", vel.x * dt);
  tryAxis("z", vel.z * dt);
  tryAxis("y", vel.y * dt);

  // Whatever the frame did, end it outside every collider.
  depenetrate();

  return { onGround, hitCeiling, hitWall };
}
