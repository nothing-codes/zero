import { AnimatePresence, motion, useAnimation } from "motion/react";
import { ArrowLeft, Camera, Check } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type ChangeEvent,
} from "react";
import { Avatar } from "../components/Avatar";
import { ContactGlobe } from "../components/Globe";
import { PhotoEditor } from "../components/PhotoEditor";
import { Button, IconButton, Sheet } from "../components/ui";
import { findRemoteAccount, isUsernameTaken } from "../lib/chat";
import { playTone } from "../lib/feedback";
import { useStore } from "../lib/store";
import { supabase } from "../lib/supabase";
import { cn, haptic } from "../lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

function EmailStep({
  email,
  onEmail,
  onContinue,
}: {
  email: string;
  onEmail: (value: string) => void;
  onContinue: () => void;
}) {
  const valid = isValidEmail(email);
  const inputRef = useRef<HTMLInputElement>(null);
  // «Изменить» закрывает окно до следующей правки адреса, чтобы оно не
  // возвращалось сразу после нажатия.
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Окно подтверждения выезжает снизу, но не во время набора: ждём паузу,
  // чтобы оно не выскакивало на каждой введённой букве.
  useEffect(() => {
    if (!valid || hiddenFor === email.trim()) {
      setConfirmOpen(false);
      return;
    }
    const timer = window.setTimeout(() => setConfirmOpen(true), 420);
    return () => window.clearTimeout(timer);
  }, [valid, email, hiddenFor]);

  const backToEditing = () => {
    setConfirmOpen(false);
    setHiddenFor(email.trim());
    // Ждём, пока окно уедет вниз, и только потом возвращаем клавиатуру.
    window.setTimeout(() => inputRef.current?.focus(), 420);
  };

  return (
    <div className="flex h-full flex-col px-6">
      <div className="flex flex-1 flex-col justify-center pb-10 pt-[32vh]">
        <div className="mb-1.5">
          <p className="t-cap text-faint">Добро пожаловать</p>
          <h1 className="t-title mt-1">Ваш Gmail</h1>
        </div>

        <div>
          <label className="t-cap block text-faint" htmlFor="email">
            Электронная почта
          </label>

          <div className="mt-2 flex h-[56px] items-center overflow-hidden rounded-[14px] border border-foreground/10 bg-foreground/[0.05] transition-colors focus-within:border-foreground/30">
            <input
              ref={inputRef}
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              enterKeyHint="go"
              autoFocus
              value={email}
              onChange={(event) => {
                setHiddenFor(null);
                onEmail(event.target.value.slice(0, 120));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && valid) {
                  event.preventDefault();
                  onContinue();
                }
              }}
              placeholder="you@gmail.com"
              className="h-full min-w-0 flex-1 bg-transparent px-4 text-[16px] tracking-[0.01em] outline-none"
            />
          </div>
        </div>

        <div className="mt-10">
          <ContactGlobe className="mx-auto max-w-[260px]" />
        </div>
      </div>

      <Sheet
        open={confirmOpen}
        onClose={backToEditing}
        title="Проверьте почту"
      >
        <p className="t-body mt-2 break-all text-muted-foreground">{email.trim()}</p>
        <div className="mt-6 flex gap-2 pb-4">
          <Button variant="secondary" className="flex-1" onClick={backToEditing}>
            Изменить
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              setConfirmOpen(false);
              onContinue();
            }}
          >
            Продолжить
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function OtpStep({
  email,
  sending,
  sendError,
  cooldownUntil,
  onChangeEmail,
  onVerified,
  onVerify,
  onResend,
}: {
  email: string;
  sending: boolean;
  sendError: string | null;
  cooldownUntil: number;
  onChangeEmail: () => void;
  onVerified: () => void;
  onVerify: (value: string) => Promise<boolean>;
  onResend: () => Promise<void>;
}) {
  const [otp, setOtp] = useState<string[]>(Array(6).fill(""));
  const [error, setError] = useState(false);
  const [verified, setVerified] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const controls = useAnimation();
  const busy = useRef(false);

  const seconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const verify = async (value: string) => {
    if (busy.current || verified) return;
    busy.current = true;
    const ok = await onVerify(value);
    if (ok) {
      setVerified(true);
      setError(false);
      playTone("success");
      haptic([12, 34, 24]);
      window.setTimeout(onVerified, 620);
    } else {
      busy.current = false;
      setError(true);
      playTone("error");
      haptic([20, 40, 20]);
      void controls.start({ x: [0, -7, 7, -5, 5, 0], transition: { duration: 0.38 } });
      window.setTimeout(() => {
        setOtp(Array(6).fill(""));
        setError(false);
        refs.current[0]?.focus();
      }, 520);
    }
  };

  useEffect(() => {
    const joined = otp.join("");
    if (joined.length === 6) {
      const timer = window.setTimeout(() => verify(joined), 90);
      return () => window.clearTimeout(timer);
    }
  }, [otp]);

  const setDigit = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    setOtp((current) => {
      const next = [...current];
      next[index] = digit;
      return next;
    });
    if (digit && index < 5) refs.current[index + 1]?.focus();
  };

  const onKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !otp[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < 5) refs.current[index + 1]?.focus();
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!text) return;
    event.preventDefault();
    const next = text.split("");
    while (next.length < 6) next.push("");
    setOtp(next);
    refs.current[Math.min(text.length, 5)]?.focus();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-4">
        <IconButton label="Назад" onClick={onChangeEmail} className="-ml-2">
          <ArrowLeft size={19} />
        </IconButton>
      </div>

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col justify-center px-6 pb-12 pt-[10vh]">
        <div className="mb-8">
          <h1 className="t-title">Введите код</h1>
          <p className="t-body mt-2 break-all text-muted-foreground">
            Отправили на <span className="text-foreground">{email}</span>
          </p>
        </div>

        <motion.div
          animate={controls}
          onPaste={onPaste}
          className="flex items-center justify-between gap-2"
        >
          {otp.map((digit, index) => (
            <input
              key={index}
              ref={(node) => {
                refs.current[index] = node;
              }}
              value={digit}
              onChange={(event) => setDigit(index, event.target.value)}
              onKeyDown={(event) => onKeyDown(index, event)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={1}
              aria-label={`Цифра ${index + 1}`}
              disabled={verified}
              className={cn(
                "t-num h-[62px] w-full min-w-0 rounded-[16px] border text-center text-[24px] font-medium outline-none transition-all duration-200",
                digit
                  ? "border-foreground/35 bg-foreground/[0.08] text-foreground"
                  : "border-foreground/10 bg-foreground/[0.04] text-foreground",
                error && "border-danger/60 bg-danger/[0.06]",
                verified && "border-foreground bg-foreground text-background",
              )}
            />
          ))}
        </motion.div>

        <div className="mt-4 flex min-h-6 items-center justify-center">
          <AnimatePresence mode="wait">
            {error ? (
              <motion.p
                key="error"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="t-sub text-danger"
              >
                Неверный код
              </motion.p>
            ) : verified ? (
              <motion.p
                key="ok"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="t-sub flex items-center gap-1.5 text-foreground"
              >
                <Check size={14} /> Код принят
              </motion.p>
            ) : sendError ? (
              <motion.p
                key="send-error"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="t-sub text-center text-danger/80"
              >
                {sendError}
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="mt-4 text-center">
          {sending ? (
            <p className="t-sub text-faint">Отправляем код…</p>
          ) : seconds > 0 ? (
            <p className="t-sub text-faint">
              Повторно через{" "}
              <span className="t-num text-muted-foreground">0:{String(seconds).padStart(2, "0")}</span>
            </p>
          ) : (
            <button
              type="button"
              onClick={() => {
                setOtp(Array(6).fill(""));
                refs.current[0]?.focus();
                void onResend();
              }}
              className="press t-sub rounded-full px-4 py-1.5 font-medium text-foreground underline decoration-foreground/25 underline-offset-4 disabled:opacity-40"
            >
              Отправить ещё раз
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SignupStep({
  email,
  onBack,
  onDone,
}: {
  email: string;
  onBack: () => void;
  onDone: (profile: {
    name: string;
    username: string;
    bio: string;
    avatar: string | null;
  }) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [editorFile, setEditorFile] = useState<File | null>(null);
  const [touchedUsername, setTouchedUsername] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!touchedUsername) {
      setUsername(
        name
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 24)
      );
    }
  }, [name, touchedUsername]);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setEditorFile(file);
  };

  const valid = name.trim().length >= 2;

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-4">
        <IconButton label="Назад" onClick={onBack} className="-ml-2">
          <ArrowLeft size={19} />
        </IconButton>
      </div>

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col justify-center px-6 pb-12">
        <div className="mb-6">
          <h1 className="t-title">Профиль</h1>
          <p className="t-sub mt-2 break-all text-faint">{email}</p>
        </div>

        <div className="mb-6 flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative rounded-full"
            aria-label="Добавить аватар"
          >
            <Avatar name={name || "Zero"} src={avatar} size={72} gradient />
            <span className="absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-md">
              <Camera size={12} />
            </span>
          </button>
          <div>
            <p className="t-h">Аватар</p>
            <p className="t-sub mt-1 max-w-[190px] text-faint">По желанию. Можно добавить позже.</p>
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
        </div>

        <div className="space-y-5">
          <div>
            <label htmlFor="name" className="t-cap block text-faint">
              Имя
            </label>
            <input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Как вас зовут?"
              autoComplete="name"
              maxLength={40}
              className="field mt-2"
            />
          </div>
          <div>
            <label htmlFor="username" className="t-cap block text-faint">
              Имя пользователя
            </label>
            <div className="mt-2 flex h-[52px] items-center rounded-[14px] border border-foreground/10 bg-foreground/[0.05] px-4 focus-within:border-foreground/30">
              <span className="text-[15px] text-faint">@</span>
              <input
                id="username"
                value={username}
                onChange={(event) => {
                  setTouchedUsername(true);
                  setUsername(
                    event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24),
                  );
                }}
                placeholder="username"
                className="h-full flex-1 bg-transparent pl-1 text-[15px] tracking-[0.01em] outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 pb-[max(22px,env(safe-area-inset-bottom,0px))] pt-3">
        <AnimatePresence>
          {error ? (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="t-sub mb-3 text-center text-danger"
            >
              {error}
            </motion.p>
          ) : null}
        </AnimatePresence>
        <Button
          className="w-full"
          disabled={!valid || loading}
          onClick={() => {
            if (!valid || loading) return;
            setLoading(true);
            setError(null);
            haptic(8);
            void onDone({
              name: name.trim(),
              username: username.trim() || "user",
              bio,
              avatar,
            }).then((message) => {
              if (message) {
                setError(message);
                setLoading(false);
              }
            });
          }}
        >
          {loading ? "Создаём аккаунт…" : "Начать"}
        </Button>
      </div>

      {editorFile ? (
        <PhotoEditor
          file={editorFile}
          mode="avatar"
          onCancel={() => setEditorFile(null)}
          onDone={({ dataUrl }) => {
            setAvatar(dataUrl);
            setEditorFile(null);
            playTone("tap");
          }}
        />
      ) : null}
    </div>
  );
}

export function AuthFlow() {
  const { setOnboarded, loginExisting, completeSignup } = useStore();
  const [step, setStep] = useState<"email" | "otp" | "signup">("email");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [checking, setChecking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const lastSentEmailRef = useRef("");
  const COOLDOWN_MS = 60_000;

  useEffect(() => {
    setOnboarded();
  }, [setOnboarded]);

  const address = normalizeEmail(email);

  /**
   * Главное правило входа: сначала ищем аккаунт локально, затем в
   * `zero_profiles` / `zero_states`. Существующий аккаунт входит сразу,
   * регистрация открывается только для действительно нового email.
   */
  const resolveAccount = useCallback(
    async (target: string) => {
      const key = normalizeEmail(target);
      if (!key) return;
      setLookupError(null);
      if (loginExisting(key)) return;

      setChecking(true);
      try {
        let remote: Awaited<ReturnType<typeof findRemoteAccount>> = null;
        let lastError: unknown = null;
        // Одна повторная попытка на случай краткого обрыва сети.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            remote = await findRemoteAccount(key);
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            if (attempt === 0) {
              await new Promise((resolve) => window.setTimeout(resolve, 500));
            }
          }
        }
        if (lastError) throw lastError;

        if (remote) {
          loginExisting(key, remote);
          return;
        }
        setStep("signup");
      } catch {
        setLookupError(
          "Не удалось проверить аккаунт. Проверьте подключение и попробуйте ещё раз.",
        );
      } finally {
        setChecking(false);
      }
    },
    [loginExisting],
  );

  // Поддержка magic link: если Supabase вернул сессию по ссылке из письма,
  // входим по email без ручного ввода кода.
  useEffect(() => {
    void (async () => {
      try {
        const hasAuthCallback =
          window.location.hash.includes("access_token") ||
          window.location.search.includes("code=");
        if (!hasAuthCallback) return;
        const { data } = await supabase.auth.getSession();
        const sessionEmail = data.session?.user?.email;
        if (!sessionEmail) return;
        const next = normalizeEmail(sessionEmail);
        setEmail(next);
        await resolveAccount(next);
      } catch {
        /* нет сессии — обычный вход по коду */
      }
    })();
  }, [resolveAccount]);

  // Подтверждение идёт через Supabase Auth (email OTP).
  const sendCode = async () => {
    if (sendingRef.current) return;
    if (lastSentEmailRef.current === address && cooldownUntil > Date.now()) return;
    sendingRef.current = true;
    lastSentEmailRef.current = address;
    setSending(true);
    setSendError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: true, emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setCooldownUntil(Date.now() + COOLDOWN_MS);
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      const message = error instanceof Error ? error.message : "";
      const rateLimited = status === 429 || /rate|limit|429|too many/i.test(message);
      // Supabase ограничивает частоту писем. Не показываем красную плашку —
      // просто выдерживаем паузу, после которой можно запросить код снова.
      setCooldownUntil(Date.now() + (rateLimited ? COOLDOWN_MS : 15_000));
      setSendError(
        rateLimited ? null : "Не удалось отправить код. Попробуйте ещё раз.",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const startOtp = () => {
    if (!isValidEmail(address)) return;
    setStep("otp");
    playTone("send");
    haptic(8);
    void sendCode();
  };

  const verifyCode = async (value: string) => {
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: address,
        token: value,
        type: "email",
      });
      return !error;
    } catch {
      return false;
    }
  };

  const finishOtp = () => {
    void resolveAccount(address);
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-background">
      <AnimatePresence mode="wait" initial={false}>
        {step === "email" ? (
          <motion.div
            key="email"
            initial={{ opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="h-full"
          >
            <EmailStep email={email} onEmail={setEmail} onContinue={startOtp} />
          </motion.div>
        ) : step === "otp" ? (
          <motion.div
            key="otp"
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 28 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="h-full"
          >
            <OtpStep
              email={address}
              sending={sending}
              sendError={sendError}
              cooldownUntil={cooldownUntil}
              onChangeEmail={() => {
                setStep("email");
                setSendError(null);
              }}
              onVerified={finishOtp}
              onVerify={verifyCode}
              onResend={sendCode}
            />
          </motion.div>
        ) : (
          <motion.div
            key="signup"
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 28 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="h-full"
          >
            <SignupStep
              email={address}
              onBack={() => setStep("email")}
              onDone={async ({ name, username, bio, avatar }) => {
                // @username — публичный ключ поиска, поэтому занятый
                // обрабатываем до создания профиля.
                try {
                  if (await isUsernameTaken(username, address)) {
                    return "Этот @username уже занят";
                  }
                } catch {
                  return "Не удалось проверить @username. Попробуйте ещё раз.";
                }
                completeSignup({
                  email: address,
                  name,
                  username,
                  avatar,
                  bio,
                });
                playTone("success");
                return null;
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {checking ? (
          <motion.div
            key="checking"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="pointer-events-none absolute inset-x-0 bottom-[max(30px,env(safe-area-inset-bottom,0px))] z-30 flex justify-center"
          >
            <div className="flex items-center gap-2 rounded-full bg-foreground/[0.08] px-4 py-2 backdrop-blur-md">
              <span className="size-3.5 animate-spin rounded-full border-2 border-foreground/25 border-t-foreground" />
              <span className="t-sub text-muted-foreground">Проверяем аккаунт…</span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {lookupError ? (
        <div className="absolute inset-0 z-40 grid place-items-center bg-background/95 px-6 backdrop-blur-sm">
          <div className="w-full max-w-sm text-center">
            <p className="t-body text-danger">{lookupError}</p>
            <div className="mt-5 flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setLookupError(null);
                  setStep("email");
                }}
              >
                Изменить почту
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setLookupError(null);
                  void resolveAccount(address);
                }}
              >
                Повторить
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}