import { motion } from "motion/react";
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Sheet } from "../components/ui";
import { isZeroIdentity } from "../lib/identity";
import { useAuthedStore } from "../lib/store";
import { cn, duration, haptic, listTime } from "../lib/utils";

const FILTERS = [
  { id: "all", label: "Все" },
  { id: "missed", label: "Пропущенные" },
] as const;

export function CallsScreen({ onCall }: { onCall: (chatId: string) => void }) {
  const { state, openOrCreateChat } = useAuthedStore();
  const [filter, setFilter] = useState<"all" | "missed">("all");
  const [dialOpen, setDialOpen] = useState(false);
  const [handle, setHandle] = useState("");

  const calls = useMemo(
    () => (filter === "missed" ? state.calls.filter((call) => call.direction === "missed") : state.calls),
    [state.calls, filter],
  );

  const startCall = (chatId: string | undefined, name: string) => {
    const target = chatId ? state.chats.find((chat) => chat.id === chatId) : undefined;
    if (target && isZeroIdentity(target)) return;
    haptic(6);
    const id =
      chatId && state.chats.some((chat) => chat.id === chatId)
        ? chatId
        : openOrCreateChat({ name });
    onCall(id);
  };

  const dial = () => {
    const username = handle.trim().replace(/^@+/, "").toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!username || isZeroIdentity({ username })) return;
    const existing = state.chats.find((chat) => (chat.username ?? "").toLowerCase() === username);
    const id = existing?.id ?? openOrCreateChat({ name: `@${username}`, username, online: true });
    setDialOpen(false);
    setHandle("");
    onCall(id);
  };

  return (
    <div className="relative flex h-full flex-col">
      <header className="shrink-0 px-5 pt-[max(16px,env(safe-area-inset-top,0px))]">
        <div className="flex items-end justify-between">
          <div className="flex items-baseline gap-2.5">
            <h1 className="t-display">Звонки</h1>
          </div>
        </div>

        <div className="mt-4 flex gap-1.5">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={cn(
                "press t-sub rounded-full px-3.5 py-1.5 transition-colors",
                filter === item.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-foreground/5 text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto pb-[122px] pt-4">
        {calls.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-8 pb-24 text-center">
            <span className="mb-5 grid size-16 place-items-center rounded-full border border-foreground/10 bg-foreground/[0.03]">
              <Phone size={24} strokeWidth={1.5} className="text-foreground/50" />
            </span>
            <p className="t-h">{filter === "missed" ? "Пропущенных нет" : "Пока тихо"}</p>
            <p className="t-sub mt-2 max-w-[240px] text-faint">
              {filter === "missed"
                ? "Хороший знак. Все звонки были услышаны."
                : "Здесь появятся ваши звонки — аудио и видео."}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 pb-1">
              <span className="t-cap text-faint">{filter === "missed" ? "Пропущенные" : "Недавние"}</span>
              <span className="t-cap text-faint/50">{calls.length}</span>
            </div>
            {calls.map((call, index) => {
              const Icon =
                call.direction === "missed"
                  ? PhoneMissed
                  : call.direction === "out"
                    ? PhoneOutgoing
                    : PhoneIncoming;
              return (
                <motion.button
                  key={call.id}
                  type="button"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.025, 0.2), duration: 0.26 }}
                  onClick={() => startCall(call.chatId, call.name)}
                  className="press flex w-full items-center gap-3 px-5 py-3 text-left"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full border border-foreground/8 bg-foreground/[0.04] text-foreground/65">
                    <Icon size={16} strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "t-body block truncate font-medium",
                        call.direction === "missed" ? "text-danger" : "text-foreground",
                      )}
                    >
                      {call.name}
                    </span>
                    <span className="t-sub mt-0.5 flex items-center gap-1.5 text-faint">
                      <span>
                        {call.direction === "missed"
                          ? "Пропущенный"
                          : call.direction === "out"
                            ? "Исходящий"
                            : "Входящий"}
                      </span>
                      {call.duration > 0 ? (
                        <>
                          <span className="opacity-40">·</span>
                          <span className="t-num">{duration(call.duration)}</span>
                        </>
                      ) : null}

                    </span>
                  </span>
                  <span className="t-time shrink-0 text-faint">{listTime(call.at)}</span>
                </motion.button>
              );
            })}
          </>
        )}
      </div>

      <motion.button
        type="button"
        whileTap={{ scale: 0.9 }}
        onClick={() => setDialOpen(true)}
        aria-label="Новый звонок"
        className="absolute bottom-[92px] right-5 z-30 grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_26px_rgba(0,0,0,0.45)]"
      >
        <Plus size={20} />
      </motion.button>

      <Sheet open={dialOpen} onClose={() => setDialOpen(false)} title="Новый звонок">
        <div className="pb-3">
          <p className="t-sub text-muted-foreground">
            Введите @username собеседника. Он должен быть в сети с открытым Zero.
          </p>
          <div className="mt-4 flex h-[52px] items-center rounded-[14px] border border-foreground/10 bg-foreground/5 px-4 focus-within:border-foreground/30">
            <span className="text-[15px] text-faint">@</span>
            <input
              value={handle}
              onChange={(event) =>
                setHandle(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24))
              }
              placeholder="username"
              autoFocus
              className="h-full flex-1 bg-transparent pl-1 text-[15px] tracking-[0.01em] outline-none"
            />
          </div>
          <div className="mt-5 flex gap-2">
            <Button
              className="flex flex-1 items-center justify-center gap-2"
              disabled={!handle.trim()}
              onClick={dial}
            >
              <Phone size={16} /> Позвонить
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}