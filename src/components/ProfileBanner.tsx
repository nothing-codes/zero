import { cn } from "../lib/utils";

/** Градиентные фоны профиля (без загрузки картинки). */
export const BANNERS = [
  { id: "g1", style: "linear-gradient(135deg, #3a3a3c 0%, #141416 55%, #08080a 100%)" },
  { id: "g2", style: "linear-gradient(135deg, #0a84ff 0%, #004a8f 55%, #071521 100%)" },
  { id: "g3", style: "linear-gradient(135deg, #ff9f0a 0%, #ff375f 55%, #3a0714 100%)" },
  { id: "g4", style: "linear-gradient(135deg, #bf5af2 0%, #5e2a8a 55%, #140a20 100%)" },
  { id: "g5", style: "linear-gradient(135deg, #30d158 0%, #0d5a35 55%, #06130c 100%)" },
  { id: "g6", style: "linear-gradient(135deg, #ff6482 0%, #8a1838 55%, #1a050b 100%)" },
];

export function isBannerPhoto(value?: string | null) {
  return Boolean(
    value &&
      (value.startsWith("data:") ||
        value.startsWith("blob:") ||
        value.startsWith("http://") ||
        value.startsWith("https://")),
  );
}

export function BannerVisual({
  banner,
  className,
}: {
  banner?: string | null;
  className?: string;
}) {
  if (isBannerPhoto(banner)) {
    return (
      <img
        src={banner ?? ""}
        alt=""
        draggable={false}
        className={cn("h-full w-full object-cover", className)}
      />
    );
  }
  const style = BANNERS.find((item) => item.id === banner)?.style ?? BANNERS[0].style;
  return <div className={cn("h-full w-full", className)} style={{ backgroundImage: style }} />;
}
