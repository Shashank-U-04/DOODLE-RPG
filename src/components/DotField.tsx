// The menus' backdrop: ink dots drifting over the cream paper, joined by
// fine lines whenever two come close, and reaching for the cursor. A plain 2D
// canvas behind the cards; it rests when the tab is hidden and stands still
// for people who prefer reduced motion.

import { useEffect, useRef } from "react";

const INKS = ["26, 48, 192", "26, 48, 192", "26, 48, 192", "208, 32, 48", "235, 140, 20"];
const LINK = 150; // px: dots closer than this are joined
const REACH = 190; // px: the cursor joins dots within this

type Dot = { x: number; y: number; vx: number; vy: number; r: number; ink: string };

export default function DotField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let w = 0;
    let h = 0;
    let dots: Dot[] = [];
    const mouse = { x: -1e4, y: -1e4 };

    const seed = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.max(28, Math.min(120, Math.round((w * h) / 13000)));
      dots = Array.from({ length: n }, () => {
        const a = Math.random() * Math.PI * 2;
        const s = 0.08 + Math.random() * 0.22;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          r: 1.4 + Math.random() * 1.8,
          ink: INKS[Math.floor(Math.random() * INKS.length)],
        };
      });
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1;
      for (let i = 0; i < dots.length; i++) {
        const a = dots[i];
        for (let j = i + 1; j < dots.length; j++) {
          const b = dots[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > LINK * LINK) continue;
          const t = 1 - Math.sqrt(d2) / LINK;
          ctx.strokeStyle = `rgba(26, 48, 192, ${(t * 0.32).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        const mx = a.x - mouse.x;
        const my = a.y - mouse.y;
        const md = Math.hypot(mx, my);
        if (md < REACH) {
          ctx.strokeStyle = `rgba(208, 32, 48, ${((1 - md / REACH) * 0.45).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
      }
      for (const d of dots) {
        ctx.fillStyle = `rgba(${d.ink}, 0.7)`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const step = () => {
      for (const d of dots) {
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < -20) d.x = w + 20;
        else if (d.x > w + 20) d.x = -20;
        if (d.y < -20) d.y = h + 20;
        else if (d.y > h + 20) d.y = -20;
      }
    };

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      step();
      draw();
    };

    const onResize = () => {
      seed();
      if (still) draw();
    };
    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (still) draw();
    };
    const onLeave = () => {
      mouse.x = mouse.y = -1e4;
    };

    seed();
    draw();
    if (!still) raf = requestAnimationFrame(tick);
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={ref} className="dd-dotfield" aria-hidden="true" />;
}
