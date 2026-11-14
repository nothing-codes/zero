import { Pause, Play, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useMediaSrc } from "../lib/useMediaSrc";
import { cn, duration, fileSize, haptic, trackMeta } from "../lib/utils";
import type { Message, PinnedMusic } from "../types";

/**
 * Обложка трека в стиле приложения: монохромный градиент, без случайных
 * цветных пятен. Число из названия только слегка меняет светлоту.
 */
function coverStyle(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 97;
  }
  const top = 30 + (hash % 10);
  const mid = 18 + (hash % 7);
  return {
    backgroundImage: `radial-gradient(120% 120% at 22% 12%, hsl(0 0% ${top + 8}% / 0.95), transparent 58%), linear-gradient(150deg, hsl(0 0% ${top}%) 0%, hsl(0 0% ${mid}%) 58%, hsl(0 0% 9%) 100%)`,
  };
}

function TrackPlayer({
  src,
  enc,
  title,
  artist,
  size,
  mine,
  compact,
}: {
  src: string;
  enc?: PinnedMusic["enc"];
  title: string;
  artist: string;
  size?: number;
  mine?: boolean;
  compact?: boolean;
}) {
  const mediaSrc = useMediaSrc(src, enc);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);

  /** Подключаем анализатор к самому аудио, чтобы полоски двигались в такт треку. */
  const setupAnalyser = () => {
    if (analyserRef.current) return analyserRef.current;
    const element = audioRef.current;
    if (!element) return null;
    const Ctor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      const ctx = new Ctor();
      const source = ctx.createMediaElementSource(element);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      return analyser;
    } catch {
      return null;
    }
  };

  const toggle = () => {
    haptic(4);
    const element = audioRef.current;
    if (!element) {
      setFailed(true);
      return;
    }
    if (playing) {
      element.pause();
      setPlaying(false);
      return;
    }
    setFailed(false);
    const analyser = setupAnalyser();
    if (analyser && audioCtxRef.current?.state === "suspended") {
      void audioCtxRef.current.resume();
    }
    void element.play().catch(() => setFailed(true));
    setPlaying(true);
  };

  useEffect(() => {
    const bars = barsRef.current;
    const idle = "scaleY(0.38)";
    const reset = () => bars.forEach((bar) => { if (bar) bar.style.transform = idle; });
    if (!playing) {
      window.cancelAnimationFrame(rafRef.current);
      reset();
      return;
    }

    const analyser = analyserRef.current;
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const started = performance.now();
    const tick = (time: number) => {
      if (analyser && data) analyser.getByteFrequencyData(data);
      bars.forEach((bar, index) => {
        if (!bar) return;
        const sample = data ? data[Math.min(data.length - 1, 1 + index * 3)] / 255 : 0;
        const level = sample > 0.03
          ? 0.18 + sample * 0.82
          : 0.3 + 0.32 * (0.5 + 0.5 * Math.sin((time - started) / 190 + index * 1.9));
        bar.style.transform = `scaleY(${level.toFixed(3)})`;
      });
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafRef.current);
      reset();
    };
  }, [playing]);

  useEffect(() => {
    return () => {
      window.cancelAnimationFrame(rafRef.current);
      try {
        void audioCtxRef.current?.close();
      } catch {
        /* контекст уже закрыт */
      }
      audioCtxRef.current = null;
      analyserRef.current = null;
    };
  }, [mediaSrc]);

  const seek = (event: MouseEvent<HTMLDivElement>) => {
    const element = audioRef.current;
    if (!element) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    if (Number.isFinite(element.duration) && element.duration > 0) {
      element.currentTime = ratio * element.duration;
      setProgress(ratio);
    }
  };

  const artwork = compact ? 44 : 52;

  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      <div
        className="relative grid shrink-0 place-items-center overflow-hidden rounded-[11px] text-white/85 shadow-inner"
        style={{ width: artwork, height: artwork, ...coverStyle(title) }}
      >
        <span className="flex h-[18px] items-center justify-center gap-[3px]">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              ref={(node) => { barsRef.current[index] = node; }}
              className="h-full w-[3px] rounded-full bg-white/85"
              style={{ transform: "scaleY(0.38)" }}
            />
          ))}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium leading-tight">{title}</p>
        <p className="mt-0.5 truncate text-[11px] opacity-55">{artist}</p>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Позиция трека"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          onClick={seek}
          className="mt-2 flex h-3 cursor-pointer items-center"
        >
          <span className={cn("relative h-[3px] w-full overflow-hidden rounded-full", mine ? "bg-primary-foreground/20" : "bg-foreground/15")}>
            <span
              className={cn("absolute inset-y-0 left-0 rounded-full", mine ? "bg-primary-foreground/80" : "bg-foreground/70")}
              style={{ width: `${Math.max(0, progress * 100)}%` }}
            />
          </span>
        </div>
        <p className="mt-1 text-[10px] tabular-nums opacity-50">
          {failed
            ? "Не удалось воспроизвести"
            : `${duration(total * progress)}${total ? ` / ${duration(total)}` : ""}${size ? ` · ${fileSize(size)}` : ""}`}
        </p>
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Пауза" : "Воспроизвести"}
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-full transition-transform active:scale-95",
          mine ? "bg-primary-foreground/15" : "bg-foreground/10",
        )}
      >
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} className="ml-0.5" fill="currentColor" />}
      </button>

      {mediaSrc ? (
        <audio
          ref={audioRef}
          src={mediaSrc}
          preload="metadata"
          playsInline
          hidden
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) setTotal(value);
          }}
          onTimeUpdate={(event) => {
            const element = event.currentTarget;
            if (Number.isFinite(element.duration) && element.duration > 0) {
              setTotal(element.duration);
              setProgress(element.currentTime / element.duration);
            }
          }}
          onError={() => {
            setPlaying(false);
            setFailed(true);
          }}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
        />
      ) : null}
    </div>
  );
}

export function MusicBubble({ message, mine }: { message: Message; mine: boolean }) {
  const file = message.file!;
  const meta = trackMeta(file.name);
  return (
    <div className="flex min-w-[250px] max-w-[292px] items-center py-0.5">
      <TrackPlayer
        src={file.src ?? ""}
        enc={file.enc}
        title={meta.title}
        artist={meta.artist}
        size={file.size}
        mine={mine}
        compact
      />
    </div>
  );
}

export function PinnedMusicPlayer({
  track,
  onRemove,
}: {
  track: PinnedMusic;
  onRemove?: () => void;
}) {
  return (
    <div className="rounded-[18px] border border-foreground/8 bg-foreground/[0.03] p-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="t-sub text-faint">Закреплённая музыка</span>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Снять закрепление"
            className="grid size-6 place-items-center rounded-full text-faint transition-colors hover:bg-foreground/8 hover:text-foreground"
          >
            <X size={13} />
          </button>
        ) : null}
      </div>
      <TrackPlayer
        src={track.src}
        enc={track.enc}
        title={track.title}
        artist={track.artist}
        size={track.size}
      />
    </div>
  );
}
