// Automatic rigging for character models that come without a skeleton (or
// without animations): the Polygonal Mind and Sloyd figures, Punk Girl, Hyper
// Casual. They are statues in a T- or A-pose; this gives them the skeleton and
// the animation clips of a "donor" (the Quaternius SWAT, whose clips include
// idle, aim, run and run-and-shoot), so they move exactly like the rigged cast.
//
// 1. Bake the statue's meshes into one ink-painted geometry, feet on the floor,
//    1.8 m tall, centred.
// 2. Measure both bodies the same way, slice by slice: where the legs part
//    (crotch), how far apart they stand, where the arms join (armpit), the
//    torso's width there, the narrowest point above it (neck), the hand tips.
// 3. Move every donor joint to the matching place on the statue and turn each
//    bone so its child lands there. Because bones are turned (not just moved),
//    the donor's clips — absolute joint rotations — still read as the same
//    motion on the new body.
// 4. Skin: each vertex goes to the nearest body part (spine, arm, leg) and,
//    within it, the nearest bone, blended across joints.
//
// It assumes a humanoid facing +z with arms out to the sides; that is what the
// shipped models are. It is a load-time step (a few ms for a 40k-triangle mesh).

import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { paintMesh } from "./paint";

const H = 1.8;
const bn = (s: string) => THREE.PropertyBinding.sanitizeNodeName(s);

/* ------------------------------------------------------------------ *
 * baking
 * ------------------------------------------------------------------ */

type Baked = { geo: THREE.BufferGeometry; mats: THREE.Material[] };

/** every mesh of a scene in its bind pose, painted, merged into one non-indexed geometry (position + normal) */
function bake(scene: THREE.Object3D, paint: boolean): Baked {
  scene.updateMatrixWorld(true);
  const parts: { pos: Float32Array; nrm: Float32Array; groups: { start: number; count: number; mat: number }[] }[] = [];
  const mats: THREE.Material[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const tmp = new THREE.Mesh(m.geometry.clone(), m.material);
    tmp.geometry.deleteAttribute("skinIndex");
    tmp.geometry.deleteAttribute("skinWeight");
    // a skinned mesh's geometry is its bind pose; bake its node transform in
    tmp.geometry.applyMatrix4(m.matrixWorld);
    if (paint) paintMesh(tmp);
    let g = tmp.geometry.index ? tmp.geometry.toNonIndexed() : tmp.geometry;
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const groups = g.groups.length
      ? g.groups
      : [{ start: 0, count: g.getAttribute("position").count, materialIndex: 0 }];
    const tm = Array.isArray(tmp.material) ? tmp.material : [tmp.material];
    const base = mats.length;
    mats.push(...tm);
    parts.push({
      pos: new Float32Array(g.getAttribute("position").array as ArrayLike<number>),
      nrm: new Float32Array(g.getAttribute("normal").array as ArrayLike<number>),
      groups: groups.map((gr) => ({ start: gr.start, count: gr.count, mat: base + (gr.materialIndex ?? 0) })),
    });
    g = null as unknown as THREE.BufferGeometry;
  });
  const total = parts.reduce((s, p) => s + p.pos.length, 0);
  const pos = new Float32Array(total);
  const nrm = new Float32Array(total);
  const geo = new THREE.BufferGeometry();
  let off = 0;
  for (const p of parts) {
    pos.set(p.pos, off);
    nrm.set(p.nrm, off);
    for (const gr of p.groups) geo.addGroup(off / 3 + gr.start, gr.count, gr.mat);
    off += p.pos.length;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  return { geo, mats };
}

/** feet on the floor, H tall, centred on x/z; returns the transform it applied */
function normalise(geo: THREE.BufferGeometry): THREE.Matrix4 {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const s = H / Math.max(1e-6, b.max.y - b.min.y);
  const m = new THREE.Matrix4()
    .makeScale(s, s, s)
    .premultiply(
      new THREE.Matrix4().makeTranslation(-((b.min.x + b.max.x) / 2) * s, -b.min.y * s, -((b.min.z + b.max.z) / 2) * s),
    );
  geo.applyMatrix4(m);
  return m;
}

/**
 * Turn a statue standing sideways (arms spread along z) a quarter turn, so the
 * arms lie along x. In a T- or A-pose the upper body is far wider across the
 * arms than it is deep.
 */
function alignArms(geo: THREE.BufferGeometry) {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  let x0 = Infinity,
    x1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 0.45 * H || y > 0.9 * H) continue;
    const x = pos.getX(i);
    const z = pos.getZ(i);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  if (z1 - z0 > (x1 - x0) * 1.2) {
    geo.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    normalise(geo);
  }
}

/**
 * Turn a statue that faces -z around. Feet give it away: the toes stick out
 * in front of the shins much further than the heels do behind them.
 */
function faceForward(geo: THREE.BufferGeometry) {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  let shin = 0;
  let shinN = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y > 0.12 * H && y < 0.22 * H) {
      shin += z;
      shinN++;
    }
    if (y < 0.04 * H) {
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
  }
  if (!shinN || !Number.isFinite(lo)) return;
  const mid = shin / shinN;
  if (mid - lo > (hi - mid) * 1.25) geo.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
}

/* ------------------------------------------------------------------ *
 * measuring a body
 * ------------------------------------------------------------------ */

type Marks = {
  crotch: number;
  legX: number;
  waistW: number;
  armpit: number;
  shoulderX: number;
  shoulderY: number;
  neck: number;
  /** hand tips, by side: +x and -x */
  handP: THREE.Vector3;
  handN: THREE.Vector3;
  /** toe tips (front-most low point) by side */
  toeP: THREE.Vector3;
  toeN: THREE.Vector3;
};

const SLICE = 0.01;

function measure(geo: THREE.BufferGeometry): Marks {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const n = Math.ceil(H / SLICE) + 2;
  // every triangle's x-extent, entered into each slice its y-range crosses
  const spans: [number, number][][] = Array.from({ length: n }, () => []);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y) / SLICE));
    const y1 = Math.min(n - 1, Math.floor(Math.max(a.y, b.y, c.y) / SLICE));
    const x0 = Math.min(a.x, b.x, c.x);
    const x1 = Math.max(a.x, b.x, c.x);
    for (let y = y0; y <= y1; y++) spans[y].push([x0, x1]);
  }
  /** merged occupied runs in a slice */
  const runs = (y: number): [number, number][] => {
    const s = spans[Math.max(0, Math.min(n - 1, Math.round(y / SLICE)))].slice().sort((p, q) => p[0] - q[0]);
    const out: [number, number][] = [];
    for (const r of s) {
      const last = out[out.length - 1];
      if (last && r[0] <= last[1] + 0.004) last[1] = Math.max(last[1], r[1]);
      else out.push([r[0], r[1]]);
    }
    return out;
  };
  /** half-width of the run through x≈0, or 0 if the middle is empty there */
  const middle = (y: number) => {
    for (const r of runs(y)) if (r[0] <= 0.01 && r[1] >= -0.01) return Math.max(-r[0], r[1]);
    return 0;
  };

  // crotch: the first height (above the shins) where the middle fills in
  let crotch = 0;
  for (let y = 0.2 * H; y < 0.65 * H; y += SLICE) {
    if (middle(y) > 0) {
      crotch = y;
      break;
    }
  }
  if (crotch < 0.28 * H) crotch = 0.47 * H; // a robe or a skirt: assume ordinary legs

  // leg spacing: the centres of the runs either side of the middle, low down
  const centres: number[] = [];
  for (let y = 0.08 * H; y < Math.min(crotch - 0.03, 0.3 * H); y += SLICE) {
    for (const r of runs(y)) if (r[1] - r[0] < 0.25 * H) centres.push(Math.abs((r[0] + r[1]) / 2));
  }
  centres.sort((p, q) => p - q);
  let legX = centres.length ? centres[Math.floor(centres.length / 2)] : 0.055 * H;
  if (legX < 0.025 * H || legX > 0.14 * H) legX = 0.055 * H;

  const waistW = Math.max(0.05 * H, middle(crotch + 0.06 * H) || 0.09 * H);

  // armpit: the arms join the middle run, so it suddenly widens
  let armpit = 0;
  for (let y = crotch + 0.08 * H; y < 0.92 * H; y += SLICE) {
    if (middle(y) > Math.max(1.55 * waistW, waistW + 0.08 * H)) {
      armpit = y;
      break;
    }
  }
  if (!armpit) armpit = crotch + 0.55 * (H - crotch) * 0.62;
  const shoulderX = Math.max(waistW * 0.75, middle(armpit - 0.03 * H) || waistW);
  const shoulderY = armpit + 0.035 * H;

  // neck: the narrowest middle between the shoulders and the top of the head
  let neck = shoulderY + 0.06 * H;
  let narrow = Infinity;
  for (let y = shoulderY + 0.03 * H; y < H - 0.06 * H; y += SLICE) {
    const w = middle(y);
    if (w > 0 && w < narrow) {
      narrow = w;
      neck = y;
    }
  }

  // hand tips: the furthest-out points above the knees on each side; toes: front-most low points
  const handP = new THREE.Vector3(-Infinity, 0, 0);
  const handN = new THREE.Vector3(Infinity, 0, 0);
  const toeP = new THREE.Vector3(legX, 0, -Infinity);
  const toeN = new THREE.Vector3(-legX, 0, -Infinity);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.y > crotch * 0.55) {
      if (v.x > handP.x) handP.copy(v);
      if (v.x < handN.x) handN.copy(v);
    }
    if (v.y < 0.06 * H) {
      if (v.x >= 0 && v.z > toeP.z) toeP.copy(v);
      if (v.x < 0 && v.z > toeN.z) toeN.copy(v);
    }
  }
  return { crotch, legX, waistW, armpit, shoulderX, shoulderY, neck, handP, handN, toeP, toeN };
}

/* ------------------------------------------------------------------ *
 * the rig
 * ------------------------------------------------------------------ */

export type Donor = { scene: THREE.Object3D; clips: THREE.AnimationClip[] };

const SPINE = ["Hips", "Abdomen", "Torso", "Chest", "Neck", "Head"];

/**
 * Rig a statue with the donor's skeleton and clips. Returns a scene holding
 * the skinned, ink-painted mesh and the armature, plus clips that drive it.
 */
export function autorig(
  statue: THREE.Object3D,
  donor: Donor,
  opts: { paint?: boolean } = {},
): { scene: THREE.Group; clips: THREE.AnimationClip[] } {
  /* ---- the statue, baked and measured ---- */
  const target = bake(statue, opts.paint !== false);
  normalise(target.geo);
  alignArms(target.geo);
  faceForward(target.geo);
  const T = measure(target.geo);

  /* ---- the donor, measured the same way, and its rest joints ---- */
  const donorBody = bake(donor.scene, false);
  const donorFit = normalise(donorBody.geo);
  const D = measure(donorBody.geo);

  const rig = new THREE.Group();
  const holder = cloneSkinned(donor.scene);
  // The file's resting pose is not the pose the donor's mesh was bound in (its
  // arms hang down while the mesh stands in a T); put the bones in the bind
  // pose, which is what the donor's clips and measurements are relative to.
  holder.updateMatrixWorld(true);
  holder.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh) sm.skeleton.pose();
  });
  holder.updateMatrixWorld(true);
  const bodyRestD = (holder.getObjectByName(bn("Body"))?.position ?? new THREE.Vector3()).clone();
  // keep only the armature: the donor's own meshes are not drawn
  const drop: THREE.Object3D[] = [];
  holder.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) drop.push(o);
  });
  for (const o of drop) o.removeFromParent();
  holder.applyMatrix4(donorFit); // the donor's normalised space = our rig space
  rig.add(holder);
  rig.updateMatrixWorld(true);

  const bone = (name: string) => holder.getObjectByName(bn(name)) as THREE.Bone | undefined;
  const wpos = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);

  // which side is ".L": the donor's left wrist sits at +x or -x
  const sideL = (wpos(bone("Wrist.L")!).x >= 0 ? 1 : -1) as 1 | -1;
  const handOf = (m: Marks, s: "L" | "R") => ((s === "L") === sideL > 0 ? m.handP : m.handN);
  const toeOf = (m: Marks, s: "L" | "R") => ((s === "L") === sideL > 0 ? m.toeP : m.toeN);

  /** donor height → statue height, through the landmarks */
  const ys = [0, D.crotch, D.shoulderY, D.neck, H];
  const yt = [0, T.crotch, T.shoulderY, T.neck, H];
  const mapY = (y: number) => {
    for (let i = 1; i < ys.length; i++) {
      if (y <= ys[i] || i === ys.length - 1) {
        const k = (y - ys[i - 1]) / Math.max(1e-6, ys[i] - ys[i - 1]);
        return yt[i - 1] + k * (yt[i] - yt[i - 1]);
      }
    }
    return y;
  };

  /* ---- where every joint goes on the statue ---- */
  const want = new Map<string, THREE.Vector3>();
  const restD = new Map<string, THREE.Vector3>();
  holder.traverse((o) => {
    if ((o as THREE.Bone).isBone) restD.set(o.name, wpos(o));
  });
  for (const name of SPINE) {
    const p = restD.get(bn(name));
    if (p) want.set(bn(name), new THREE.Vector3(0, mapY(p.y), p.z));
  }
  const headTop = new THREE.Vector3(0, H, want.get(bn("Head"))?.z ?? 0);
  for (const s of ["L", "R"] as const) {
    const sgn = s === "L" ? sideL : -sideL;
    const sh = restD.get(bn(`Shoulder.${s}`));
    if (sh)
      want.set(
        bn(`Shoulder.${s}`),
        new THREE.Vector3(sh.x * (T.shoulderX / Math.max(1e-6, D.shoulderX)), mapY(sh.y), sh.z),
      );
    // the arm: each joint keeps its fraction of the way from shoulder to hand tip
    const sD = restD.get(bn(`UpperArm.${s}`))!;
    const tD = handOf(D, s);
    const sT = new THREE.Vector3(sgn * T.shoulderX, T.shoulderY, want.get(bn("Chest"))?.z ?? 0);
    const tT = handOf(T, s);
    const along = (p: THREE.Vector3) => {
      const ax = tD.clone().sub(sD);
      return p.clone().sub(sD).dot(ax) / Math.max(1e-6, ax.lengthSq());
    };
    for (const j of ["UpperArm", "LowerArm", "Wrist"]) {
      const p = restD.get(bn(`${j}.${s}`));
      if (p) want.set(bn(`${j}.${s}`), sT.clone().lerp(tT, Math.max(0, Math.min(1, along(p)))));
    }
    want.set(`__hand.${s}`, tT.clone());
    // the leg: heights through the landmarks, spacing by the measured stance
    for (const j of ["UpperLeg", "LowerLeg", "Foot"]) {
      const p = restD.get(bn(`${j}.${s}`));
      if (p) want.set(bn(`${j}.${s}`), new THREE.Vector3(p.x * (T.legX / Math.max(1e-6, D.legX)), mapY(p.y), p.z));
    }
    want.set(`__toe.${s}`, toeOf(T, s).clone());
  }
  want.set("__top", headTop);

  // Virtual bone ends (head top, hand tips, ankles), in each bone's own frame
  // as the donor has it, before anything is moved.
  const virt = new Map<string, THREE.Vector3>();
  const restLocal = (name: string, world: THREE.Vector3) => bone(name)!.worldToLocal(world.clone());
  virt.set("__top", restLocal("Head", new THREE.Vector3(0, H, restD.get(bn("Head"))!.z)));
  for (const s of ["L", "R"] as const) {
    virt.set(`__hand.${s}`, restLocal(`Wrist.${s}`, handOf(D, s)));
    virt.set(bn(`Foot.${s}`), restLocal(`LowerLeg.${s}`, restD.get(bn(`Foot.${s}`))!));
  }

  /* ---- move and turn the bones onto those places ---- */
  const place = (name: string) => {
    const b = bone(name);
    const p = want.get(bn(name));
    if (!b || !p || !b.parent) return;
    b.parent.updateMatrixWorld(true);
    b.position.copy(b.parent.worldToLocal(p.clone()));
    b.updateMatrixWorld(true);
  };
  /** turn `from` so the point it holds at `localRef` lands on `goal`; stretch a child bone to match */
  const aim = (from: string, to: string, goalKey?: string) => {
    const b = bone(from);
    const goal = want.get(goalKey ?? bn(to));
    const start = want.get(bn(from));
    if (!b || !goal || !start) return;
    const child = goalKey ? undefined : bone(to);
    b.updateMatrixWorld(true);
    const local = child ? child.position.clone() : virt.get(goalKey!)?.clone();
    if (!local) return;
    const scale = new THREE.Vector3().setFromMatrixScale(b.matrixWorld).x;
    const len = goal.distanceTo(start) / Math.max(1e-9, scale);
    local.setLength(len);
    if (child) child.position.copy(local);
    b.updateMatrixWorld(true);
    const cur = b.localToWorld(local.clone()).sub(wpos(b)).normalize();
    const des = goal.clone().sub(start).normalize();
    const qw = new THREE.Quaternion().setFromUnitVectors(cur, des);
    const bw = b.getWorldQuaternion(new THREE.Quaternion());
    const pw = b.parent!.getWorldQuaternion(new THREE.Quaternion());
    b.quaternion.copy(pw.invert().multiply(qw).multiply(bw));
    b.updateMatrixWorld(true);
  };

  // the trunk, bottom up
  const bodyB = bone("Body");
  const hipsT = want.get(bn("Hips"))!;
  if (bodyB && bodyB.parent) {
    bodyB.parent.updateMatrixWorld(true);
    // Body sits where the donor's does relative to its hips
    const off = restD
      .get(bn("Body"))!
      .clone()
      .sub(restD.get(bn("Hips"))!);
    want.set(bn("Body"), hipsT.clone().add(off));
    place("Body");
  }
  place("Hips");
  for (let i = 0; i < SPINE.length - 1; i++) aim(SPINE[i], SPINE[i + 1]);
  aim("Head", "", "__top");
  for (const s of ["L", "R"] as const) {
    place(`Shoulder.${s}`);
    aim(`Shoulder.${s}`, `UpperArm.${s}`);
    aim(`UpperArm.${s}`, `LowerArm.${s}`);
    aim(`LowerArm.${s}`, `Wrist.${s}`);
    aim(`Wrist.${s}`, "", `__hand.${s}`);
    place(`UpperLeg.${s}`);
    aim(`UpperLeg.${s}`, `LowerLeg.${s}`);
    // the shin ends at the ankle (the donor's feet hang off Root, an IK setup)
    aim(`LowerLeg.${s}`, "", bn(`Foot.${s}`));
  }
  rig.updateMatrixWorld(true);

  /* ---- skinning ---- */
  const bones: THREE.Bone[] = [];
  holder.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const index = new Map(bones.map((b, i) => [b.name, i]));
  type Chain = { bones: number[]; pts: THREE.Vector3[]; before?: number };
  const J = (k: string) => want.get(bn(k)) ?? want.get(k)!;
  const spineChain: Chain = {
    bones: SPINE.map((s) => index.get(bn(s))!),
    pts: [...SPINE.map((s) => J(s)), J("__top")],
  };
  const armChain = (s: "L" | "R"): Chain => ({
    bones: ["UpperArm", "LowerArm", "Wrist"].map((j) => index.get(bn(`${j}.${s}`))!),
    pts: [J(`UpperArm.${s}`), J(`LowerArm.${s}`), J(`Wrist.${s}`), J(`__hand.${s}`)],
    before: index.get(bn("Chest")),
  });
  const legChain = (s: "L" | "R"): Chain => {
    const ankle = J(`Foot.${s}`);
    return {
      bones: [index.get(bn(`UpperLeg.${s}`))!, index.get(bn(`LowerLeg.${s}`))!, index.get(bn(`LowerLeg.${s}`))!],
      pts: [J(`UpperLeg.${s}`), J(`LowerLeg.${s}`), ankle, J(`__toe.${s}`)],
      before: index.get(bn("Hips")),
    };
  };
  const arms = { L: armChain("L"), R: armChain("R") };
  const legs = { L: legChain("L"), R: legChain("R") };

  const seg = new THREE.Line3();
  const tmp = new THREE.Vector3();
  /** nearest point on a chain: distance, segment, and how far along it */
  const nearest = (ch: Chain, p: THREE.Vector3) => {
    let best = { d: Infinity, i: 0, u: 0 };
    for (let i = 0; i < ch.pts.length - 1; i++) {
      seg.set(ch.pts[i], ch.pts[i + 1]);
      const u = seg.closestPointToPointParameter(p, true);
      seg.at(u, tmp);
      const d = tmp.distanceTo(p);
      if (d < best.d) best = { d, i, u };
    }
    return best;
  };
  const armR = 0.04 * H;
  const legR = 0.055 * H;
  const trunkR = Math.max(0.05 * H, T.waistW * 0.9);

  const pos = target.geo.getAttribute("position") as THREE.BufferAttribute;
  const skinIndex = new Uint16Array(pos.count * 4);
  const skinWeight = new Float32Array(pos.count * 4);
  const p = new THREE.Vector3();
  for (let v = 0; v < pos.count; v++) {
    p.fromBufferAttribute(pos, v);
    const s: "L" | "R" = p.x >= 0 === sideL > 0 ? "L" : "R";
    let ch: Chain = spineChain;
    if (p.y < T.neck - 0.01) {
      const dS = nearest(spineChain, p).d / trunkR;
      const dA = nearest(arms[s], p).d / armR;
      const dL = p.y < T.crotch + 0.06 * H ? nearest(legs[s], p).d / legR : Infinity;
      // clear of the torso's sides (and off the legs): an arm, however wide the body is
      const outside = Math.abs(p.x) > T.shoulderX * 1.04 && p.y > T.crotch * 0.6 && dA < dL && dA * armR < 0.1;
      if (outside || (dA < dS && dA < dL)) ch = arms[s];
      else if (dL < dS) ch = legs[s];
    }
    const hit = nearest(ch, p);
    // blend across a joint near either end of the segment
    const w: [number, number][] = [];
    const L = ch.pts[hit.i].distanceTo(ch.pts[hit.i + 1]);
    const bw = Math.min(0.045, 0.3 * L);
    const prev = hit.i > 0 ? ch.bones[hit.i - 1] : ch.before;
    const next = hit.i < ch.bones.length - 1 ? ch.bones[hit.i + 1] : undefined;
    const into = hit.u * L;
    const outof = (1 - hit.u) * L;
    if (into < bw && prev !== undefined) {
      const k = 0.5 + 0.5 * (into / bw);
      w.push([ch.bones[hit.i], k], [prev, 1 - k]);
    } else if (outof < bw && next !== undefined) {
      const k = 0.5 + 0.5 * (outof / bw);
      w.push([ch.bones[hit.i], k], [next, 1 - k]);
    } else w.push([ch.bones[hit.i], 1]);
    for (let k = 0; k < w.length && k < 4; k++) {
      skinIndex[v * 4 + k] = w[k][0];
      skinWeight[v * 4 + k] = w[k][1];
    }
  }
  target.geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
  target.geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));

  const mesh = new THREE.SkinnedMesh(target.geo, target.mats);
  mesh.frustumCulled = false;
  rig.add(mesh);
  rig.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton, mesh.matrixWorld);

  /* ---- the donor's clips, for this body ---- */
  // Joint rotations carry over as they are. Body's position (the hips' bob and
  // crouch) is rescaled about the new rest pose; every other moved joint keeps
  // its fitted place (the donor's feet and pole targets are not skinned here).
  const bodyRestT = bodyB ? bodyB.position.clone() : new THREE.Vector3();
  const k = T.crotch / Math.max(1e-6, D.crotch);
  const keep = new Set(bones.map((b) => b.name));
  const clips = donor.clips.map((c) => {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const t of c.tracks) {
      const dot = t.name.lastIndexOf(".");
      const node = t.name.slice(0, dot);
      const prop = t.name.slice(dot + 1);
      if (!keep.has(node)) continue;
      if (prop === "quaternion") tracks.push(t.clone());
      else if (prop === "position" && node === bn("Body")) {
        const nt = t.clone();
        const vals = nt.values;
        for (let i = 0; i < vals.length; i += 3) {
          vals[i] = bodyRestT.x + (vals[i] - bodyRestD.x) * k;
          vals[i + 1] = bodyRestT.y + (vals[i + 1] - bodyRestD.y) * k;
          vals[i + 2] = bodyRestT.z + (vals[i + 2] - bodyRestD.z) * k;
        }
        tracks.push(nt);
      }
    }
    return new THREE.AnimationClip(c.name, c.duration, tracks);
  });
  return { scene: rig, clips };
}
