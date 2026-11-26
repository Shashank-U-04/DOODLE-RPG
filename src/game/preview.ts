// Customize Character's turntable: the picked character on a little plinth,
// idling with its weapon (drag to spin), drawn through the game's own
// ink-on-paper pass on plain paper (no ruled lines), so what you pick here is
// what friends see in the arena. The character cards are static pictures of
// the same render (public/characters/thumbs).

import * as THREE from "three";
import { PAPER_FRAG } from "./shaders";
import { INK, INK_PALETTE, LIGHT_DIR_WORLD, PAPER, PAPER_RGB, makeInkMaterial, shared, type InkId } from "./world";
import { loadCharacter, makeCharacterRig } from "./characters";

/* ------------------------------------------------------------------ *
 * the paper pass, for a renderer of our own
 * ------------------------------------------------------------------ */

type Paper = {
  resize(w: number, h: number): void;
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
  dispose(): void;
};

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
      uInkTex: { value: INK_PALETTE },
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

type Body = NonNullable<ReturnType<typeof makeCharacterRig>>;
/** a character's own parts: only the weapon geometry; the model is shared */
const releaseBody = (b: Body) =>
  (b.root.userData.own as THREE.Object3D | undefined)?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());

/* ------------------------------------------------------------------ *
 * the turntable
 * ------------------------------------------------------------------ */

export type LockerPreview = {
  setCharacter(index: number): void;
  setWeapon(weapon: string): void;
  dispose(): void;
};

export function createLockerPreview(container: HTMLElement, index: number, weapon = "rifle"): LockerPreview {
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

  let current = index;
  let held = weapon;
  let body: Body | null = null;
  let disposed = false;
  let ticket = 0;
  const rebuild = () => {
    const mine = ++ticket;
    void loadCharacter(current).then(() => {
      if (disposed || mine !== ticket) return; // a newer pick won
      const next = makeCharacterRig(current, held);
      if (!next) return;
      if (body) {
        turn.remove(body.root);
        releaseBody(body);
      }
      body = next;
      turn.add(body.root);
    });
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
    body?.anim.update(dt, { moving: false, firing: false, weapon: held });
    paper.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return {
    setCharacter(next) {
      if (next === current) return;
      current = next;
      rebuild();
    },
    setWeapon(next) {
      if (next === held) return;
      held = next;
      rebuild();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      if (body) releaseBody(body);
      for (const g of plinthGeos) g.dispose();
      paper.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

/* ------------------------------------------------------------------ *
 * card thumbnails (a dev step: scripts/_thumbs.ts saves them to public/characters/thumbs)
 * ------------------------------------------------------------------ */

export type Thumbnailer = {
  /** character `index`, whole body, front three-quarter view, as a PNG data URL (holding `weapon`, a rifle by default) */
  shot(index: number, turn?: number, weapon?: string, paint?: { body: InkId; trim: InkId }): Promise<string | null>;
  dispose(): void;
};

export function createThumbnailer(size = 240): Thumbnailer {
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  const paper = paperPass(renderer);
  paper.resize(size, size);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAPER);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
  camera.position.set(0, 1.25, 3.9);
  camera.lookAt(0, 0.92, 0);
  return {
    async shot(index, turn = 0.5, weapon = "rifle", paint) {
      await loadCharacter(index);
      const body = makeCharacterRig(index, weapon, { paint });
      if (!body) return null;
      body.root.rotation.y = turn;
      body.anim.update(0.4, { moving: false, firing: false, weapon });
      scene.add(body.root);
      paper.render(scene, camera);
      const url = canvas.toDataURL("image/png");
      scene.remove(body.root);
      releaseBody(body);
      return url;
    },
    dispose() {
      paper.dispose();
      renderer.dispose();
    },
  };
}
