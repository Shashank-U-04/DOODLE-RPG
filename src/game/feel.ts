// Game-feel helpers: smoothing that behaves the same at 30, 60 or 144 fps.
//
// The old camera and viewmodel code eased with `x += (t - x) * dt * k`, which
// changes character with the frame rate, and drove recoil with a linear
// countdown, which reads as a stiff sawtooth. Everything cosmetic about the
// first-person view (aim-down-sights, recoil, bob, landing, sway) now goes
// through these two primitives instead.

/** Exponential approach of `a` toward `b` at `lambda` per second, independent of frame rate. */
export function damp(a: number, b: number, lambda: number, dt: number): number {
  return b + (a - b) * Math.exp(-lambda * dt);
}

/** Cubic ease-in-out of a 0..1 value. */
export function smooth01(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/**
 * A damped spring at rest on zero. `kick` adds velocity; the value overshoots
 * a little and settles, which is what makes a gun's kick read as a punch
 * rather than a slide. Integrated in fixed sub-steps so a long frame cannot
 * blow it up.
 */
export class Spring {
  value = 0;
  vel = 0;
  private readonly stiffness: number;
  private readonly damping: number;
  constructor(stiffness: number, damping: number) {
    this.stiffness = stiffness;
    this.damping = damping;
  }

  kick(v: number) {
    this.vel += v;
  }

  reset() {
    this.value = 0;
    this.vel = 0;
  }

  update(dt: number): number {
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.vel += (-this.stiffness * this.value - this.damping * this.vel) * h;
      this.value += this.vel * h;
    }
    return this.value;
  }
}
