import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import {
  ArrowDown, ArrowLeft, AtSign, BadgeCheck, Ban, BarChart3, Bookmark, Camera, Check, CheckCheck, ChevronDown, ChevronUp, Clock3, Copy, Download, Eraser, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, File as FileIcon, Forward, Image as ImageIcon, Loader2, Mail, Megaphone, Mic, MoreVertical, Music2, Paperclip, Pause, Pencil, Phone, Pin, Play, Plus, Reply, Search, Send, Sticker, Trash2, UserPlus, Users, Video, X,
} from "lucide-react";
import {
  Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject,
} from "react";
import { Avatar } from "../components/Avatar";
import { ContactPicker } from "../components/ContactPicker";
import { MapArt, PhotoArt } from "../components/media";
import { MusicBubble } from "../components/Music";
import { PeoplePicker } from "../components/PeoplePicker";
import { PhotoEditor, type EditedImage } from "../components/PhotoEditor";
import { Button, ContextMenu, IconButton, Sheet, SettingsRow } from "../components/ui";
import {
  downloadFileBlob, pickZeroDirectory, saveImageToGallery, triggerBlobDownload, uploadFileToCloud, writeBlobToDirectory,
} from "../lib/files";
import { normalizeEmail, normalizeUsername, searchProfiles, type ZeroProfile } from "../lib/chat";
import { decryptBlob } from "../lib/e2ee";
import { isZeroIdentity } from "../lib/identity";
import { useMediaSrc } from "../lib/useMediaSrc";
import { pickRecorderMime, uploadMedia } from "../lib/media";
import { useAuthedStore } from "../lib/store";
import type { Chat, GroupMember, MediaEncryption, Message, MessageStatus, PollOption } from "../types";
import { cn, duration as fmtDuration, haptic, isAudioFile, lastSeenLabel, makeWave, plural, timeOf, trackMeta, uid } from "../lib/utils";

function searchText(message: Message) {
  return [message.text, message.photo?.caption, message.file?.name, message.location?.title, message.poll?.question].filter(Boolean).join(" ").toLowerCase();
}

function previewOf(message?: Message) {
  if (!message) return "";
  switch (message.kind) {
    case "sticker": return "Стикер";
    case "voice": return "Голосовое сообщение";
    case "videoNote": return "Видеосообщение";
    case "photo": return message.photo?.caption || "Фотография";
    case "file": return isAudioFile(message.file) ? "Музыка" : message.file?.name || "Файл";
    case "location": return message.location?.title || "Геопозиция";
    case "poll": return message.poll?.question || "Опрос";
    default: return message.text || "";
  }
}

const MENTION_SPLIT = /(@[a-zA-Z0-9_]{2,24})/g;
const MENTION_TEST = /^@[a-zA-Z0-9_]{2,24}$/;

/** Подсвечивает все вхождения поискового запроса. */
function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const needle = query.toLowerCase();
  const haystack = text.toLowerCase();
  const output: ReactNode[] = [];
  let from = 0;
  let found = haystack.indexOf(needle, from);
  let key = 0;
  while (found !== -1) {
    if (found > from) output.push(text.slice(from, found));
    output.push(
      <mark key={key} className="rounded-[3px] bg-[#ffd60a] px-[1px] text-black">
        {text.slice(found, found + needle.length)}
      </mark>,
    );
    key += 1;
    from = found + needle.length;
    found = haystack.indexOf(needle, from);
  }
  output.push(text.slice(from));
  return <>{output}</>;
}

/** Текст с подсветкой @упоминаний и найденных совпадений. */
function RichText({ text, query, onMention }: { text?: string; query?: string; onMention?: (username: string) => void }) {
  if (!text) return null;
  const parts = text.split(MENTION_SPLIT);
  return (
    <>
      {parts.map((part, index) => {
        if (MENTION_TEST.test(part)) {
          const username = part.slice(1);
          return (
            <button
              key={`m-${index}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onMention?.(username);
              }}
              className="relative z-10 inline font-medium text-[#6fb7ff] hover:underline"
            >
              {onMention ? <Highlighted text={part} query={query ?? ""} /> : part}
            </button>
          );
        }
        return <Highlighted key={`t-${index}`} text={part} query={query ?? ""} />;
      })}
    </>
  );
}

/** Сглаженная «морская» линия волны по массиву амплитуд. */
function wavePath(values: number[], width: number, height: number) {
  const source = values.length >= 2 ? values : [0.22, 0.38, 0.3, 0.46, 0.34];
  const points = source.map((value, index) => {
    const level = Math.max(0.04, Math.min(1, Number.isFinite(value) ? value : 0.2));
    return {
      x: (index / (source.length - 1)) * width,
      y: height / 2 - (level - 0.5) * (height - 8),
    };
  });
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return path;
}

/** Единая непрерывная волна с заливкой и прогрессом прослушивания. */
function WaveShape({ values, progress = 1, height = 32, className }: { values: number[]; progress?: number; height?: number; className?: string }) {
  const rawId = useId();
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const width = 100;
  const path = useMemo(() => wavePath(values, width, height), [values, height]);
  const area = `${path} L ${width} ${height} L 0 ${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden className={cn("block size-full", className)}>
      <defs>
        <clipPath id={`wave-clip-${id}`}>
          <rect x="0" y="0" width={Math.max(0, Math.min(1, progress)) * width} height={height} />
        </clipPath>
        <linearGradient id={`wave-fill-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#wave-fill-${id})`} />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity="0.26" />
      <g clipPath={`url(#wave-clip-${id})`}>
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

/** Сжимает картинку в квадратный стикер (прозрачный фон, ~320px). */
async function stickerFromBlob(blob: Blob): Promise<string> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image"));
      img.src = objectUrl;
    });
    const size = 320;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    const scale = Math.min(size / image.width, size / image.height);
    const width = Math.max(1, image.width * scale);
    const height = Math.max(1, image.height * scale);
    ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
    return canvas.toDataURL("image/webp", 0.92);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function Ticks({ status, mine }: { status?: MessageStatus; mine: boolean }) {
  if (!mine || !status) return null;
  const className = cn("shrink-0", mine ? "opacity-55" : "opacity-45");
  if (status === "sending") return <Clock3 size={11} className={className} />;
  if (status === "sent") return <Check size={12} className={className} />;
  return <CheckCheck size={13} className={className} />;
}

function unreadStartId(messages: Message[], unread: number) {
  const fresh = messages.find((message) => message.fresh && !message.fromMe);
  if (fresh) return fresh.id;
  if (unread <= 0) return null;
  let remaining = unread;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].fromMe) continue;
    remaining -= 1;
    if (remaining <= 0) return messages[index].id;
  }
  return null;
}

function UnreadDivider() {
  return (
    <div role="separator" aria-label="Непрочитанные сообщения" className="my-4 flex items-center gap-3">
      <span className="h-px flex-1 bg-foreground/12" />
      <span className="t-cap text-foreground/55">Непрочитанные сообщения</span>
      <span className="h-px flex-1 bg-foreground/12" />
    </div>
  );
}

function Meta({ message, mine }: { message: Message; mine: boolean }) {
  return (
    <span className={cn("mt-1 flex items-center justify-end gap-1", mine ? "text-primary-foreground/55" : "text-foreground/45")}>
      {message.edited ? <span className="t-time">изменено</span> : null}
      <span className="t-time">{timeOf(message.at)}</span>
      <Ticks status={message.status} mine={mine} />
    </span>
  );
}

function VoiceBubble({ message, mine }: { message: Message; mine: boolean }) {
  const voice = message.voice!;
  const mediaSrc = useMediaSrc(voice.src, voice.enc);
  const hasSrc = Boolean(mediaSrc);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(voice.duration);
  const [failed, setFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setDuration(voice.duration);
  }, [voice.duration]);

  // Старые сообщения без файла проигрываются визуально по таймеру.
  useEffect(() => {
    if (!playing || hasSrc) return;
    const timer = window.setInterval(() => {
      setProgress((current) => {
        const next = current + 0.1 / Math.max(1, duration);
        if (next >= 1) { setPlaying(false); return 0; }
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing, hasSrc, duration]);

  const toggle = () => {
    haptic(4);
    if (playing) {
      setPlaying(false);
      audioRef.current?.pause();
      if (!hasSrc) setProgress(0);
      return;
    }
    if (hasSrc && audioRef.current) {
      const element = audioRef.current;
      // До загрузки метаданных duration = NaN — не трогаем currentTime,
      // иначе Safari может выбросить исключение и не начать воспроизведение.
      if (progress > 0 && Number.isFinite(element.duration) && element.duration > 0) {
        element.currentTime = progress * element.duration;
      }
      setFailed(false);
      void element.play().catch(() => {
        setPlaying(false);
        setFailed(true);
      });
      setPlaying(true);
    } else {
      setPlaying(true);
    }
  };

  const seek = (event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setProgress(ratio);
    setElapsed(ratio * duration);
    if (audioRef.current && Number.isFinite(audioRef.current.duration) && audioRef.current.duration > 0) {
      audioRef.current.currentTime = ratio * audioRef.current.duration;
    }
  };

  const shown = playing ? elapsed : duration;

  return (
    <div className="flex min-w-[222px] items-center gap-2.5 py-0.5">
      <button type="button" onClick={toggle} className={cn("grid size-9 shrink-0 place-items-center rounded-full transition-transform active:scale-95", mine ? "bg-primary-foreground/12" : "bg-foreground/10")}>
        {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} className="ml-0.5" fill="currentColor" />}
      </button>
      <div role="slider" tabIndex={0} onClick={seek} className="relative flex h-9 flex-1 cursor-pointer items-center">
        <WaveShape values={voice.waveform} progress={progress} height={32} className={mine ? "text-primary-foreground" : "text-foreground/85"} />
      </div>
      <span className={cn("t-time w-8 shrink-0 text-right", failed ? "text-danger" : "opacity-60")}>
        {failed ? "!" : fmtDuration(shown)}
      </span>
      {hasSrc ? (
        <audio
          ref={audioRef}
          src={mediaSrc}
          preload="auto"
          playsInline
          hidden
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) setDuration(value);
          }}
          onTimeUpdate={(event) => {
            const element = event.currentTarget;
            if (Number.isFinite(element.duration) && element.duration > 0) {
              setElapsed(element.currentTime);
              setProgress(element.currentTime / element.duration);
            }
          }}
          onError={() => { setPlaying(false); setFailed(true); }}
          onEnded={() => { setPlaying(false); setProgress(0); setElapsed(0); }}
        />
      ) : null}
    </div>
  );
}

const NOTE_SIZE = 232;

function VideoNoteBubble({ message, mine }: { message: Message; mine: boolean }) {
  const note = message.videoNote!;
  const mediaSrc = useMediaSrc(note.src, note.enc);
  const hasSrc = Boolean(mediaSrc);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const radius = NOTE_SIZE / 2 - 3;
  const circumference = 2 * Math.PI * radius;

  // Старые кружки без файла просто проигрывают индикатор по таймеру.
  useEffect(() => {
    if (!playing || hasSrc) return;
    const timer = window.setInterval(() => {
      setProgress((current) => {
        const next = current + 0.1 / Math.max(1, note.duration);
        if (next >= 1) { setPlaying(false); return 0; }
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing, hasSrc, note.duration]);

  const toggle = () => {
    haptic(4);
    if (!hasSrc || !videoRef.current) {
      setPlaying((value) => !value);
      return;
    }
    const element = videoRef.current;
    if (playing) {
      element.pause();
      setPlaying(false);
      return;
    }
    setFailed(false);
    void element.play().catch(() => {
      setPlaying(false);
      setFailed(true);
    });
    setPlaying(true);
  };

  return (
    <div className="relative" style={{ width: NOTE_SIZE, height: NOTE_SIZE }}>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Пауза" : "Воспроизвести кружок"}
        className={cn("absolute inset-[3px] overflow-hidden rounded-full border bg-card/70 transition-transform active:scale-[0.98]", mine ? "border-primary-foreground/20" : "border-foreground/15")}
      >
        {hasSrc ? (
          <video
            ref={videoRef}
            src={mediaSrc}
            playsInline
            preload="auto"
            className="size-full object-cover"
            onTimeUpdate={(event) => {
              const element = event.currentTarget;
              if (Number.isFinite(element.duration) && element.duration > 0) setProgress(element.currentTime / element.duration);
            }}
            onError={() => { setPlaying(false); setFailed(true); }}
            onEnded={() => { setPlaying(false); setProgress(0); }}
          />
        ) : (
          <PhotoArt seed={note.seed} className="size-full" />
        )}
        {!playing || failed ? (
          <span className="absolute inset-0 grid place-items-center bg-background/25 backdrop-blur-[1px]">
            {failed
              ? <span className="t-time text-danger">!</span>
              : <span className={cn("grid size-11 place-items-center rounded-full", mine ? "bg-primary-foreground/15" : "bg-foreground/10")}><Play size={18} className="ml-0.5" fill="currentColor" /></span>}
          </span>
        ) : null}
      </button>

      <svg viewBox={`0 0 ${NOTE_SIZE} ${NOTE_SIZE}`} className={cn("pointer-events-none absolute inset-0 size-full -rotate-90", mine ? "text-primary-foreground" : "text-foreground")}>
        <circle cx={NOTE_SIZE / 2} cy={NOTE_SIZE / 2} r={radius} fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.16" />
        <circle
          cx={NOTE_SIZE / 2}
          cy={NOTE_SIZE / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          className="opacity-70"
        />
      </svg>

      <span className={cn("t-time t-num absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5 backdrop-blur", mine ? "bg-primary/50 text-primary-foreground" : "bg-background/55 text-foreground/80")}>
        {playing ? fmtDuration(Math.max(0, note.duration * progress)) : fmtDuration(note.duration)}
      </span>
    </div>
  );
}

function PollBubble({ message, mine, onVote }: { message: Message; mine: boolean; onVote: (id: string) => void }) {
  const poll = message.poll!;
  const total = poll.options.reduce((sum, o) => sum + o.votes, 0);
  return (
    <div className="w-[286px] max-w-full">
      <p className="bubble-text t-body pr-1 font-medium">{poll.question}</p>
      <div className="mt-2.5 space-y-1.5">
        {poll.options.map((option) => {
          const percent = total === 0 ? 0 : Math.round((option.votes / total) * 100);
          return (
            <button key={option.id} type="button" onClick={() => { onVote(option.id); haptic(5); }} className={cn("relative block w-full overflow-hidden rounded-[11px] border px-3 py-2 text-left transition-colors", mine ? "border-primary-foreground/15 hover:border-primary-foreground/30" : "border-foreground/10 hover:border-foreground/25")}>
              <motion.span initial={false} animate={{ width: `${percent}%` }} transition={{ type: "spring", stiffness: 180, damping: 26 }} className="absolute inset-y-0 left-0 bg-current opacity-[0.09]" />
              <span className="relative flex items-center justify-between gap-2">
                <span className="t-sub flex items-center gap-1.5 pr-2">{option.voted ? <Check size={12} className="shrink-0" /> : null}<span className="line-clamp-2">{option.text}</span></span>
                <span className="t-time t-num shrink-0 opacity-70">{percent}%</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="t-time mt-2 opacity-55">{total} {plural(total, "голос", "голоса", "голосов")} · опрос</p>
    </div>
  );
}

type FileTransfer = { mode: "upload" | "download"; progress: number; controller: AbortController };

function fileSizeLabel(size: number) {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

function fileVisual(ext: string) {
  const value = ext.toLowerCase();
  if (["pdf", "doc", "docx", "txt", "rtf", "md", "odt"].includes(value)) return { Icon: FileText, tone: "text-danger" };
  if (["xls", "xlsx", "csv", "ods"].includes(value)) return { Icon: FileSpreadsheet, tone: "text-online" };
  if (["zip", "rar", "7z", "gz", "tar", "bz2"].includes(value)) return { Icon: FileArchive, tone: "text-foreground/80" };
  if (["jpg", "jpeg", "png", "webp", "gif", "heic", "avif", "svg"].includes(value)) return { Icon: FileImage, tone: "text-foreground/80" };
  if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(value)) return { Icon: FileAudio, tone: "text-foreground/80" };
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(value)) return { Icon: FileVideo, tone: "text-foreground/80" };
  return { Icon: FileIcon, tone: "text-foreground/75" };
}

function FileBubble({
  message, mine, transfer, onDownload, onCancel,
}: {
  message: Message; mine: boolean; transfer?: FileTransfer; onDownload: () => void; onCancel: () => void;
}) {
  const file = message.file!;
  const { Icon, tone } = fileVisual(file.ext);
  const percent = Math.round((transfer?.progress ?? 0) * 100);
  const canDownload = Boolean(file.src) && !file.pending;

  return (
    <div className="flex min-w-[232px] max-w-[290px] items-center gap-3">
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-[12px]", mine ? "bg-primary-foreground/10" : "bg-foreground/10", tone)}>
        <Icon size={21} strokeWidth={1.7} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="t-sub block truncate font-medium">{file.name}</span>
        <span className="t-time mt-0.5 flex items-center gap-1 opacity-55">
          <span className="t-num">{fileSizeLabel(file.size)}</span>
          {transfer ? <span>· {transfer.mode === "upload" ? "Загрузка" : "Скачивание"} {percent}%</span> : null}
        </span>
        {transfer ? (
          <span className={cn("mt-1.5 block h-[3px] overflow-hidden rounded-full", mine ? "bg-primary-foreground/15" : "bg-foreground/10")}>
            <span className="block h-full rounded-full bg-current transition-[width] duration-150 ease-out" style={{ width: `${Math.max(2, percent)}%` }} />
          </span>
        ) : null}
      </span>
      {transfer ? (
        <button type="button" aria-label="Отменить" onClick={(event) => { event.stopPropagation(); onCancel(); }} className={cn("grid size-8 shrink-0 place-items-center rounded-full transition-colors", mine ? "hover:bg-primary-foreground/10" : "hover:bg-foreground/10")}>
          <X size={15} />
        </button>
      ) : canDownload ? (
        <button type="button" aria-label="Скачать файл" onClick={(event) => { event.stopPropagation(); onDownload(); }} className={cn("grid size-8 shrink-0 place-items-center rounded-full transition-colors", mine ? "hover:bg-primary-foreground/10" : "hover:bg-foreground/10")}>
          <Download size={16} />
        </button>
      ) : null}
    </div>
  );
}

function MessageBubble({
  message, chat, prev, next, replyMessage, activeMatch, flash, onMenu, onScrollTo, searchDimmed, onVote, onMediaLoad, transfer, onFileDownload, onFileCancel, onReply, highlight, onMention,
}: {
  message: Message; chat: Chat; prev?: Message; next?: Message; replyMessage?: Message; activeMatch: boolean; flash: boolean; onMenu: (m: Message, x: number, y: number) => void; onScrollTo: (id: string) => void; searchDimmed: boolean; onVote: (id: string) => void; onMediaLoad: () => void; transfer?: FileTransfer; onFileDownload: (m: Message) => void; onFileCancel: (m: Message) => void; onReply: (m: Message) => void; highlight?: string; onMention?: (username: string) => void;
}) {
  const mine = message.fromMe;
  const photoSrc = useMediaSrc(message.photo?.src, message.photo?.enc);
  const isGroup = Boolean(chat.group);
  const timeGap = (a?: Message, b?: Message) => (a && b ? Math.abs(a.at - b.at) < 5 * 60_000 : false);
  const sameAsPrev = Boolean(prev && prev.fromMe === message.fromMe && prev.sender === message.sender && timeGap(prev, message));
  const sameAsNext = Boolean(next && next.fromMe === message.fromMe && next.sender === message.sender && timeGap(message, next));
  const pressTimer = useRef<number | null>(null);
  const startPoint = useRef({ x: 0, y: 0 });
  const swipeX = useMotionValue(0);
  const replyOpacity = useTransform(swipeX, [-70, -8], [1, 0]);
  const replyScale = useTransform(swipeX, [-70, 0], [1, 0.7]);
  const swipe = useRef({ active: false, locked: false, startX: 0, startY: 0, dx: 0 });

  const SWIPE_TRIGGER = 54;
  const SWIPE_MAX = 96;

  const clearPress = () => { if (pressTimer.current) window.clearTimeout(pressTimer.current); pressTimer.current = null; };

  const isInteractive = (target: EventTarget | null) =>
    target instanceof HTMLElement && Boolean(target.closest("button, a, input, textarea, audio, video, [role='slider']"));

  const resetSwipe = () => {
    clearPress();
    swipe.current = { active: false, locked: false, startX: 0, startY: 0, dx: 0 };
    animate(swipeX, 0, { type: "spring", stiffness: 480, damping: 36, mass: 0.5 });
  };
  
  const onPointerDown = (e: ReactPointerEvent) => {
    if (isInteractive(e.target)) return;
    swipe.current = { active: true, locked: false, startX: e.clientX, startY: e.clientY, dx: 0 };
    startPoint.current = { x: e.clientX, y: e.clientY };
    clearPress();
    pressTimer.current = window.setTimeout(() => { 
      haptic(12); 
      onMenu(message, startPoint.current.x, startPoint.current.y); 
    }, 420);
  };
  
  const onPointerMove = (e: ReactPointerEvent) => {
    const state = swipe.current;
    if (state.active) {
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      if (!state.locked) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          state.locked = true;
          clearPress();
          try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
        } else {
          state.active = false;
          clearPress();
          return;
        }
      }
      if (state.locked) {
        const raw = Math.min(0, dx);
        const offset = raw < -SWIPE_MAX ? -SWIPE_MAX + (raw + SWIPE_MAX) * 0.2 : raw;
        state.dx = offset;
        swipeX.set(offset);
        return;
      }
    }
    if (!pressTimer.current) return;
    const dx = Math.abs(e.clientX - startPoint.current.x);
    const dy = Math.abs(e.clientY - startPoint.current.y);
    if (dx > 8 || dy > 8) clearPress();
  };

  const onPointerUp = () => {
    clearPress();
    const state = swipe.current;
    if (state.locked) {
      if (state.dx <= -SWIPE_TRIGGER) {
        haptic(6);
        onReply(message);
      }
      resetSwipe();
      return;
    }
    state.active = false;
    swipeX.set(0);
  };

  const bubbleRadius = mine ? cn("rounded-[20px]", !sameAsNext && "rounded-br-[7px]") : cn("rounded-[20px]", !sameAsNext && "rounded-bl-[7px]");
  const bubbleTone = mine ? "bg-primary text-primary-foreground" : "bg-bubble-in text-foreground";

  const content = (() => {
    if (message.kind === "voice") return (
      <div className={cn("min-w-[248px] max-w-[294px] px-2.5 py-2", bubbleRadius, bubbleTone)}>
        <VoiceBubble message={message} mine={mine} />
        <Meta message={message} mine={mine} />
      </div>
    );
    if (message.kind === "videoNote") return (
      <div className="flex flex-col items-end">
        <VideoNoteBubble message={message} mine={mine} />
        <Meta message={message} mine={mine} />
      </div>
    );
    if (message.kind === "sticker") return (
      <div className="flex flex-col items-end">
        {message.sticker ? (
          <img src={message.sticker} alt="Стикер" draggable={false} className="size-[132px] object-contain drop-shadow-md" />
        ) : (
          <span className="t-time text-faint">Стикер</span>
        )}
        <Meta message={message} mine={mine} />
      </div>
    );
    if (message.kind === "photo") return (
      <div className={cn("max-w-[286px] overflow-hidden p-1.5", bubbleRadius, bubbleTone)}>
        <div className="block w-full overflow-hidden rounded-[14px]">{photoSrc ? <img src={photoSrc} alt="" draggable={false} onLoad={onMediaLoad} className="max-h-[340px] w-full object-cover" /> : <PhotoArt seed={message.photo?.seed ?? 1} wide={message.photo?.wide} className="aspect-[4/5] w-full" />}</div>
        {message.photo?.caption ? <p className="bubble-text px-1.5 pb-0.5 pt-2 text-[14px] leading-snug"><RichText text={message.photo.caption} query={highlight} onMention={onMention} /></p> : null}
        <div className="px-1.5"><Meta message={message} mine={mine} /></div>
      </div>
    );
    if (message.kind === "file") {
      const audio = isAudioFile(message.file);
      return (
        <div className={cn(audio ? "min-w-[254px] max-w-[306px] p-2.5" : "min-w-[232px] max-w-[290px] p-2.5", bubbleRadius, bubbleTone)}>
          {audio ? (
            <MusicBubble message={message} mine={mine} />
          ) : (
            <FileBubble message={message} mine={mine} transfer={transfer} onDownload={() => onFileDownload(message)} onCancel={() => onFileCancel(message)} />
          )}
          <Meta message={message} mine={mine} />
        </div>
      );
    }
    if (message.kind === "location") return (
      <div className={cn("w-[262px] overflow-hidden p-1.5", bubbleRadius, bubbleTone)}>
        <MapArt seed={message.location?.seed ?? 1} className={cn("h-[124px] w-full rounded-[14px]", mine ? "text-background/45" : "text-foreground")} />
        <div className="px-1.5 pb-0.5 pt-2"><p className="t-sub font-medium">{message.location?.title}</p><p className="t-time mt-0.5 opacity-55">{message.location?.subtitle}</p><Meta message={message} mine={mine} /></div>
      </div>
    );
    if (message.kind === "poll") return <div className={cn("p-3.5", bubbleRadius, bubbleTone)}><PollBubble message={message} mine={mine} onVote={onVote} /><Meta message={message} mine={mine} /></div>;

    return (
      <div className={cn("max-w-full px-3.5 py-2", bubbleRadius, bubbleTone)}>
        {message.forwardedFrom ? <p className="t-cap mb-1 flex items-center gap-1 opacity-50"><Forward size={9} /> Переслано от {message.forwardedFrom}</p> : null}
        {replyMessage ? <ReplyQuote message={replyMessage} mine={mine} onScrollTo={onScrollTo} /> : null}
        <p className="bubble-text whitespace-pre-wrap break-words text-[15px] leading-[1.42]"><RichText text={message.text} query={highlight} onMention={onMention} /></p>
        <Meta message={message} mine={mine} />
      </div>
    );
  })();

  return (
    <motion.div layout initial={{ opacity: 0, y: 15, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 25 }} id={`msg-${message.id}`} className={cn("group flex w-full gap-2", mine ? "justify-end" : "justify-start", sameAsPrev ? "mt-[3px]" : "mt-2.5", searchDimmed && "opacity-25")} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerLeave={clearPress} onPointerCancel={resetSwipe} onPointerMove={onPointerMove} onContextMenu={(e) => { e.preventDefault(); onMenu(message, e.clientX, e.clientY); }} style={{ filter: searchDimmed ? "grayscale(1)" : undefined, touchAction: "pan-y" }}>
      {!mine && isGroup ? <div className="w-6 shrink-0 self-end">{!sameAsNext ? <Avatar name={message.sender ?? chat.name} size={24} /> : null}</div> : null}
      <div className={cn("flex min-w-0 max-w-[82%] flex-col", mine ? "items-end" : "items-start")}>
        {!mine && isGroup && !sameAsPrev ? <span className="t-cap mb-1 pl-1 text-faint">{message.sender ?? chat.name}</span> : null}
        <div className={cn("relative", activeMatch && "rounded-[22px] ring-1 ring-foreground/60 ring-offset-2 ring-offset-background", flash && "msg-new rounded-[22px]")}>
          <motion.span style={{ opacity: replyOpacity, scale: replyScale }} className={cn("pointer-events-none absolute right-2 top-1/2 z-0 grid size-9 -translate-y-1/2 place-items-center rounded-full", mine ? "bg-primary-foreground/15 text-primary-foreground" : "bg-foreground/10 text-foreground/80")}>
            <Reply size={16} />
          </motion.span>
          <motion.div style={{ x: swipeX }} className="relative z-10">{content}</motion.div>
        </div>
      </div>
    </motion.div>
  );
}

function ReplyQuote({ message, mine, onScrollTo }: { message: Message; mine: boolean; onScrollTo: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onScrollTo(message.id)} className={cn("mb-2 flex w-full items-stretch gap-2.5 overflow-hidden rounded-[12px] px-2.5 py-2 text-left transition-colors", mine ? "bg-primary-foreground/[0.09] hover:bg-primary-foreground/[0.13]" : "bg-foreground/[0.055] hover:bg-foreground/[0.08]")}>
      <span className={cn("w-[3px] shrink-0 rounded-full", mine ? "bg-primary-foreground/45" : "bg-foreground/35")} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[12px] font-semibold leading-tight tracking-[0.01em]", mine ? "text-primary-foreground/90" : "text-foreground/85")}>
          {message.fromMe ? "Вы" : message.sender ?? "Сообщение"}
        </span>
        <span className={cn("mt-1 line-clamp-2 block text-[12.5px] leading-snug", mine ? "text-primary-foreground/65" : "text-foreground/60")}>
          {previewOf(message)}
        </span>
      </span>
    </button>
  );
}

function RecordingOverlay({ kind, elapsed, cancelled, videoRef, hasStream, levels }: { kind: "voice" | "videoNote"; elapsed: number; cancelled: boolean; videoRef: RefObject<HTMLVideoElement | null>; hasStream: boolean; levels: number[] }) {
  const progress = Math.min(1, elapsed / 60);
  const box = kind === "videoNote" ? 286 : 212;
  const radius = box / 2 - 3;
  const circumference = 2 * Math.PI * radius;
  const wave = useMemo(() => {
    if (levels.length === 0) return [0.18, 0.32, 0.24, 0.4, 0.28, 0.36, 0.22, 0.3];
    return Array.from({ length: 56 }, (_, index) => levels[Math.floor((index * levels.length) / 56)] ?? 0.12);
  }, [levels]);

  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="pointer-events-none fixed inset-0 z-[75] overflow-hidden bg-background/80 backdrop-blur-md">
      {kind === "voice" ? (
        <div className="pointer-events-none absolute inset-x-0 top-[max(30px,calc(env(safe-area-inset-top,0px)+24px))] flex justify-center">
          <span className={cn("t-num rounded-full px-3.5 py-1.5 text-[15px] font-medium tabular-nums backdrop-blur-sm transition-colors", cancelled ? "bg-danger/15 text-danger" : "bg-foreground/5 text-foreground/75")}>
            {fmtDuration(elapsed)}
          </span>
        </div>
      ) : null}

      {kind === "videoNote" ? (
        <div className="absolute inset-0 grid place-items-center">
          <motion.div
            initial={{ scale: 0.72, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
            className="relative"
            style={{ width: box, height: box }}
          >
            <div className={cn("absolute inset-[9px] overflow-hidden rounded-full border bg-card/70", cancelled ? "border-danger/60" : "border-foreground/15")}>
              <video ref={videoRef} autoPlay muted playsInline className="size-full object-cover" />
              {!hasStream ? <div className="absolute inset-0 grid place-items-center"><Camera size={30} className="text-foreground/30" /></div> : null}
            </div>

            <svg viewBox={`0 0 ${box} ${box}`} className={cn("pointer-events-none absolute inset-0 size-full -rotate-90", cancelled ? "text-danger" : "text-foreground")}>
              <circle cx={box / 2} cy={box / 2} r={radius} fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.12" />
              <circle
                cx={box / 2}
                cy={box / 2}
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - progress)}
                opacity="0.9"
              />
            </svg>
          </motion.div>
        </div>
      ) : null}

      {kind === "voice" ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[30vh] px-1 pb-[max(8px,env(safe-area-inset-bottom,0px))]">
          <WaveShape values={wave} progress={1} height={64} className={cancelled ? "text-danger/75" : "text-foreground/75"} />
        </div>
      ) : null}

      <AnimatePresence>
        {cancelled ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className={cn("pointer-events-none absolute inset-x-0 flex justify-center", kind === "voice" ? "bottom-[calc(30vh+18px)]" : "bottom-[max(30px,calc(env(safe-area-inset-bottom,0px)+20px))]")}
          >
            <span className="rounded-full bg-danger px-3.5 py-1.5 text-[11px] font-medium text-white shadow-lg">Отпустите, чтобы отменить</span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

function ChatRoom({ chat, onBack, onCall, onOpenChat }: { chat: Chat; onBack: () => void; onCall: () => void; onOpenChat: (chatId: string) => void; }) {
  const { state, user, sendMessage, setMessageMediaSource, deleteMessage, editMessage, pinMessage, votePoll, forwardMessage, setDraft, markRead, setActiveChat, openOrCreateChat, clearMessages, loadChatHistory, blockChat, updateProfile, updateGroup, addGroupMembers, removeGroupMember, deleteChat, syncPollVotes } = useAuthedStore();
  const isZero = isZeroIdentity(chat);
  const isSaved = Boolean(chat.saved);
  const isGroup = Boolean(chat.group);
  const isChannel = chat.group?.kind === "channel";
  const isOwner = isGroup ? (!chat.group?.ownerEmail || normalizeEmail(chat.group.ownerEmail) === normalizeEmail(user.email)) : true;
  const canPost = !isChannel || isOwner;
  const messages = chat.messages;
  const [text, setText] = useState(chat.draft ?? "");
  const [unreadFromId] = useState<string | null>(() => unreadStartId(chat.messages, chat.unread));
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  
  // Состояние для контекстного меню (поповер)
  const [sheetMessage, setSheetMessage] = useState<Message | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const [forwardMessageTarget, setForwardMessageTarget] = useState<Message | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Message | null>(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [transfers, setTransfers] = useState<Record<string, FileTransfer>>({});
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [, setSeenTick] = useState(0);

  const [stickerOpen, setStickerOpen] = useState(false);
  const [groupPhotoFile, setGroupPhotoFile] = useState<File | null>(null);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [newMembers, setNewMembers] = useState<GroupMember[]>([]);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionResults, setMentionResults] = useState<ZeroProfile[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);

  const [recording, setRecording] = useState<{ kind: "voice" | "videoNote"; startedAt: number } | null>(null);
  const [recElapsed, setRecElapsed] = useState(0);
  const [recCancelled, setRecCancelled] = useState(false);
  const [recMode, setRecMode] = useState<"voice" | "videoNote">("voice");
  const [hasStream, setHasStream] = useState(false);
  const [levels, setLevels] = useState<number[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const editTextRef = useRef<HTMLTextAreaElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const groupPhotoInput = useRef<HTMLInputElement>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const atBottom = useRef(true);
  const prevCount = useRef(messages.length);
  const scrollRaf = useRef<number | null>(null);
  const scrollActive = useRef(false);
  const noticeTimer = useRef<number | null>(null);
  const recRef = useRef<{ kind: "voice" | "videoNote"; startedAt: number } | null>(null);
  const recCancel = useRef(false);
  const recSilent = useRef(false);
  const holdRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    at: number;
    started: boolean;
    timer: number | null;
    cleanup: (() => void) | null;
  } | null>(null);
  const pendingRelease = useRef(false);
  const mediaRef = useRef<{ stream: MediaStream; recorder: MediaRecorder; chunks: Blob[]; startedAt: number } | null>(null);
  const levelsRef = useRef<number[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const transfersRef = useRef<Record<string, FileTransfer>>({});
  const zeroDirRef = useRef<Awaited<ReturnType<typeof pickZeroDirectory>>>(null);
  const zeroDirTried = useRef(false);

  const notify = useCallback((value: string) => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice(value);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2800);
  }, []);

  const updateTransfer = useCallback((messageId: string, transfer: FileTransfer | null) => {
    setTransfers((prev) => {
      const next = { ...prev };
      if (transfer) next[messageId] = transfer;
      else delete next[messageId];
      transfersRef.current = next;
      return next;
    });
  }, []);

  const updateTransferProgress = useCallback((messageId: string, progress: number) => {
    setTransfers((prev) => {
      const transfer = prev[messageId];
      if (!transfer) return prev;
      const next = { ...prev, [messageId]: { ...transfer, progress } };
      transfersRef.current = next;
      return next;
    });
  }, []);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const messageIndex = useMemo(() => new Map(messages.map((m, index) => [m.id, index])), [messages]);
  const pinned = useMemo(() => messages.find((m) => m.pinned), [messages]);
  const replyMessage = replyTo ? byId.get(replyTo.id) : undefined;
  const query = searchQuery.trim().toLowerCase();
  const matches = useMemo(() => (query ? messages.filter((m) => searchText(m).includes(query)) : []), [messages, query]);
  const matchPosition = matches.length === 0 ? 0 : Math.min(searchIndex, matches.length - 1) + 1;
  const activeMatchId = matches.length > 0 ? matches[Math.min(searchIndex, matches.length - 1)]?.id : null;

  // Поиск людей по @username прямо в поле ввода: набираем «@», выбираем из
  // подсказок. Контакты — мгновенно, остальные — из Supabase.
  useEffect(() => {
    const needle = mention ? normalizeUsername(mention.query) : "";
    if (needle.length < 2) {
      setMentionResults([]);
      setMentionLoading(false);
      return;
    }
    let cancelled = false;
    setMentionLoading(true);
    const timer = window.setTimeout(() => {
      void searchProfiles(needle, user.email)
        .then((rows) => {
          if (!cancelled) setMentionResults(rows);
        })
        .catch(() => {
          if (!cancelled) setMentionResults([]);
        })
        .finally(() => {
          if (!cancelled) setMentionLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mention?.query, user.email]);

  const mentionOptions = useMemo(() => {
    if (!mention) return [];
    const needle = normalizeUsername(mention.query);
    if (!needle) return [];
    const options: { username: string; name: string; avatar?: string | null; email?: string }[] = [];
    const seen = new Set<string>([normalizeUsername(user.username), "zero"]);
    const push = (username?: string, name?: string, avatar?: string | null, email?: string) => {
      const handle = normalizeUsername(username ?? "");
      if (!handle || seen.has(handle) || !handle.startsWith(needle)) return;
      seen.add(handle);
      options.push({ username: handle, name: name || handle, avatar, email });
    };
    for (const item of state.chats) {
      if (item.group || item.saved) continue;
      push(item.username, item.name, item.avatar, item.email);
    }
    for (const profile of mentionResults) push(profile.username, profile.name, profile.avatar, profile.email);
    return options.slice(0, 6);
  }, [mention, mentionResults, state.chats, user.username]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mention?.query]);

  const cancelScroll = useCallback(() => {
    if (scrollRaf.current !== null) {
      window.cancelAnimationFrame(scrollRaf.current);
      scrollRaf.current = null;
    }
    scrollActive.current = false;
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const node = scrollRef.current;
    if (!node) return;
    cancelScroll();
    atBottom.current = true;
    setShowJump(false);

    const target = () => Math.max(0, node.scrollHeight - node.clientHeight);
    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.classList.contains("reduce-motion");
    const distance = target() - node.scrollTop;

    if (!smooth || reduced || distance <= 0) {
      node.scrollTop = target();
      return;
    }

    const start = node.scrollTop;
    const duration = Math.min(460, Math.max(200, distance * 0.55));
    const startedAt = performance.now();
    scrollActive.current = true;

    const step = (now: number) => {
      const nextTarget = target();
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.scrollTop = start + (nextTarget - start) * eased;
      if (progress < 1) {
        scrollRaf.current = window.requestAnimationFrame(step);
        return;
      }
      node.scrollTop = target();
      scrollRaf.current = null;
      scrollActive.current = false;
      atBottom.current = true;
      setShowJump(false);
    };

    scrollRaf.current = window.requestAnimationFrame(step);
  }, [cancelScroll]);

  const keepBottomOnMedia = useCallback(() => {
    const node = scrollRef.current;
    if (!node || !atBottom.current || scrollActive.current) return;
    node.scrollTop = node.scrollHeight - node.clientHeight;
  }, []);

  useLayoutEffect(() => { const node = scrollRef.current; if (node) node.scrollTop = node.scrollHeight; }, [chat.id]);
  useEffect(() => { if (!chat.remote) return; void loadChatHistory(chat.id); }, [chat.id, chat.remote, loadChatHistory]);
  useEffect(() => { void syncPollVotes(chat.id); }, [chat.id, syncPollVotes]);
  useEffect(() => { setActiveChat(chat.id); markRead(chat.id); return () => setActiveChat(null); }, [chat.id, markRead, setActiveChat]);
  useEffect(() => { markRead(chat.id); }, [messages.length, chat.id, markRead]);
  useEffect(() => { const timer = window.setTimeout(() => setDraft(chat.id, text), 260); return () => window.clearTimeout(timer); }, [text, chat.id, setDraft]);
  useEffect(() => {
    const count = messages.length;
    const delta = count - prevCount.current;
    prevCount.current = count;
    if (delta <= 0) return;
    const last = messages[count - 1];
    if (atBottom.current || last?.fromMe) {
      const frame = window.requestAnimationFrame(() => scrollToBottom());
      return () => window.cancelAnimationFrame(frame);
    }
    if (last && !last.fromMe) setShowJump(true);
  }, [messages, scrollToBottom]);
  useEffect(() => { if (!searchOpen || matches.length === 0) return; const target = matches[Math.min(searchIndex, matches.length - 1)]; if (!target) return; document.getElementById(`msg-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [searchIndex, matches, searchOpen]);
  useEffect(() => { if (!searchOpen) return; setSearchIndex(0); }, [searchQuery, searchOpen]);
  useEffect(() => {
    return () => {
      cancelScroll();
      Object.values(transfersRef.current).forEach((transfer) => transfer.controller.abort());
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      if (holdRef.current?.timer) window.clearTimeout(holdRef.current.timer);
      holdRef.current?.cleanup?.();
      mediaRef.current?.stream.getTracks().forEach((t) => t.stop());
      if (audioCtxRef.current) void audioCtxRef.current.close().catch(() => undefined);
    };
  }, [cancelScroll]);

  // Держим последнее сообщение у нижней кромки, пока пользователь сам не
  // пролистал вверх: подгрузка картинок и клавиатура не должны «отрывать» чат.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    let frame = 0;
    const pin = () => {
      if (!atBottom.current || scrollActive.current) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (!atBottom.current || scrollActive.current) return;
        const current = scrollRef.current;
        if (current) current.scrollTop = current.scrollHeight - current.clientHeight;
      });
    };
    const observer = new ResizeObserver(pin);
    observer.observe(node);
    window.visualViewport?.addEventListener("resize", pin);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", pin);
    };
  }, []);

  const scrollToMessage = useCallback((id: string) => { document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); setFlashId(id); window.setTimeout(() => setFlashId(null), 1600); }, []);

  const goMatch = useCallback((direction: 1 | -1) => {
    if (matches.length === 0) return;
    haptic(3);
    setSearchIndex((index) => {
      const base = Math.min(index, matches.length - 1);
      return (base + direction + matches.length) % matches.length;
    });
  }, [matches.length]);

  const detectMention = useCallback((value: string, caret: number) => {
    const before = value.slice(0, caret);
    const found = /(?:^|\s)@([a-zA-Z0-9_]{0,24})$/.exec(before);
    if (!found) {
      setMention(null);
      return;
    }
    setMention({ query: found[1], start: caret - found[1].length - 1 });
  }, []);

  const applyMention = useCallback((username: string) => {
    if (!mention) return;
    const caret = textRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, mention.start);
    const after = text.slice(caret);
    const next = `${before}@${username} ${after}`;
    setText(next);
    setMention(null);
    haptic(4);
    window.requestAnimationFrame(() => {
      const node = textRef.current;
      if (!node) return;
      const caretAt = before.length + username.length + 2;
      node.focus({ preventScroll: true });
      node.setSelectionRange(caretAt, caretAt);
      node.style.height = "auto";
      node.style.height = `${Math.min(112, node.scrollHeight)}px`;
    });
  }, [mention, text]);

  const findMentionedChat = useCallback(async (username: string) => {
    const handle = normalizeUsername(username);
    if (!handle) return;
    const existing = state.chats.find(
      (item) => normalizeUsername(item.username ?? "") === handle && !item.group && !item.saved,
    );
    if (existing) {
      onOpenChat(existing.id);
      return;
    }
    notify("Открываем профиль…");
    try {
      const rows = await searchProfiles(handle, user.email);
      const profile = rows.find((row) => normalizeUsername(row.username) === handle) ?? rows[0];
      if (!profile) {
        notify("Пользователь не найден");
        return;
      }
      const id = openOrCreateChat({
        name: profile.name || profile.username,
        username: profile.username,
        email: profile.email,
        avatar: profile.avatar,
        remote: Boolean(profile.email),
      });
      onOpenChat(id);
    } catch {
      notify("Не удалось открыть чат");
    }
  }, [notify, onOpenChat, openOrCreateChat, state.chats, user.email]);

  const savePhotoAsSticker = async (message: Message) => {
    const src = message.photo?.src;
    if (!src) return;
    try {
      const response = await fetch(src, { cache: "no-store" });
      if (!response.ok) throw new Error("photo");
      const cipher = await response.blob();
      const blob = message.photo?.enc ? await decryptBlob(cipher, message.photo.enc) : cipher;
      const sticker = await stickerFromBlob(blob);
      const current = user.stickers ?? [];
      const next = [sticker, ...current.filter((item) => item !== sticker)].slice(0, 80);
      updateProfile({ stickers: next });
      notify("Стикер сохранён");
      haptic(6);
    } catch {
      notify("Не удалось сохранить стикер");
    }
  };

  const togglePinnedMusic = (message: Message) => {
    const file = message.file;
    if (!file?.src) {
      notify("Файл ещё не загружен");
      return;
    }
    const pinnedNow = user.pinnedMusic?.src === file.src;
    if (pinnedNow) {
      updateProfile({ pinnedMusic: null });
      notify("Музыка откреплена");
      return;
    }
    const meta = trackMeta(file.name);
    updateProfile({
      pinnedMusic: {
        title: meta.title,
        artist: meta.artist,
        src: file.src,
        enc: file.enc,
        mime: file.mime ?? "audio/mpeg",
        size: file.size,
      },
    });
    notify("Музыка закреплена в профиле");
    haptic(6);
  };

  const sendSticker = (sticker: string) => {
    sendMessage(chat.id, { kind: "sticker", sticker });
    setStickerOpen(false);
    setReplyTo(null);
    haptic(5);
  };

  // Обновленный openMenu с координатами
  const openMenu = useCallback((m: Message, x: number, y: number) => {
    // Ограничиваем координаты, чтобы меню не улетало за экран
    const safeY = Math.min(y, window.innerHeight - 224);
    const safeX = Math.min(x, window.innerWidth - 200);
    setMenuPos({ x: Math.max(16, safeX), y: Math.max(16, safeY) });
    setSheetMessage(m);
  }, []);

  const cancelFileTransfer = (message: Message) => {
    const transfer = transfersRef.current[message.id];
    if (!transfer) return;
    transfer.controller.abort();
  };

  const downloadMessageFile = async (message: Message) => {
    const file = message.file;
    if (!file?.src) {
      notify("Файл ещё не загружен");
      return;
    }
    if (transfersRef.current[message.id]) return;

    if (!zeroDirTried.current) {
      zeroDirTried.current = true;
      try {
        zeroDirRef.current = await pickZeroDirectory();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        zeroDirRef.current = null;
      }
    }

    const controller = new AbortController();
    updateTransfer(message.id, { mode: "download", progress: 0, controller });
    try {
      const downloaded = await downloadFileBlob(
        file.src,
        file.size,
        (progress) => updateTransferProgress(message.id, progress),
        controller.signal,
      );
      const blob = file.enc ? await decryptBlob(downloaded, file.enc) : downloaded;
      const directory = zeroDirRef.current;
      if (directory) {
        try {
          await writeBlobToDirectory(directory, file.name, blob);
        } catch {
          triggerBlobDownload(blob, file.name);
        }
      } else {
        triggerBlobDownload(blob, file.name);
      }
      notify("Файл сохранён");
    } catch (error) {
      if (controller.signal.aborted) notify("Скачивание отменено");
      else notify("Не удалось скачать файл");
    } finally {
      updateTransfer(message.id, null);
    }
  };

  const savePhotoMessage = async (message: Message) => {
    const src = message.photo?.src;
    if (!src) return;
    try {
      const response = await fetch(src, { cache: "no-store" });
      if (!response.ok) throw new Error("photo");
      const cipher = await response.blob();
      const blob = message.photo?.enc ? await decryptBlob(cipher, message.photo.enc) : cipher;
      const type = blob.type || "image/jpeg";
      const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("gif") ? "gif" : "jpg";
      const outcome = await saveImageToGallery(blob, `zero-${Date.now()}.${ext}`);
      if (outcome === "canceled") return;
      notify("Фото сохранено");
    } catch {
      notify("Не удалось сохранить фото");
    }
  };

  useEffect(() => {
    if (chat.online) return;
    const timer = window.setInterval(() => setSeenTick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [chat.online, chat.lastSeen]);

  useEffect(() => {
    if (!editTarget) return;
    const frame = window.requestAnimationFrame(() => {
      const node = editTextRef.current;
      if (!node) return;
      node.focus({ preventScroll: true });
      const end = node.value.length;
      node.setSelectionRange(end, end);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editTarget]);

  const startEditMessage = (message: Message) => {
    setEditTarget(message);
    setEditText(message.text ?? "");
  };

  const saveEditedMessage = async () => {
    if (!editTarget || savingEdit) return;
    const value = editText.trim();
    if (!value) return;
    setSavingEdit(true);
    const ok = await editMessage(chat.id, editTarget.id, value);
    setSavingEdit(false);
    if (ok) {
      setEditTarget(null);
      notify("Сообщение изменено");
    } else {
      notify("Не удалось изменить сообщение");
    }
  };

  const handleSendText = () => {
    const value = text.trim(); if (!value) return;
    sendMessage(chat.id, { kind: "text", text: value, replyTo: replyTo?.id });
    setText(""); setReplyTo(null); setDraft(chat.id, "");
    if (textRef.current) {
      textRef.current.style.height = "auto";
      textRef.current.focus({ preventScroll: true });
    }
    haptic(5);
  };

  const handlePhoto = async (edited: EditedImage) => {
    try {
      const image = await new Promise<HTMLImageElement>((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.src = edited.dataUrl; });
      // Для настоящего чата фото шифруется и загружается в Storage.
      let src = edited.dataUrl;
      let enc: MediaEncryption | undefined;
      try {
        const uploaded = await uploadMedia(edited.blob, "photo");
        src = uploaded.url;
        enc = uploaded.enc;
      } catch { /* офлайн или нет бакета */ }
      sendMessage(chat.id, { kind: "photo", photo: { seed: Math.floor(Math.random() * 900) + 1, src, enc, wide: image.width > image.height * 1.2, caption: "" }, replyTo: replyTo?.id });
      setReplyTo(null); setAttachOpen(false); notify("Фотография отправлена");
    } catch { notify("Не удалось открыть изображение"); }
  };

  const handleFile = async (file: File) => {
    const ext = (file.name.split(".").pop() ?? "file").toUpperCase().slice(0, 4);
    const messageId = sendMessage(chat.id, {
      kind: "file",
      file: { name: file.name, size: file.size, ext, mime: file.type || undefined, pending: true },
      replyTo: replyTo?.id,
    });
    setReplyTo(null);
    setAttachOpen(false);
    if (!messageId) return;

    const controller = new AbortController();
    updateTransfer(messageId, { mode: "upload", progress: 0, controller });
    try {
      const uploaded = await uploadFileToCloud(
        file,
        (progress) => updateTransferProgress(messageId, progress),
        controller.signal,
      );
      setMessageMediaSource(chat.id, messageId, "file", uploaded.url, uploaded.enc);
      notify("Файл отправлен");
    } catch {
      if (controller.signal.aborted) notify("Загрузка отменена");
      else notify("Не удалось отправить файл");
      await deleteMessage(chat.id, messageId);
    } finally {
      updateTransfer(messageId, null);
    }
  };

  const sendPoll = () => { const q = pollQuestion.trim(); const o = pollOptions.map((v) => v.trim()).filter(Boolean); if (!q || o.length < 2) return; sendMessage(chat.id, { kind: "poll", poll: { id: uid("poll"), question: q, options: o.map<PollOption>((t) => ({ id: uid("o"), text: t, votes: 0 })) }, replyTo: replyTo?.id }); setPollOpen(false); setPollQuestion(""); setPollOptions(["", ""]); setReplyTo(null); notify("Опрос создан"); };
  const copyMessage = async (m: Message) => { const v = m.text ?? previewOf(m); try { await navigator.clipboard.writeText(v); notify("Скопировано"); } catch { notify("Не удалось скопировать"); } };

  const finishRecording = useCallback(() => {
    const session = recRef.current;
    if (!session) return;

    const media = mediaRef.current;
    const cancelled = recCancel.current;

    const cleanup = () => {
      recRef.current = null;
      // Снимаем глобальные слушатели отпускания: запись могли остановить не
      // пальцем, а таймером или размонтированием экрана.
      const hold = holdRef.current;
      if (hold) {
        if (hold.timer) window.clearTimeout(hold.timer);
        hold.cleanup?.();
      }
      holdRef.current = null;
      setRecording(null);
      setRecCancelled(false);
      setHasStream(false);
      setLevels([]);
      levelsRef.current = [];
      try { analyserRef.current?.disconnect(); } catch { /* noop */ }
      analyserRef.current = null;
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => undefined);
        audioCtxRef.current = null;
      }
    };

    if (!media) {
      // Пользователь отпустил кнопку раньше, чем браузер выдал доступ к
      // микрофону. Не обрываем запись: дождёмся потока и завершим её сразу
      // после старта рекордера (иначе кнопка «срабатывает» мгновенно).
      if (recRef.current) {
        pendingRelease.current = true;
        return;
      }
      cleanup();
      return;
    }
    pendingRelease.current = false;

    const elapsed = Math.max(1, Math.round((Date.now() - media.startedAt) / 1000));
    const captured = levelsRef.current.slice();
    const waveform = captured.length >= 8
      ? Array.from({ length: 34 }, (_, index) => {
          const start = Math.floor((index * captured.length) / 34);
          const end = Math.max(start + 1, Math.floor(((index + 1) * captured.length) / 34));
          const slice = captured.slice(start, end);
          return Math.max(0.16, Math.min(1, Math.max(...slice)));
        })
      : makeWave(Date.now() % 999, 34);

    cleanup();
    mediaRef.current = null;

    let delivered = false;
    const finalize = () => {
      if (delivered) return;
      delivered = true;
      media.stream.getTracks().forEach((t) => t.stop());

      if (cancelled) {
        if (!recSilent.current) notify("Запись отменена");
        return;
      }

      const fallbackType = session.kind === "voice" ? "audio/webm" : "video/webm";
      // Итоговый тип берём у рекордера (mp4 на Safari, webm в Chrome).
      const blob = new Blob(media.chunks, { type: media.recorder.mimeType || fallbackType });
      if (blob.size === 0) {
        notify("Не удалось записать");
        return;
      }

      // Показываем запись сразу по локальной ссылке, а в Supabase Storage
      // отправляем в фоне, чтобы не задерживать сообщение на медленной сети.
      const localSrc = URL.createObjectURL(blob);
      const messageId = session.kind === "voice"
        ? sendMessage(chat.id, {
            kind: "voice",
            voice: { duration: elapsed, waveform, src: localSrc },
          })
        : sendMessage(chat.id, {
            kind: "videoNote",
            videoNote: { duration: elapsed, seed: (Date.now() % 700) + 3, src: localSrc },
          });

      notify(session.kind === "voice" ? "Голосовое отправлено" : "Кружок отправлен");

      if (!messageId) return;
      void uploadMedia(blob, session.kind)
        .then((uploaded) => setMessageMediaSource(chat.id, messageId, session.kind, uploaded.url, uploaded.enc))
        .catch(() => notify("Не удалось загрузить медиа — собеседник его не получит"));
    };

    media.recorder.onstop = finalize;
    try {
      if (media.recorder.state !== "inactive") media.recorder.stop();
      else finalize();
    } catch {
      finalize();
    }
  }, [chat.id, notify, sendMessage, setMessageMediaSource]);

  const beginRecording = useCallback(async (kind: "voice" | "videoNote") => {
    if (recRef.current) return;
    haptic(10); const session = { kind, startedAt: Date.now() }; recRef.current = session; recCancel.current = false; recSilent.current = false; setRecCancelled(false); setRecElapsed(0); setRecording(session);
    levelsRef.current = []; setLevels([]);
    try {
      if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("recording-unsupported");
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          kind === "voice"
            ? { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
            : {
                video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
              },
        );
      } catch (error) {
        if (kind === "voice") throw error;
        // Камера может быть занята или недоступна — записываем хотя бы звук.
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        notify("Камера недоступна — запишем только звук");
      }

      if (recRef.current !== session) { stream.getTracks().forEach((t) => t.stop()); return; }
      const mime = pickRecorderMime(kind);
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = []; recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.start(250);
      mediaRef.current = { stream, recorder, chunks, startedAt: Date.now() };
      setHasStream(true);

      // Кнопку уже отпустили, пока браузер запрашивал доступ — сразу
      // останавливаем и отправляем записанное (а не «мгновенный сброс»).
      if (pendingRelease.current) {
        pendingRelease.current = false;
        finishRecording();
        return;
      }

      if (recCancel.current) {
        finishRecording();
        return;
      }

      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        void videoPreviewRef.current.play().catch(() => undefined);
      }

      if (kind === "voice") {
        const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.65;
          source.connect(analyser);
          analyserRef.current = analyser;
          audioCtxRef.current = ctx;
        }
      }
    } catch (error) {
      if (recRef.current !== session) return;
      pendingRelease.current = false;
      mediaRef.current = null;
      recRef.current = null;
      holdRef.current?.cleanup?.();
      holdRef.current = null;
      setRecording(null);
      setRecCancelled(false);
      setHasStream(false);
      setLevels([]);
      notify(
        error instanceof Error && error.message === "recording-unsupported"
          ? "Браузер не поддерживает запись"
          : "Нет доступа к камере или микрофону",
      );
    }
  }, [finishRecording, notify]);

  // Telegram-механика: удерживаем кнопку — пишем, отпускаем — отправляем.
  // Короткое нажатие переключает режим (голос ↔ видео), свайп влево отменяет.
  const HOLD_DELAY = 180;

  // Жест прервал сам браузер (системный запрос доступа, переключение окна).
  // Это не нажатие: режим не переключаем, но активную запись завершаем.
  const cancelHold = () => {
    const hold = holdRef.current;
    if (!hold) return;
    holdRef.current = null;
    hold.cleanup?.();
    if (hold.timer) window.clearTimeout(hold.timer);
    if (hold.started) finishRecording();
  };

  const startHoldRecording = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (recRef.current || holdRef.current) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    try { event.currentTarget.setPointerCapture(pointerId); } catch { /* noop */ }
    const kind = recMode;
    const hold = {
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
      at: Date.now(),
      started: false,
      timer: null as number | null,
      cleanup: null as (() => void) | null,
    };

    // Отпускание и движение ловим и на window: когда поверх появляется оверлей
    // записи или системный запрос доступа, события могут не дойти до кнопки.
    const onRelease = (native: PointerEvent) => {
      if (native.pointerId !== pointerId) return;
      endHoldRecording();
    };
    const onCancel = (native: PointerEvent) => {
      if (native.pointerId !== pointerId) return;
      cancelHold();
    };
    const onMove = (native: PointerEvent) => {
      if (native.pointerId !== pointerId) return;
      updateCancelMark(native.clientX, native.clientY);
    };
    hold.cleanup = () => {
      window.removeEventListener("pointerup", onRelease);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("pointermove", onMove);
    };
    window.addEventListener("pointerup", onRelease);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("pointermove", onMove, { passive: true });

    hold.timer = window.setTimeout(() => {
      if (holdRef.current !== hold) return;
      hold.started = true;
      void beginRecording(kind);
    }, HOLD_DELAY);
    holdRef.current = hold;

    function updateCancelMark(clientX: number, clientY: number) {
      const active = holdRef.current;
      if (!active || !active.started) return;
      const dx = clientX - active.startX;
      const dy = clientY - active.startY;
      // Отмена срабатывает только при отпускании: пока палец влево — показываем
      // предупреждение, но запись продолжается и её можно «вернуть» движением.
      const shouldCancel = dx < -68 && Math.abs(dy) < Math.abs(dx) * 1.3;
      if (recCancel.current === shouldCancel) return;
      recCancel.current = shouldCancel;
      setRecCancelled(shouldCancel);
      if (shouldCancel) haptic(8);
    }
  };

  const endHoldRecording = (event?: ReactPointerEvent<HTMLButtonElement>) => {
    const hold = holdRef.current;
    if (!hold) return;
    holdRef.current = null;
    hold.cleanup?.();
    if (hold.timer) window.clearTimeout(hold.timer);
    if (event) {
      try { event.currentTarget.releasePointerCapture(hold.pointerId); } catch { /* noop */ }
    }

    // Не успели начать запись — значит это было обычное нажатие: меняем режим.
    if (!hold.started) {
      haptic(5);
      setRecMode((mode) => (mode === "voice" ? "videoNote" : "voice"));
      return;
    }

    if (recCancel.current) {
      setRecCancelled(true);
      finishRecording();
      return;
    }

    const tooShort = Date.now() - hold.at < 500;
    if (tooShort) {
      recCancel.current = true;
      recSilent.current = true;
      setRecCancelled(true);
    }
    finishRecording();
    if (tooShort) notify("Удерживайте кнопку, чтобы записать");
  };

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const next = (Date.now() - recording.startedAt) / 1000;
      setRecElapsed(next);

      const analyser = analyserRef.current;
      if (analyser) {
        const data = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let index = 0; index < data.length; index += 1) {
          const value = (data[index] - 128) / 128;
          sum += value * value;
        }
        const rms = Math.sqrt(sum / data.length);
        const level = Math.max(0.06, Math.min(1, rms * 5.5));
        levelsRef.current.push(level);
        if (levelsRef.current.length > 600) levelsRef.current.shift();
        setLevels(levelsRef.current.slice(-40));
      }

      if (next >= 60) finishRecording();
    }, 100);
    return () => window.clearInterval(timer);
  }, [recording, finishRecording]);

  // Подключаем поток к превью кружка после того, как оверлей появился в DOM.
  useEffect(() => {
    if (!recording || recording.kind !== "videoNote") return;
    const video = videoPreviewRef.current;
    const stream = mediaRef.current?.stream;
    if (!video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [recording, hasStream]);

  const onlineLabel = isSaved
    ? "Личные заметки"
    : isGroup
      ? `${chat.group?.members ?? 0} ${plural(chat.group?.members ?? 0, "участник", "участника", "участников")}`
      : lastSeenLabel(chat.lastSeen, chat.online);

  const dateGroups = useMemo(() => {
    const groups: { label: string; items: Message[] }[] = [];
    let currentLabel = "";
    for (const m of messages) {
      const label = new Date(m.at).toDateString();
      if (label !== currentLabel) { currentLabel = label; groups.push({ label, items: [m] }); }
      else groups[groups.length - 1].items.push(m);
    }
    return groups;
  }, [messages]);

  return (
    <div className="chat-canvas relative flex h-full flex-col overflow-hidden">
      <header className="relative z-30 shrink-0 border-b border-foreground/6 glass">
        <div className="flex h-[68px] items-center gap-1 px-2 pt-[env(safe-area-inset-top,0px)]">
          <IconButton label="Назад" onClick={onBack} className="size-9"><ArrowLeft size={20} /></IconButton>
          <button type="button" onClick={() => setProfileOpen(true)} aria-label="Профиль" className="flex min-w-0 flex-1 items-center gap-3 rounded-[14px] py-1 pl-0.5 pr-1 text-left transition-colors active:bg-foreground/5">
            <Avatar name={chat.name} src={chat.avatar} size={44} online={chat.online} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 truncate text-[17px] font-semibold leading-tight">
                <span className="truncate">{chat.name}</span>
                {chat.verified ? <BadgeCheck size={16} className="shrink-0 text-foreground/55" strokeWidth={1.9} /> : null}
              </span>
              <span className="t-sub mt-0.5 flex items-center gap-1.5 text-faint">
                {chat.online && !isGroup ? <span className="size-1.5 rounded-full bg-online" /> : null}
                <span className="truncate">{chat.typing ? "печатает…" : onlineLabel}</span>
              </span>
            </span>
          </button>
          <IconButton label="Поиск" onClick={() => setSearchOpen(true)} className="size-8"><Search size={17} /></IconButton>
          {isZero || isGroup || isSaved ? null : <IconButton label="Аудиозвонок" onClick={() => onCall()} className="size-8"><Phone size={17} /></IconButton>}
          <IconButton label="Ещё" onClick={() => setMenuOpen(true)} className="size-8"><MoreVertical size={17} /></IconButton>
        </div>

        <AnimatePresence>
          {searchOpen ? (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 56, opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-foreground/6">
              <div className="flex h-[56px] items-center gap-1.5 px-2.5">
                <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-foreground/[0.06] px-3 transition-colors focus-within:bg-foreground/[0.09]">
                  <Search size={15} className="shrink-0 text-foreground/45" />
                  <input
                    autoFocus
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setSearchIndex(0); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        goMatch(e.shiftKey ? -1 : 1);
                      }
                      if (e.key === "Escape") {
                        setSearchOpen(false);
                        setSearchQuery("");
                      }
                    }}
                    placeholder="Поиск по чату"
                    className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-foreground/35"
                  />
                  {query ? (
                    <button
                      type="button"
                      aria-label="Очистить поиск"
                      onClick={() => { setSearchQuery(""); setSearchIndex(0); }}
                      className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground/10 text-foreground/60 transition-colors hover:bg-foreground/15"
                    >
                      <X size={11} />
                    </button>
                  ) : null}
                </div>

                {query ? (
                  <motion.span
                    key={matches.length ? "count" : "empty"}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    aria-live="polite"
                    className={cn(
                      "t-time t-num shrink-0 rounded-full px-2 py-1 tabular-nums",
                      matches.length ? "bg-foreground/[0.06] text-foreground/65" : "bg-danger/10 text-danger/80",
                    )}
                  >
                    {matches.length ? `${matchPosition} из ${matches.length}` : "нет"}
                  </motion.span>
                ) : null}

                <IconButton label="Предыдущий результат" className="size-8 shrink-0" disabled={matches.length === 0} onClick={() => goMatch(-1)}><ChevronUp size={17} /></IconButton>
                <IconButton label="Следующий результат" className="size-8 shrink-0" disabled={matches.length === 0} onClick={() => goMatch(1)}><ChevronDown size={17} /></IconButton>
                <IconButton label="Закрыть" className="size-8 shrink-0" onClick={() => { setSearchOpen(false); setSearchQuery(""); }}><X size={16} /></IconButton>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {pinned ? (
          <button type="button" onClick={() => scrollToMessage(pinned.id)} className="flex w-full items-center gap-2 border-t border-foreground/6 px-4 py-2 text-left">
            <Pin size={13} className="shrink-0 text-foreground/60" />
            <span className="min-w-0 flex-1">
              <span className="t-time block font-medium text-foreground/70">Закреплённое сообщение</span>
              <span className="t-sub mt-0.5 block truncate text-faint">{previewOf(pinned)}</span>
            </span>
            <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); pinMessage(chat.id, pinned.id); notify("Сообщение откреплено"); }} className="grid size-7 shrink-0 place-items-center rounded-full text-faint hover:text-foreground"><X size={13} /></span>
          </button>
        ) : null}
      </header>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          if (scrollActive.current) return;
          const node = e.currentTarget;
          const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 140;
          atBottom.current = bottom;
          setShowJump(!bottom);
        }}
        onWheel={cancelScroll}
        onTouchStart={cancelScroll}
        className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4"
      >
        <div className="mx-auto flex min-h-full w-full max-w-[520px] flex-col justify-end pb-2 pt-4">
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
              <Avatar name={chat.name} src={chat.avatar} size={76} liquid />
              <p className="t-h mt-5">{chat.name}</p>
              <p className="t-sub mt-2 max-w-[240px] text-faint">Ноль сообщений. Напишите первым.</p>
            </div>
          ) : (
            dateGroups.map((group) => (
              <div key={group.label}>
                <div className="my-4 flex items-center gap-3">
                  <span className="h-px flex-1 bg-foreground/6" />
                  <span className="t-cap text-faint/70">{(() => { const d = new Date(group.label); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1); if (d.toDateString() === t.toDateString()) return "Сегодня"; if (d.toDateString() === y.toDateString()) return "Вчера"; return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); })()}</span>
                  <span className="h-px flex-1 bg-foreground/6" />
                </div>
                {group.items.map((message) => {
                  const allIndex = messageIndex.get(message.id) ?? -1;
                  const reply = message.replyTo ? byId.get(message.replyTo) : undefined;
                  return (
                    <Fragment key={message.id}>
                      {unreadFromId === message.id ? <UnreadDivider /> : null}
                      <MessageBubble message={message} chat={chat} prev={messages[allIndex - 1]} next={messages[allIndex + 1]} replyMessage={reply} activeMatch={activeMatchId === message.id} flash={flashId === message.id} onMenu={openMenu} onScrollTo={scrollToMessage} searchDimmed={Boolean(query) && !searchText(message).includes(query)} onVote={(oid) => votePoll(chat.id, message.id, oid)} onMediaLoad={keepBottomOnMedia} transfer={transfers[message.id]} onFileDownload={(item) => { void downloadMessageFile(item); }} onFileCancel={cancelFileTransfer} onReply={(item) => { setReplyTo(item); window.setTimeout(() => textRef.current?.focus({ preventScroll: true }), 80); }} highlight={query} onMention={(username) => { void findMentionedChat(username); }} />
                    </Fragment>
                  );
                })}
              </div>
            ))
          )}
          <div ref={endRef} className="h-1" />
        </div>
      </div>

      <AnimatePresence>
        {showJump ? (
          <motion.button type="button" initial={{ opacity: 0, scale: 0.8, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.8, y: 8 }} onClick={() => scrollToBottom()} className="absolute bottom-[92px] right-4 z-20 grid size-10 place-items-center rounded-full border border-foreground/10 bg-card/95 shadow-xl backdrop-blur">
            <ArrowDown size={17} />
          </motion.button>
        ) : null}
      </AnimatePresence>

      <div className="relative z-20 shrink-0 border-t border-foreground/8 bg-background/95 pb-[max(8px,env(safe-area-inset-bottom,0px))] pl-2 pr-2 backdrop-blur-xl">
        {mention && mentionOptions.length > 0 ? (
          <div className="mb-1 max-h-[232px] overflow-y-auto overscroll-contain rounded-[18px] border border-foreground/8 bg-card/95 p-1 shadow-xl backdrop-blur">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="t-cap text-faint">Упомянуть</span>
              {mentionLoading ? <Loader2 size={12} className="animate-spin text-faint" /> : null}
            </div>
            {mentionOptions.map((option, index) => (
              <button
                key={option.username}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyMention(option.username)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[13px] px-2 py-2 text-left transition-colors",
                  index === mentionIndex ? "bg-foreground/10" : "hover:bg-foreground/5",
                )}
              >
                <Avatar name={option.name} src={option.avatar} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="t-sub block truncate font-medium">{option.name}</span>
                  <span className="t-time block truncate text-faint">@{option.username}</span>
                </span>
                <AtSign size={14} className="shrink-0 text-faint" />
              </button>
            ))}
          </div>
        ) : null}

        {canPost ? (
          <>
            <AnimatePresence initial={false}>
              {replyTo ? (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 48, opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="flex h-12 items-center gap-2 border-b border-foreground/6 px-2">
                    <Reply size={14} className="shrink-0 text-foreground/60" />
                    <div className="min-w-0 flex-1"><p className="t-time font-semibold text-foreground/75">{replyTo.fromMe ? "Вы" : replyTo.sender ?? chat.name}</p><p className="t-time mt-0.5 truncate text-faint">{previewOf(replyTo)}</p></div>
                    <button type="button" onClick={() => setReplyTo(null)} className="grid size-7 place-items-center rounded-full text-faint"><X size={14} /></button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="flex items-end gap-1 pt-2">
              <IconButton label="Вложения" onClick={() => setAttachOpen(true)} className="mb-0.5 size-10 shrink-0"><Paperclip size={19} /></IconButton>

              <div className="flex min-w-0 flex-1 items-end rounded-[21px] border border-foreground/10 bg-foreground/[0.05] transition-colors focus-within:border-foreground/22">
                <textarea
                  ref={textRef}
                  value={text}
                  rows={1}
                  onChange={(e) => {
                    setText(e.target.value);
                    detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
                    const n = e.target;
                    n.style.height = "auto";
                    n.style.height = `${Math.min(112, n.scrollHeight)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (mention && mentionOptions.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setMentionIndex((index) => (index + 1) % mentionOptions.length);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setMentionIndex((index) => (index - 1 + mentionOptions.length) % mentionOptions.length);
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        applyMention(mentionOptions[mentionIndex]?.username ?? mentionOptions[0].username);
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setMention(null);
                        return;
                      }
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendText();
                    }
                  }}
                  placeholder="Сообщение"
                  className="bubble-text max-h-28 min-h-[42px] flex-1 resize-none bg-transparent px-3.5 py-[11px] text-[15px] leading-[1.35] outline-none"
                />
                <button
                  type="button"
                  onClick={() => { setMention(null); setStickerOpen(true); haptic(4); }}
                  aria-label="Стикеры"
                  className="mb-[4px] mr-[4px] grid size-[32px] shrink-0 place-items-center rounded-full bg-[#1c1c1e] text-white/85 transition-transform active:scale-90"
                >
                  <Sticker size={17} />
                </button>
              </div>

              {text.trim() ? (
                <motion.button type="button" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} whileTap={{ scale: 0.9 }} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={handleSendText} className="mb-0.5 grid size-[42px] shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><Send size={17} /></motion.button>
              ) : (
                <div className="mb-0.5 flex shrink-0 items-center">
                  <button
                    type="button"
                    aria-label={recMode === "voice"
                      ? "Голосовое сообщение: удерживайте, чтобы записать. Нажмите, чтобы переключить на видео"
                      : "Видеосообщение: удерживайте, чтобы записать. Нажмите, чтобы переключить на голос"}
                    title={recMode === "voice" ? "Удерживайте — голосовое, нажмите — видео" : "Удерживайте — видеосообщение, нажмите — голос"}
                    draggable={false}
                    onPointerDown={startHoldRecording}
                    onPointerUp={endHoldRecording}
                    onPointerCancel={cancelHold}
                    onContextMenu={(event) => event.preventDefault()}
                    className="grid size-[42px] touch-none select-none place-items-center rounded-full text-foreground/80 transition-[transform,background-color] duration-150 hover:bg-foreground/6 active:scale-[0.92] active:bg-foreground/10"
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={recMode}
                        initial={{ opacity: 0, scale: 0.55, rotate: -35 }}
                        animate={{ opacity: 1, scale: 1, rotate: 0 }}
                        exit={{ opacity: 0, scale: 0.55, rotate: 35 }}
                        transition={{ duration: 0.14 }}
                        className="grid place-items-center"
                      >
                        {recMode === "voice" ? <Mic size={21} /> : <Video size={20} />}
                      </motion.span>
                    </AnimatePresence>
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center gap-2 px-4 py-4 text-center">
            <Megaphone size={15} className="shrink-0 text-faint" />
            <p className="t-sub text-faint">Писать могут только администраторы канала</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {recording ? (
          <RecordingOverlay
            kind={recording.kind}
            elapsed={recElapsed}
            cancelled={recCancelled}
            videoRef={videoPreviewRef}
            hasStream={hasStream}
            levels={levels}
          />
        ) : null}
      </AnimatePresence>

      <Sheet open={attachOpen} onClose={() => setAttachOpen(false)} title="Вложение">
        <div className="overflow-hidden rounded-[16px] border-none bg-transparent">
          <SettingsRow icon={<ImageIcon size={16} />} label="Фото" onClick={() => photoInput.current?.click()} className="border-0" />
          <SettingsRow icon={<Camera size={16} />} label="Камера" onClick={() => cameraInput.current?.click()} className="border-0" />
          <SettingsRow icon={<FileIcon size={16} />} label="Файл" onClick={() => fileInput.current?.click()} className="border-0" />
          <SettingsRow icon={<BarChart3 size={16} />} label="Опрос" last onClick={() => { setAttachOpen(false); setTimeout(() => setPollOpen(true), 120); }} className="border-0" />
        </div>
        <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhotoFile(f); e.target.value = ""; }} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhotoFile(f); e.target.value = ""; }} />
        <input ref={fileInput} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
      </Sheet>

      <ContextMenu
        open={Boolean(sheetMessage)}
        x={menuPos.x}
        y={menuPos.y}
        onClose={() => setSheetMessage(null)}
        items={sheetMessage ? [
          { icon: <Reply size={15} />, label: "Ответить", onClick: () => { const message = sheetMessage; setReplyTo(message); window.setTimeout(() => textRef.current?.focus(), 80); } },
          ...(sheetMessage.fromMe && sheetMessage.kind === "text" && sheetMessage.text ? [{ icon: <Pencil size={15} />, label: "Изменить", onClick: () => startEditMessage(sheetMessage) }] : []),
          ...(sheetMessage.kind === "file" && sheetMessage.file?.src ? [{ icon: <Download size={15} />, label: "Сохранить файл", onClick: () => { void downloadMessageFile(sheetMessage); } }] : []),
          ...(sheetMessage.kind === "photo" && sheetMessage.photo?.src ? [{ icon: <Download size={15} />, label: "Сохранить фото", onClick: () => { void savePhotoMessage(sheetMessage); } }] : []),
          ...(sheetMessage.kind === "photo" && sheetMessage.photo?.src ? [{ icon: <Sticker size={15} />, label: "Сохранить как стикер", onClick: () => { void savePhotoAsSticker(sheetMessage); } }] : []),
          ...(sheetMessage.kind === "file" && isAudioFile(sheetMessage.file) && sheetMessage.file?.src ? [{ icon: <Music2 size={15} />, label: user.pinnedMusic?.src === sheetMessage.file?.src ? "Открепить из профиля" : "Закрепить в профиле", onClick: () => togglePinnedMusic(sheetMessage) }] : []),
          { icon: <Pin size={15} />, label: sheetMessage.pinned ? "Открепить" : "Закрепить", onClick: () => pinMessage(chat.id, sheetMessage.id) },
          { icon: <Copy size={15} />, label: "Копировать", onClick: () => { void copyMessage(sheetMessage); } },
          { icon: <Forward size={15} />, label: "Переслать", onClick: () => setForwardMessageTarget(sheetMessage) },
          { icon: <Trash2 size={15} />, label: "Удалить", danger: true, onClick: () => { const message = sheetMessage; void deleteMessage(chat.id, message.id).then((ok) => { if (!ok) notify("Не удалось удалить сообщение"); }); } },
        ] : []}
      />

      <Sheet open={Boolean(editTarget)} onClose={() => { if (!savingEdit) setEditTarget(null); }} title="Изменить сообщение">
        <div className="pb-2">
          <textarea
            ref={editTextRef}
            value={editText}
            rows={3}
            onChange={(event) => setEditText(event.target.value)}
            className="w-full resize-none rounded-[14px] border border-foreground/10 bg-foreground/[0.04] px-3.5 py-3 text-[15px] leading-[1.4] outline-none transition-colors focus:border-foreground/22"
          />
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={() => setEditTarget(null)} className="flex-1">Отмена</Button>
            <Button onClick={() => { void saveEditedMessage(); }} disabled={savingEdit || !editText.trim() || editText.trim() === (editTarget?.text ?? "")} className="flex-1">
              {savingEdit ? "Сохранение…" : "Сохранить"}
            </Button>
          </div>
        </div>
      </Sheet>

      <Sheet open={profileOpen} onClose={() => setProfileOpen(false)} title="Профиль">
        {isGroup ? (
          <>
            <div className="flex flex-col items-center pb-3 text-center">
              <button
                type="button"
                onClick={() => { if (isOwner) groupPhotoInput.current?.click(); }}
                aria-label={isOwner ? "Изменить фото" : chat.name}
                className="relative rounded-full"
              >
                <Avatar name={chat.name} src={chat.avatar} size={96} />
                {isOwner ? (
                  <span className="absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground"><Camera size={12} /></span>
                ) : null}
              </button>
              <p className="t-h mt-4 flex items-center justify-center gap-1.5">
                <span className="truncate">{chat.name}</span>
              </p>
              <p className="t-sub mt-1 text-faint">{isChannel ? "Канал" : "Группа"} · {onlineLabel}</p>
              {chat.group?.description ? (
                <p className="t-sub mt-2 max-w-[300px] text-muted-foreground">{chat.group.description}</p>
              ) : null}
            </div>

            <div className="mt-2">
              <div className="flex items-center justify-between px-1 pb-1.5">
                <span className="t-cap text-faint">Участники</span>
                <span className="t-time t-num text-faint">{chat.group?.members ?? 1}</span>
              </div>
              <div className="overflow-hidden rounded-[16px] border border-foreground/8 bg-foreground/[0.02]">
                <div className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={user.name} src={user.avatar} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="t-body block truncate">{user.name}</span>
                    <span className="t-time block truncate text-faint">@{user.username}</span>
                  </span>
                  {isOwner ? <span className="t-cap shrink-0 text-faint">владелец</span> : null}
                </div>
                {(chat.group?.memberList ?? []).map((member) => (
                  <div key={member.email} className="flex items-center gap-3 border-t border-foreground/[0.05] px-4 py-3">
                    <Avatar name={member.name} src={member.avatar} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="t-body block truncate">{member.name}</span>
                      <span className="t-time block truncate text-faint">{member.username ? `@${member.username}` : member.email}</span>
                    </span>
                    {isOwner ? (
                      <button
                        type="button"
                        aria-label={`Удалить ${member.name}`}
                        onClick={() => { removeGroupMember(chat.id, member.email); notify("Участник удалён"); haptic(5); }}
                        className="grid size-7 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-foreground/8 hover:text-danger"
                      >
                        <X size={14} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2 pb-2">
              {isOwner ? (
                <Button
                  variant="secondary"
                  className="flex w-full items-center justify-center gap-2"
                  onClick={() => { setProfileOpen(false); window.setTimeout(() => setAddMemberOpen(true), 160); }}
                >
                  <UserPlus size={15} /> Добавить участника
                </Button>
              ) : null}
              {canPost ? (
                <Button className="flex w-full items-center justify-center gap-2" onClick={() => { setProfileOpen(false); window.setTimeout(() => textRef.current?.focus(), 180); }}>Написать</Button>
              ) : null}
            </div>
          </>
        ) : isSaved ? (
          <>
            <div className="flex flex-col items-center pb-3 text-center">
              <span className="grid size-24 place-items-center rounded-full bg-foreground/8 text-foreground/75">
                <Bookmark size={34} fill="currentColor" strokeWidth={1.4} />
              </span>
              <p className="t-h mt-4">Избранное</p>
              <p className="t-sub mt-1 text-faint">Личные заметки</p>
            </div>
            <p className="t-body rounded-[16px] border border-foreground/8 bg-foreground/[0.02] px-4 py-3.5 text-muted-foreground">
              Сообщения, фото и файлы, которые видны только вам.
            </p>
            <div className="mt-4 flex gap-2 pb-2">
              <Button className="flex flex-1 items-center justify-center gap-2" onClick={() => { setProfileOpen(false); window.setTimeout(() => textRef.current?.focus(), 180); }}>Написать</Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center pb-3 text-center">
              <Avatar name={chat.name} src={chat.avatar} size={96} />
              <p className="t-h mt-4 flex items-center justify-center gap-1.5">
                <span className="truncate">{chat.name}</span>
                {chat.verified ? <BadgeCheck size={18} className="shrink-0 text-foreground/60" strokeWidth={1.9} /> : null}
              </p>
              {chat.username ? <p className="t-sub mt-1 text-faint">@{chat.username}</p> : null}
              <p className="t-sub mt-1 text-faint">{onlineLabel}</p>
            </div>

            <div className="mt-4 overflow-hidden rounded-[16px] border border-foreground/8 bg-foreground/[0.02]">
              <div className="flex items-center gap-3 px-4 py-3.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-foreground/6 text-foreground/60"><Mail size={15} /></span>
                <span className="min-w-0 flex-1">
                  <span className="t-cap block text-faint">Gmail</span>
                  <span className="t-body mt-0.5 block truncate">{chat.email ?? "Скрыт настройками приватности"}</span>
                </span>
                {chat.email ? (
                  <IconButton label="Скопировать почту" className="size-8" onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(chat.email ?? "");
                      notify("Почта скопирована");
                    } catch { notify("Не удалось скопировать"); }
                  }}><Copy size={15} /></IconButton>
                ) : null}
              </div>
              {chat.username ? (
                <div className="flex items-center gap-3 border-t border-foreground/[0.05] px-4 py-3.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-foreground/6 text-foreground/60"><BadgeCheck size={15} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="t-cap block text-faint">Имя пользователя</span>
                    <span className="t-body mt-0.5 block truncate">@{chat.username}</span>
                  </span>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex gap-2 pb-2">
              {isZero ? null : <Button variant="secondary" className="flex flex-1 items-center justify-center gap-2" onClick={() => { setProfileOpen(false); onCall(); }}><Phone size={15} /> Звонок</Button>}
              <Button className="flex flex-1 items-center justify-center gap-2" onClick={() => { setProfileOpen(false); window.setTimeout(() => textRef.current?.focus(), 180); }}>Написать</Button>
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={chat.name}>
        <div className="pb-2">
          <SettingsRow icon={<Search size={15} />} label="Поиск по чату" onClick={() => { setMenuOpen(false); setSearchOpen(true); }} />
          {isGroup ? <SettingsRow icon={<Users size={15} />} label="Информация" onClick={() => { setMenuOpen(false); setProfileOpen(true); }} /> : null}
          {isGroup && isOwner ? <SettingsRow icon={<UserPlus size={15} />} label="Добавить участника" onClick={() => { setMenuOpen(false); window.setTimeout(() => setAddMemberOpen(true), 160); }} /> : null}
          {isGroup && isOwner ? <SettingsRow icon={<Camera size={15} />} label="Изменить фото" onClick={() => { setMenuOpen(false); window.setTimeout(() => groupPhotoInput.current?.click(), 160); }} /> : null}
          <SettingsRow icon={<Eraser size={15} />} label="Очистить историю" onClick={() => { setMenuOpen(false); setConfirmClear(true); }} />
          {isGroup && isOwner ? (
            <SettingsRow icon={<Trash2 size={15} />} label={isChannel ? "Удалить канал" : "Удалить группу"} danger last onClick={() => { setMenuOpen(false); setConfirmDeleteGroup(true); }} />
          ) : !isZero && !isSaved && !isGroup ? (
            <SettingsRow icon={<Ban size={15} />} label="Заблокировать" danger last onClick={() => { setMenuOpen(false); void blockChat(chat.id).then((ok) => notify(ok ? `${chat.name} заблокирован(а)` : "Не удалось заблокировать")); }} />
          ) : null}
        </div>
      </Sheet>

      <Sheet open={confirmClear} onClose={() => setConfirmClear(false)} title="Очистить историю?">
        <p className="t-body pb-5 text-muted-foreground">Все сообщения в этом чате будут удалены только у вас.</p>
        <div className="flex gap-2 pb-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmClear(false)}>Отмена</Button>
          <Button className="flex-1 bg-danger text-white" onClick={() => { void clearMessages(chat.id).then((ok) => notify(ok ? "История очищена" : "Не удалось очистить историю")); setConfirmClear(false); }}>Очистить</Button>
        </div>
      </Sheet>

      <Sheet open={stickerOpen} onClose={() => setStickerOpen(false)} title="Стикеры">
        {(user.stickers ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-9 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-foreground/6 text-foreground/60"><Sticker size={26} /></span>
            <p className="t-body font-medium">Пока нет стикеров</p>
            <p className="t-sub max-w-[270px] text-faint">Удерживайте фото в чате и выберите «Сохранить как стикер».</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 pb-2">
            {(user.stickers ?? []).map((sticker, index) => (
              <button
                key={`${index}-${sticker.slice(-16)}`}
                type="button"
                onClick={() => sendSticker(sticker)}
                className="press aspect-square rounded-[14px] bg-foreground/5 p-1.5 transition-transform active:scale-95"
              >
                <img src={sticker} alt={`Стикер ${index + 1}`} draggable={false} className="size-full object-contain" />
              </button>
            ))}
          </div>
        )}
      </Sheet>

      <Sheet
        open={addMemberOpen}
        onClose={() => { setAddMemberOpen(false); setNewMembers([]); }}
        title="Добавить участника"
        full
      >
        <PeoplePicker
          selected={newMembers}
          onChange={setNewMembers}
          exclude={[user.email, ...(chat.group?.memberList ?? []).map((member) => member.email)]}
        />
        <div className="pb-2 pt-5">
          <Button
            className="w-full"
            disabled={newMembers.length === 0}
            onClick={() => {
              addGroupMembers(chat.id, newMembers);
              notify(newMembers.length === 1 ? "Участник добавлен" : `Добавлено: ${newMembers.length}`);
              setNewMembers([]);
              setAddMemberOpen(false);
              haptic(6);
            }}
          >
            Добавить
          </Button>
        </div>
      </Sheet>

      <Sheet
        open={confirmDeleteGroup}
        onClose={() => setConfirmDeleteGroup(false)}
        title={isChannel ? "Удалить канал?" : "Удалить группу?"}
      >
        <p className="t-body pb-5 text-muted-foreground">
          Чат исчезнет из вашего списка. У участников останется их локальная история.
        </p>
        <div className="flex gap-2 pb-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmDeleteGroup(false)}>Отмена</Button>
          <Button
            className="flex-1 bg-danger text-white"
            onClick={() => {
              setConfirmDeleteGroup(false);
              deleteChat(chat.id);
              notify(isChannel ? "Канал удалён" : "Группа удалена");
              onBack();
            }}
          >
            Удалить
          </Button>
        </div>
      </Sheet>

      <input
        ref={groupPhotoInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) setGroupPhotoFile(file);
        }}
      />

      <Sheet open={pollOpen} onClose={() => setPollOpen(false)} title="Новый опрос">
        <div className="pb-2">
          <label className="t-cap block text-faint">Вопрос</label>
          <input value={pollQuestion} onChange={(e) => setPollQuestion(e.target.value)} placeholder="О чём спросить?" className="field mt-2" maxLength={120} />
          <label className="t-cap mt-5 block text-faint">Варианты</label>
          <div className="mt-2 space-y-2">
            {pollOptions.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <input value={option} onChange={(e) => setPollOptions((c) => c.map((v, i) => i === index ? e.target.value : v))} placeholder={`Вариант ${index + 1}`} className="field h-11 flex-1" maxLength={60} />
                {pollOptions.length > 2 ? <IconButton label="Удалить" className="size-9" onClick={() => setPollOptions((c) => c.filter((_, i) => i !== index))}><X size={14} /></IconButton> : null}
              </div>
            ))}
          </div>
          {pollOptions.length < 5 ? <button type="button" onClick={() => setPollOptions((c) => [...c, ""])} className="t-sub mt-3 flex items-center gap-1.5 rounded-full px-2 py-1.5 text-muted-foreground hover:text-foreground"><Plus size={14} /> Добавить вариант</button> : null}
          <Button className="mt-5 w-full" disabled={pollQuestion.trim().length < 3 || pollOptions.filter(o => o.trim()).length < 2} onClick={sendPoll}>Создать опрос</Button>
        </div>
      </Sheet>

      <ContactPicker open={Boolean(forwardMessageTarget)} onClose={() => setForwardMessageTarget(null)} title="Переслать" onPick={(contact) => {
        if (!forwardMessageTarget) return;
        const targetId = openOrCreateChat({ name: contact.name, username: contact.username, email: contact.email, phone: contact.phone, avatar: contact.avatar, online: contact.online, lastSeen: contact.lastSeen, remote: Boolean(contact.email) });
        forwardMessage(targetId, forwardMessageTarget.id);
        notify(`Переслано: ${contact.name}`); setForwardMessageTarget(null);
      }} />

      <AnimatePresence>
        {notice ? (
          <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} className="pointer-events-none absolute inset-x-0 bottom-[78px] z-40 flex justify-center px-6">
            <div className="rounded-full border border-foreground/10 bg-card/95 px-4 py-2 shadow-2xl backdrop-blur"><p className="t-sub text-foreground/85">{notice}</p></div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {photoFile ? (
        <PhotoEditor
          file={photoFile}
          mode="photo"
          onCancel={() => setPhotoFile(null)}
          onDone={(edited) => {
            setPhotoFile(null);
            void handlePhoto(edited);
          }}
        />
      ) : null}

      {groupPhotoFile ? (
        <PhotoEditor
          file={groupPhotoFile}
          mode="avatar"
          onCancel={() => setGroupPhotoFile(null)}
          onDone={({ dataUrl }) => {
            setGroupPhotoFile(null);
            updateGroup(chat.id, { avatar: dataUrl });
            notify("Фото обновлено");
            haptic(6);
          }}
        />
      ) : null}
    </div>
  );
}

export function ChatScreen({ chatId, onBack, onCall, onOpenChat }: { chatId: string; onBack: () => void; onCall: () => void; onOpenChat: (chatId: string) => void; }) {
  const { state } = useAuthedStore();
  const chat = state.chats.find((item) => item.id === chatId);

  if (!chat) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background px-8 text-center">
        <p className="t-h">Чат не найден</p>
        <p className="t-sub text-faint">Возможно, он был удалён.</p>
        <Button variant="secondary" onClick={onBack} className="mt-2 h-11 px-5">Назад</Button>
      </div>
    );
  }

  return <ChatRoom key={chat.id} chat={chat} onBack={onBack} onCall={onCall} onOpenChat={onOpenChat} />;
}