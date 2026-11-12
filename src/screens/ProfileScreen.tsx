import { motion } from "motion/react";
import { ArrowLeft, BadgeCheck, CalendarDays, Camera, Check, ChevronRight, Lock, Mail, MessageCircle, Pencil, Share2 } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Avatar } from "../components/Avatar";
import { Button, IconButton, Sheet } from "../components/ui";
import { fileToAvatar, shareText } from "../lib/image";
import { useAuthedStore } from "../lib/store";
import { cn, haptic } from "../lib/utils";

export function ProfileScreen({ onBack, onOpenSettings }: { onBack: () => void; onOpenSettings: () => void; }) {
  const { state, user, updateProfile } = useAuthedStore();
  const [editOpen, setEditOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const [draft, setDraft] = useState({
    name: user.name,
    username: user.username,
    status: user.status,
    bio: user.bio,
    avatar: user.avatar,
  });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editOpen) return;
    setDraft({ name: user.name, username: user.username, status: user.status, bio: user.bio, avatar: user.avatar });
  }, [editOpen, user]);

  const messages = state.chats.reduce((sum, chat) => sum + chat.messages.length, 0);
  const media = state.chats.reduce((sum, chat) => sum + chat.messages.filter((m) => ["photo", "voice", "videoNote", "file"].includes(m.kind)).length, 0);
  const since = new Date(user.createdAt).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });

  const pickAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await fileToAvatar(file);
      setDraft((current) => ({ ...current, avatar: result }));
    } catch { /* noop */ }
    event.target.value = "";
  };

  return (
    <div className="relative flex h-full flex-col bg-background">
      <header className="relative z-10 flex shrink-0 items-center justify-between px-3 pt-[max(10px,env(safe-area-inset-top,0px))]">
        <IconButton label="Назад" onClick={onBack}><ArrowLeft size={20} /></IconButton>
        <span className="t-cap text-faint">Профиль</span>
        <IconButton label="Поделиться" onClick={async () => {
          haptic(6);
          const ok = await shareText(`@${user.username} в Zero — https://zero.app/@${user.username}`);
          setShared(ok);
          window.setTimeout(() => setShared(false), 2000);
        }}>
          {shared ? <Check size={18} /> : <Share2 size={18} />}
        </IconButton>
      </header>

      <div className="no-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto px-5 pb-[40px]">
        <div className="flex flex-col items-center pt-6 text-center">
          <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 24 }} className="relative">
            {/* Убраны круговые свечения (border и dashed) */}
            <Avatar name={user.name} src={user.avatar} size={118} gradient />
            <span className="absolute -bottom-1 right-0 grid size-8 place-items-center rounded-full border-2 border-background bg-card text-foreground/70">
              <Lock size={12} />
            </span>
          </motion.div>

          <h1 className="t-title mt-5 flex items-center justify-center gap-1.5">
            <span className="truncate">{user.name}</span>
            {user.verified !== false ? (
              <BadgeCheck size={20} className="shrink-0 text-foreground/60" strokeWidth={1.9} />
            ) : null}
          </h1>
          <p className="t-sub mt-1 text-faint">@{user.username}</p>
          <div className="mt-3 flex items-center gap-1.5 rounded-full border border-foreground/10 bg-foreground/[0.04] px-3 py-1.5">
            <span className="size-1.5 rounded-full bg-online" />
            <span className="t-sub text-muted-foreground">{user.status || "в сети"}</span>
          </div>

          <div className="mt-5 flex w-full items-center gap-2">
            <button type="button" onClick={() => setEditOpen(true)} className="btn-secondary h-12 flex-1 text-[14px]">
              <Pencil size={15} /> Изменить профиль
            </button>
            <IconButton label="Настройки" variant="surface" onClick={onOpenSettings} className="size-12 border border-foreground/10">
              <ChevronRight size={19} />
            </IconButton>
          </div>
        </div>

        <div className="mt-7 flex items-stretch rounded-[18px] border border-foreground/8 bg-foreground/[0.035] py-4">
          {[
            { value: state.chats.length, label: "чатов" },
            { value: messages, label: "сообщений" },
            { value: media, label: "медиа" },
          ].map((stat, index) => (
            <div key={stat.label} className={cn("flex flex-1 flex-col items-center gap-1", index > 0 && "border-l border-foreground/8")}>
              <span className="t-h t-num text-foreground">{stat.value}</span>
              <span className="t-cap text-faint">{stat.label}</span>
            </div>
          ))}
        </div>

        {user.bio.trim() ? (
          <div className="mt-3 rounded-[18px] border border-foreground/8 bg-foreground/[0.025] p-4 text-left">
            <span className="t-cap text-faint">О себе</span>
            <p className="t-body mt-2 text-foreground/90">{user.bio}</p>
          </div>
        ) : null}

        <div className="mt-3 overflow-hidden rounded-[18px] border border-foreground/8 bg-foreground/[0.025]">
          {[
            { icon: <MessageCircle size={16} />, label: "Имя пользователя", value: `@${user.username}` },
            { icon: <Mail size={16} />, label: "Gmail", value: user.email, hint: "подтверждён" },
            { icon: <CalendarDays size={16} />, label: "В Zero с", value: since },
          ].map((row, index) => (
            <div key={row.label} className={cn("flex items-center gap-3 px-4 py-3.5", index > 0 && "border-t border-foreground/[0.05]")}>
              <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-foreground/6 text-foreground/60">{row.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="t-sub block text-faint">{row.label}</span>
                <span className="t-body mt-0.5 block truncate">{row.value}</span>
              </span>
              {row.hint ? <span className="t-cap text-faint">{row.hint}</span> : null}
            </div>
          ))}
        </div>

        {/* Убран текст "X сообщений в вашем Zero" */}
      </div>

      <Sheet open={editOpen} onClose={() => setEditOpen(false)} title="Изменить профиль">
        <div className="flex items-center gap-4 pb-5">
          <button type="button" onClick={() => fileRef.current?.click()} className="relative rounded-full">
            <Avatar name={draft.name || "Zero"} src={draft.avatar} size={76} gradient />
            <span className="absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground"><Camera size={12} /></span>
          </button>
          <div className="flex-1">
            <p className="t-body font-medium">Аватар</p>
            <p className="t-sub mt-0.5 text-faint">Квадратное фото выглядит лучше всего.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className="t-sub rounded-full bg-foreground/8 px-3 py-1.5 font-medium">Загрузить</button>
              {draft.avatar ? <button type="button" onClick={() => setDraft((c) => ({ ...c, avatar: null }))} className="t-sub rounded-full px-3 py-1.5 text-faint">Удалить</button> : null}
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={pickAvatar} className="hidden" />
        </div>

        <div className="space-y-4 pb-5">
          <div>
            <label className="t-cap block text-faint" htmlFor="edit-name">Имя</label>
            <input id="edit-name" value={draft.name} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} maxLength={40} className="field mt-2" />
          </div>
          <div>
            <label className="t-cap block text-faint" htmlFor="edit-username">Имя пользователя</label>
            <div className="mt-2 flex h-[52px] items-center rounded-[14px] border border-foreground/10 bg-foreground/5 px-4">
              <span className="text-faint">@</span>
              <input id="edit-username" value={draft.username} onChange={(e) => setDraft((c) => ({ ...c, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24) }))} className="h-full flex-1 bg-transparent pl-1 outline-none" />
            </div>
          </div>
          <div>
            <label className="t-cap block text-faint" htmlFor="edit-status">Статус</label>
            <input id="edit-status" value={draft.status} onChange={(e) => setDraft((c) => ({ ...c, status: e.target.value }))} maxLength={60} className="field mt-2" placeholder="в сети" />
          </div>
          <div>
            <label className="t-cap block text-faint" htmlFor="edit-bio">О себе</label>
            <textarea id="edit-bio" value={draft.bio} onChange={(e) => setDraft((c) => ({ ...c, bio: e.target.value }))} rows={3} maxLength={180} className="field mt-2 h-auto resize-none py-3.5" placeholder="Пара слов. Или ни слова." />
          </div>
        </div>

        <div className="pb-2">
          <Button className="w-full" disabled={draft.name.trim().length < 2} onClick={() => {
            updateProfile({
              name: draft.name.trim(),
              username: draft.username.trim() || user.username,
              status: draft.status.trim() || "в сети",
              bio: draft.bio.trim(),
              avatar: draft.avatar,
            });
            haptic(8);
            setEditOpen(false);
          }}>Сохранить</Button>
        </div>
      </Sheet>
    </div>
  );
}