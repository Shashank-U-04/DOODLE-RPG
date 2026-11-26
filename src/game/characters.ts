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
import { paintMesh } from "./paint";
import { autorig, type Donor } from "./autorig";
import type { InkId } from "./world";

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

export type CharacterAnim = {
  /** what the body is doing this frame; picks and blends the clip */
  update(dt: number, state: { moving: boolean; firing: boolean; weapon: string }): void;
};

const CLIPS = {
  idle: ["Idle_Gun_Pointing", "Idle_Gun", "Idle_Hold", "Idle", "Female_Idle", "Man_Idle"],
  idleFire: ["Idle_Gun_Shoot", "Idle_Shoot", "Gun_Shoot", "Idle_Gun", "Idle_Hold", "Idle", "Female_Idle", "Man_Idle"],
  run: ["Run_Gun", "Run_Shoot", "Run_Hold", "Run", "Female_Run", "Man_Run"],
  runFire: ["Run_Shoot", "Run_Gun_Shoot", "Run_Gun", "Run_Hold", "Run", "Female_Run", "Man_Run"],
  bladeIdle: ["Idle_Sword", "Idle_Neutral", "Idle", "Female_Idle", "Man_Idle"],
  bladeRun: ["Run", "Run_Gun", "Female_Run", "Man_Run"],
  bladeHit: ["Sword_Slash", "Female_SwordSlash", "Punch_Right", "Punch", "Female_Punch"],
};

/**
 * A clone of a loaded character holding `weapon` (a rig weapon id: rifle,
 * shotgun, sniper, blade, pistol; "" for empty hands), or null while it is
 * still loading (the caller draws a stand-in and asks again later).
 */
export function makeCharacterRig(index: number, weapon: string): (Rig & { anim: CharacterAnim }) | null {
  const def = CHARACTER_LIST[index] ?? CHARACTER_LIST[FALLBACK_CHARACTER];
  const t = def && templates.get(def.id);
  if (!t) return null;

  const root = new THREE.Group();
  const model = cloneSkinned(t.scene);
  model.scale.setScalar(t.scale);
  root.add(model);
  // these share the template's geometry: never dispose it with the player
  root.userData.sharedGeometry = true;

  const gun = new THREE.Group();
  const sniper = weapon === "sniper" && sniperModel;
  // a drawn gun is this rig's own; the sniper model is shared by every rig
  root.userData.own = sniper ? undefined : gun;
  const hand = model.getObjectByName(boneName(def.hand));
  if (hand && weapon) {
    gun.matrixAutoUpdate = false;
    gun.matrix.copy(t.grip);
    hand.add(gun);
    if (sniper) gun.add(sniperModel!.clone());
    else buildGun(gun, weapon);
  }

  const mixer = new THREE.AnimationMixer(model);
  let current: THREE.AnimationAction | null = null;
  const play = (names: string[], fade = 0.18) => {
    const clip = pickClip(t.clips, names);
    if (!clip) return;
    const next = mixer.clipAction(clip);
    if (next === current) return;
    next.reset().setEffectiveWeight(1).play();
    if (current) current.crossFadeTo(next, fade, false);
    current = next;
  };
  play(weapon === "blade" ? CLIPS.bladeIdle : CLIPS.idle, 0);

  const anim: CharacterAnim = {
    update(dt, s) {
      const blade = s.weapon === "blade";
      if (blade) play(s.firing ? CLIPS.bladeHit : s.moving ? CLIPS.bladeRun : CLIPS.bladeIdle);
      else if (s.moving) play(s.firing ? CLIPS.runFire : CLIPS.run);
      else play(s.firing ? CLIPS.idleFire : CLIPS.idle);
      mixer.update(dt);
    },
  };

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
      shield: null,
    },
    headWorldY: 1.65,
    hitHeads: [head],
    anim,
  };
}
