import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import {
  Bluetooth,
  Check,
  Headphones,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Smartphone,
  Speaker,
  Volume2,
} from "lucide-react";
import { useAuthedStore } from "../lib/store";
import { playTone } from "../lib/feedback";
import {
  ICE_SERVERS,
  callRoom,
  newClientId,
  sendSignal,
  subscribeCall,
  type CallSignal,
  type IncomingCall,
} from "../lib/rtc";
import { supabase } from "../lib/supabase";
import { cn, duration as fmtDuration, haptic } from "../lib/utils";
import { Avatar } from "./Avatar";

type Phase = "incoming" | "calling" | "connecting" | "active" | "failed";
type Direction = "in" | "out" | "missed";
type AudioOutput = { deviceId: string; label: string };
type SinkAudioElement = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

/**
 * Chrome понимает специальный идентификатор «communications» — это
 * разговорное устройство (на телефоне — верхний динамик). Если его нет,
 * падаем обратно на системный маршрут.
 */
const EARPIECE_ID = "communications";

function OutputIcon({ label }: { label: string }) {
  if (/bluetooth|блютус|bt/i.test(label)) return <Bluetooth size={20} />;
  if (/headphone|наушник|airpod|buds|гарнитур|headset/i.test(label)) return <Headphones size={20} />;
  if (/верхн|earpiece|receiver|телефон/i.test(label)) return <Smartphone size={20} />;
  if (/speaker|динамик|monitor|display|hdmi/i.test(label)) return <Speaker size={20} />;
  return <Volume2 size={20} />;
}

export function CallOverlay({
  chatId,
  incoming,
  onClose,
}: {
  chatId: string;
  incoming?: IncomingCall;
  onClose: () => void;
}) {
  const { state, user, addCall } = useAuthedStore();
  const chat = state.chats.find((item) => item.id === chatId);
  const name = chat?.name ?? incoming?.from ?? "Zero";
  const room = incoming?.room ?? callRoom(chat?.username || chat?.name || "");

  const clientId = useRef(newClientId());
  const ended = useRef(false);
  const started = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const channelRef = useRef<ReturnType<typeof subscribeCall> | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const iceQueue = useRef<RTCIceCandidateInit[]>([]);
  const readyRef = useRef<Promise<void>>(Promise.resolve());
  const secondsRef = useRef(0);
  const finishRef = useRef<(direction: Direction) => void>(() => undefined);
  const startRef = useRef<() => void>(() => undefined);

  const [phase, setPhase] = useState<Phase>(incoming ? "incoming" : "calling");
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const [outputs, setOutputs] = useState<AudioOutput[]>([]);
  const [outputId, setOutputId] = useState("default");
  const outputIdRef = useRef(outputId);
  outputIdRef.current = outputId;
  const [routeOpen, setRouteOpen] = useState(false);
  const [sinkSupported] = useState(() => typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype);
  const [error, setError] = useState<string | null>(null);
  const swipeX = useMotionValue(0);
  const rejectHint = useTransform(swipeX, [-120, -28, 0], [1, 0, 0]);
  const acceptHint = useTransform(swipeX, [0, 28, 120], [0, 0, 1]);

  const finishCall = (direction: Direction) => {
    if (ended.current) return;
    ended.current = true;
    try {
      pcRef.current?.close();
    } catch {
      /* noop */
    }
    pcRef.current = null;
    localRef.current?.getTracks().forEach((track) => track.stop());
    localRef.current = null;
    addCall({ chatId, name, direction, duration: secondsRef.current });
    onClose();
  };
  finishRef.current = finishCall;

  const getMic = async () => {
    if (localRef.current) return localRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    localRef.current = stream;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !mutedRef.current;
    });
    void refreshOutputs();
    return stream;
  };

  const refreshOutputs = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setOutputs(
        devices
          .filter((device) => device.kind === "audiooutput")
          .map((device) => ({
            deviceId: device.deviceId,
            label: device.label?.trim() || "Аудиовыход",
          })),
      );
    } catch {
      setOutputs([]);
    }
  };

  const applyOutput = async (element: HTMLAudioElement, deviceId: string) => {
    const audio = element as SinkAudioElement;
    if (!audio.setSinkId) return;
    try {
      await audio.setSinkId(deviceId);
    } catch {
      /* маршрут управляется системой */
    }
  };

  const chooseOutput = async (deviceId: string) => {
    setOutputId(deviceId);
    setRouteOpen(false);
    haptic(5);
    const element = audioRef.current;
    if (element) await applyOutput(element, deviceId);
  };

  /** Ждём подписку на канал: отправка до SUBSCRIBED теряется. */
  const waitReady = (timeout = 2500) =>
    Promise.race([
      readyRef.current,
      new Promise<void>((resolve) => window.setTimeout(resolve, timeout)),
    ]);

  const flushIce = async () => {
    const pc = pcRef.current;
    if (!pc) return;
    const queued = iceQueue.current;
    iceQueue.current = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        /* устаревший кандидат */
      }
    }
  };

  const createPeer = (stream: MediaStream) => {
    // Trickle ICE: кандидаты уходят сразу, не дожидаясь полной сборки SDP.
    // Это заметно сокращает время до первого звука.
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 4,
      bundlePolicy: "max-bundle",
    });
    pcRef.current = pc;
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
    pc.ontrack = (event) => {
      const [remote] = event.streams;
      if (!remote || !audioRef.current) return;
      audioRef.current.srcObject = remote;
      audioRef.current.volume = 1;
      void applyOutput(audioRef.current, outputIdRef.current);
      void audioRef.current.play().catch(() => undefined);
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void sendSignal(channelRef.current, {
          client: clientId.current,
          kind: "ice",
          candidate: event.candidate.toJSON(),
        });
      }
    };
    pc.onconnectionstatechange = () => {
      const status = pc.connectionState;
      if (status === "connected") {
        playTone("success");
        setPhase("active");
      } else if (status === "failed") {
        setError("Не удалось установить соединение");
        setPhase("failed");
      }
    };
    return pc;
  };

  const startOutgoing = async () => {
    try {
      const stream = await getMic();
      if (ended.current) return;
      const pc = createPeer(stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (ended.current) return;
      await waitReady();
      await sendSignal(channelRef.current, {
        client: clientId.current,
        kind: "offer",
        from: user.name,
        handle: user.username,
        sdp: pc.localDescription ?? offer,
      });
    } catch {
      setError("Нет доступа к микрофону");
      setPhase("failed");
    }
  };
  startRef.current = () => {
    void startOutgoing();
  };

  const acceptIncoming = async () => {
    if (!incoming) return;
    setPhase("connecting");
    haptic(8);
    try {
      const stream = await getMic();
      const pc = createPeer(stream);
      await pc.setRemoteDescription(incoming.sdp);
      await flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (ended.current) return;
      await waitReady();
      await sendSignal(channelRef.current, {
        client: clientId.current,
        kind: "answer",
        sdp: pc.localDescription ?? answer,
      });
    } catch {
      setError("Нет доступа к микрофону");
      setPhase("failed");
    }
  };

  const hangUp = () => {
    if (ended.current) return;
    playTone("hangup");
    haptic([10, 40, 14]);

    const direction: Direction = incoming
      ? phaseRef.current === "active"
        ? "in"
        : "missed"
      : "out";

    // Отправляем сигнал до закрытия комнаты, иначе Realtime может не успеть
    // доставить hangup и у собеседника звонок продолжит звонить.
    const channel = channelRef.current;
    if (channel) {
      void waitReady(600).then(() =>
        sendSignal(channel, { client: clientId.current, kind: "hangup" }),
      ).finally(() => {
        finishRef.current(direction);
      });
      window.setTimeout(() => finishRef.current(direction), 900);
    } else {
      finishRef.current(direction);
    }
  };

  const handleSignal = (signal: CallSignal) => {
    if (signal.client === clientId.current) return;
    if (signal.kind === "offer") return;

    if (signal.kind === "hangup") {
      if (ended.current) return;
      playTone("hangup");
      const direction: Direction = incoming
        ? phaseRef.current === "active"
          ? "in"
          : "missed"
        : phaseRef.current === "active"
          ? "out"
          : "missed";
      finishCall(direction);
      return;
    }

    const pc = pcRef.current;
    if (!pc) return;

    if (signal.kind === "answer") {
      if (pc.currentRemoteDescription) return;
      void pc
        .setRemoteDescription(signal.sdp)
        .then(() => flushIce())
        .catch(() => undefined);
      return;
    }

    if (signal.kind === "ice") {
      if (pc.remoteDescription) {
        void pc.addIceCandidate(signal.candidate).catch(() => undefined);
      } else {
        iceQueue.current.push(signal.candidate);
      }
    }
  };

  // Сигналинг через Supabase Realtime.
  useEffect(() => {
    let resolveReady: (() => void) | null = null;
    readyRef.current = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const channel = subscribeCall(
      room,
      handleSignal,
      () => {
        resolveReady?.();
        if (incoming || started.current) return;
        started.current = true;
        startRef.current();
      },
    );
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, incoming]);

  // Таймер разговора.
  useEffect(() => {
    if (phase !== "active") return;
    const timer = window.setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  // Входящий рингтон.
  useEffect(() => {
    if (phase !== "incoming") return;
    playTone("receive");
    const timer = window.setInterval(() => playTone("receive"), 2400);
    return () => window.clearInterval(timer);
  }, [phase]);

  // Исходящий звонок без ответа.
  useEffect(() => {
    if (phase !== "calling" || incoming) return;
    const timer = window.setTimeout(() => {
      setError("Нет ответа");
      finishRef.current("out");
    }, 45_000);
    return () => window.clearTimeout(timer);
  }, [phase, incoming]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hangUp();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      try {
        pcRef.current?.close();
      } catch {
        /* noop */
      }
      localRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    localRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    haptic(5);
  };

  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.addEventListener) return;
    const handler = () => { void refreshOutputs(); };
    media.addEventListener("devicechange", handler);
    return () => media.removeEventListener("devicechange", handler);
  }, []);

  const label =
    phase === "active"
      ? fmtDuration(seconds)
      : phase === "incoming"
        ? "Входящий звонок"
        : phase === "connecting"
          ? "Подключаем…"
          : phase === "failed"
            ? error ?? "Не удалось соединиться"
            : "Соединяем…";

  const routeLabel =
    outputId === "default"
      ? "Динамик"
      : outputId === EARPIECE_ID
        ? "Верхний динамик"
        : outputs.find((output) => output.deviceId === outputId)?.label ?? "Аудиовыход";

  const outputOptions: AudioOutput[] = [
    { deviceId: "default", label: "Динамик" },
    { deviceId: EARPIECE_ID, label: "Верхний динамик" },
    ...outputs.filter(
      (output) => output.deviceId !== "default" && output.deviceId !== EARPIECE_ID,
    ),
  ];

  const ring = phase === "incoming" || phase === "calling";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.01 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[90] flex justify-center overflow-hidden bg-[#08080a] text-white"
      role="dialog"
      aria-modal="true"
      aria-label={`Звонок · ${name}`}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[34%] h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,oklch(0.38_0_0/0.55),transparent_66%)] blur-2xl" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_110%,oklch(0.2_0_0/0.7),transparent_70%)]" />
      </div>
      <div className="grain pointer-events-none absolute inset-0 opacity-70" />

      <div className="relative flex h-full w-full max-w-[520px] flex-col px-6 pt-[max(18px,env(safe-area-inset-top,0px))] pb-[max(24px,env(safe-area-inset-bottom,0px))]">
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center">
          {incoming && phase === "incoming" ? (
            <>
              <motion.div style={{ opacity: rejectHint }} className="pointer-events-none absolute left-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2 text-danger">
                <span className="grid size-12 place-items-center rounded-full border border-danger/25 bg-danger/10"><PhoneOff size={20} /></span>
                <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-danger/70">Отклонить</span>
              </motion.div>
              <motion.div style={{ opacity: acceptHint }} className="pointer-events-none absolute right-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2 text-online">
                <span className="grid size-12 place-items-center rounded-full border border-online/25 bg-online/10"><Phone size={20} /></span>
                <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-online/80">Принять</span>
              </motion.div>
            </>
          ) : null}

          <motion.div
            drag={incoming && phase === "incoming" ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.55}
            dragMomentum={false}
            style={{ x: swipeX }}
            onDragEnd={(_, info) => {
              if (info.offset.x > 92) {
                void acceptIncoming();
                return;
              }
              if (info.offset.x < -92) {
                hangUp();
                return;
              }
              animate(swipeX, 0, { type: "spring", stiffness: 420, damping: 32 });
            }}
            className={cn(
              "relative flex h-full w-full flex-col items-center justify-center",
              incoming && phase === "incoming" && "cursor-grab touch-pan-y active:cursor-grabbing",
            )}
          >
            <div className="relative">
              {ring ? <span className="pulse-ring absolute inset-0 rounded-full border border-white/15" /> : null}
              {ring ? (
                <span
                  className="pulse-ring absolute inset-0 rounded-full border border-white/10"
                  style={{ animationDelay: "1.2s" }}
                />
              ) : null}
              <Avatar
                name={name}
                src={chat?.avatar}
                size={136}
                liquid
                className="shadow-[0_30px_90px_-24px_rgba(0,0,0,0.9)] ring-1 ring-white/15"
              />
            </div>

            <h1 className="t-title mt-7 max-w-full truncate px-4 text-white">{name}</h1>

            <p className={cn("t-sub mt-2 flex items-center gap-2", phase === "failed" ? "text-danger" : "text-white/55")}>
              {phase === "calling" ? (
                <span className="flex items-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="typing-dot size-1 rounded-full bg-white/60"
                      style={{ animationDelay: `${i * 0.18}s` }}
                    />
                  ))}
                </span>
              ) : phase === "active" ? (
                <span className="size-1.5 rounded-full bg-online" />
              ) : null}
              <span className={phase === "active" ? "t-num" : undefined}>{label}</span>
            </p>

            {incoming && phase === "incoming" ? (
              <p className="t-time mt-5 text-center text-white/30">Свайп вправо — принять, влево — отклонить</p>
            ) : null}
          </motion.div>
        </div>

        <audio ref={audioRef} autoPlay playsInline className="hidden" />

        {incoming && (phase === "incoming" || phase === "connecting" || phase === "failed") ? (
          <div className="mt-auto grid w-full grid-cols-2 gap-5 px-7 pb-4">
            <motion.button
              type="button"
              whileTap={{ scale: 0.93 }}
              onClick={hangUp}
              aria-label="Отклонить звонок"
              className="grid h-[68px] w-full place-items-center rounded-full bg-danger text-white shadow-[0_18px_50px_-12px_rgba(255,60,60,0.55)]"
            >
              <PhoneOff size={26} strokeWidth={1.9} />
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.93 }}
              onClick={() => { void acceptIncoming(); }}
              disabled={phase === "connecting"}
              aria-label="Принять звонок"
              className="grid h-[68px] w-full place-items-center rounded-full bg-online text-white shadow-[0_18px_50px_-12px_rgba(48,209,88,0.55)] disabled:opacity-60"
            >
              <Phone size={26} strokeWidth={1.9} />
            </motion.button>
          </div>
        ) : (
          <div className="mt-auto grid w-full grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 pb-4">
            <CallButton
              label={muted ? "Включить микрофон" : "Выключить микрофон"}
              active={muted}
              className="justify-self-start"
              onClick={toggleMute}
            >
              {muted ? <MicOff size={20} /> : <Mic size={20} />}
            </CallButton>

            <motion.button
              type="button"
              whileTap={{ scale: 0.93 }}
              onClick={hangUp}
              aria-label="Завершить звонок"
              className="grid size-[66px] place-items-center justify-self-center rounded-full bg-danger text-white shadow-[0_16px_44px_-10px_rgba(255,50,50,0.35)]"
            >
              <PhoneOff size={25} strokeWidth={1.9} />
            </motion.button>

            <CallButton
              label={`Звук звонка: ${routeLabel}`}
              active={routeOpen}
              className="justify-self-end"
              onClick={() => { setRouteOpen(true); void refreshOutputs(); }}
            >
              <OutputIcon label={routeLabel} />
            </CallButton>
          </div>
        )}
      </div>

      <AnimatePresence>
      {routeOpen ? (
        <div
          className="absolute inset-0 z-[96] flex items-end justify-center bg-black/55 px-0 pb-0 backdrop-blur-[3px]"
          onClick={() => setRouteOpen(false)}
        >
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 42, mass: 0.7 }}
            onClick={(event) => event.stopPropagation()}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 80 || info.velocity.y > 600) setRouteOpen(false);
            }}
            className="w-full max-w-[520px] overflow-hidden rounded-t-[28px] border-t border-white/10 bg-[#111113] pb-[max(18px,env(safe-area-inset-bottom,0px))] shadow-[0_-30px_80px_rgba(0,0,0,0.8)]"
          >
            <div className="flex cursor-grab justify-center pt-2.5 pb-1 active:cursor-grabbing">
              <span className="h-1 w-9 rounded-full bg-white/20" />
            </div>
            <div className="px-5 pb-2 pt-2">
              <p className="text-[17px] font-semibold text-white">Звук звонка</p>
              <p className="mt-1 text-[12.5px] leading-snug text-white/45">
                {sinkSupported
                  ? "Куда выводить голос собеседника"
                  : "Браузер сам выбирает маршрут — переключение может быть недоступно"}
              </p>
            </div>
            <div className="space-y-1 px-3">
              {outputOptions.map((option) => {
                const active = option.deviceId === outputId;
                return (
                  <button
                    key={option.deviceId}
                    type="button"
                    onClick={() => { void chooseOutput(option.deviceId); }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[15px] px-3 py-3 text-left transition-colors",
                      active ? "bg-white/[0.09]" : "hover:bg-white/[0.05]",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-full transition-colors",
                        active ? "bg-white text-black" : "bg-white/8 text-white/70",
                      )}
                    >
                      <OutputIcon label={option.label} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14.5px] text-white/85">
                      {option.label}
                    </span>
                    {active ? <Check size={17} className="shrink-0 text-white" /> : null}
                  </button>
                );
              })}
            </div>
            <div className="px-3 pt-3">
              <button
                type="button"
                onClick={() => setRouteOpen(false)}
                className="h-12 w-full rounded-[15px] bg-white/8 text-[14.5px] font-medium text-white/85 transition-colors hover:bg-white/12"
              >
                Готово
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

function CallButton({
  children,
  label,
  active,
  onClick,
  className,
}: {
  children: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "grid size-[52px] place-items-center rounded-full border backdrop-blur-xl transition-colors duration-300",
        active
          ? "border-white/70 bg-white text-[#0b0b0c]"
          : "border-white/12 bg-white/8 text-white/80 hover:bg-white/12",
        className,
      )}
    >
      {children}
    </motion.button>
  );
}
