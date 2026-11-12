import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";

export function ContactGlobe({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = 292;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const color = document.documentElement.classList.contains("light")
      ? "rgba(0,0,0,0.75)"
      : "rgba(255,255,255,0.82)";
    const glowColor = document.documentElement.classList.contains("light")
      ? "rgba(0,0,0,0.05)"
      : "rgba(255,255,255,0.055)";
    const dots: { lat: number; lon: number }[] = [];
    const count = 460;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i += 1) {
      const y = 1 - (i / (count - 1)) * 2;
      dots.push({
        lat: Math.asin(y),
        lon: golden * i,
      });
    }

    const cx = size / 2;
    const cy = size / 2;
    const R = size * 0.335;
    const tilt = -0.32;
    let rot = 0;
    let raf = 0;
    let last = performance.now();

    const draw = (time: number) => {
      const dt = Math.min(64, time - last);
      last = time;
      if (!reduce) rot += dt * 0.00016;

      ctx.clearRect(0, 0, size, size);

      const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.5);
      glow.addColorStop(0, glowColor);
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.12;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();

      const cosT = Math.cos(tilt);
      const sinT = Math.sin(tilt);

      for (const dot of dots) {
        const cosLat = Math.cos(dot.lat);
        const x = cosLat * Math.sin(dot.lon + rot);
        const z0 = cosLat * Math.cos(dot.lon + rot);
        const y0 = Math.sin(dot.lat);
        const y = y0 * cosT - z0 * sinT;
        const z = y0 * sinT + z0 * cosT;

        const sx = cx + x * R;
        const sy = cy + y * R;
        const depth = (z + 1) / 2;
        if (depth < 0.35) continue;
        ctx.globalAlpha = 0.06 + Math.pow(depth, 2.4) * 0.6;
        ctx.fillStyle = color;
        const radius = 0.7 + depth * 1.05;
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={cn("relative mx-auto aspect-square w-full max-w-[292px]", className)}>
      <div className="absolute inset-[9%] rounded-full bg-foreground/[0.035] blur-2xl" />
      <canvas ref={canvasRef} className="relative size-full text-foreground" />
      <svg
        viewBox="0 0 300 300"
        className="pointer-events-none absolute inset-0 size-full text-foreground/45"
        aria-hidden
      >
        <ellipse
          cx="150"
          cy="150"
          rx="134"
          ry="44"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.7"
          strokeDasharray="2 6"
          opacity="0.5"
          transform="rotate(-18 150 150)"
        />
        <ellipse
          cx="150"
          cy="150"
          rx="140"
          ry="61"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.7"
          strokeDasharray="1 8"
          opacity="0.32"
          transform="rotate(22 150 150)"
        />
      </svg>
    </div>
  );
}