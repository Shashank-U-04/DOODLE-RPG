// Customize Character's pictures: the turntable (one character on a little
// plinth you can spin) and the item cards' thumbnails. Both are drawn through
// the game's own ink-on-paper pass, on plain paper (no ruled lines), so what
// you dress here is what friends see in the arena.

import * as THREE from "three";
import { PAPER_FRAG } from "./shaders";
import { INK, INK_LIST, INK_RGB, LIGHT_DIR_WORLD, PAPER, PAPER_RGB, makeInkMaterial, shared } from "./world";
import type { Rig } from "./rig";
import { makeAvatar } from "./avatar";
import type { Look, Slot } from "./look";

/* ------------------------------------------------------------------ *
 * the paper pass, for a renderer of our own
 * ------------------------------------------------------------------ */

type Paper = { resize(w: number, h: number): void; render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void; dispose(): void };

function paperPass(renderer: THREE.WebGLRenderer): Paper {
  const newDepth = (w: number, h: number) => {
    const d = new THREE.DepthTexture(w, h);
    d.format = THREE.DepthFormat;
    d.type = THREE.FloatType;
    return d;
  };
  const rt = new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  rt.depthTexture = newDepth(4, 4);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const postScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: rt.texture },
      tDepth: { value: rt.depthTexture },
      uRes: { value: new THREE.Vector2(4, 4) },
      uTime: { value: 0 },
      uHurt: { value: 0 },
      uFlash: { value: 0 },
      uSlow: { value: 0 },
      uLowHp: { value: 0 },
      uOutline: { value: 1 },
      uPlain: { value: 1 },
      uPaper: { value: new THREE.Vector3(...PAPER_RGB) },
      uInks: { value: INK_LIST.map((i) => new THREE.Vector3(...INK_RGB[i])) },
      uNear: { value: 0.1 },
      uFar: { value: 40 },
      uAspect: { value: 1 },
      uLineSpacing: { value: 60 },
      uInvProj: { value: new THREE.Matrix4() },
      uInvView: { value: new THREE.Matrix4() },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
    fragmentShader: PAPER_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  postScene.add(quad);
  return {
    resize(w, h) {
      renderer.setSize(w, h, false);
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      rt.setSize(size.x, size.y);
      rt.depthTexture?.dispose();
      rt.depthTexture = newDepth(size.x, size.y);
      mat.uniforms.tDepth.value = rt.depthTexture;
      mat.uniforms.uRes.value.set(size.x, size.y);
      mat.uniforms.uAspect.value = w / h;
      mat.uniforms.uLineSpacing.value = size.y / 13.5;
    },
    render(scene, camera) {
      const t = performance.now() * 0.001;
      shared.uTime.value = t;
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      shared.uLightDir.value.copy(LIGHT_DIR_WORLD).transformDirection(camera.matrixWorldInverse);
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      const u = mat.uniforms;
      u.uTime.value = t;
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uInvView.value.copy(camera.matrixWorld);
      renderer.render(postScene, postCam);
    },
    dispose() {
      quad.geometry.dispose();
      mat.dispose();
      rt.depthTexture?.dispose();
      rt.dispose();
    },
  };
}

const releaseRig = (r: Rig) => r.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());

/** an easy standing pose: arms relaxed, the gun carried low and pointing ahead */
function standPose(r: Rig, t = 0) {
  const P = r.parts;
  const breathe = Math.sin(t * 1.7);
  P.torso.rotation.x = 0.015 + breathe * 0.01;
  P.head.rotation.y = Math.sin(t * 0.45) * 0.3;
  P.head.rotation.x = Math.sin(t * 0.7) * 0.04;
  P.armL.rotation.set(-0.06 + breathe * 0.025, 0, -0.1);
  P.armR.rotation.set(-0.12 + breathe * 0.02, 0, 0.06);
  P.foreR.rotation.x = -0.12;
  P.foreL.rotation.x = -0.1;
  P.legL.rotation.z = -0.025;
  P.legR.rotation.z = 0.025;
}

/* ------------------------------------------------------------------ *
 * the turntable
 * ------------------------------------------------------------------ */

export type LockerPreview = {
  setLook(look: Look): void;
  setWeapon(weapon: string): void;
  dispose(): void;
};

export function createLockerPreview(container: HTMLElement, look: Look, weapon = "rifle"): LockerPreview {
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const paper = paperPass(renderer);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAPER);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
  const DIST = 4.35;
  camera.position.set(0, 1.2, DIST);
  camera.lookAt(0, 0.95, 0);

  const plinthGeos = [new THREE.CylinderGeometry(0.62, 0.66, 0.08, 40), new THREE.TorusGeometry(0.64, 0.018, 5, 48)];
  const drum = new THREE.Mesh(plinthGeos[0], makeInkMaterial(INK.BLACK, false));
  drum.position.y = -0.04;
  const lip = new THREE.Mesh(plinthGeos[1], makeInkMaterial(INK.BLACK, true));
  lip.rotation.x = Math.PI / 2;
  scene.add(drum, lip);

  const turn = new THREE.Group();
  turn.rotation.y = -0.45;
  scene.add(turn);

  let current = look;
  let held = weapon;
  let rig: Rig | null = null;
  const rebuild = () => {
    if (rig) {
      turn.remove(rig.root);
      releaseRig(rig);
    }
    rig = makeAvatar(current, held);
    turn.add(rig.root);
  };
  rebuild();

  let spin = 0;
  let dragging = false;
  let lastX = 0;
  let idleFor = 0;
  const onDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    turn.rotation.y += dx * 0.012;
    spin = dx * 0.6;
    idleFor = 0;
  };
  const onUp = (e: PointerEvent) => {
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    paper.resize(w, h);
    camera.aspect = w / h;
    // keep the whole figure in frame on a tall, narrow panel too
    camera.position.z = w / h < 0.75 ? DIST / Math.max(0.45, (w / h) * 1.33) : DIST;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!dragging) {
      idleFor += dt;
      spin *= Math.exp(-dt * 3);
      turn.rotation.y += spin * 0.02 + (idleFor > 1.5 ? 0.35 : 0) * dt;
    }
    if (rig) standPose(rig, now * 0.001);
    paper.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return {
    setLook(next) {
      current = next;
      rebuild();
    },
    setWeapon(next) {
      if (next === held) return;
      held = next;
      rebuild();
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      if (rig) releaseRig(rig);
      for (const g of plinthGeos) g.dispose();
      paper.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

/* ------------------------------------------------------------------ *
 * item thumbnails
 * ------------------------------------------------------------------ */

/** where each shelf's camera looks: target height, distance, height above target, and the body's turn */
const FRAMING: Record<Slot, { y: number; dist: number; up: number; turn: number; z?: number }> = {
  hair: { y: 1.7, dist: 0.85, up: 0.12, turn: 0.55 },
  face: { y: 1.69, dist: 0.62, up: 0.02, turn: 0.15 },
  hat: { y: 1.78, dist: 0.95, up: 0.15, turn: 0.45 },
  skin: { y: 1.62, dist: 1.0, up: 0.05, turn: 0.25 },
  shirt: { y: 1.25, dist: 1.45, up: 0.1, turn: 0.35 },
  pants: { y: 0.6, dist: 1.75, up: 0.15, turn: 0.35 },
  shoes: { y: 0.1, dist: 0.85, up: 0.35, turn: 0.7, z: 0.04 },
  extra: { y: 1.15, dist: 2.0, up: 0.2, turn: Math.PI - 0.6 },
};

export type Thumbnailer = {
  /** a picture of `look`, framed on the part `slot` dresses, as a data URL */
  shot(look: Look, slot: Slot): string;
  dispose(): void;
};

export function createThumbnailer(size = 168): Thumbnailer {
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  const paper = paperPass(renderer);
  paper.resize(size, size);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAPER);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 20);

  return {
    shot(look, slot) {
      const f = FRAMING[slot];
      const rig = makeAvatar(look, "");
      standPose(rig);
      rig.parts.head.rotation.set(0, 0, 0);
      rig.root.rotation.y = f.turn;
      scene.add(rig.root);
      camera.position.set(0, f.y + f.up, (f.z ?? 0) + f.dist);
      camera.lookAt(0, f.y, f.z ?? 0);
      paper.render(scene, camera);
      const url = canvas.toDataURL("image/png");
      scene.remove(rig.root);
      releaseRig(rig);
      return url;
    },
    dispose() {
      paper.dispose();
      renderer.dispose();
    },
  };
}
