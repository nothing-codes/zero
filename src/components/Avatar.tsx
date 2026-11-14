import { useState } from "react";
import { cn, initials } from "../lib/utils";

export function PresenceDot({
  online,
  className,
}: {
  online?: boolean;
  className?: string;
}) {
  // Точка показывается только у людей в сети и всегда серая — как в шапке
  // приложения. У офлайн-собеседников никакого кружка нет.
  if (!online) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "presence-dot pointer-events-none absolute -right-0.5 -bottom-0.5 z-20 grid size-[15px] place-items-center rounded-full border-[2.5px] border-background bg-foreground/45",
        className,
      )}
    >
      <span className="presence-pulse absolute inset-0 rounded-full" />
    </span>
  );
}

const AVATAR_BACKGROUND = "#000";

export function Avatar({
  name,
  src,
  size = 52,
  online,
  className,
  liquid,
  gradient,
  onClick,
  rounded = "full",
}: {
  name: string;
  src?: string | null;
  size?: number;
  online?: boolean;
  className?: string;
  liquid?: boolean;
  gradient?: boolean;
  onClick?: () => void;
  rounded?: "full" | "card";
}) {
  const [active, setActive] = useState(false);
  const letter = initials(name).slice(0, 1);

  const style = {
    width: size,
    height: size,
    display: "grid" as const,
    placeItems: "center" as const,
  };

  const body = liquid ? (
    <span
      aria-hidden
      className={cn(
        "absolute inset-0 grid place-items-center rounded-full text-center font-semibold leading-none tracking-[-0.03em] text-white transition-transform duration-500",
        active && "scale-[1.03]",
      )}
      style={{
        fontSize: size * 0.4,
        background: src ? undefined : AVATAR_BACKGROUND,
      }}
    >
      {src ? (
        <img src={src} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
      ) : (
        <span className="relative z-10">{letter}</span>
      )}
    </span>
  ) : (
    <>
      {src ? (
        <img
          src={src}
          alt={name}
          draggable={false}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <>
          <span
            className="absolute inset-0"
            style={{ background: AVATAR_BACKGROUND }}
          />
          <span
            className="relative z-10 flex size-full select-none items-center justify-center text-center font-semibold leading-none tracking-[-0.03em] text-white"
            style={{ fontSize: size * 0.4 }}
          >
            {letter}
          </span>
        </>
      )}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10"
      />
    </>
  );

  const classNameFull = cn(
    "relative shrink-0 overflow-visible", // overflow-visible чтобы точка онлайна не обрезалась
    rounded === "full" ? "rounded-full" : "radius-card",
    liquid && "liquid-metal",
    className,
  );

  const innerWrapper = (
    <span className="relative flex size-full items-center justify-center overflow-hidden rounded-[inherit]">
      {body}
    </span>
  );

  const pointerHandlers = liquid
    ? {
        onPointerDown: () => setActive(true),
        onPointerUp: () => setActive(false),
        onPointerCancel: () => setActive(false),
        onPointerLeave: () => setActive(false),
      }
    : {};

  const content = (
    <>
      {innerWrapper}
      {online !== undefined ? <PresenceDot online={online} /> : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        aria-label={name}
        onClick={onClick}
        style={style}
        className={cn(classNameFull, "transition-transform duration-300 active:scale-[0.965]")}
        {...pointerHandlers}
      >
        {content}
      </button>
    );
  }

  return (
    <div style={style} className={classNameFull} {...pointerHandlers}>
      {content}
    </div>
  );
}