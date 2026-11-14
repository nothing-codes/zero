import { motion } from "motion/react";
import { ArrowLeft, CalendarDays, Camera, Check, ChevronRight, Lock, Mail, MessageCircle, Pencil, Share2 } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Avatar } from "../components/Avatar";
import { PhotoEditor, type PhotoEditorMode } from "../components/PhotoEditor";
import { Button, IconButton, Sheet } from "../components/ui";
import { shareText } from "../lib/image";
import { useAuthedStore } from "../lib/store";
import { appLink, cn, haptic } from "../lib/utils";

const BANNERS = [
  { id: "g1", style: "linear-gradient(135deg, #3a3a3c 0%, #141416 55%, #08080a 100%)" },
  { id: "g2", style: "linear-gradient(135deg, #0a84ff 0%, #004a8f 55%, #071521 100%)" },
  { id: "g3", style: "linear-gradient(135deg, #ff9f0a 0%, #ff375f 55%, #3a0714 100%)" },
  { id: "g4", style: "linear-gradient(135deg, #bf5af2 0%, #5e2a8a 55%, #140a20 100%)" },
  { id: "g5", style: "linear-gradient(135deg, #30d158 0%, #0d5a35 55%, #06130c 100%)" },
  { id: "g6", style: "linear-gradient(135deg, #ff6482 0%, #8a1838 55%, #1a050b 100%)" },
];

function isBannerPhoto(value?: string | null) {
  return Boolean(value && (value.startsWith("data:") || value.startsWith("http://") || value.startsWith("https://")));
}

function BannerVisual({ banner, className }: { banner?: string | null; className?: string }) {
  if (isBannerPhoto(banner)) {
    return <img src={banner ?? ""} alt="" draggable={false} className={cn("h-full w-full object-cover", className)} />;
  }
  const style = BANNERS.find((item) => item.id === banner)?.style ?? BANNERS[0].style;
  return <div className={cn("h-full w-full", className)} style={{ backgroundImage: style }} />;
}

export function ProfileScreen({ onBack, onOpenSettings }: { onBack: () => void; onOpenSettings: () => void; }) {
  const { state, user, updateProfile } = useAuthedStore();
  const [editOpen, setEditOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const [editor, setEditor] = useState<{ file: File; mode: PhotoEditorMode } | null>(null);
  const [draft, setDraft] = useState({
    name: user.name,
    username: user.username,
    status: user.status,
    bio: user.bio,
    avatar: user.avatar,
    banner: user.banner ?? null,
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editOpen) return;
    setDraft({
      name: user.name,
      username: user.username,
      status: user.status,
      bio: user.bio,
      avatar: user.avatar,
      banner: user.banner ?? null,
    });
  }, [editOpen, user]);

  const messages = state.chats.reduce((sum, chat) => sum + chat.messages.length, 0);
  const media = state.chats.reduce((sum, chat) => sum + chat.messages.filter((m) => ["photo", "voice", "videoNote", "file"].includes(m.kind)).length, 0);
  const since = new Date(user.createdAt).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });

  const pickAvatar = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setEditor({ file, mode: "avatar" });
  };

  const pickBanner = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setEditor({ file, mode: "banner" });
  };

  return (
    <div className="relative flex h-full flex-col bg-background">
      <header className="relative z-10 flex shrink-0 items-center justify-between px-3 pt-[max(10px,env(safe-area-inset-top,0px))]">
        <IconButton label="Назад" onClick={onBack}><ArrowLeft size={20} /></IconButton>
        <span className="t-cap text-faint">Профиль</span>
        <IconButton label="Поделиться" onClick={async () => {
          haptic(6);
          const ok = await shareText(`@${user.username} в Zero — ${appLink()}`);
          setShared(ok);
          window.setTimeout(() => setShared(false), 2000);
        }}>
          {shared ? <Check size={18} /> : <Share2 size={18} />}
        </IconButton>
      </header>

      <div className="no-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto px-5 pb-[40px]">
        <div className="relative -mx-5">
          <div className="relative h-[178px] overflow-hidden rounded-b-[28px]">
            <BannerVisual banner={user.banner} />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          </div>
          <div className="relative -mt-[63px] flex justify-center">
            <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 24 }} className="relative rounded-full bg-background p-1">
              <Avatar name={user.name} src={user.avatar} size={118} gradient />
              <span className="absolute -bottom-1 right-0 grid size-8 place-items-center rounded-full border-2 border-background bg-card text-foreground/70">
                <Lock size={12} />
              </span>
            </motion.div>
          </div>
        </div>

        <div className="flex flex-col items-center text-center">
          <h1 className="t-title mt-4 flex items-center justify-center gap-1.5">
            <span className="truncate">{user.name}</span>
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
        <div className="relative mb-5 h-[112px] overflow-hidden rounded-[16px]">
          <BannerVisual banner={draft.banner} />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        </div>

        <div className="mb-5">
          <p className="t-body font-medium">Баннер</p>
          <div className="mt-2 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            {BANNERS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label="Градиент"
                onClick={() => setDraft((c) => ({ ...c, banner: item.id }))}
                className={cn(
                  "size-9 shrink-0 rounded-full border transition-transform",
                  draft.banner === item.id ? "scale-110 border-foreground ring-2 ring-foreground/15" : "border-foreground/15",
                )}
                style={{ backgroundImage: item.style }}
              />
            ))}
            <button
              type="button"
              onClick={() => bannerRef.current?.click()}
              className={cn(
                "press grid size-9 shrink-0 place-items-center rounded-full border",
                isBannerPhoto(draft.banner)
                  ? "border-foreground bg-foreground/10 text-foreground ring-2 ring-foreground/15"
                  : "border-foreground/15 bg-foreground/6 text-foreground/65",
              )}
            >
              <Camera size={15} />
            </button>
          </div>
          <input ref={bannerRef} type="file" accept="image/*" onChange={pickBanner} className="hidden" />
        </div>

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
              banner: draft.banner,
            });
            haptic(8);
            setEditOpen(false);
          }}>Сохранить</Button>
        </div>
      </Sheet>

      {editor ? (
        <PhotoEditor
          file={editor.file}
          mode={editor.mode}
          onCancel={() => setEditor(null)}
          onDone={({ dataUrl }) => {
            setDraft((current) =>
              editor.mode === "banner"
                ? { ...current, banner: dataUrl }
                : { ...current, avatar: dataUrl },
            );
            setEditor(null);
            haptic(6);
          }}
        />
      ) : null}
    </div>
  );
}