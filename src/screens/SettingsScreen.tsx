import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  BadgeCheck,
  Bell,
  Check,
  ChevronRight,
  Info,
  Lock,
  LogOut,
  Moon,
  Palette,
  Smartphone,
  Sun,
  Type,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "../components/Avatar";
import {
  Button,
  IconButton,
  SectionLabel,
  Segmented,
  SettingsRow,
  Sheet,
  Switch,
} from "../components/ui";
import { requestPushPermission } from "../lib/feedback";
import { useAuthedStore } from "../lib/store";
import type { Settings, ThemeMode, Visibility } from "../types";
import { cn, haptic } from "../lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;

const VISIBILITY: { value: Visibility; label: string; hint: string }[] = [
  { value: "all", label: "Все", hint: "Видно всем пользователям Zero" },
  { value: "contacts", label: "Мои контакты", hint: "Только тем, с кем вы переписываетесь" },
  { value: "nobody", label: "Никто", hint: "Скрыто ото всех" },
];

const THEME_LABEL: Record<ThemeMode, string> = {
  dark: "Тёмная",
  light: "Светлая",
  system: "Системная",
};

type Sub = null | "notifications" | "appearance" | "privacy" | "about";

function SubShell({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-1 px-3 pb-2 pt-[max(10px,env(safe-area-inset-top,0px))]">
        <IconButton label="Назад" onClick={onBack}><ArrowLeft size={20} /></IconButton>
        <h1 className="t-h pl-1">{title}</h1>
      </header>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-[122px]">{children}</div>
    </div>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-[18px] border border-foreground/8 bg-foreground/[0.025] px-4", className)}>
      {children}
    </div>
  );
}

export function SettingsScreen({ onOpenProfile }: { onOpenProfile: () => void }) {
  const { state, user, updateSettings, logout } = useAuthedStore();
  const settings = state.settings;
  const [sub, setSub] = useState<Sub>(null);
  const [choice, setChoice] = useState<null | "lastSeen" | "profilePhoto" | "phoneNumber">(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);

  const notify = (text: string) => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2800);
  };

  useEffect(() => {
    return () => { if (noticeTimer.current) window.clearTimeout(noticeTimer.current); };
  }, []);

  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const valueLabel = (value: Visibility) => VISIBILITY.find((option) => option.value === value)?.label ?? "Все";
  const choiceValue = choice === "lastSeen" ? settings.lastSeen : choice === "profilePhoto" ? settings.profilePhoto : settings.phoneNumber;
  const choiceTitle = choice === "lastSeen" ? "Последний визит" : choice === "profilePhoto" ? "Фото профиля" : "Кому показывать почту";

  return (
    <div className="relative h-full">
      <AnimatePresence mode="wait" initial={false}>
        {sub === null ? (
          <motion.div key="settings-main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2, ease: EASE }} className="h-full">
            <div className="flex h-full flex-col">
              <header className="shrink-0 px-5 pb-2 pt-[max(16px,env(safe-area-inset-top,0px))]">
                <h1 className="t-display">Настройки</h1>
              </header>

              <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-[122px]">
                <button type="button" onClick={onOpenProfile} className="press mt-4 flex w-full items-center gap-3 rounded-[18px] border border-foreground/10 bg-card p-4 text-left shadow-[0_18px_40px_-30px_rgba(0,0,0,0.9)]">
                  <Avatar name={user.name} src={user.avatar} size={56} gradient />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="t-body truncate font-semibold">{user.name}</span>
                      {user.verified !== false ? (
                        <BadgeCheck size={16} className="shrink-0 text-foreground/60" strokeWidth={1.9} />
                      ) : null}
                    </span>
                    <span className="t-sub mt-0.5 block truncate text-faint">@{user.username}</span>
                  </span>
                  <ChevronRight size={18} className="text-faint" />
                </button>

                <SectionLabel>Основное</SectionLabel>
                <Card>
                  <SettingsRow icon={<Bell size={15} />} label="Уведомления" onClick={() => setSub("notifications")} />
                  <SettingsRow icon={<Palette size={15} />} label="Внешний вид" hint={THEME_LABEL[settings.theme]} onClick={() => setSub("appearance")} />
                  <SettingsRow icon={<Lock size={15} />} label="Приватность" hint={`Почта: ${valueLabel(settings.phoneNumber).toLowerCase()}`} onClick={() => setSub("privacy")} last />
                </Card>

                <SectionLabel>Zero</SectionLabel>
                <Card>
                  <SettingsRow icon={<Info size={15} />} label="О приложении" hint="Версия 0.1.0" onClick={() => setSub("about")} last />
                </Card>

                <div className="mt-4">
                  <Card>
                    <SettingsRow icon={<LogOut size={15} />} label="Выйти из аккаунта" danger onClick={() => setLogoutOpen(true)} last trailing={<span />} />
                  </Card>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key={sub} initial={{ opacity: 0, x: 22 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 22 }} transition={{ duration: 0.22, ease: EASE }} className="h-full">
            {sub === "notifications" ? (
              <SubShell title="Уведомления" onBack={() => setSub(null)}>
                <Card className="mt-3">
                  <SettingsRow
                    label="Push-уведомления"
                    hint="Только на это устройство"
                    trailing={
                      <Switch label="Push" checked={settings.push} onChange={async (v) => {
                        if (!v) return set({ push: false });
                        const granted = await requestPushPermission();
                        set({ push: granted });
                        notify(granted ? "Push включены" : "Браузер не дал разрешение");
                      }} />
                    }
                    last
                  />
                </Card>
              </SubShell>
            ) : sub === "appearance" ? (
              <SubShell title="Внешний вид" onBack={() => setSub(null)}>
                <SectionLabel className="pt-3">Тема</SectionLabel>
                <Segmented<ThemeMode>
                  value={settings.theme}
                  idPrefix="theme"
                  options={[{ value: "dark", label: "Тёмная" }, { value: "light", label: "Светлая" }, { value: "system", label: "Системная" }]}
                  onChange={(v) => { set({ theme: v }); haptic(5); }}
                />
                <SectionLabel>Поведение</SectionLabel>
                <Card>
                  <SettingsRow
                    icon={<Moon size={15} />}
                    label="Уменьшить движение"
                    hint="Меньше анимаций в интерфейсе"
                    trailing={<Switch label="Уменьшить движение" checked={settings.reducedMotion} onChange={(v) => set({ reducedMotion: v })} />}
                    last
                  />
                </Card>
              </SubShell>
            ) : sub === "privacy" ? (
              <SubShell title="Приватность" onBack={() => setSub(null)}>
                <SectionLabel className="pt-3">Кто видит</SectionLabel>
                <Card>
                  <SettingsRow label="Последний визит" hint={valueLabel(settings.lastSeen)} onClick={() => setChoice("lastSeen")} />
                  <SettingsRow label="Фото профиля" hint={valueLabel(settings.profilePhoto)} onClick={() => setChoice("profilePhoto")} />
                  <SettingsRow
                    label="Кому показывать почту"
                    hint={valueLabel(settings.phoneNumber)}
                    onClick={() => setChoice("phoneNumber")}
                    last
                  />
                </Card>
                <SectionLabel>Переписка</SectionLabel>
                <Card>
                  <SettingsRow
                    label="Отчёты о прочтении"
                    hint="Галочки у ваших сообщений"
                    trailing={<Switch label="Отчёты о прочтении" checked={settings.readReceipts} onChange={(v) => set({ readReceipts: v })} />}
                    last
                  />
                </Card>
              </SubShell>
            ) : (
              <SubShell title="О приложении" onBack={() => setSub(null)}>
                <div className="flex flex-col items-center pb-2 pt-6 text-center">
                  <img src="/logo.png" alt="Zero" className="size-[82px] object-contain" />
                  <h2 className="t-title mt-4">Zero</h2>
                  <p className="t-sub mt-1 text-faint">Автор: nothing</p>
                </div>
              </SubShell>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <Sheet open={choice !== null} onClose={() => setChoice(null)} title={choiceTitle}>
        <div className="pb-2">
          {VISIBILITY.map((option) => {
            const active = choiceValue === option.value;
            return (
              <button key={option.value} type="button" onClick={() => { if (choice) set({ [choice]: option.value }); setChoice(null); haptic(5); }} className="press flex w-full items-center gap-3 rounded-[14px] px-2 py-3 text-left hover:bg-foreground/5">
                <span className="min-w-0 flex-1">
                  <span className={cn("t-body block", active ? "font-semibold" : "text-foreground/90")}>{option.label}</span>
                  <span className="t-sub mt-0.5 block text-faint">{option.hint}</span>
                </span>
                {active ? <Check size={17} /> : <span className="size-[17px]" />}
              </button>
            );
          })}
        </div>
      </Sheet>

      <Sheet open={logoutOpen} onClose={() => setLogoutOpen(false)} title="Выйти из Zero?">
        <p className="t-body pb-5 text-muted-foreground">Чаты останутся на этом устройстве.</p>
        <div className="flex gap-2 pb-2">
          <Button variant="secondary" className="flex-1" onClick={() => setLogoutOpen(false)}>Остаться</Button>
          <Button className="flex-1 bg-danger text-white" onClick={() => { setLogoutOpen(false); logout(); }}>Выйти</Button>
        </div>
      </Sheet>

      <AnimatePresence>
        {notice ? (
          <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} className="pointer-events-none fixed inset-x-0 bottom-[100px] z-50 mx-auto flex w-full max-w-[420px] justify-center px-5">
            <div className="rounded-[14px] border border-foreground/10 bg-card/95 px-4 py-2.5 shadow-2xl backdrop-blur-xl"><p className="t-sub text-center text-foreground/85">{notice}</p></div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}