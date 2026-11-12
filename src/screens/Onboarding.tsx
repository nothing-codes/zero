import { animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from "motion/react";
import { ArrowRight, Check, Lock, Mail, MessageCircle, Phone, Shield, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/ui";
import { clamp, cn, haptic } from "../lib/utils";

const SLIDES = [
  {
    kicker: "Zero",
    title: "Ноль лишнего.",
    text: "Тихий мессенджер для своих. Ни рекламы, ни рекомендаций, ни шума — только вы и ваши люди.",
  },
  {
    kicker: "Приватность",
    title: "Ноль слежки.",
    text: "Сообщения шифруются на устройстве. Сервер хранит только шум — прочитать переписку нельзя.",
  },
  {
    kicker: "Начало",
    title: "Тридцать секунд.",
    text: "Gmail и короткий код из письма — и вы внутри. Установите Zero на домашний экран и оставайтесь на связи.",
  },
];

function ArtOne() {
  return (
    <div className="relative grid size-full place-items-center">
      <div className="absolute size-[290px] rounded-full border border-foreground/10" />
      <div className="absolute size-[250px] rounded-full border border-dashed border-foreground/12 spin-slow" />
      <div className="absolute size-[210px] rounded-full bg-foreground/[0.03] blur-xl" />
      <Avatar name="Zero" size={168} liquid className="relative" />
      <motion.div
        animate={{ y: [0, -7, 0] }}
        transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
        className="absolute left-[6%] top-[16%] flex items-center gap-2 rounded-full border border-foreground/10 bg-card/90 px-3 py-2 shadow-xl backdrop-blur"
      >
        <MessageCircle size={14} className="text-foreground/70" />
        <span className="t-sub text-foreground/80">тихо</span>
      </motion.div>
      <motion.div
        animate={{ y: [0, 8, 0] }}
        transition={{ duration: 6.4, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
        className="absolute right-[4%] top-[30%] flex items-center gap-2 rounded-full border border-foreground/10 bg-card/90 px-3 py-2 shadow-xl backdrop-blur"
      >
        <Lock size={13} className="text-foreground/70" />
        <span className="t-sub text-foreground/80">E2E</span>
      </motion.div>
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 1.1 }}
        className="absolute bottom-[10%] left-[13%] flex -space-x-2"
      >
        {["Аня", "Максим", "Полина"].map((name, i) => (
          <span key={name} className="rounded-full border-2 border-background">
            <Avatar name={name} size={i === 1 ? 32 : 28} />
          </span>
        ))}
      </motion.div>
      <div className="absolute bottom-[10%] right-[12%] rounded-full border border-foreground/10 bg-card/90 px-3 py-2 backdrop-blur">
        <span className="t-cap text-faint">0 шума</span>
      </div>
    </div>
  );
}

function ArtTwo() {
  return (
    <div className="relative grid size-full place-items-center">
      <div className="absolute size-[292px] rounded-full border border-foreground/8" />
      <div className="absolute size-[238px] rounded-full border border-foreground/10" />
      <div className="absolute size-[184px] rounded-full border border-dashed border-foreground/14" />
      <div className="absolute size-[150px] rounded-full bg-foreground/[0.05] blur-lg" />
      <motion.div
        animate={{ scale: [1, 1.035, 1] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        className="relative grid size-[116px] place-items-center rounded-[36px] border border-foreground/12 bg-card shadow-[0_25px_60px_-24px_rgba(0,0,0,0.9)]"
      >
        <Lock size={38} strokeWidth={1.4} className="text-foreground/85" />
      </motion.div>
      {[
        { label: "E2E", icon: Shield, className: "left-[6%] top-[17%]" },
        { label: "Без рекламы", icon: Check, className: "right-[2%] top-[28%]" },
        { label: "Без алгоритмов", icon: Sparkles, className: "left-[8%] bottom-[14%]" },
        { label: "Ваша почта", icon: Mail, className: "right-[6%] bottom-[20%]" },
      ].map((item, i) => {
        const Icon = item.icon;
        return (
          <motion.div
            key={item.label}
            animate={{ y: [0, i % 2 ? 7 : -7, 0] }}
            transition={{ duration: 5.5 + i * 0.6, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 }}
            className={cn(
              "absolute flex items-center gap-2 rounded-full border border-foreground/10 bg-card/90 px-3 py-2 shadow-lg backdrop-blur",
              item.className,
            )}
          >
            <Icon size={13} className="text-foreground/65" />
            <span className="t-sub text-foreground/80">{item.label}</span>
          </motion.div>
        );
      })}
    </div>
  );
}

function ArtThree() {
  return (
    <div className="relative grid size-full place-items-center">
      <div className="absolute size-[286px] rounded-full bg-foreground/[0.035] blur-2xl" />
      <div className="relative w-[76%] space-y-2.5">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex items-end gap-2"
        >
          <Avatar name="Аня" size={26} />
          <div className="radius-card rounded-bl-[6px] bg-bubble-in px-3.5 py-2.5">
            <span className="t-sub text-foreground">Ты уже внутри?</span>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="flex justify-end"
        >
          <div className="radius-card rounded-br-[6px] bg-primary px-3.5 py-2.5 text-primary-foreground">
            <span className="t-sub">Да. И здесь тихо.</span>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="flex items-end gap-2"
        >
          <Avatar name="Аня" size={26} />
          <div className="radius-card rounded-bl-[6px] bg-bubble-in px-3.5 py-2.5">
            <span className="t-sub text-foreground">Начнём.</span>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="!mt-5 flex items-center justify-center gap-1 rounded-[20px] border border-foreground/10 bg-card/80 p-2 backdrop-blur"
        >
          {[MessageCircle, Mail, Lock].map((Icon, i) => (
            <span
              key={i}
              className={cn(
                "grid size-8 place-items-center rounded-full",
                i === 0 ? "bg-foreground/10 text-foreground" : "text-faint",
              )}
            >
              <Icon size={15} />
            </span>
          ))}
          <span className="mx-2 h-4 w-px bg-foreground/10" />
          <span className="t-cap pr-2 text-faint">Zero</span>
        </motion.div>
      </div>
      <div className="absolute bottom-[4%] flex items-center gap-2 rounded-full border border-foreground/10 bg-card/80 px-3 py-1.5 backdrop-blur">
        <span className="size-1.5 rounded-full bg-online" />
        <span className="t-sub text-muted-foreground">На связи в 3 чатах</span>
      </div>
    </div>
  );
}

const ART = [<ArtOne key="1" />, <ArtTwo key="2" />, <ArtThree key="3" />];

function Slide({
  x,
  index,
  width,
  art,
  kicker,
  title,
  text,
}: {
  x: MotionValue<number>;
  index: number;
  width: number;
  art: ReactNode;
  kicker: string;
  title: string;
  text: string;
}) {
  const artX = useTransform(x, (value) => (value + index * width) * -0.1);
  const textX = useTransform(x, (value) => (value + index * width) * 0.045);
  const fade = useTransform(x, (value) => {
    const distance = Math.abs(value + index * width);
    return 1 - Math.min(0.6, (distance / Math.max(width, 1)) * 0.6);
  });

  return (
    <div className="flex h-full flex-none flex-col" style={{ width }}>
      <motion.div style={{ x: artX, opacity: fade }} className="relative min-h-0 flex-1">
        <div className="absolute inset-0">{art}</div>
      </motion.div>
      <motion.div style={{ x: textX, opacity: fade }} className="px-6 pb-4">
        <span className="t-cap text-faint">{kicker}</span>
        <h1 className="t-display mt-3 text-foreground">{title}</h1>
        <p className="t-body mt-3 max-w-[330px] text-balance text-muted-foreground">{text}</p>
      </motion.div>
    </div>
  );
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(390);
  const x = useMotionValue(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => setWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reduce) {
      x.set(-index * width);
      return;
    }
    const controls = animate(x, -index * width, {
      type: "spring",
      stiffness: 260,
      damping: 32,
      mass: 0.9,
    });
    return () => controls.stop();
  }, [index, width, x, reduce]);

  const go = (next: number) => {
    const clamped = clamp(next, 0, SLIDES.length - 1);
    if (clamped !== index) haptic(6);
    setIndex(clamped);
  };

  return (
    <div ref={containerRef} className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_50%_at_50%_0%,var(--chat-wash),transparent_75%)]" />

      <header className="relative z-10 flex items-center justify-between px-6 pt-[max(18px,env(safe-area-inset-top,0px))]">
        <div className="flex items-center gap-2">
          {/* Замененный логотип */}
          <img src="/logo.png" alt="Zero" className="h-6 w-auto object-contain" />
          <span className="t-cap text-foreground/80">Zero</span>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="press t-sub rounded-full px-3 py-1.5 text-faint hover:text-foreground"
        >
          Пропустить
        </button>
      </header>

      <motion.div
        drag={reduce ? false : "x"}
        style={{ x }}
        dragConstraints={{ left: -width * (SLIDES.length - 1), right: 0 }}
        dragElastic={0.14}
        onDragEnd={(_, info) => {
          if (info.offset.x < -54 || info.velocity.x < -420) go(index + 1);
          else if (info.offset.x > 54 || info.velocity.x > 420) go(index - 1);
          else {
            if (reduce) x.set(-index * width);
            else
              animate(x, -index * width, {
                type: "spring",
                stiffness: 300,
                damping: 34,
              });
          }
        }}
        className="relative z-10 flex min-h-0 flex-1 cursor-grab touch-pan-y active:cursor-grabbing"
      >
        {SLIDES.map((slide, i) => (
          <Slide
            key={slide.title}
            x={x}
            index={i}
            width={width}
            art={ART[i]}
            kicker={slide.kicker}
            title={slide.title}
            text={slide.text}
          />
        ))}
      </motion.div>

      <div className="relative z-10 px-6 pb-[max(22px,env(safe-area-inset-bottom,0px))] pt-2">
        <div className="mb-5 flex items-center gap-1.5">
          {SLIDES.map((slide, i) => (
            <button
              key={slide.title}
              type="button"
              aria-label={`Экран ${i + 1}`}
              onClick={() => go(i)}
              className="h-1.5 rounded-full transition-all duration-500"
              style={{
                width: i === index ? 26 : 6,
                backgroundColor:
                  i === index
                    ? "var(--foreground)"
                    : "color-mix(in oklch, var(--foreground) 20%, transparent)",
              }}
            />
          ))}
        </div>
        <Button
          className="w-full"
          onClick={() => {
            if (index < SLIDES.length - 1) go(index + 1);
            else onDone();
          }}
        >
          {index < SLIDES.length - 1 ? "Далее" : "Начать"}
          <ArrowRight size={17} strokeWidth={2} />
        </Button>
        <p className="t-sub mt-3 text-center text-faint">Один шрифт. Одна система. Ноль лишнего.</p>
      </div>
    </div>
  );
}