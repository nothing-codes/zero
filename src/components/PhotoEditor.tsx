import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  Pencil,
  RotateCw,
  Smile,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { cn, uid } from "../lib/utils";

export type PhotoEditorMode = "avatar" | "photo" | "banner";

export interface EditedImage {
  blob: Blob;
  dataUrl: string;
}

type Tool = "move" | "crop" | "draw" | "text" | "emoji";

interface Point {
  x: number;
  y: number;
}

interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Stroke {
  points: Point[];
  color: string;
  size: number;
}

interface TextOverlay {
  id: string;
  type: "text";
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
}

interface StickerOverlay {
  id: string;
  type: "sticker";
  emoji: string;
  x: number;
  y: number;
  size: number;
}

type Overlay = TextOverlay | StickerOverlay;
type Corner = "nw" | "ne" | "sw" | "se";

interface EditorData {
  workW: number;
  workH: number;
  crop: CropBox;
  strokes: Stroke[];
  overlays: Overlay[];
}

const BRUSH_COLORS = ["#ffffff", "#0b0b0c", "#ff453a", "#ffd60a", "#30d158", "#0a84ff", "#bf5af2"];
const EMOJIS = ["😀", "😂", "🥰", "😎", "🤍", "❤️", "🔥", "👍", "🎉", "✨", "💬", "🌙", "⭐️", "🍀", "⚡️", "💎"];

function aspectFor(mode: PhotoEditorMode) {
  if (mode === "avatar") return 1;
  if (mode === "banner") return 2.4;
  return 0;
}

function outputWidth(mode: PhotoEditorMode) {
  if (mode === "avatar") return 512;
  if (mode === "banner") return 1280;
  return 1600;
}

function initialCrop(workW: number, workH: number, mode: PhotoEditorMode): CropBox {
  const aspect = aspectFor(mode);
  if (!aspect) return { x: 0, y: 0, w: workW, h: workH };
  let w = workW * 0.92;
  let h = w / aspect;
  if (h > workH * 0.92) {
    h = workH * 0.92;
    w = h * aspect;
  }
  return { x: (workW - w) / 2, y: (workH - h) / 2, w, h };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampCrop(crop: CropBox, data: EditorData): CropBox {
  const min = Math.max(24, Math.min(data.workW, data.workH) * 0.08);
  const w = clamp(crop.w, min, data.workW);
  const h = clamp(crop.h, min, data.workH);
  return {
    x: clamp(crop.x, 0, data.workW - w),
    y: clamp(crop.y, 0, data.workH - h),
    w,
    h,
  };
}

function normalizePoint(point: Point, data: EditorData): Point {
  return { x: point.x / data.workW, y: point.y / data.workH };
}

function overlayBounds(item: Overlay, widthUnit: number, heightUnit: number) {
  const width = item.type === "text" ? item.text.length * item.size * widthUnit * 0.58 : item.size * widthUnit;
  const height = item.size * widthUnit * (item.type === "text" ? 1.1 : 1);
  const x = item.x * widthUnit;
  const y = item.y * heightUnit;
  return { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 };
}

function drawOverlays(
  ctx: CanvasRenderingContext2D,
  data: EditorData,
  options: { unit: number; scale: number; offsetX?: number; offsetY?: number; selected?: string | null },
) {
  const { unit, scale, offsetX = 0, offsetY = 0, selected } = options;
  const mapX = (value: number) => (value * data.workW - offsetX) * scale;
  const mapY = (value: number) => (value * data.workH - offsetY) * scale;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of data.strokes) {
    const width = Math.max(1, stroke.size * unit);
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = width;
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      ctx.beginPath();
      ctx.arc(mapX(point.x), mapY(point.y), width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    stroke.points.forEach((point, index) => {
      const x = mapX(point.x);
      const y = mapY(point.y);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  for (const item of data.overlays) {
    const x = mapX(item.x);
    const y = mapY(item.y);
    const fontSize = Math.max(1, item.size * unit);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (item.type === "text") {
      ctx.font = `600 ${fontSize}px "Space Grotesk", system-ui, sans-serif`;
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = fontSize * 0.14;
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, x, y);
      ctx.shadowBlur = 0;
    } else {
      ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      ctx.fillText(item.emoji, x, y);
    }
    if (selected === item.id) {
      const bounds = overlayBounds(item, data.workW, data.workH);
      const left = mapX(bounds.left / data.workW);
      const right = mapX(bounds.right / data.workW);
      const top = mapY(bounds.top / data.workH);
      const bottom = mapY(bounds.bottom / data.workH);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(left - 4, top - 4, right - left + 8, bottom - top + 8);
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

export function PhotoEditor({
  file,
  mode = "photo",
  onCancel,
  onDone,
}: {
  file: File | Blob;
  mode?: PhotoEditorMode;
  onCancel: () => void;
  onDone: (image: EditedImage) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLCanvasElement>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const dataRef = useRef<EditorData>({
    workW: 1,
    workH: 1,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    strokes: [],
    overlays: [],
  });
  const drawRef = useRef<() => void>(() => undefined);
  const dragRef = useRef<
    | { kind: "draw"; stroke: Stroke }
    | { kind: "crop-move"; start: Point; startCrop: CropBox }
    | { kind: "crop-resize"; corner: Corner; startCrop: CropBox }
    | { kind: "item"; id: string; dx: number; dy: number }
    | null
  >(null);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [imageSize, setImageSize] = useState({ w: 1, h: 1 });
  const [stage, setStage] = useState({ w: 1, h: 1 });
  const [tool, setTool] = useState<Tool>("move");
  const [color, setColor] = useState(BRUSH_COLORS[0]);
  const [brush, setBrush] = useState(8);
  const [textValue, setTextValue] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = () => setTick((value) => value + 1);

  // Загрузка изображения в рабочий canvas. Большие фото уменьшаем, чтобы
  // редактор оставался быстрым, а результат всё равно был качественным.
  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      const max = 2400;
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const workW = Math.max(1, Math.round(image.width * scale));
      const workH = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = workW;
      canvas.height = workH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setFailed(true);
        URL.revokeObjectURL(url);
        return;
      }
      ctx.drawImage(image, 0, 0, workW, workH);
      workRef.current = canvas;
      dataRef.current = {
        workW,
        workH,
        crop: initialCrop(workW, workH, mode),
        strokes: [],
        overlays: [],
      };
      setImageSize({ w: workW, h: workH });
      setTool(mode === "avatar" || mode === "banner" ? "crop" : "move");
      setReady(true);
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      if (cancelled) return;
      setFailed(true);
      URL.revokeObjectURL(url);
    };
    image.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file, mode]);

  // Размер сцены: вписываем изображение в доступную область.
  useEffect(() => {
    if (!ready) return;
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const maxW = Math.max(1, rect.width - 24);
      const maxH = Math.max(1, rect.height - 24);
      const aspect = imageSize.w / imageSize.h;
      let w = maxW;
      let h = w / aspect;
      if (h > maxH) {
        h = maxH;
        w = h * aspect;
      }
      setStage({ w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready, imageSize.w, imageSize.h]);

  const drawStage = () => {
    const canvas = stageRef.current;
    const work = workRef.current;
    if (!canvas || !work || !ready) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(stage.w));
    const height = Math.max(1, Math.round(stage.h));
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(work, 0, 0, width, height);

    const data = dataRef.current;
    const scale = width / data.workW;
    drawOverlays(ctx, data, { unit: width, scale, selected });

    if (tool === "crop") {
      const crop = data.crop;
      const cx = crop.x * scale;
      const cy = crop.y * scale;
      const cw = crop.w * scale;
      const ch = crop.h * scale;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.58)";
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.rect(cx, cy, cw, ch);
      ctx.fill("evenodd");
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx, cy, cw, ch);
      const handles: Point[] = [
        { x: cx, y: cy },
        { x: cx + cw, y: cy },
        { x: cx, y: cy + ch },
        { x: cx + cw, y: cy + ch },
      ];
      for (const point of handles) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  drawRef.current = drawStage;

  useEffect(() => {
    drawStage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, stage.w, stage.h, tool, selected, tick]);

  const toWork = (clientX: number, clientY: number) => {
    const canvas = stageRef.current;
    if (!canvas) return { x: 0, y: 0, scale: 1 };
    const rect = canvas.getBoundingClientRect();
    const data = dataRef.current;
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * data.workW,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * data.workH,
      scale: data.workW / Math.max(1, rect.width),
    };
  };

  const itemAt = (x: number, y: number) => {
    const data = dataRef.current;
    for (let index = data.overlays.length - 1; index >= 0; index -= 1) {
      const item = data.overlays[index];
      const unit = data.workW;
      const bounds = overlayBounds(item, unit, data.workH);
      const pad = 10;
      if (x >= bounds.left - pad && x <= bounds.right + pad && y >= bounds.top - pad && y <= bounds.bottom + pad) {
        return item;
      }
    }
    return null;
  };

  const bake = () => {
    const work = workRef.current;
    if (!work) return;
    const ctx = work.getContext("2d");
    if (!ctx) return;
    const data = dataRef.current;
    drawOverlays(ctx, data, { unit: data.workW, scale: 1 });
    data.strokes = [];
    data.overlays = [];
    setSelected(null);
  };

  const rotate = () => {
    const work = workRef.current;
    if (!work) return;
    bake();
    const data = dataRef.current;
    const next = document.createElement("canvas");
    next.width = work.height;
    next.height = work.width;
    const ctx = next.getContext("2d");
    if (!ctx) return;
    ctx.translate(next.width / 2, next.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(work, -work.width / 2, -work.height / 2);
    workRef.current = next;
    data.workW = next.width;
    data.workH = next.height;
    if (aspectFor(mode) === 1) {
      data.crop = {
        x: work.height - (data.crop.y + data.crop.h),
        y: data.crop.x,
        w: data.crop.h,
        h: data.crop.w,
      };
    } else {
      data.crop = initialCrop(next.width, next.height, mode);
    }
    setImageSize({ w: next.width, h: next.height });
    refresh();
  };

  const flip = (axis: "x" | "y") => {
    const work = workRef.current;
    if (!work) return;
    bake();
    const data = dataRef.current;
    const next = document.createElement("canvas");
    next.width = work.width;
    next.height = work.height;
    const ctx = next.getContext("2d");
    if (!ctx) return;
    ctx.translate(next.width / 2, next.height / 2);
    if (axis === "x") ctx.scale(-1, 1);
    else ctx.scale(1, -1);
    ctx.drawImage(work, -work.width / 2, -work.height / 2);
    workRef.current = next;
    data.crop =
      axis === "x"
        ? { ...data.crop, x: next.width - (data.crop.x + data.crop.w) }
        : { ...data.crop, y: next.height - (data.crop.y + data.crop.h) };
    refresh();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toWork(event.clientX, event.clientY);
    const data = dataRef.current;

    if (tool === "crop") {
      const crop = data.crop;
      const radius = Math.max(14, 22 * point.scale);
      const corners: { corner: Corner; x: number; y: number }[] = [
        { corner: "nw", x: crop.x, y: crop.y },
        { corner: "ne", x: crop.x + crop.w, y: crop.y },
        { corner: "sw", x: crop.x, y: crop.y + crop.h },
        { corner: "se", x: crop.x + crop.w, y: crop.y + crop.h },
      ];
      const hit = corners.find((corner) => Math.hypot(point.x - corner.x, point.y - corner.y) <= radius);
      if (hit) {
        dragRef.current = { kind: "crop-resize", corner: hit.corner, startCrop: { ...crop } };
        return;
      }
      if (point.x >= crop.x && point.x <= crop.x + crop.w && point.y >= crop.y && point.y <= crop.y + crop.h) {
        dragRef.current = { kind: "crop-move", start: point, startCrop: { ...crop } };
      }
      return;
    }

    if (tool === "draw") {
      const stroke: Stroke = {
        points: [normalizePoint(point, data)],
        color,
        size: brush / 1000,
      };
      data.strokes.push(stroke);
      dragRef.current = { kind: "draw", stroke };
      drawRef.current();
      return;
    }

    const item = itemAt(point.x, point.y);
    if (item) {
      setSelected(item.id);
      dragRef.current = {
        kind: "item",
        id: item.id,
        dx: point.x / data.workW - item.x,
        dy: point.y / data.workH - item.y,
      };
    } else {
      setSelected(null);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    const point = toWork(event.clientX, event.clientY);
    const data = dataRef.current;

    if (drag.kind === "draw") {
      const normalized = normalizePoint(point, data);
      const last = drag.stroke.points[drag.stroke.points.length - 1];
      if (!last || Math.hypot(normalized.x - last.x, normalized.y - last.y) > 0.0015) {
        drag.stroke.points.push(normalized);
      }
      drawRef.current();
      return;
    }

    if (drag.kind === "crop-move") {
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      data.crop = clampCrop(
        { ...drag.startCrop, x: drag.startCrop.x + dx, y: drag.startCrop.y + dy },
        data,
      );
      drawRef.current();
      return;
    }

    if (drag.kind === "crop-resize") {
      const aspect = aspectFor(mode);
      const start = drag.startCrop;
      const anchorX = drag.corner.includes("w") ? start.x + start.w : start.x;
      const anchorY = drag.corner.includes("n") ? start.y + start.h : start.y;
      const min = Math.max(24, Math.min(data.workW, data.workH) * 0.08);
      let w = Math.abs(point.x - anchorX);
      let h = Math.abs(point.y - anchorY);
      if (aspect) {
        const target = Math.max(w, h * aspect, min);
        w = target;
        h = target / aspect;
        if (h < min) {
          h = min;
          w = min * aspect;
        }
      } else {
        w = Math.max(min, w);
        h = Math.max(min, h);
      }
      const maxW = drag.corner.includes("w") ? anchorX : data.workW - anchorX;
      const maxH = drag.corner.includes("n") ? anchorY : data.workH - anchorY;
      if (aspect) {
        const limit = Math.min(maxW, maxH * aspect);
        if (w > limit) {
          w = limit;
          h = w / aspect;
        }
      } else {
        w = Math.min(w, maxW);
        h = Math.min(h, maxH);
      }
      data.crop = clampCrop(
        {
          x: drag.corner.includes("w") ? anchorX - w : anchorX,
          y: drag.corner.includes("n") ? anchorY - h : anchorY,
          w,
          h,
        },
        data,
      );
      drawRef.current();
      return;
    }

    if (drag.kind === "item") {
      const item = data.overlays.find((entry) => entry.id === drag.id);
      if (!item) return;
      item.x = clamp(point.x / data.workW - drag.dx, 0.03, 0.97);
      item.y = clamp(point.y / data.workH - drag.dy, 0.03, 0.97);
      drawRef.current();
    }
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const addText = () => {
    const value = textValue.trim();
    if (!value) return;
    const data = dataRef.current;
    data.overlays.push({
      id: uid("txt"),
      type: "text",
      text: value,
      x: 0.5,
      y: 0.5,
      size: 0.07,
      color,
    });
    setTextValue("");
    setSelected(data.overlays[data.overlays.length - 1].id);
    refresh();
  };

  const addEmoji = (emoji: string) => {
    const data = dataRef.current;
    data.overlays.push({
      id: uid("stk"),
      type: "sticker",
      emoji,
      x: 0.5,
      y: 0.5,
      size: 0.15,
    });
    setSelected(data.overlays[data.overlays.length - 1].id);
    refresh();
  };

  const removeSelected = () => {
    if (!selected) return;
    const data = dataRef.current;
    data.overlays = data.overlays.filter((item) => item.id !== selected);
    setSelected(null);
    refresh();
  };

  const save = async () => {
    const work = workRef.current;
    if (!work || busy) return;
    setBusy(true);
    try {
      const data = dataRef.current;
      const crop = data.crop;
      const max = outputWidth(mode);
      const outW = mode === "photo" ? Math.min(max, Math.max(1, Math.round(crop.w))) : max;
      const outH = Math.max(1, Math.round((outW * crop.h) / crop.w));
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(work, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH);
      drawOverlays(ctx, data, {
        unit: outW,
        scale: outW / crop.w,
        offsetX: crop.x,
        offsetY: crop.y,
      });
      const quality = mode === "avatar" ? 0.9 : 0.84;
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => {
          if (value) resolve(value);
          else reject(new Error("encode"));
        }, "image/jpeg", quality);
      });
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      onDone({ blob, dataUrl });
    } catch {
      setBusy(false);
    }
  };

  if (typeof document === "undefined") return null;

  const toolButton = (id: Tool, label: string, icon: ReactNode) => (
    <button
      key={id}
      type="button"
      onClick={() => setTool(id)}
      aria-label={label}
      className={cn(
        "press flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[12px] py-2 text-[10px] font-medium transition-colors",
        tool === id ? "bg-white/14 text-white" : "text-white/55 hover:text-white/85",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );

  const content = (
    <div className="fixed inset-0 z-[120] flex select-none flex-col bg-[#09090b] text-white">
      <div className="flex shrink-0 items-center justify-between px-3 pt-[max(10px,env(safe-area-inset-top,0px))] pb-2">
        <button type="button" onClick={onCancel} aria-label="Отмена" className="press grid size-10 place-items-center rounded-full text-white/85 hover:bg-white/10">
          <X size={19} />
        </button>
        <span className="t-sub font-medium text-white/70">Редактор</span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !ready}
          aria-label="Готово"
          className="press grid size-10 place-items-center rounded-full bg-white text-black disabled:opacity-45"
        >
          <Check size={19} strokeWidth={2.4} />
        </button>
      </div>

      <div ref={containerRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {failed ? (
          <p className="t-sub max-w-[260px] text-center text-white/60">Не удалось открыть изображение</p>
        ) : (
          <canvas
            ref={stageRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="touch-none rounded-[10px]"
            style={{ width: stage.w, height: stage.h }}
          />
        )}
        {!ready && !failed ? (
          <span className="absolute size-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
        ) : null}
      </div>

      <div
        className="shrink-0 border-t border-white/10 bg-[#0d0d10] px-3 pt-2.5"
        style={{ paddingBottom: "max(14px, env(safe-area-inset-bottom, 0px))" }}
      >
        {tool === "draw" ? (
          <div className="flex items-center gap-2 pb-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar">
              {BRUSH_COLORS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`Цвет ${value}`}
                  onClick={() => setColor(value)}
                  className={cn(
                    "size-7 shrink-0 rounded-full border transition-transform",
                    color === value ? "scale-110 border-white" : "border-white/25",
                  )}
                  style={{ background: value }}
                />
              ))}
            </div>
            <input
              type="range"
              min={2}
              max={26}
              value={brush}
              onChange={(event) => setBrush(Number(event.target.value))}
              aria-label="Толщина кисти"
              className="w-24 accent-white"
            />
          </div>
        ) : null}

        {tool === "text" ? (
          <div className="flex items-center gap-2 pb-2">
            <input
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addText();
              }}
              maxLength={80}
              placeholder="Текст"
              className="h-10 min-w-0 flex-1 rounded-[12px] border border-white/12 bg-white/6 px-3 text-[14px] text-white outline-none placeholder:text-white/35"
            />
            <div className="flex items-center gap-1.5">
              {BRUSH_COLORS.slice(0, 5).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`Цвет ${value}`}
                  onClick={() => setColor(value)}
                  className={cn(
                    "size-6 rounded-full border transition-transform",
                    color === value ? "scale-110 border-white" : "border-white/25",
                  )}
                  style={{ background: value }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={addText}
              disabled={!textValue.trim()}
              className="press h-10 shrink-0 rounded-[12px] bg-white px-3 text-[13px] font-semibold text-black disabled:opacity-40"
            >
              Добавить
            </button>
          </div>
        ) : null}

        {tool === "emoji" ? (
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => addEmoji(emoji)}
                aria-label={`Добавить ${emoji}`}
                className="press grid size-9 shrink-0 place-items-center rounded-[10px] bg-white/6 text-[21px]"
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-1">
          {toolButton("crop", "Обрезать", <Crop size={18} />)}
          {toolButton("draw", "Кисть", <Pencil size={18} />)}
          {toolButton("text", "Текст", <Type size={18} />)}
          {toolButton("emoji", "Стикеры", <Smile size={18} />)}
        </div>

        <div className="mt-1 flex items-center gap-1">
          <button type="button" onClick={rotate} aria-label="Повернуть" className="press flex flex-1 flex-col items-center gap-1 rounded-[12px] py-2 text-[10px] font-medium text-white/55 hover:text-white/85">
            <RotateCw size={18} />
            <span>Повернуть</span>
          </button>
          <button type="button" onClick={() => flip("x")} aria-label="Отразить по горизонтали" className="press flex flex-1 flex-col items-center gap-1 rounded-[12px] py-2 text-[10px] font-medium text-white/55 hover:text-white/85">
            <FlipHorizontal2 size={18} />
            <span>Отразить</span>
          </button>
          <button type="button" onClick={() => flip("y")} aria-label="Отразить по вертикали" className="press flex flex-1 flex-col items-center gap-1 rounded-[12px] py-2 text-[10px] font-medium text-white/55 hover:text-white/85">
            <FlipVertical2 size={18} />
            <span>Отразить</span>
          </button>
          <button
            type="button"
            onClick={removeSelected}
            disabled={!selected}
            aria-label="Удалить элемент"
            className="press flex flex-1 flex-col items-center gap-1 rounded-[12px] py-2 text-[10px] font-medium text-white/55 hover:text-white/85 disabled:opacity-35"
          >
            <Trash2 size={18} />
            <span>Удалить</span>
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
