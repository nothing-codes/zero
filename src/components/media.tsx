import { useMemo } from "react";
import { cn, rng } from "../lib/utils";

/* ── Generated monochrome photography ─────────────────────────────── */

export function PhotoArt({
  seed,
  className,
  wide,
}: {
  seed: number;
  className?: string;
  wide?: boolean;
}) {
  const art = useMemo(() => {
    const r = rng(seed * 7919 + 17);
    const skyTop = Math.round(8 + r() * 14);
    const skyMid = Math.round(26 + r() * 22);
    const skyLow = Math.round(40 + r() * 26);
    const moonX = 80 + r() * 240;
    const moonY = 70 + r() * 120;
    const moonR = 26 + r() * 34;
    const horizon = 250 + r() * 60;
    const layers = [0, 1, 2].map((i) => {
      const base = horizon + i * 34 + r() * 20;
      const peak = base - 40 - r() * 70;
      const mid = base - 10 - r() * 30;
      return {
        base,
        peak,
        mid,
        points: `0,500 0,${base} ${40 + r() * 70},${mid} ${130 + r() * 60},${peak} ${250 + r() * 60},${mid + r() * 30} ${340 + r() * 40},${peak + r() * 30} 400,${base} 400,500`,
        light: Math.round(9 + i * 7 + r() * 6),
      };
    });
    return { skyTop, skyMid, skyLow, moonX, moonY, moonR, layers, vignette: 0.45 + r() * 0.2 };
  }, [seed]);

  const id = `ph${seed}`;

  return (
    <div className={cn("relative overflow-hidden bg-[#121212]", className)}>
      <svg
        viewBox="0 0 400 500"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 size-full"
        aria-hidden
      >
        <defs>
          <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0.25" y2="1">
            <stop offset="0%" stopColor={`hsl(0 0% ${art.skyTop}%)`} />
            <stop offset="52%" stopColor={`hsl(0 0% ${art.skyMid}%)`} />
            <stop offset="100%" stopColor={`hsl(0 0% ${art.skyLow}%)`} />
          </linearGradient>
          <radialGradient id={`${id}-moon`}>
            <stop offset="0%" stopColor="hsl(0 0% 96%)" stopOpacity="0.95" />
            <stop offset="55%" stopColor="hsl(0 0% 86%)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="hsl(0 0% 80%)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-vignette`}>
            <stop offset="45%" stopColor="black" stopOpacity="0" />
            <stop offset="100%" stopColor="black" stopOpacity={art.vignette} />
          </radialGradient>
          <filter id={`${id}-soft`}>
            <feGaussianBlur stdDeviation="18" />
          </filter>
          <filter id={`${id}-grain`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>

        <rect width="400" height="500" fill={`url(#${id}-sky)`} />

        <ellipse
          cx={70 + (seed % 4) * 20}
          cy={210}
          rx="170"
          ry="70"
          fill="hsl(0 0% 92%)"
          opacity="0.09"
          filter={`url(#${id}-soft)`}
        />
        <circle cx={art.moonX} cy={art.moonY} r={art.moonR * 2.4} fill={`url(#${id}-moon)`} />
        <circle cx={art.moonX} cy={art.moonY} r={art.moonR} fill="hsl(0 0% 93% / 0.9)" />

        {art.layers.map((layer, index) => (
          <polygon
            key={index}
            points={layer.points}
            fill={`hsl(0 0% ${layer.light}%)`}
            opacity={index === 0 ? 0.85 : 1}
          />
        ))}

        <rect width="400" height="500" fill={`url(#${id}-vignette)`} />
        <rect width="400" height="500" filter={`url(#${id}-grain)`} opacity="0.16" style={{ mixBlendMode: "overlay" }} />
      </svg>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/10" />
    </div>
  );
}

/* ── Stylised map ─────────────────────────────────────────────────── */

export function MapArt({ seed, className }: { seed: number; className?: string }) {
  const roads = useMemo(() => {
    const r = rng(seed * 131 + 3);
    return [0, 1, 2, 3, 4].map((i) => {
      const y = 30 + i * 42 + r() * 16;
      return `M-20 ${y} C 80 ${y - 26 + r() * 30}, 160 ${y + 28 - r() * 20}, 300 ${y - 8 + r() * 24} S 420 ${y + 12}, 440 ${y - 16}`;
    });
  }, [seed]);

  return (
    <div className={cn("relative overflow-hidden bg-foreground/[0.04]", className)}>
      <svg viewBox="0 0 400 250" className="absolute inset-0 size-full" aria-hidden>
        <g stroke="currentColor" fill="none">
          <g opacity="0.07">
            {Array.from({ length: 9 }).map((_, i) => (
              <line key={`v${i}`} x1={i * 50} y1="0" x2={i * 50 + 20} y2="250" strokeWidth="1" />
            ))}
            {Array.from({ length: 6 }).map((_, i) => (
              <line key={`h${i}`} x1="0" y1={i * 50} x2="400" y2={i * 50 - 14} strokeWidth="1" />
            ))}
          </g>
          <path
            d={`M-20 ${170} C 90 ${140}, 150 ${190}, 240 ${150} S 360 ${110}, 430 ${140}`}
            stroke="currentColor"
            strokeWidth="14"
            opacity="0.06"
            strokeLinecap="round"
          />
          {roads.map((d, i) => (
            <path
              key={i}
              d={d}
              stroke="currentColor"
              strokeWidth={i === 2 ? 3 : 1.6}
              opacity={i === 2 ? 0.24 : 0.13}
              strokeLinecap="round"
            />
          ))}
          <rect x="52" y="40" width="52" height="34" rx="4" opacity="0.07" fill="currentColor" stroke="none" />
          <rect x="130" y="86" width="70" height="44" rx="4" opacity="0.05" fill="currentColor" stroke="none" />
          <rect x="248" y="44" width="46" height="52" rx="4" opacity="0.07" fill="currentColor" stroke="none" />
          <rect x="272" y="128" width="64" height="38" rx="4" opacity="0.05" fill="currentColor" stroke="none" />
          <rect x="64" y="120" width="44" height="40" rx="4" opacity="0.05" fill="currentColor" stroke="none" />
        </g>
      </svg>
      <span className="absolute left-1/2 top-1/2 z-10 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black shadow-[0_4px_18px_rgba(0,0,0,0.55)]">
        <span className="size-2.5 rounded-full bg-black" />
      </span>
      <span className="absolute left-1/2 top-1/2 -z-0 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/15 blur-md" />
    </div>
  );
}

/* ── Sticker set ──────────────────────────────────────────────────── */

export function StickerArt({ id, className }: { id: string; className?: string }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg viewBox="0 0 120 120" className={cn("size-full", className)} aria-hidden>
      {id === "orb" ? (
        <g>
          <circle cx="60" cy="60" r="42" {...common} opacity="0.55" />
          <ellipse cx="60" cy="60" rx="43" ry="17" {...common} opacity="0.35" transform="rotate(-24 60 60)" />
          <ellipse cx="60" cy="60" rx="17" ry="43" {...common} opacity="0.35" transform="rotate(-24 60 60)" />
          <circle cx="60" cy="60" r="22" fill="currentColor" opacity="0.9" />
          <circle cx="51" cy="50" r="6" fill="var(--background)" opacity="0.55" />
          <circle cx="93" cy="35" r="3.4" fill="currentColor" />
          <circle cx="24" cy="82" r="2.2" fill="currentColor" opacity="0.6" />
        </g>
      ) : null}

      {id === "ghost" ? (
        <g>
          <path
            d="M32 98V56a28 28 0 0 1 56 0v42l-9-7-9 7-10-7-10 7-9-7-9 7Z"
            fill="currentColor"
            opacity="0.92"
            stroke="none"
          />
          <circle cx="48" cy="55" r="5" fill="var(--background)" />
          <circle cx="72" cy="55" r="5" fill="var(--background)" />
          <path d="M52 72c4 5 12 5 16 0" stroke="var(--background)" strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      ) : null}

      {id === "cat" ? (
        <g>
          <path d="M35 44 28 22l22 12c6-2 14-2 20 0l22-12-7 22" {...common} />
          <path d="M35 44c-6 8-8 20-6 30 3 14 16 22 31 22s28-8 31-22c2-10 0-22-6-30" {...common} />
          <circle cx="49" cy="62" r="2.6" fill="currentColor" />
          <circle cx="71" cy="62" r="2.6" fill="currentColor" />
          <path d="M56 74c2 2 6 2 8 0" {...common} strokeWidth="2" />
          <path d="M30 70h-9M30 76l-8 4M90 70h9M90 76l8 4" {...common} strokeWidth="2" opacity="0.5" />
        </g>
      ) : null}

      {id === "hand" ? (
        <g>
          <path
            d="M44 78 36 54c-1-5 6-8 8-3l5 12-7-28c-1-5 6-7 8-2l7 24-4-30c-1-5 7-6 8-1l4 30-1-26c0-5 8-5 8 0l1 30c1 12-5 24-16 27-10 3-18-3-23-12Z"
            {...common}
          />
          <path d="M60 18c4-6 12-4 13 2 1 5-4 8-8 6" {...common} strokeWidth="2.2" opacity="0.7" />
        </g>
      ) : null}

      {id === "moon" ? (
        <g>
          <path d="M70 22a38 38 0 1 0 26 60A34 34 0 0 1 70 22Z" fill="currentColor" opacity="0.9" stroke="none" />
          <path d="M50 32c2-4 8-4 10 0s-2 8-6 7" {...common} strokeWidth="2" opacity="0.45" />
          <path d="M88 28v10M83 33h10" {...common} strokeWidth="2" opacity="0.7" />
          <path d="M96 70v7M92.5 73.5h7" {...common} strokeWidth="1.8" opacity="0.5" />
          <circle cx="84" cy="52" r="1.8" fill="currentColor" opacity="0.6" />
        </g>
      ) : null}

      {id === "mug" ? (
        <g>
          <path d="M30 46h50v28c0 14-11 24-25 24S30 88 30 74V46Z" {...common} />
          <path d="M80 54h7c9 0 13 6 13 13s-4 13-13 13h-7" {...common} />
          <path d="M41 30c-4-5 3-7 0-12M54 30c-4-5 3-7 0-12M67 30c-4-5 3-7 0-12" {...common} strokeWidth="2" opacity="0.5" />
          <path d="M42 62h26" {...common} strokeWidth="3" opacity="0.45" />
        </g>
      ) : null}

      {id === "star" ? (
        <g>
          <path d="M60 18c4 24 18 38 42 42-24 4-38 18-42 42-4-24-18-38-42-42 24-4 38-18 42-42Z" fill="currentColor" />
          <circle cx="94" cy="86" r="4" fill="currentColor" opacity="0.55" />
          <circle cx="27" cy="31" r="2.5" fill="currentColor" opacity="0.5" />
        </g>
      ) : null}

      {id === "wave" ? (
        <g>
          <path d="M22 60h10M88 60h10M31 40c6-10 14-16 25-19M89 40c-6-10-14-16-25-19M31 80c6 10 14 16 25 19M89 80c-6 10-14 16-25 19" {...common} opacity="0.85" />
          <circle cx="60" cy="60" r="12" fill="currentColor" opacity="0.85" />
          <circle cx="60" cy="60" r="24" {...common} opacity="0.35" />
        </g>
      ) : null}

      {id === "spark" ? (
        <g>
          <path d="M46 26c2 13 10 21 23 23-13 2-21 10-23 23-2-13-10-21-23-23 13-2 21-10 23-23Z" fill="currentColor" />
          <path d="M83 52c1.4 9 7 14.6 16 16-9 1.4-14.6 7-16 16-1.4-9-7-14.6-16-16 9-1.4 14.6-7 16-16Z" fill="currentColor" opacity="0.6" />
          <circle cx="85" cy="26" r="3" fill="currentColor" opacity="0.5" />
        </g>
      ) : null}

      {id === "eye" ? (
        <g>
          <path d="M16 60c14-22 30-32 44-32s30 10 44 32c-14 22-30 32-44 32S30 82 16 60Z" {...common} />
          <circle cx="60" cy="60" r="16" {...common} />
          <circle cx="60" cy="60" r="7" fill="currentColor" />
          <path d="M60 30v-8M36 38l-5-6M84 38l5-6" {...common} strokeWidth="2" opacity="0.5" />
        </g>
      ) : null}

      {id === "cloud" ? (
        <g>
          <path d="M35 78c-10 0-17-7-17-16 0-10 8-17 18-16 2-12 12-20 24-20 14 0 25 10 26 24 9 0 15 6 15 14s-7 14-16 14H35Z" {...common} />
          <path d="M45 94v4M60 94v8M75 94v4" {...common} strokeWidth="2.4" opacity="0.45" />
        </g>
      ) : null}

      {id === "flower" ? (
        <g>
          {Array.from({ length: 6 }).map((_, i) => (
            <ellipse
              key={i}
              cx="60"
              cy="42"
              rx="9"
              ry="20"
              {...common}
              opacity="0.75"
              transform={`rotate(${i * 60} 60 60)`}
            />
          ))}
          <circle cx="60" cy="60" r="8" fill="currentColor" />
        </g>
      ) : null}
    </svg>
  );
}
