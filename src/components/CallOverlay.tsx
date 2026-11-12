import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Volume2,
  VolumeX,
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
  const [speaker, setSpeaker] = useState(false);
  const speakerRef = useRef(speaker);
  speakerRef.current = speaker;
  const [error, setError] = useState<string | null>(null);

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
    return stream;
  };

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

  // Ждём, пока соберутся ICE-кандидаты, чтобы отправить их прямо в SDP.
  // Собеседник подписывается на комнату с задержкой, и отдельные candidate-
  // сообщения могли бы потеряться до его подключения.
  const waitForIce = (pc: RTCPeerConnection) =>
    new Promise<void>((resolve) => {
      if (pc.iceGatheringState === "complete") {
        resolve();
        return;
      }
      const done = () => {
        window.clearTimeout(timeout);
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      const check = () => {
        if (pc.iceGatheringState === "complete") done();
      };
      const timeout = window.setTimeout(done, 2500);
      pc.addEventListener("icegatheringstatechange", check);
    });

  const createPeer = (stream: MediaStream) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
    pc.ontrack = (event) => {
      const [remote] = event.streams;
      if (!remote || !audioRef.current) return;
      audioRef.current.srcObject = remote;
      audioRef.current.volume = speakerRef.current ? 1 : 0.85;
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
      await waitForIce(pc);
      if (ended.current) return;
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
      await waitForIce(pc);
      if (ended.current) return;
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
      void sendSignal(channel, { client: clientId.current, kind: "hangup" }).finally(() => {
        finishRef.current(direction);
      });
      window.setTimeout(() => finishRef.current(direction), 450);
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
    const channel = subscribeCall(
      room,
      handleSignal,
      () => {
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

  const toggleSpeaker = () => {
    const next = !speaker;
    setSpeaker(next);
    if (audioRef.current) audioRef.current.volume = next ? 1 : 0.85;
    haptic(5);
  };

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
        </div>

        <audio ref={audioRef} autoPlay playsInline className="hidden" />

        {incoming && (phase === "incoming" || phase === "connecting" || phase === "failed") ? (
          <div className="mt-auto grid w-full grid-cols-2 gap-6 px-8 pb-4">
            <motion.button
              type="button"
              whileTap={{ scale: 0.93 }}
              onClick={hangUp}
              aria-label="Отклонить звонок"
              className="grid h-[66px] w-full place-items-center rounded-full bg-danger text-white shadow-[0_16px_44px_-10px_rgba(255,50,50,0.35)]"
            >
              <PhoneOff size={25} strokeWidth={1.9} />
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.93 }}
              onClick={() => { void acceptIncoming(); }}
              disabled={phase === "connecting"}
              aria-label="Принять звонок"
              className="grid h-[66px] w-full place-items-center rounded-full bg-white text-[#0b0b0c] shadow-[0_16px_44px_-10px_rgba(255,255,255,0.25)] disabled:opacity-60"
            >
              <Phone size={25} strokeWidth={1.9} />
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
              label={speaker ? "Выключить громкость" : "Включить громкость"}
              active={speaker}
              className="justify-self-end"
              onClick={toggleSpeaker}
            >
              {speaker ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </CallButton>
          </div>
        )}
      </div>
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
