// Ink for models whose colours live in an image texture (Cube Guy, Skeleton,
// the Polygonal Mind and Sloyd figures). The ink pass draws flat inks, not
// textures, so the texture is read once at load time: every triangle takes the
// colour under its centre, the colours are clustered into a few inks (k-means),
// and the triangles are regrouped by ink so the mesh draws with one soft-ink
// material per colour — the same poster-print look as the solid-colour models.

import * as THREE from "three";
import { inkForColor, makeSoftInkMaterial } from "./world";

type RGB = [number, number, number];

/** pixels of a texture image, downsampled (a 256² read is plenty for face colours) */
function readPixels(image: CanvasImageSource & { width: number; height: number }): { data: Uint8ClampedArray; w: number; h: number } | null {
  const w = Math.max(1, Math.min(256, image.width));
  const h = Math.max(1, Math.min(256, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}

/** k-means in sRGB space, seeded from the most spread-out samples */
function cluster(samples: RGB[], k: number): RGB[] {
  if (samples.length === 0) return [[0.5, 0.5, 0.5]];
  const d2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const centers: RGB[] = [samples[Math.floor(samples.length / 2)]];
  while (centers.length < k) {
    let best = -1;
    let far = 0;
    for (let i = 0; i < samples.length; i += Math.max(1, Math.floor(samples.length / 2000))) {
      let m = Infinity;
      for (const c of centers) m = Math.min(m, d2(samples[i], c));
      if (m > far) {
        far = m;
        best = i;
      }
    }
    if (best < 0 || far < 0.002) break; // fewer real colours than k
    centers.push([...samples[best]] as RGB);
  }
  for (let iter = 0; iter < 8; iter++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const s of samples) {
      let bi = 0;
      let bd = Infinity;
      centers.forEach((c, i) => {
        const d = d2(s, c);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      const t = sum[bi];
      t[0] += s[0];
      t[1] += s[1];
      t[2] += s[2];
      t[3]++;
    }
    centers.forEach((c, i) => {
      const t = sum[i];
      if (t[3] > 0) {
        c[0] = t[0] / t[3];
        c[1] = t[1] / t[3];
        c[2] = t[2] / t[3];
      }
    });
  }
  return centers;
}

/** lift near-blacks a little so dark parts still read as shapes on paper */
const lift = (v: number) => 0.1 + v * 0.92;

/** the colour of each triangle of a (non-indexed) geometry, from the material's texture or colour */
function faceColours(geo: THREE.BufferGeometry, mat: THREE.Material): RGB[] {
  const src = mat as THREE.MeshStandardMaterial;
  const base = new THREE.Color(1, 1, 1);
  if (src.color) base.copy(src.color);
  const b = { r: 1, g: 1, b: 1 };
  base.getRGB(b, THREE.SRGBColorSpace);
  const faces = geo.getAttribute("position").count / 3;
  const out: RGB[] = [];
  const map = src.map;
  const uv = geo.getAttribute("uv");
  const vc = geo.getAttribute("color");
  const px = map?.image && uv ? readPixels(map.image as CanvasImageSource & { width: number; height: number }) : null;
  for (let f = 0; f < faces; f++) {
    let r = b.r;
    let g = b.g;
    let bl = b.b;
    if (px && uv) {
      // the colour under the triangle's centre (glTF textures are not flipped: v=0 is the top row)
      let u = 0;
      let v = 0;
      for (let k = 0; k < 3; k++) {
        u += uv.getX(f * 3 + k);
        v += uv.getY(f * 3 + k);
      }
      u = ((u / 3) % 1 + 1) % 1;
      v = ((v / 3) % 1 + 1) % 1;
      const x = Math.min(px.w - 1, Math.floor(u * px.w));
      const y = Math.min(px.h - 1, Math.floor((map!.flipY ? 1 - v : v) * px.h));
      const i = (y * px.w + x) * 4;
      r *= px.data[i] / 255;
      g *= px.data[i + 1] / 255;
      bl *= px.data[i + 2] / 255;
    } else if (vc) {
      const c = new THREE.Color();
      let rr = 0;
      let gg = 0;
      let bb = 0;
      for (let k = 0; k < 3; k++) {
        c.fromBufferAttribute(vc, f * 3 + k);
        const o = { r: 0, g: 0, b: 0 };
        c.getRGB(o, THREE.SRGBColorSpace);
        rr += o.r;
        gg += o.g;
        bb += o.b;
      }
      r *= rr / 3;
      g *= gg / 3;
      bl *= bb / 3;
    }
    out.push([r, g, bl]);
  }
  return out;
}

/**
 * Re-colour a mesh in ink: a textured (or vertex-coloured) mesh gets its faces
 * clustered into at most `k` inks and regrouped by ink; a plain one gets its
 * material's colour. Works for skinned meshes (skin attributes are carried).
 */
export function paintMesh(mesh: THREE.Mesh, k = 10) {
  const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
  const textured = !!mat.map || !!mesh.geometry.getAttribute("color");
  if (!textured) {
    const c = { r: 1, g: 1, b: 1 };
    (mat.color ?? new THREE.Color(1, 1, 1)).getRGB(c, THREE.SRGBColorSpace);
    mesh.material = makeSoftInkMaterial(inkForColor(lift(c.r), lift(c.g), lift(c.b)));
    return;
  }
  const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const colours = faceColours(geo, mat);
  const centers = cluster(colours, k);
  const inks = centers.map((c) => makeSoftInkMaterial(inkForColor(lift(c[0]), lift(c[1]), lift(c[2]))));
  const which = colours.map((s) => {
    let bi = 0;
    let bd = Infinity;
    centers.forEach((c, i) => {
      const d = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    return bi;
  });
  // reorder the triangles so each ink's faces are contiguous, then one group per ink
  const order = which.map((w, f) => [w, f]).sort((a, b) => a[0] - b[0]);
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute;
    const n = a.itemSize;
    const arr = new (a.array.constructor as { new (len: number): THREE.TypedArray })(a.array.length);
    let o = 0;
    for (const [, f] of order) {
      for (let v = 0; v < 3; v++) {
        const src = (f * 3 + v) * n;
        for (let c = 0; c < n; c++) arr[o++] = a.array[src + c];
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, n, a.normalized));
  }
  let start = 0;
  for (let i = 0; i < order.length; ) {
    const w = order[i][0];
    let j = i;
    while (j < order.length && order[j][0] === w) j++;
    out.addGroup(start * 3, (j - i) * 3, w);
    start += j - i;
    i = j;
  }
  if (!out.getAttribute("normal")) out.computeVertexNormals();
  mesh.geometry = out;
  mesh.material = inks;
}
