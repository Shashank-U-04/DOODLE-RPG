// Ready-made battle characters: rigged, animated low-poly models (Quaternius,
// CC0, see public/characters/CREDITS.md) drawn through the game's ink pass.
//
// A model is loaded once (GLB), its materials swapped for soft ink in the
// model's own colours (world.ts inkForColor), and its built-in props removed.
// Every player then gets a skeleton clone with its own AnimationMixer, playing
// idle / run / shoot clips from what the network says they are doing, and the
// game's real weapon in the right hand. Looks are cosmetic: hit tests use the
// body's position and a fixed capsule, never these meshes.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { buildGun, type Rig } from "./rig";
import { rigGunPoints } from "./guns";
import { paintMesh } from "./paint";
import { autorig, type Donor } from "./autorig";
import { inkRgb, makeSoftInkMaterial, type InkId } from "./world";

export type CharacterDef = {
  id: string;
  name: string;
  blurb: string;
  /** under /characters/ */
  file: string;
  /** the bone the weapon is held by */
  hand: string;
  /**
   * "auto": the model has no skeleton (or no usable clips); it is rigged at
   * load time with the donor's skeleton and clips (autorig.ts)
   */
  rig?: "auto";
  /** turn a statue that faces another way to face +z before rigging, radians */
  turn?: number;
};

/** the roster; the index is what a look code stores, so only ever append */
export const CHARACTER_LIST: CharacterDef[] = [
  { id: "swat", name: "SWAT", blurb: "breach, clear, repeat", file: "swat.glb", hand: "Wrist.R" },
  { id: "trooper", name: "TROOPER", blurb: "helmet on, head down", file: "trooper.glb", hand: "Index1.R" },
  { id: "hazmat", name: "HAZMAT", blurb: "sealed suit, no fear", file: "hazmat.glb", hand: "Index1.R" },
  { id: "ranger", name: "RANGER", blurb: "lives out in the long grass", file: "ranger.glb", hand: "Wrist.R" },
  { id: "soldier", name: "SOLDIER", blurb: "front line, every time", file: "soldier.glb", hand: "Wrist.R" },
  { id: "punk", name: "PUNK", blurb: "loud boots, louder aim", file: "punk.glb", hand: "Wrist.R" },
  { id: "punk2", name: "RIOT", blurb: "starts trouble, ends it too", file: "punk2.glb", hand: "Wrist.R" },
  { id: "hoodie", name: "HOODIE", blurb: "hands in pockets till go time", file: "hoodie.glb", hand: "Wrist.R" },
  { id: "worker", name: "ENGINEER", blurb: "fixes things, breaks enemies", file: "worker.glb", hand: "Wrist.R" },
  { id: "viper", name: "VIPER", blurb: "fast feet, faster trigger", file: "viper.glb", hand: "Palm.R" },
  { id: "business", name: "BOSS", blurb: "closes deals, and doors", file: "business.glb", hand: "Wrist.R" },
  { id: "cubeguy", name: "CUBE GUY", blurb: "every angle is a right angle", file: "cubeguy.glb", hand: "Fist.R" },
  { id: "skeleton", name: "SKELETON", blurb: "no skin in the game", file: "skeleton.glb", hand: "Index1.R" },
  {
    id: "punkgirl",
    name: "PUNK GIRL",
    blurb: "spikes, studs and a short fuse",
    file: "punkgirl.glb",
    hand: "Wrist.R",
    rig: "auto",
  },
  { id: "hyper", name: "HYPER", blurb: "pure speed, no details", file: "hyper.glb", hand: "Wrist.R", rig: "auto" },
  { id: "banana", name: "BANANA", blurb: "cool, ripe, dangerous", file: "banana.glb", hand: "Wrist.R", rig: "auto" },
  { id: "warrior", name: "WARRIOR", blurb: "old school, new gun", file: "warrior.glb", hand: "Wrist.R", rig: "auto" },
  { id: "warrior2", name: "GLADIATOR", blurb: "the arena is home", file: "warrior2.glb", hand: "Wrist.R", rig: "auto" },
  { id: "o", name: "O", blurb: "bullseye on the head, still undefeated", file: "o.glb", hand: "Wrist.R", rig: "auto" },
  {
    id: "alien",
    name: "ALIEN",
    blurb: "came in peace, brought a rifle",
    file: "alien.glb",
    hand: "Wrist.R",
    rig: "auto",
  },
];

export const FALLBACK_CHARACTER = 0;

type Template = {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  /** scales the model to 1.8 m */
  scale: number;
  /** the weapon's resting transform in hand-bone space, found from the aiming pose */
  grip: THREE.Matrix4;
};

const templates = new Map<string, Template>();
const pending = new Map<string, Promise<Template | null>>();
const loader = new GLTFLoader();
const HEIGHT = 1.8;

/** GLTFLoader strips "." (and other binding characters) from node names: Wrist.R → WristR */
const boneName = (name: string) => THREE.PropertyBinding.sanitizeNodeName(name);

const clipName = (c: THREE.AnimationClip) => c.name.replace(/^.*\|/, "");

/** the first clip a model has out of a preference list */
function pickClip(clips: Map<string, THREE.AnimationClip>, names: string[]): THREE.AnimationClip | null {
  for (const n of names) {
    const c = clips.get(n);
    if (c) return c;
  }
  return null;
}

/** names of the hand-held props some models ship with */
const WEAPON_PROP =
  /weapon|sword|dagger|knife|axe|gun|pistol|rifle|revolver|shotgun|sniper|smg|launcher|cannon|shovel|shield|staff|spear|bow/i;

/** finger-base bones that mark the palm, by skeleton family */
const PALM_BONES = ["Middle1.R", "MiddleHand.R", "Index1.R"];

/** where the gun is calibrated: a pose that fires straight ahead, so the weapon lines up while shooting */
const AIM_POSE = [
  "Idle_Gun_Shoot",
  "Gun_Shoot",
  "Idle_Shoot",
  "Idle_Gun_Pointing",
  "Idle_Gun",
  "Idle_Hold",
  "Idle",
  "Female_Idle",
  "Man_Idle",
];

/** the donor for auto-rigged characters: a fresh, untouched copy of the SWAT (rest pose, all clips) */
let donor: Promise<Donor> | null = null;
const loadDonor = () =>
  (donor ??= loader.loadAsync("/characters/swat.glb").then((g) => ({ scene: g.scene, clips: g.animations })));

async function build(def: CharacterDef): Promise<Template | null> {
  const gltf = await loader.loadAsync(`/characters/${def.file}`);
  let scene: THREE.Object3D = gltf.scene;
  let animations = gltf.animations;
  if (def.rig === "auto") {
    if (def.turn) gltf.scene.rotation.y = def.turn;
    const rigged = autorig(gltf.scene, await loadDonor());
    scene = rigged.scene;
    animations = rigged.clips;
  }
  const hand = scene.getObjectByName(boneName(def.hand));
  // the model's own weapons hang off the hand; the game draws the real one
  // (the gun hand's attachments, and any weapon-named prop elsewhere, like a dagger in the other hand)
  if (def.rig !== "auto") {
    const props: THREE.Object3D[] = [];
    hand?.traverse((o) => {
      if (o !== hand && (o as THREE.Mesh).isMesh) props.push(o);
    });
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh && WEAPON_PROP.test(o.name))
        props.push(o);
    });
    for (const p of new Set(props)) p.removeFromParent();
  }
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    // auto-rigged meshes come out already inked
    const inked = (Array.isArray(m.material) ? m.material : [m.material]).every(
      (x) => (x as THREE.ShaderMaterial).isShaderMaterial,
    );
    if (!inked) paintMesh(m);
    m.frustumCulled = false;
    m.castShadow = m.receiveShadow = false;
  });

  const clips = new Map<string, THREE.AnimationClip>();
  for (const c of animations) if (!clips.has(clipName(c))) clips.set(clipName(c), c);

  // Size from the bind pose, then find how the hand holds a gun: pose the
  // aiming clip's first frame and take the hand bone's frame relative to the
  // body, so the weapon points straight ahead (+z) with its top up.
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  const scale = HEIGHT / Math.max(0.01, box.max.y - box.min.y);
  const grip = new THREE.Matrix4();
  if (hand) {
    const aim = pickClip(clips, AIM_POSE);
    const mixer = new THREE.AnimationMixer(scene);
    if (aim) mixer.clipAction(aim).play();
    mixer.update(0);
    scene.updateMatrixWorld(true);
    const rootInv = scene.matrixWorld.clone().invert();
    const handInRoot = rootInv.clone().multiply(hand.matrixWorld);
    const pos = new THREE.Vector3().setFromMatrixPosition(handInRoot);
    // The trigger goes in the palm, not at the wrist joint: part-way from the
    // hand bone towards the base of the middle finger (where the model has one).
    const finger = PALM_BONES.map((n) => scene.getObjectByName(boneName(n))).find(
      (b) => b && b !== hand && hand.getObjectById(b.id),
    );
    if (finger) {
      const f = new THREE.Vector3().setFromMatrixPosition(rootInv.clone().multiply(finger.matrixWorld));
      pos.lerp(f, 0.6);
    }
    // weapon frame = model frame (identity rotation, pointing ahead), unit scale in model units
    const want = new THREE.Matrix4().compose(
      pos,
      new THREE.Quaternion(),
      new THREE.Vector3(1, 1, 1).divideScalar(scale),
    );
    grip.copy(handInRoot.invert().multiply(want));
    mixer.stopAllAction();
    mixer.uncacheRoot(scene);
  }
  return { scene, clips, scale, grip };
}

/* ------------------------------------------------------------------ *
 * the sniper rifle the characters carry ("Sniper Rifle" by Zsky, CC-BY 3.0)
 * ------------------------------------------------------------------ */

let sniperModel: THREE.Object3D | null = null;
let sniperLoad: Promise<void> | null = null;
/** the model is 9.11 units long, muzzle at -z, scope up; the trigger sits at (0, -0.35, 1.0) */
const SNIPER_SCALE = 1.2 / 9.11;
function loadSniper(): Promise<void> {
  return (sniperLoad ??= loader
    .loadAsync("/weapons/sniper.glb")
    .then((g) => {
      g.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) paintMesh(o as THREE.Mesh, 4);
      });
      // the rig convention: muzzle down +z, scope up, trigger at the origin
      g.scene.rotation.y = Math.PI;
      g.scene.scale.setScalar(SNIPER_SCALE);
      g.scene.position.set(0, 0.35 * SNIPER_SCALE, 1.0 * SNIPER_SCALE);
      const holder = new THREE.Group();
      holder.add(g.scene);
      sniperModel = holder;
    })
    .catch((err) => console.warn("[characters] sniper model failed to load; using the drawn AWM", err)));
}

/** start (or join) loading a character; resolves to null if the file is missing */
export function loadCharacter(index: number): Promise<Template | null> {
  const def = CHARACTER_LIST[index] ?? CHARACTER_LIST[FALLBACK_CHARACTER];
  if (!def) return Promise.resolve(null);
  const done = templates.get(def.id);
  if (done) return Promise.resolve(done);
  let p = pending.get(def.id);
  if (!p) {
    p = Promise.all([build(def), loadSniper()])
      .then(([t]) => {
        if (t) templates.set(def.id, t);
        return t;
      })
      .catch((err) => {
        console.warn(`[characters] ${def.file} failed to load`, err);
        return null;
      });
    pending.set(def.id, p);
  }
  return p;
}

/* ------------------------------------------------------------------ *
 * the first-person arms: what a character wears on its right forearm and hand
 * ------------------------------------------------------------------ */

/** the inks of a character's right forearm (sleeve, or bare skin) and hand (glove or skin) */
export type ArmInks = { sleeve: InkId; hand: InkId };

const FOREARM_BONE = /^LowerArm\.?R$/;
const HAND_BONE = /^(Wrist|Palm|Fist|MiddleHand|Fingers|Index\d|Middle\d|Ring\d|Pinky\d|Thumb\d)\.?R$/;

const inkOf = (m: THREE.Material | undefined): InkId | null => {
  const u = (m as THREE.ShaderMaterial | undefined)?.uniforms?.uInk;
  return u ? (u.value as InkId) : null;
};

/**
 * Read the arm inks off a loaded (already inked) model: every vertex votes for
 * the ink of its triangle, filed under the bone that moves it most, so the
 * colours are exactly the ones other players see on this body. Rigid meshes
 * hung off an arm bone (a fist, a bracer) vote under that bone.
 */
export function sampleArmInks(scene: THREE.Object3D): ArmInks | null {
  const votes = { sleeve: new Map<InkId, number>(), hand: new Map<InkId, number>() };
  const vote = (where: "sleeve" | "hand", ink: InkId | null, n = 1) => {
    if (ink !== null) votes[where].set(ink, (votes[where].get(ink) ?? 0) + n);
  };
  const part = (name: string): "sleeve" | "hand" | null =>
    FOREARM_BONE.test(name) ? "sleeve" : HAND_BONE.test(name) ? "hand" : null;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const geo = mesh.geometry;
    const skinned = mesh as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh) {
      // a rigid piece: the nearest arm bone above it decides
      let up: THREE.Object3D | null = mesh.parent;
      while (up && !part(up.name)) up = up.parent;
      const where = up && part(up.name);
      if (where) for (const m of mats) vote(where, inkOf(m), geo.getAttribute("position")?.count ?? 1);
      return;
    }
    const idx = geo.getAttribute("skinIndex");
    const wgt = geo.getAttribute("skinWeight");
    if (!idx || !wgt) return;
    const bones = skinned.skeleton.bones;
    // which material draws each vertex: groups cover index (or vertex) ranges
    const matFor = new Array<number>(idx.count).fill(0);
    if (geo.groups.length && mats.length > 1) {
      const index = geo.index;
      for (const g of geo.groups) {
        for (let i = g.start; i < g.start + g.count; i++) matFor[index ? index.getX(i) : i] = g.materialIndex ?? 0;
      }
    }
    for (let v = 0; v < idx.count; v++) {
      let best = 0;
      for (let k = 1; k < 4; k++) if (wgt.getComponent(v, k) > wgt.getComponent(v, best)) best = k;
      const bone = bones[idx.getComponent(v, best)];
      const where = bone && part(bone.name);
      if (where) vote(where, inkOf(mats[matFor[v]]));
    }
  });
  const top = (m: Map<InkId, number>) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const sleeve = top(votes.sleeve);
  const hand = top(votes.hand);
  if (sleeve === null && hand === null) return null;
  return { sleeve: sleeve ?? hand!, hand: hand ?? sleeve! };
}

const armCache = new Map<string, ArmInks | null>();

/** the arm inks of a roster character, once its model has loaded (null if it never does) */
export async function characterArmInks(index: number): Promise<ArmInks | null> {
  const def = CHARACTER_LIST[index] ?? CHARACTER_LIST[FALLBACK_CHARACTER];
  if (!def) return null;
  if (armCache.has(def.id)) return armCache.get(def.id)!;
  const t = await loadCharacter(index);
  const inks = t ? sampleArmInks(t.scene) : null;
  armCache.set(def.id, inks);
  return inks;
}

export function characterReady(index: number): boolean {
  const def = CHARACTER_LIST[index];
  return !!def && templates.has(def.id);
}

/* ------------------------------------------------------------------ *
 * a player's body
 * ------------------------------------------------------------------ */

/** what the body is doing this frame, as the network (or the turntable) says */
export type BodyState = {
  moving: boolean;
  firing: boolean;
  /** a rig weapon id: rifle, shotgun, sniper, pistol, blade */
  weapon: string;
  /** where they look up or down, radians (up is positive); 0 = level */
  pitch?: number;
  /** speed along where they face, m/s (backwards is negative) */
  forward?: number;
  /** speed to their right, m/s (left is negative) */
  side?: number;
};

export type CharacterAnim = {
  /** what the body is doing this frame; picks and blends the clip, then puts both hands on the gun */
  update(dt: number, state: BodyState): void;
  /** a shot leaves the gun: it kicks back into the shoulder and the arms ride it */
  kick(): void;
  /** where the barrel ends, in world space (false while the body has no gun) */
  muzzle(out: THREE.Vector3): boolean;
  /** shot dead: the death clip plays once and holds; the gun falls away */
  die(): void;
};

const CLIPS = {
  // the legs' clips: the arms are posed onto the gun on top of them (holdGun)
  idle: ["Idle_Neutral", "Idle", "Female_Idle", "Man_Idle", "Idle_Hold", "Idle_Gun"],
  walk: ["Walk", "Female_Walk", "Walk_Hold", "Walk_Shoot", "Run", "Female_Run"],
  run: ["Run", "Run_Gun", "Female_Run", "Man_Run", "Run_Hold", "Walk", "Female_Walk"],
  back: ["Run_Back", "Walk", "Female_Walk", "Run", "Female_Run"],
  left: ["Run_Left", "Run", "Female_Run", "Walk"],
  right: ["Run_Right", "Run", "Female_Run", "Walk"],
  bladeIdle: ["Idle_Sword", "Idle_Neutral", "Idle", "Female_Idle", "Man_Idle"],
  bladeRun: ["Run", "Run_Gun", "Female_Run", "Man_Run"],
  bladeHit: ["Sword_Slash", "Female_SwordSlash", "Punch_Right", "Punch", "Female_Punch"],
  death: ["Death", "Female_Death", "Dea", "HitReact", "HitRecieve"],
};

/**
 * Where each gun is carried, from the right shoulder (m): `ahead` of it,
 * `down` from it, `inward` towards the chest; and its size. The drawn guns are
 * sized for the old doodle bodies: on a 1.8 m fighter an AK is about 0.9 m.
 * A pistol is held out in both hands, near the middle of the chest.
 */
const PLACE: Record<string, { ahead: number; down: number; inward: number; scale: number }> = {
  rifle: { ahead: 0.3, down: 0.15, inward: 0.07, scale: 1.3 },
  shotgun: { ahead: 0.3, down: 0.15, inward: 0.07, scale: 1.3 },
  sniper: { ahead: 0.3, down: 0.15, inward: 0.07, scale: 1.3 },
  pistol: { ahead: 0.48, down: 0.1, inward: 0.16, scale: 1.15 },
};

/** Below this (m/s) a moving body walks; above it, it runs (the game walks at 6.6, crouches at 3.6). */
const WALK_MAX = 4.6;

/**
 * Where the wrists go on each gun, in the gun's own frame (trigger at the
 * origin, muzzle down +z, top up +y): a palm's length behind the gun's own
 * grip and support points (guns.ts, the same ones the first-person hands use),
 * the support wrist a little under the handguard.
 */
const RIG_KIND: Record<string, string> = { rifle: "rifle", shotgun: "shotgun", sniper: "sniper", pistol: "revolver" };
const holds = new Map<string, { left: THREE.Vector3; right: THREE.Vector3 } | null>();
function holdFor(weapon: string) {
  let h = holds.get(weapon);
  if (h === undefined) {
    const kind = RIG_KIND[weapon];
    const pts = kind ? rigGunPoints(kind) : null;
    h = pts && {
      right: pts.grip.clone().add(new THREE.Vector3(0.01, -0.01, -0.06)),
      left: pts.support.clone().add(new THREE.Vector3(-0.01, -0.045, -0.05)),
    };
    holds.set(weapon, h);
  }
  return h;
}

/** where a gun's barrel ends, in its own frame: the middle of its front-most vertices */
export function gunMuzzle(gun: THREE.Object3D): THREE.Vector3 {
  const cached = gun.userData.muzzle as THREE.Vector3 | undefined;
  if (cached) return cached;
  gun.updateWorldMatrix(true, true);
  const inv = gun.matrixWorld.clone().invert();
  const pts: THREE.Vector3[] = [];
  gun.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const pos = mesh.isMesh ? mesh.geometry.getAttribute("position") : null;
    if (!pos) return;
    const m = inv.clone().multiply(mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m));
  });
  const front = pts.reduce((z, p) => Math.max(z, p.z), -Infinity);
  const tip = pts.filter((p) => p.z > front - 0.04);
  const out = new THREE.Vector3();
  for (const p of tip) out.add(p);
  if (tip.length) out.divideScalar(tip.length);
  gun.userData.muzzle = out;
  return out;
}

/* ---- two-bone IK: the arms reach for the gun (all in world space) ---- */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();

/** turn `bone` about its own origin so that the world point `from` (which it carries) swings onto the line to `to` */
function aimBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  bone.getWorldPosition(_a);
  const v1 = _b.copy(from).sub(_a);
  const v2 = _c.copy(to).sub(_a);
  if (v1.lengthSq() < 1e-10 || v2.lengthSq() < 1e-10) return;
  _q.setFromUnitVectors(v1.normalize(), v2.normalize());
  bone.getWorldQuaternion(_qw);
  bone.parent!.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_q.multiply(_qw)));
  bone.updateMatrixWorld(true);
}

/** put `hand` (the end of upper → lower) on `target`, the elbow bending towards `pole` */
export function reach(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  hand: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
) {
  const s = upper.getWorldPosition(new THREE.Vector3());
  const e = lower.getWorldPosition(new THREE.Vector3());
  const h = hand.getWorldPosition(new THREE.Vector3());
  const la = s.distanceTo(e);
  const lb = e.distanceTo(h);
  const d = target.clone().sub(s);
  const dist = THREE.MathUtils.clamp(d.length(), Math.abs(la - lb) + 1e-3, (la + lb) * 0.999);
  const dir = d.normalize();
  const cosA = THREE.MathUtils.clamp((la * la + dist * dist - lb * lb) / (2 * la * dist), -1, 1);
  const bend = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0);
  bend.normalize();
  const elbow = s
    .clone()
    .addScaledVector(dir, cosA * la)
    .addScaledVector(bend, Math.sqrt(1 - cosA * cosA) * la);
  aimBone(upper, e, elbow);
  aimBone(lower, hand.getWorldPosition(new THREE.Vector3()), target);
}

/**
 * One colour for the whole body, dark parts (boots, belts, gear) in the trim
 * colour: every material the model had, skin included, becomes one of the two.
 * Only this clone's meshes change; the template keeps its own colours.
 */
function paintBody(model: THREE.Object3D, body: InkId, trim: InkId) {
  const lum = (ink: number) => {
    const [r, g, b] = inkRgb(ink as InkId);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const repaint = (m: THREE.Material) => {
    const ink = (m as THREE.ShaderMaterial).uniforms?.uInk?.value as number | undefined;
    return makeSoftInkMaterial(ink !== undefined && lum(ink) < 0.22 ? trim : body);
  };
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(repaint) : repaint(mesh.material);
  });
}

/** point a hand's fingers along `dir` (world), when it has fingers to point */
function pointHand(hand: THREE.Object3D, dir: THREE.Vector3) {
  const finger = hand.children.find((c) => (c as THREE.Bone).isBone);
  if (!finger) return;
  const at = hand.getWorldPosition(new THREE.Vector3());
  aimBone(hand, finger.getWorldPosition(new THREE.Vector3()), at.add(dir));
}

/**
 * Close a hand round a bar (a pistol grip, a handguard): every finger joint
 * turns towards the nearest point of the bar, so the fingers wrap it instead
 * of lying flat. The thumb is left as the clip has it.
 */
function curlFingers(hand: THREE.Object3D, barAt: THREE.Vector3, barDir: THREE.Vector3) {
  const p = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const near = (v: THREE.Vector3) => {
    const t = v.clone().sub(barAt).dot(barDir);
    return barAt.clone().addScaledVector(barDir, t);
  };
  const curl = (joint: THREE.Object3D, depth: number) => {
    const next = joint.children.find((c) => (c as THREE.Bone).isBone);
    if (!next || depth > 2) return;
    joint.getWorldPosition(p);
    next.getWorldPosition(tip);
    aimBone(joint, tip, near(p).lerp(near(tip), 0.5));
    curl(next, depth + 1);
  };
  for (const f of hand.children) if ((f as THREE.Bone).isBone && !/thumb/i.test(f.name)) curl(f, 0);
}

/**
 * A clone of a loaded character holding `weapon` (a rig weapon id: rifle,
 * shotgun, sniper, blade, pistol; "" for empty hands), or null while it is
 * still loading (the caller draws a stand-in and asks again later).
 *
 * The models' own gun clips are one-handed pistol poses (and some characters
 * have none), so a long gun hung off the hand stuck out of one stiff arm. A
 * gun is instead carried by the body (at the right shoulder, aimed where the
 * player looks) and both arms are solved onto it every frame, right hand on
 * the grip and left on the handguard, over the legs' walk / run clips. A
 * blade still rides the hand: its clips are real sword clips.
 *
 * `offHand` (a riot shield) is carried in the left hand instead, in front of
 * the left half of the chest, and the gun is held in the right hand alone.
 *
 * `paint` repaints the whole body in one colour with dark trim, like a toy
 * soldier: skin, hair and clothes alike. The waves' soldiers use it, so an
 * enemy is told by its class colour and never by anyone's skin tone.
 */
export function makeCharacterRig(
  index: number,
  weapon: string,
  opts: { offHand?: THREE.Object3D | null; paint?: { body: InkId; trim: InkId } } = {},
): (Rig & { anim: CharacterAnim }) | null {
  const def = CHARACTER_LIST[index] ?? CHARACTER_LIST[FALLBACK_CHARACTER];
  const t = def && templates.get(def.id);
  if (!t) return null;

  const root = new THREE.Group();
  const model = cloneSkinned(t.scene);
  model.scale.setScalar(t.scale);
  root.add(model);
  // these share the template's geometry: never dispose it with the player
  root.userData.sharedGeometry = true;
  if (opts.paint) paintBody(model, opts.paint.body, opts.paint.trim);

  const bone = (n: string) => model.getObjectByName(boneName(n)) ?? null;
  const endOf = (b: THREE.Object3D | null) => b?.children.find((c) => (c as THREE.Bone).isBone) ?? null;
  const upR = bone("UpperArm.R");
  const loR = bone("LowerArm.R");
  const upL = bone("UpperArm.L");
  const loL = bone("LowerArm.L");
  const handR = endOf(loR);
  const handL = endOf(loL);
  const hold = holdFor(weapon);
  // two arms to hold it with, and a gun (not a blade)
  const carried = !!(hold && upR && loR && upL && loL && handR && handL);

  const gun = new THREE.Group();
  const sniper = weapon === "sniper" && sniperModel;
  // a drawn gun is this rig's own; the sniper model is shared by every rig
  root.userData.own = sniper ? undefined : gun;
  const hand = model.getObjectByName(boneName(def.hand));
  if (weapon) {
    if (sniper) gun.add(sniperModel!.clone());
    else buildGun(gun, weapon);
    gun.matrixAutoUpdate = false;
    if (carried) root.add(gun);
    else if (hand) {
      gun.matrix.copy(t.grip);
      hand.add(gun);
    }
  }
  const muzzleAt = weapon && weapon !== "blade" && gun.parent ? gunMuzzle(gun).clone() : null;
  const offHand = carried ? (opts.offHand ?? null) : null;
  if (offHand) {
    offHand.removeFromParent();
    offHand.position.set(0, 0, 0);
    offHand.rotation.set(0, 0, 0);
    root.add(offHand);
  }
  let dead = false;

  const mixer = new THREE.AnimationMixer(model);
  let current: THREE.AnimationAction | null = null;
  const play = (names: string[], fade = 0.2) => {
    const clip = pickClip(t.clips, names);
    if (!clip) return null;
    const next = mixer.clipAction(clip);
    if (next !== current) {
      next.reset().setEffectiveWeight(1).play();
      if (current) current.crossFadeTo(next, fade, false);
      current = next;
    }
    return next;
  };
  play(weapon === "blade" ? CLIPS.bladeIdle : CLIPS.idle, 0);

  // eased: the aim, how far the gun is lowered (running), the recoil, the velocity
  let pitch = 0;
  let lower = 0;
  let recoil = 0;
  let fwd = 0;
  let side = 0;
  const place = PLACE[weapon] ?? PLACE.rifle;
  // the sniper model is already true size; the drawn guns are scaled up
  const scale = sniper ? 1 : place.scale;
  const UP = new THREE.Vector3(0, 1, 0);
  const across = new THREE.Vector3();
  const gx = new THREE.Vector3();
  const gy = new THREE.Vector3();
  const gz = new THREE.Vector3();
  const grip = new THREE.Vector3();
  const support = new THREE.Vector3();
  const rootQ = new THREE.Quaternion();

  /** carry the gun at the right shoulder and put both hands on it */
  const holdGun = () => {
    root.updateWorldMatrix(true, true);
    const sR = root.worldToLocal(upR!.getWorldPosition(new THREE.Vector3()));
    const sL = root.worldToLocal(upL!.getWorldPosition(new THREE.Vector3()));
    // the body's right, level: from the left shoulder to the right one
    across.copy(sR).sub(sL).setY(0);
    if (across.lengthSq() < 1e-8) across.set(-1, 0, 0);
    across.normalize();
    // ahead, tipped by the aim; a lowered gun also turns in across the chest
    const inward = across.x < 0 ? 1 : -1;
    gz.set(0, 0, 1)
      .applyAxisAngle(UP, inward * lower * 0.5)
      .applyAxisAngle(across, pitch - lower * 0.55 + recoil * 0.12)
      .normalize();
    gx.crossVectors(UP, gz).normalize();
    gy.crossVectors(gz, gx).normalize();
    // the trigger in front of and below the shoulder, pulled in towards the
    // chest, the stock in the shoulder pocket (a pistol out at arm's length);
    // recoil shoves it back
    grip
      .copy(sR)
      .addScaledVector(across, (offHand ? 0.06 : -place.inward) - lower * 0.08)
      .addScaledVector(gy, -place.down)
      .addScaledVector(gz, place.ahead - recoil * 0.06);
    gun.matrix
      .makeBasis(gx, gy, gz)
      .scale(new THREE.Vector3(scale, scale, scale))
      .setPosition(grip);
    gun.updateMatrixWorld(true);
    // Stylised bodies have short arms: the support hand takes the furthest
    // spot along the handguard it can reach (never further back than the
    // magazine well), rather than straining past it in the air.
    const armL =
      upL!.getWorldPosition(_a).distanceTo(loL!.getWorldPosition(_b)) + _b.distanceTo(handL!.getWorldPosition(_c));
    const sLw = upL!.getWorldPosition(new THREE.Vector3());
    support.copy(hold!.left);
    for (let z = hold!.left.z; z > Math.min(hold!.left.z, 0.1); z -= 0.02) {
      support.z = z;
      if (gun.localToWorld(support.clone()).distanceTo(sLw) <= armL * 0.97) break;
    }

    const on = (o: THREE.Vector3 | [number, number, number]) =>
      gun.localToWorld(Array.isArray(o) ? new THREE.Vector3(o[0], o[1], o[2]) : o.clone());
    root.getWorldQuaternion(rootQ);
    const down = gy.clone().applyQuaternion(rootQ).negate();
    const right = across.clone().applyQuaternion(rootQ);
    const ahead = gz.clone().applyQuaternion(rootQ);
    // elbows down and out, the support elbow tucked under the gun
    reach(upR!, loR!, handR!, on(hold!.right), down.clone().addScaledVector(right, 0.7).addScaledVector(ahead, -0.3));
    if (offHand) {
      // the shield square in front of the left half of the chest, the left
      // hand on its grip behind the boss
      offHand.position
        .copy(sL)
        .addScaledVector(across, 0.06)
        .add(new THREE.Vector3(0, -0.32, 0.36));
      offHand.updateMatrixWorld(true);
      const handle = offHand.localToWorld(new THREE.Vector3(-0.04, 0.05, -0.08));
      reach(upL!, loL!, handL!, handle, down.clone().addScaledVector(right, -0.8));
    } else
      reach(upL!, loL!, handL!, on(support), down.clone().addScaledVector(right, -0.5).addScaledVector(ahead, -0.2));
    // fingers round the grip, and along the handguard
    pointHand(handR!, ahead.clone().multiplyScalar(0.7).addScaledVector(down, 0.6));
    pointHand(handL!, ahead.clone().multiplyScalar(0.6).addScaledVector(down, -0.45).addScaledVector(right, 0.3));
    // and closed: round the grip (down and back from the trigger), round the handguard
    curlFingers(handR!, on([0, -0.06, -0.02]), down.clone().addScaledVector(ahead, -0.35).normalize());
    if (!offHand) curlFingers(handL!, on([0, -0.02, support.z]), ahead);
  };

  const anim: CharacterAnim = {
    update(dt, s) {
      if (dead) {
        mixer.update(dt);
        return;
      }
      const ease = (rate: number) => 1 - Math.exp(-rate * dt);
      fwd += ((s.forward ?? (s.moving ? 6 : 0)) - fwd) * ease(10);
      side += ((s.side ?? 0) - side) * ease(10);
      const speed = Math.hypot(fwd, side);
      const moving = s.moving && speed > 0.4;

      if (s.weapon === "blade") {
        play(s.firing ? CLIPS.bladeHit : moving ? CLIPS.bladeRun : CLIPS.bladeIdle);
        mixer.update(dt);
        return;
      }

      // the legs: walk or run by speed; a back-pedal or a strafe by direction
      let a: THREE.AnimationAction | null;
      if (!moving) a = play(CLIPS.idle);
      else if (fwd < -0.5 && -fwd > Math.abs(side) * 0.8) a = play(CLIPS.back);
      else if (Math.abs(side) > Math.abs(fwd) * 1.2) a = play(side > 0 ? CLIPS.right : CLIPS.left);
      else a = play(speed < WALK_MAX ? CLIPS.walk : CLIPS.run);
      if (a) a.timeScale = moving ? THREE.MathUtils.clamp(speed / (speed < WALK_MAX ? 3 : 7), 0.7, 1.5) : 1;
      mixer.update(dt);

      // the arms: aim where they look; running without shooting lowers the gun
      pitch += (THREE.MathUtils.clamp(s.pitch ?? 0, -1.1, 1.1) - pitch) * ease(14);
      lower += ((moving && !s.firing && speed >= WALK_MAX ? 1 : 0) - lower) * ease(8);
      recoil = Math.max(0, recoil - dt * 9);
      if (carried) holdGun();
    },
    kick() {
      recoil = 1;
    },
    muzzle(out) {
      if (!muzzleAt || dead) return false;
      gun.updateWorldMatrix(true, false);
      gun.localToWorld(out.copy(muzzleAt));
      return true;
    },
    die() {
      if (dead) return;
      dead = true;
      gun.visible = false;
      const a = play(CLIPS.death, 0.1);
      if (a) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
    },
  };
  // posed from the first frame: the turntable and the thumbnails draw at once
  anim.update(0, { moving: false, firing: false, weapon });

  // The engine's procedural limbs are not used for these bodies (they have
  // their own clips); hand it stand-in groups so its type is satisfied.
  const g = () => new THREE.Group();
  const head = model.getObjectByName("Head") ?? g();
  return {
    root,
    parts: {
      hips: g(),
      torso: g(),
      head: head as THREE.Group,
      armL: g(),
      armR: g(),
      foreL: g(),
      foreR: g(),
      legL: g(),
      legR: g(),
      shinL: g(),
      shinR: g(),
      gun,
      shield: (offHand as THREE.Group | null) ?? null,
    },
    headWorldY: 1.65,
    hitHeads: [head],
    anim,
  };
}
