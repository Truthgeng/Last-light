import { useEffect, useRef } from "react";

/**
 * The mechanism, looping every 12 s:
 *  0-5 s   the owner's check-ins pulse into the vault; the vault stays lit
 *  5-6.5 s a check-in is missed; the owner's light fades, the vault opens its ring
 *  6.5-9 s two of the three guardians send their shares to the heir
 *  9-12 s  the heir's half and the shares meet; the heir lights up; reset
 */
export function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const AMBER = [255, 179, 71];
    const EMBER = [255, 106, 61];
    const DIM = [120, 112, 100];
    const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    function node(x: number, y: number, r: number, c: number[], glow: number, label: string, sub?: string) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4.5);
      g.addColorStop(0, rgba(c, 0.45 * glow));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(c, 0.25 + 0.75 * glow);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(243,237,228,${0.45 + 0.4 * glow})`;
      ctx.font = "500 12px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, x, y + r + 20);
      if (sub) {
        ctx.fillStyle = "rgba(165,156,143,0.75)";
        ctx.font = "400 11px Inter, system-ui, sans-serif";
        ctx.fillText(sub, x, y + r + 36);
      }
    }

    function link(ax: number, ay: number, bx: number, by: number, a: number) {
      ctx.strokeStyle = `rgba(243,237,228,${a})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    function spark(ax: number, ay: number, bx: number, by: number, t: number, c: number[]) {
      if (t <= 0 || t >= 1) return;
      const e = ease(t);
      const x = lerp(ax, bx, e);
      const y = lerp(ay, by, e);
      for (let i = 0; i < 6; i++) {
        const tt = Math.max(0, e - i * 0.03);
        ctx.fillStyle = rgba(c, 0.8 - i * 0.13);
        ctx.beginPath();
        ctx.arc(lerp(ax, bx, tt), lerp(ay, by, tt), 3.2 - i * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = rgba(c, 1);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    function frame(ms: number) {
      const T = reduced ? 10.5 : (ms / 1000) % 12;
      ctx.clearRect(0, 0, w, h);
      // Wide: left to right. Narrow (phones): top to bottom, so labels never collide.
      const vertical = w < 560;
      let owner, vault, heir, gs;
      if (vertical) {
        owner = { x: w * 0.5, y: h * 0.08 };
        vault = { x: w * 0.5, y: h * 0.32 };
        gs = [0.18, 0.5, 0.82].map((f) => ({ x: w * f, y: h * 0.58 }));
        heir = { x: w * 0.5, y: h * 0.84 };
      } else {
        const cy = h * 0.46;
        owner = { x: w * 0.12, y: cy };
        vault = { x: w * 0.42, y: cy };
        heir = { x: w * 0.86, y: cy };
        const spread = Math.max(40, Math.min(h / 2 - 52, 120));
        gs = [
          { x: w * 0.64, y: cy - spread },
          { x: w * 0.64, y: cy },
          { x: w * 0.64, y: cy + spread },
        ];
      }

      const missed = ease((T - 5) / 1.5);
      const handed = ease((T - 9) / 1.2);

      link(owner.x, owner.y, vault.x, vault.y, 0.18 * (1 - missed) + 0.05);
      for (const g of gs) link(vault.x, vault.y, g.x, g.y, 0.12);
      link(vault.x, vault.y, heir.x, heir.y, 0.08);
      for (const g of gs) link(g.x, g.y, heir.x, heir.y, 0.07);

      // Check-ins every 1.6 s while the owner is present.
      for (const start of [0.2, 1.8, 3.4]) spark(owner.x, owner.y, vault.x, vault.y, (T - start) / 1.1, AMBER);

      // Vault: steady while alive, a ring opens on release.
      const beat = T < 5 ? 0.85 + 0.15 * Math.sin(T * 4) : 1;
      node(vault.x, vault.y, 13, missed > 0 ? EMBER : AMBER, beat, "Vault", missed > 0.5 ? "released" : "sealed");
      if (missed > 0) {
        ctx.strokeStyle = rgba(EMBER, 0.7 * (1 - handed * 0.6));
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(vault.x, vault.y, 22 + 10 * missed, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * missed);
        ctx.stroke();
      }

      node(owner.x, owner.y, 9, missed > 0.5 ? DIM : AMBER, 1 - missed * 0.75, "Owner", missed > 0.5 ? "missed check-in" : "checking in");

      // Guardians 1 and 3 hand off; guardian 2 does not need to.
      const active = [0, 2];
      gs.forEach((g, i) => {
        const on = active.includes(i) && T > 6.5;
        node(g.x, g.y, 7, on ? AMBER : DIM, on ? 0.9 : 0.35, `Guardian ${i + 1}`, i === 1 ? undefined : on ? "hands off" : undefined);
      });
      spark(gs[0].x, gs[0].y, heir.x, heir.y, (T - 6.6) / 1.6, EMBER);
      spark(gs[2].x, gs[2].y, heir.x, heir.y, (T - 7.2) / 1.6, EMBER);

      node(heir.x, heir.y, 10, handed > 0 ? AMBER : DIM, 0.35 + 0.65 * handed, "Heir", handed > 0.5 ? "opens the vault" : "holds half A");
      if (handed > 0) {
        ctx.strokeStyle = rgba(AMBER, 0.6 * handed);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(heir.x, heir.y, 18 + 8 * handed, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (!reduced) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="hero-canvas" aria-label="Animation: the owner checks in, misses a check-in, and two of three guardians release the vault to the heir" />;
}
