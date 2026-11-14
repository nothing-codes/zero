import { Check, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchProfiles, type ZeroProfile } from "../lib/chat";
import type { Contact } from "../lib/data";
import { isZeroIdentity } from "../lib/identity";
import { useAuthedStore } from "../lib/store";
import { haptic } from "../lib/utils";
import { Avatar } from "./Avatar";
import { Sheet } from "./ui";

export function ContactPicker({
  open,
  onClose,
  onPick,
  title = "Новый чат",
}: {
  open: boolean;
  onClose: () => void;
  onPick: (contact: Contact) => void;
  title?: string;
}) {
  const { state, user } = useAuthedStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ZeroProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setFailed(false);
    // autoFocus в анимированном окне срабатывает не всегда (особенно на iOS),
    // поэтому подстраховываемся фокусом после появления окна.
    const timer = window.setTimeout(() => {
      if (document.activeElement === document.body) inputRef.current?.focus();
    }, 380);
    return () => window.clearTimeout(timer);
  }, [open]);

  const needle = query.trim().replace(/^@/, "");

  // Ищем реальных людей в zero_profiles по @username, Gmail или имени.
  useEffect(() => {
    if (!open) return;
    if (needle.length < 2) {
      setResults([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void searchProfiles(query, user.email)
        .then((rows) => {
          if (cancelled) return;
          setResults(rows.filter((row) => !isZeroIdentity({ username: row.username, email: row.email })));
          setFailed(false);
        })
        .catch(() => {
          if (cancelled) return;
          setResults([]);
          setFailed(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, needle, query, user.email]);

  const contacts: Contact[] = useMemo(() => {
    if (needle.length >= 2) {
      return results.map((profile) => ({
        id: profile.email,
        name: profile.name || profile.username,
        username: profile.username,
        phone: "",
        email: profile.email,
        avatar: profile.avatar,
        online: false,
        bio: profile.bio,
      }));
    }
    // Без поиска показываем людей, с которыми уже есть настоящий чат.
    return state.chats
      .filter((chat) => !chat.group && chat.id !== "c_zero" && Boolean(chat.email) && !isZeroIdentity(chat))
      .map((chat) => ({
        id: chat.id,
        name: chat.name,
        username: chat.username ?? "",
        phone: chat.phone ?? "",
        email: chat.email,
        avatar: chat.avatar,
        online: Boolean(chat.online),
        lastSeen: chat.lastSeen,
        bio: "",
      }));
  }, [needle.length, results, state.chats]);

  return (
    <Sheet open={open} onClose={onClose} title={title} full>
      <div className="flex h-11 items-center gap-2 rounded-[14px] border border-foreground/10 bg-foreground/5 px-3.5">
        <Search size={16} className="text-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Имя, @username или Gmail"
          className="h-full flex-1 bg-transparent text-[15px] outline-none"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="search"
        />
        {loading ? <Loader2 size={15} className="shrink-0 animate-spin text-faint" /> : null}
      </div>

      <div className="mt-2 pb-4">
        {contacts.map((contact) => (
          <button
            key={contact.id}
            type="button"
            onClick={() => {
              haptic(5);
              onPick(contact);
              onClose();
            }}
            className="press flex w-full items-center gap-3 rounded-[14px] px-2 py-2.5 text-left hover:bg-foreground/5"
          >
            <Avatar name={contact.name} src={contact.avatar} size={44} online={contact.online} />
            <span className="min-w-0 flex-1">
              <span className="t-body block truncate font-medium">{contact.name}</span>
              <span className="t-sub block truncate text-faint">
                {contact.username ? `@${contact.username}` : contact.email}
                {contact.email ? ` · ${contact.email}` : ""}
              </span>
            </span>
            <Check size={15} className="text-transparent" />
          </button>
        ))}

        {needle.length < 2 ? (
          <p className="t-sub px-3 py-8 text-center text-faint">
            Введите @username или Gmail человека.
          </p>
        ) : null}

        {needle.length >= 2 && !loading && contacts.length === 0 ? (
          <p className="t-sub px-3 py-8 text-center text-faint">
            {failed
              ? "Поиск временно недоступен. Проверьте, что схема Supabase выполнена."
              : "Никого не нашли. Проверьте @username или Gmail."}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
