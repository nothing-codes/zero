import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "../lib/utils";
import type { ToastData } from "../types";
import { Avatar } from "./Avatar";

/* ── Keyboard helpers ─────────────────────────────────────────────── */

/**
 * When a bottom sheet or a context menu opens over the composer, the mobile
 * keyboard must go away — otherwise it covers the sheet. Blur on open.
 */
export function hideKeyboard() {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return;
  const tag = active.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || active.isContentEditable) {
    active.blur();
  }
}

function useHideKeyboard(open: boolean, container?: { current: HTMLElement | null }) {
  useEffect(() => {
    if (!open) return;
    const run = () => {
      const active = document.activeElement as HTMLElement | null;
      // Если фокус уже внутри открытого окна (например, поиск в пикере),
      // не закрываем клавиатуру — пользователь сам её вызвал.
      if (active && container?.current?.contains(active)) return;
      hideKeyboard();
    };
    run();
    const timer = window.setTimeout(run, 140);
    return () => window.clearTimeout(timer);
  }, [open, container]);
}

/**
 * На iOS клавиатура не уменьшает layout viewport, и `fixed inset-0` уходит
 * под неё. Считаем окна по visualViewport, чтобы они оставались над
 * клавиатурой.
 */
function useVisualViewportBox() {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setBox({ top: vv.offsetTop, height: vv.height });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return box;
}

/* ── Button ───────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "md" | "sm";
}) {
  return (
    <button
      className={cn(
        "select-none disabled:cursor-default",
        variant === "primary" && "btn-primary text-primary-foreground",
        variant === "secondary" && "btn-secondary text-foreground",
        variant === "ghost" &&
          "press inline-flex items-center justify-center gap-2 rounded-[14px] px-3 text-[14px] font-medium text-muted-foreground hover:text-foreground active:bg-foreground/5",
        variant === "danger" &&
          "press inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-danger/10 text-[15px] font-medium text-danger",
        size === "sm" && "h-11 text-[14px]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ── Icon button ──────────────────────────────────────────────────── */

export function IconButton({
  children,
  className,
  label,
  variant = "ghost",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant?: "ghost" | "surface" | "solid";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "press grid size-10 shrink-0 place-items-center rounded-full text-foreground/85",
        variant === "ghost" && "hover:bg-foreground/6 active:bg-foreground/10",
        variant === "surface" && "bg-foreground/6 hover:bg-foreground/10",
        variant === "solid" && "bg-primary text-primary-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ── Switch ───────────────────────────────────────────────────────── */

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[28px] w-[46px] shrink-0 rounded-full transition-colors duration-300",
        checked ? "bg-primary" : "bg-foreground/14",
      )}
    >
      <motion.span
        animate={{ x: checked ? 20 : 3 }}
        transition={{ type: "spring", stiffness: 620, damping: 34, mass: 0.5 }}
        className={cn(
          "absolute top-[3px] left-0 size-[22px] rounded-full shadow-sm",
          checked ? "bg-primary-foreground" : "bg-foreground/75",
        )}
      />
    </button>
  );
}

/* ── Progress indicator ───────────────────────────────────────────── */

export function ProgressIndicator({
  steps,
  current,
  className,
}: {
  steps: number;
  current: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex flex-1 items-center gap-1.5">
        {Array.from({ length: steps }).map((_, index) => (
          <div
            key={index}
            className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-foreground/10"
          >
            <motion.div
              initial={false}
              animate={{
                width: index < current ? "100%" : index === current ? "58%" : "0%",
              }}
              transition={{ type: "spring", stiffness: 180, damping: 26 }}
              className="absolute inset-y-0 left-0 rounded-full bg-foreground"
            >
              {index === current ? (
                <motion.span
                  aria-hidden
                  animate={{ opacity: [0.15, 0.55, 0.15], x: ["-100%", "160%"] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white to-transparent"
                />
              ) : null}
            </motion.div>
          </div>
        ))}
      </div>
      <span className="t-cap t-num text-faint">
        0{Math.min(current + 1, steps)} / 0{steps}
      </span>
    </div>
  );
}

/* ── Sheet (Исправлено с помощью createPortal) ────────────────────── */

export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
  full,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  full?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const panelRef = useRef<HTMLDivElement>(null);
  useHideKeyboard(open, panelRef);
  const viewport = useVisualViewportBox();

  const sheetContent = (
    <AnimatePresence>
      {open ? (
        <div
          className="fixed inset-0 z-[100] select-none"
          style={viewport ? { top: viewport.top, height: viewport.height } : undefined}
          onContextMenu={(event) => event.preventDefault()}
        >
          <motion.button
            type="button"
            aria-label="Закрыть"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            className="absolute inset-0 h-full w-full cursor-default bg-black/55 backdrop-blur-[3px]"
          />
          <motion.div
            ref={panelRef}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 42, mass: 0.6 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.45 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 650) onClose();
            }}
            style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))" }}
            className={cn(
              "absolute inset-x-0 bottom-0 mx-auto w-full max-w-[520px] overflow-hidden rounded-t-[28px] border-t border-foreground/10 bg-card shadow-[0_-30px_80px_-20px_rgba(0,0,0,0.7)]",
              full && "h-[88%]",
              className,
            )}
          >
            <div className="flex cursor-grab justify-center pt-2.5 pb-1 active:cursor-grabbing">
              <span className="h-1 w-9 rounded-full bg-foreground/20" />
            </div>
            {title ? (
              <div className="flex items-center justify-between px-5 pb-3 pt-2">
                <h2 className="t-h">{title}</h2>
                <IconButton label="Закрыть" onClick={onClose} className="-mr-1 size-8">
                  <X size={17} strokeWidth={1.8} />
                </IconButton>
              </div>
            ) : null}
            <div className={cn("overflow-y-auto px-5", full && "h-[calc(100%-56px)]")}>
              {children}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );

  if (typeof document === "undefined") return null;
  return createPortal(sheetContent, document.body);
}

/* ── Context menu ─────────────────────────────────────────────────── */

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

export function ContextMenu({
  open,
  x,
  y,
  items,
  onClose,
  width = 214,
}: {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  width?: number;
}) {
  const [pos, setPos] = useState({ x, y });
  const panelRef = useRef<HTMLDivElement>(null);

  useHideKeyboard(open, panelRef);

  useEffect(() => {
    if (!open) return;
    const height = items.length * 44 + 16;
    setPos({
      x: Math.max(12, Math.min(x, window.innerWidth - width - 12)),
      y: Math.max(12, Math.min(y, window.innerHeight - height - 12)),
    });
  }, [open, x, y, width, items.length]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[110] select-none" onContextMenu={(event) => event.preventDefault()}>
          <motion.button
            type="button"
            aria-label="Закрыть меню"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            className="absolute inset-0 h-full w-full cursor-default bg-black/25 backdrop-blur-[2px]"
          />
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.5 }}
            style={{ position: "fixed", top: pos.y, left: pos.x, width, transformOrigin: "top left" }}
            className="overflow-hidden rounded-[16px] border border-white/10 bg-[color-mix(in_oklch,var(--card)_94%,transparent)] p-1 shadow-[0_24px_60px_-18px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl"
          >
            {items.map((item, index) => (
              <button
                key={`${item.label}-${index}`}
                type="button"
                onClick={() => {
                  item.onClick();
                  onClose();
                }}
                className={cn(
                  "press flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left text-[14px] font-medium transition-colors",
                  item.danger
                    ? "text-danger hover:bg-danger/10"
                    : "text-foreground hover:bg-foreground/8",
                )}
              >
                {item.icon ? (
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-[9px]",
                      item.danger ? "bg-danger/10 text-danger" : "bg-foreground/6 text-foreground/65",
                    )}
                  >
                    {item.icon}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            ))}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/* ── Rows ─────────────────────────────────────────────────────────── */

export function SettingsRow({
  label,
  hint,
  icon,
  onClick,
  trailing,
  danger,
  className,
  last,
  divider = true,
  compact,
  plain,
}: {
  label: string;
  hint?: string;
  icon?: ReactNode;
  onClick?: () => void;
  trailing?: ReactNode;
  danger?: boolean;
  className?: string;
  last?: boolean;
  divider?: boolean;
  compact?: boolean;
  plain?: boolean;
}) {
  const content = (
    <>
      {icon ? (
        <span
          className={cn(
            "grid shrink-0 place-items-center",
            compact ? "size-6 rounded-[8px]" : "size-8 rounded-[10px]",
            plain
              ? "text-foreground/55"
              : "bg-foreground/6 text-foreground/70",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate",
            compact ? "t-sub" : "t-body",
            danger && "text-danger",
          )}
        >
          {label}
        </span>
        {hint ? <span className="t-sub mt-0.5 block truncate text-faint">{hint}</span> : null}
      </span>
      {trailing ??
        (onClick && !plain ? (
          <ChevronRight size={compact ? 14 : 17} className="shrink-0 text-faint" />
        ) : null)}
    </>
  );

  const rowClassName = cn(
    "flex w-full items-center text-left",
    compact ? "min-h-[42px] gap-2.5 py-2" : "min-h-[56px] gap-3 py-3",
    divider && !last && "hairline-b",
    className,
  );

  if (!onClick) {
    return <div className={rowClassName}>{content}</div>;
  }

  return (
    <button type="button" onClick={onClick} className={cn("press", rowClassName)}>
      {content}
    </button>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("t-cap px-1 pb-2 pt-5 text-faint", className)}>{children}</div>;
}

/* ── Segmented ────────────────────────────────────────────────────── */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  idPrefix,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex gap-1 rounded-[14px] bg-foreground/6 p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "relative flex-1 rounded-[11px] px-2 py-2 text-[13px] font-medium transition-colors",
              active ? "text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`segmented-${idPrefix}`}
                transition={{ type: "spring", stiffness: 480, damping: 36 }}
                className="absolute inset-0 rounded-[11px] bg-primary"
              />
            ) : null}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Skeleton ─────────────────────────────────────────────────────── */

export function ChatListSkeleton() {
  return (
    <div className="space-y-1 px-5 pt-2">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="flex items-center gap-3 py-3" style={{ opacity: 1 - i * 0.09 }}>
          <div className="skeleton size-[52px] shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-[38%] rounded-full" />
            <div className="skeleton h-3 w-[72%] rounded-full" />
          </div>
          <div className="skeleton h-2.5 w-9 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/* ── In-app notification ──────────────────────────────────────────── */

export function InAppToast({
  toast,
  onOpen,
  onClose,
}: {
  toast: ToastData | null;
  onOpen: (chatId: string) => void;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {toast ? (
        <motion.div
          key={toast.id}
          initial={{ y: -92, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -76, opacity: 0, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 430, damping: 34, mass: 0.7 }}
          className="pointer-events-none absolute inset-x-0 top-0 z-[80] flex justify-center px-3 pt-[max(10px,env(safe-area-inset-top,0px))]"
        >
          <div className="pointer-events-auto flex w-full max-w-[480px] items-center gap-3 rounded-[20px] border border-white/10 bg-[color-mix(in_oklch,var(--card)_86%,transparent)] p-2.5 pr-3 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
            <button
              type="button"
              onClick={() => {
                onOpen(toast.chatId);
                onClose();
              }}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <Avatar name={toast.name} src={toast.avatar} size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="t-sub truncate font-semibold text-foreground">{toast.name}</span>
                  <span className="t-time shrink-0 text-faint">сейчас</span>
                </span>
                <span className="t-sub mt-0.5 block truncate text-muted-foreground">{toast.text}</span>
              </span>
            </button>
            <button
              type="button"
              aria-label="Скрыть уведомление"
              onClick={onClose}
              className="grid size-7 place-items-center rounded-full text-faint transition-colors hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* ── Small helpers ────────────────────────────────────────────────── */

export function useDelayedFlag(delay = 260) {
  const [ready, setReady] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    timer.current = window.setTimeout(() => setReady(true), delay);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [delay]);
  return ready;
}