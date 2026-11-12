import { motion } from "motion/react";
import { MessageCircle, Phone, Settings2, Users } from "lucide-react";
import { cn, haptic } from "../lib/utils";

export type Tab = "chats" | "contacts" | "calls" | "settings";

const ITEMS: { id: Tab; label: string; icon: typeof MessageCircle }[] = [
  { id: "chats", label: "Чаты", icon: MessageCircle },
  { id: "contacts", label: "Контакты", icon: Users },
  { id: "calls", label: "Звонки", icon: Phone },
  { id: "settings", label: "Настройки", icon: Settings2 },
];

export function Dock({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto flex w-full max-w-[520px] justify-center px-4 pb-[max(14px,env(safe-area-inset-bottom,0px))]">
      <nav className="pointer-events-auto flex items-center justify-center gap-1 rounded-[24px] border border-foreground/10 bg-[color-mix(in_oklch,var(--card)_90%,transparent)] p-1.5 shadow-[0_20px_50px_-16px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl">
        {ITEMS.map((item) => {
          const isActive = item.id === active;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (!isActive) haptic(5);
                onChange(item.id);
              }}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex h-11 items-center justify-center rounded-[16px] transition-all duration-300",
                isActive ? "px-4 text-primary-foreground" : "w-11 text-muted-foreground hover:text-foreground",
              )}
            >
              {isActive ? (
                <motion.span
                  layoutId="dock-active"
                  transition={{ type: "spring", stiffness: 460, damping: 34, mass: 0.55 }}
                  className="absolute inset-0 rounded-[16px] bg-primary"
                />
              ) : null}

              <span className="relative flex items-center justify-center gap-2">
                <Icon size={20} strokeWidth={isActive ? 2.1 : 1.7} />
                {isActive && <span className="whitespace-nowrap text-[13px] font-medium tracking-[-0.01em]">{item.label}</span>}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}