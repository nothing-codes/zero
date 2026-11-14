import { AnimatePresence, motion } from "motion/react";
import { BadgeCheck, Bookmark, CheckCheck, Loader2, Megaphone, MessageCircle, Pin, Plus, Search, Trash2, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CreateGroup } from "../components/CreateGroup";
import { Avatar } from "../components/Avatar";
import { ContactPicker } from "../components/ContactPicker";
import { ChatListSkeleton, ContextMenu, SettingsRow, Sheet, useDelayedFlag } from "../components/ui";
import { normalizeEmail, searchProfiles, type ZeroProfile } from "../lib/chat";
import type { Contact } from "../lib/data";
import { isZeroIdentity } from "../lib/identity";
import { chatPreview, useAuthedStore } from "../lib/store";
import { cn, haptic, listTime } from "../lib/utils";
import type { Chat } from "../types";

const SWIPE_WIDTH = 148;

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <span key={i} className="typing-dot inline-block size-1 rounded-full bg-current" style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  );
}

function ChatRow({ chat, open, onOpen, onClose, onChat, onMenu, onReadAll }: {
  chat: Chat; open: boolean; onOpen: () => void; onClose: () => void; onChat: () => void; onMenu: (x: number, y: number) => void; onReadAll: () => void;
}) {
  const last = chat.messages[chat.messages.length - 1];
  const fresh = Boolean(last?.fresh) || chat.unread > 0;
  const preview = chat.typing ? "печатает" : chatPreview(chat);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const startPoint = useRef({ x: 0, y: 0 });

  const clearPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  useEffect(() => clearPress, []);

  const onPointerDown = (event: ReactPointerEvent) => {
    longPressed.current = false;
    startPoint.current = { x: event.clientX, y: event.clientY };
    clearPress();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      longPressed.current = true;
      haptic(12);
      onMenu(startPoint.current.x, startPoint.current.y);
    }, 460);
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    if (!pressTimer.current) return;
    if (Math.abs(event.clientX - startPoint.current.x) > 10 || Math.abs(event.clientY - startPoint.current.y) > 10) clearPress();
  };

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-y-0 right-0 flex w-[148px]">
        <button
          type="button"
          onClick={() => { haptic(6); onReadAll(); onClose(); }}
          className="flex w-full flex-col items-center justify-center gap-1.5 bg-foreground/8 text-foreground transition-colors hover:bg-foreground/12"
        >
          <CheckCheck size={18} strokeWidth={1.8} />
          <span className="text-[11px] font-medium leading-none">Прочитать все</span>
        </button>
      </div>

      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -SWIPE_WIDTH, right: 0 }}
        dragElastic={0.06}
        animate={{ x: open ? -SWIPE_WIDTH : 0 }}
        transition={{ type: "spring", stiffness: 480, damping: 40, mass: 0.6 }}
        onDragEnd={(_, info) => { if (info.offset.x < -52 || info.velocity.x < -450) onOpen(); else onClose(); }}
        className={cn("relative z-10 transition-colors duration-500", fresh ? "bg-[color-mix(in_oklch,var(--foreground)_3%,var(--background))]" : "bg-background")}
      >
        <button
          type="button"
          onClick={() => {
            if (longPressed.current) { longPressed.current = false; return; }
            if (open) { onClose(); return; }
            haptic(4);
            onChat();
          }}
          onPointerDown={onPointerDown}
          onPointerUp={clearPress}
          onPointerCancel={clearPress}
          onPointerLeave={clearPress}
          onPointerMove={onPointerMove}
          onContextMenu={(event) => { event.preventDefault(); onMenu(event.clientX, event.clientY); }}
          className="flex w-full items-center gap-3 px-5 py-3.5 text-left"
        >
          <span className="relative">
            {chat.saved ? (
              <span className="grid size-14 place-items-center rounded-full bg-foreground/8 text-foreground/75">
                <Bookmark size={22} fill="currentColor" strokeWidth={1.6} />
              </span>
            ) : (
              <Avatar name={chat.name} src={chat.avatar} size={56} online={chat.online} />
            )}
            {chat.group ? <span className="absolute -right-0.5 -bottom-0.5 grid size-[18px] place-items-center rounded-full border-2 border-background bg-foreground/20 text-foreground">{chat.group.kind === "channel" ? <Megaphone size={8} strokeWidth={2.5} /> : <Users size={8} strokeWidth={2.5} />}</span> : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className={cn("t-body flex min-w-0 items-center gap-1.5 truncate", fresh ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>
                <span className="truncate">{chat.name}</span>
                {chat.verified ? <BadgeCheck size={15} className="shrink-0 text-foreground/55" strokeWidth={1.9} /> : null}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {chat.pinnedChat ? <Pin size={10} className="text-faint" /> : null}
                <span className={cn("t-time", fresh ? "text-muted-foreground" : "text-faint")}>{last ? listTime(last.at) : ""}</span>
              </span>
            </span>
            <span className="mt-1 flex items-center justify-between gap-2">
              <span className={cn("t-sub flex min-w-0 items-center gap-1 truncate", fresh ? "text-foreground/80" : "text-muted-foreground/80", chat.typing && "text-foreground")}>
                <span className="truncate">{preview}</span>
                {chat.typing ? <TypingDots /> : null}
              </span>
            </span>
          </span>
        </button>
      </motion.div>
    </div>
  );
}

export function ChatsScreen({ onOpenChat }: { onOpenChat: (chatId: string) => void; }) {
  const { state, user, togglePinChat, deleteChat, restoreChat, openOrCreateChat, createGroup, markRead, markAllRead } = useAuthedStore();
  const ready = useDelayedFlag(300);
  const [query, setQuery] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [createKind, setCreateKind] = useState<"group" | "channel" | null>(null);
  const [people, setPeople] = useState<ZeroProfile[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleFailed, setPeopleFailed] = useState(false);
  const [deleted, setDeleted] = useState<Chat | null>(null);
  const [undoVisible, setUndoVisible] = useState(false);
  const [menuChat, setMenuChat] = useState<Chat | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const needle = query.trim().replace(/^@/, "");

  // Люди ищутся строго по @username и только когда есть запрос.
  useEffect(() => {
    if (needle.length < 2) {
      setPeople([]);
      setPeopleLoading(false);
      setPeopleFailed(false);
      return;
    }
    let cancelled = false;
    setPeopleLoading(true);
    const timer = window.setTimeout(() => {
      void searchProfiles(needle, user.email)
        .then((rows) => {
          if (cancelled) return;
          setPeople(rows.filter((row) => !isZeroIdentity({ username: row.username, email: row.email })));
          setPeopleFailed(false);
        })
        .catch(() => {
          if (cancelled) return;
          setPeople([]);
          setPeopleFailed(true);
        })
        .finally(() => {
          if (!cancelled) setPeopleLoading(false);
        });
    }, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [needle, user.email]);

  useEffect(() => {
    if (!deleted) return;
    setUndoVisible(true);
    const timer = window.setTimeout(() => { setUndoVisible(false); setDeleted(null); }, 4200);
    return () => window.clearTimeout(timer);
  }, [deleted]);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? state.chats.filter((chat) => chat.name.toLowerCase().includes(q) || (chat.username ?? "").toLowerCase().includes(q) || (chat.email ?? "").toLowerCase().includes(q) || chat.messages.some((m) => (m.text ?? "").toLowerCase().includes(q))) : state.chats;
    return [...filtered].sort((a, b) => {
      if (Boolean(a.pinnedChat) !== Boolean(b.pinnedChat)) return a.pinnedChat ? -1 : 1;
      const aAt = a.messages[a.messages.length - 1]?.at ?? 0;
      const bAt = b.messages[b.messages.length - 1]?.at ?? 0;
      return bAt - aAt;
    });
  }, [state.chats, query]);

  // Люди, с которыми уже есть чат, не дублируются в блоке «Люди»:
  // объединённый поиск показывает один результат на человека.
  const knownEmails = useMemo(
    () =>
      new Set(
        state.chats
          .map((chat) => normalizeEmail(chat.email ?? ""))
          .filter(Boolean),
      ),
    [state.chats],
  );
  const peopleFiltered = useMemo(
    () => people.filter((profile) => !knownEmails.has(normalizeEmail(profile.email))),
    [people, knownEmails],
  );

  const pinned = sorted.filter((chat) => chat.pinnedChat);
  const regular = sorted.filter((chat) => !chat.pinnedChat);
  const searching = query.trim().length > 0;

  const pick = (contact: Contact) => {
    if (contact.id === "c_saved") {
      onOpenChat("c_saved");
      return;
    }
    const id = openOrCreateChat({
      name: contact.name,
      username: contact.username,
      email: contact.email,
      phone: contact.phone,
      avatar: contact.avatar,
      online: contact.online,
      lastSeen: contact.lastSeen,
      remote: Boolean(contact.email),
    });
    onOpenChat(id);
  };

  const openProfile = (profile: ZeroProfile) => {
    haptic(5);
    const id = openOrCreateChat({
      name: profile.name || profile.username,
      username: profile.username,
      email: profile.email,
      avatar: profile.avatar,
      remote: Boolean(profile.email),
    });
    onOpenChat(id);
  };

  const handleDelete = (chat: Chat) => {
    haptic([12, 30, 12]);
    deleteChat(chat.id);
    setDeleted(chat);
    setOpenRow(null);
  };

  const openMenu = (chat: Chat, x: number, y: number) => {
    setOpenRow(null);
    setMenuPos({ x, y });
    setMenuChat(chat);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 px-5 pt-[max(16px,env(safe-area-inset-top,0px))]">
        <div className="mt-4 flex items-end justify-between">
          <div className="flex items-baseline gap-2.5">
            <h1 className="t-display">Чаты</h1>
          </div>
        </div>

        <div className="mt-4 mb-1 flex h-11 items-center gap-2 rounded-[14px] border border-foreground/8 bg-foreground/[0.045] px-3.5 transition-colors focus-within:border-foreground/20 focus-within:bg-foreground/[0.06]">
          <Search size={16} className="shrink-0 text-faint" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Чаты, сообщения, @username" className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none" aria-label="Поиск" />
          <AnimatePresence>
            {query ? (
              <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} type="button" onClick={() => setQuery("")} aria-label="Очистить" className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground/10 text-muted-foreground">
                <X size={12} />
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>
      </header>

      <div className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[122px]">
        {!ready ? <ChatListSkeleton /> : sorted.length === 0 && peopleFiltered.length === 0 && !peopleLoading ? (
          <div className="flex h-full flex-col items-center justify-center px-8 pb-20 text-center">
            <div className="relative mb-6"><img src="/logo.png" alt="Zero" className="h-24 w-auto object-contain opacity-50" /></div>
            <p className="t-h">{searching ? "Ничего не найдено" : "Пока тихо"}</p>
            <p className="t-sub mt-2 max-w-[240px] text-faint">{searching ? "Попробуйте другой @username." : "Ноль сообщений — идеальное начало."}</p>
          </div>
        ) : (
          <>
            {pinned.length > 0 ? (
              <div className="mt-2">
                <div className="flex items-center gap-2 px-5 pb-1 pt-2">
                  <Pin size={11} className="text-faint" />
                  <span className="t-cap text-faint">Закреплённые</span>
                </div>
                {pinned.map((chat) => (
                  <ChatRow key={chat.id} chat={chat} open={openRow === chat.id} onOpen={() => setOpenRow(chat.id)} onClose={() => setOpenRow((c) => (c === chat.id ? null : c))} onChat={() => onOpenChat(chat.id)} onMenu={(x, y) => openMenu(chat, x, y)} onReadAll={markAllRead} />
                ))}
              </div>
            ) : null}

            {sorted.length > 0 || !searching ? (
              <div>
                <div className="flex items-center justify-between px-5 pb-1 pt-5">
                  <span className="t-cap text-faint">{searching ? `Чаты · ${sorted.length}` : "Все чаты"}</span>
                </div>
                {regular.map((chat) => (
                  <ChatRow key={chat.id} chat={chat} open={openRow === chat.id} onOpen={() => setOpenRow(chat.id)} onClose={() => setOpenRow((c) => (c === chat.id ? null : c))} onChat={() => onOpenChat(chat.id)} onMenu={(x, y) => openMenu(chat, x, y)} onReadAll={markAllRead} />
                ))}
              </div>
            ) : null}

            {searching ? (
              <div>
                <div className="flex items-center justify-between px-5 pb-1 pt-5">
                  <span className="t-cap text-faint">Люди · по @username{peopleFiltered.length > 0 ? ` · ${peopleFiltered.length}` : ""}</span>
                  {peopleLoading ? <Loader2 size={13} className="animate-spin text-faint" /> : null}
                </div>
                {peopleFiltered.map((profile) => (
                  <button
                    key={profile.email}
                    type="button"
                    onClick={() => openProfile(profile)}
                    className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-foreground/5"
                  >
                    <Avatar name={profile.name || profile.username} src={profile.avatar} size={46} />
                    <span className="min-w-0 flex-1">
                      <span className="t-body block truncate font-medium">{profile.name || profile.username}</span>
                      <span className="t-sub block truncate text-faint">@{profile.username}</span>
                    </span>
                    <MessageCircle size={16} className="shrink-0 text-faint" />
                  </button>
                ))}
                {!peopleLoading && peopleFiltered.length === 0 ? (
                  <p className="t-sub px-5 py-4 text-faint">
                    {peopleFailed ? "Поиск людей недоступен." : needle.length < 2 ? "Введите минимум 2 символа @username." : "Людей с таким @username нет."}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => setPlusOpen(true)} aria-label="Создать" className="absolute bottom-[92px] right-5 z-30 grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_26px_rgba(0,0,0,0.45)]">
        <Plus size={20} />
      </motion.button>

      <ContactPicker open={picker} onClose={() => setPicker(false)} onPick={pick} title="Новый чат" />

      <Sheet open={plusOpen} onClose={() => setPlusOpen(false)} title="Создать">
        <div className="overflow-hidden rounded-[16px] border border-foreground/8 bg-foreground/[0.02] px-3 pb-1">
          <SettingsRow icon={<MessageCircle size={16} />} label="Новый чат" hint="Личная переписка" onClick={() => { setPlusOpen(false); window.setTimeout(() => setPicker(true), 120); }} />
          <SettingsRow icon={<Users size={16} />} label="Новая группа" hint="Общение нескольких людей" onClick={() => { setPlusOpen(false); window.setTimeout(() => setCreateKind("group"), 120); }} />
          <SettingsRow icon={<Megaphone size={16} />} label="Новый канал" hint="Публикации для подписчиков" last onClick={() => { setPlusOpen(false); window.setTimeout(() => setCreateKind("channel"), 120); }} />
        </div>
      </Sheet>

      <CreateGroup
        open={Boolean(createKind)}
        kind={createKind ?? "group"}
        onClose={() => setCreateKind(null)}
        onCreate={(input) => {
          const id = createGroup(input);
          setCreateKind(null);
          onOpenChat(id);
        }}
      />

      <ContextMenu
        open={Boolean(menuChat)}
        x={menuPos.x}
        y={menuPos.y}
        onClose={() => setMenuChat(null)}
        items={menuChat ? [
          { icon: <CheckCheck size={15} />, label: "Прочитать", onClick: () => markRead(menuChat.id) },
          { icon: <Pin size={15} />, label: menuChat.pinnedChat ? "Открепить" : "Закрепить", onClick: () => togglePinChat(menuChat.id) },
          { icon: <Trash2 size={15} />, label: "Удалить", danger: true, onClick: () => handleDelete(menuChat) },
        ] : []}
      />

      <AnimatePresence>
        {deleted && undoVisible ? (
          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }} transition={{ type: "spring", stiffness: 460, damping: 36 }} className="pointer-events-none absolute inset-x-0 bottom-[92px] z-40 flex justify-center px-5">
            <div className="pointer-events-auto flex w-full max-w-[360px] items-center gap-3 rounded-[16px] border border-foreground/10 bg-card/95 py-2.5 pl-4 pr-2.5 shadow-2xl backdrop-blur-xl">
              <span className="t-sub min-w-0 flex-1 truncate text-muted-foreground">Чат с {deleted.name} удалён</span>
              <button type="button" onClick={() => { restoreChat(deleted); setDeleted(null); setUndoVisible(false); haptic(6); }} className="press t-sub rounded-[10px] px-3 py-1.5 font-semibold text-foreground hover:bg-foreground/8">Отменить</button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
