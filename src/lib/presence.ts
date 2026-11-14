import { supabase } from "./supabase";

/**
 * Онлайн-статусы через Supabase Realtime Presence.
 *
 * Каждый открытый клиент отмечается в общем канале `zero-presence`.
 * Остальные клиенты получают join/leave/sync и обновляют точку у аватара и
 * «был(а) в сети…» без запросов к базе.
 */
export interface PresenceEntry {
  online: boolean;
  at: number;
  name?: string;
  avatar?: string | null;
}

type PresenceMap = Record<string, PresenceEntry>;

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function subscribePresence(
  me: { email: string; name?: string; username?: string; avatar?: string | null },
  onChange: (map: PresenceMap) => void,
) {
  const email = normalizeEmail(me.email);
  const channel = supabase.channel("zero-presence", {
    config: { presence: { key: email } },
  });

  let stopped = false;

  const emit = () => {
    if (stopped) return;
    const raw = channel.presenceState() as Record<
      string,
      Array<{ email?: string; name?: string; avatar?: string | null }>
    >;
    const map: PresenceMap = {};
    for (const [key, metas] of Object.entries(raw)) {
      const meta = metas[0];
      const handle = normalizeEmail(meta?.email || key);
      if (!handle) continue;
      map[handle] = {
        online: true,
        at: Date.now(),
        name: meta?.name,
        avatar: meta?.avatar ?? null,
      };
    }
    onChange(map);
  };

  channel
    .on("presence", { event: "sync" }, emit)
    .on("presence", { event: "join" }, emit)
    .on("presence", { event: "leave" }, emit);

  const track = () => {
    if (stopped) return;
    void channel
      .track({
        email,
        name: me.name,
        username: me.username,
        avatar: me.avatar ?? null,
        online_at: new Date().toISOString(),
      })
      .catch(() => undefined);
  };

  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") track();
  });

  // Периодический heartbeat: если вкладка уснула и presence потерялся,
  // статус восстановится без перезагрузки.
  const timer = window.setInterval(track, 25_000);

  return {
    channel,
    stop: () => {
      stopped = true;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    },
  };
}
