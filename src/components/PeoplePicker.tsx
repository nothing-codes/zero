import { Check, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { normalizeEmail, normalizeUsername, searchProfiles, type ZeroProfile } from "../lib/chat";
import { isZeroIdentity } from "../lib/identity";
import { useAuthedStore } from "../lib/store";
import { cn, haptic } from "../lib/utils";
import type { GroupMember } from "../types";
import { Avatar } from "./Avatar";

export function PeoplePicker({
  selected,
  onChange,
  exclude = [],
}: {
  selected: GroupMember[];
  onChange: (members: GroupMember[]) => void;
  exclude?: string[];
}) {
  const { state, user } = useAuthedStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ZeroProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const needle = normalizeUsername(query);

  useEffect(() => {
    if (needle.length < 2) {
      setResults([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void searchProfiles(needle, user.email)
        .then((rows) => {
          if (cancelled) return;
          setResults(rows);
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
    }, 240);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [needle, user.email]);

  const candidates = useMemo(() => {
    const base: GroupMember[] = needle.length >= 2
      ? results.map((profile) => ({
          email: profile.email,
          name: profile.name || profile.username,
          username: profile.username,
          avatar: profile.avatar,
        }))
      : state.chats
          .filter(
            (chat) =>
              !chat.group &&
              !chat.saved &&
              Boolean(chat.email) &&
              !isZeroIdentity(chat),
          )
          .map((chat) => ({
            email: chat.email ?? "",
            name: chat.name,
            username: chat.username,
            avatar: chat.avatar,
          }));

    const blocked = new Set(
      [
        normalizeEmail(user.email),
        ...exclude.map(normalizeEmail),
        ...selected.map((member) => normalizeEmail(member.email)),
      ].filter(Boolean),
    );
    const seen = new Set<string>();
    return base.filter((member) => {
      const email = normalizeEmail(member.email);
      if (!email || blocked.has(email) || seen.has(email)) return false;
      seen.add(email);
      return true;
    });
  }, [needle.length, results, state.chats, exclude, selected, user.email]);

  const toggle = (member: GroupMember) => {
    haptic(5);
    const email = normalizeEmail(member.email);
    if (selected.some((item) => normalizeEmail(item.email) === email)) {
      onChange(selected.filter((item) => normalizeEmail(item.email) !== email));
    } else {
      onChange([...selected, { ...member, email }]);
    }
  };

  return (
    <div>
      {selected.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((member) => (
            <span
              key={member.email}
              className="flex items-center gap-1.5 rounded-full border border-foreground/10 bg-foreground/6 py-1 pl-1 pr-1.5"
            >
              <Avatar name={member.name} src={member.avatar} size={22} />
              <span className="t-sub max-w-[120px] truncate">{member.name}</span>
              <button
                type="button"
                aria-label={`Убрать ${member.name}`}
                onClick={() => toggle(member)}
                className="grid size-4 place-items-center rounded-full text-faint hover:text-foreground"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex h-11 items-center gap-2 rounded-[14px] border border-foreground/10 bg-foreground/5 px-3.5">
        <Search size={16} className="shrink-0 text-faint" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по @username"
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        {loading ? <Loader2 size={15} className="shrink-0 animate-spin text-faint" /> : null}
        {query ? (
          <button
            type="button"
            aria-label="Очистить"
            onClick={() => setQuery("")}
            className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground/10 text-faint"
          >
            <X size={11} />
          </button>
        ) : null}
      </div>

      <div className="mt-2 max-h-[300px] overflow-y-auto overscroll-contain">
        <p className="t-cap px-1 pb-1 pt-2 text-faint">
          {needle.length >= 2 ? "Найденные люди" : "Ваши контакты"}
        </p>
        {candidates.map((member) => {
          const active = selected.some(
            (item) => normalizeEmail(item.email) === normalizeEmail(member.email),
          );
          return (
            <button
              key={member.email}
              type="button"
              onClick={() => toggle(member)}
              className="flex w-full items-center gap-3 rounded-[12px] px-1.5 py-2 text-left transition-colors hover:bg-foreground/5"
            >
              <Avatar name={member.name} src={member.avatar} size={40} />
              <span className="min-w-0 flex-1">
                <span className="t-body block truncate font-medium">{member.name}</span>
                <span className="t-sub block truncate text-faint">
                  {member.username ? `@${member.username}` : member.email}
                </span>
              </span>
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-foreground/20 text-transparent",
                )}
              >
                <Check size={13} strokeWidth={2.6} />
              </span>
            </button>
          );
        })}

        {needle.length >= 2 && !loading && candidates.length === 0 ? (
          <p className="t-sub px-2 py-6 text-center text-faint">
            {failed ? "Поиск недоступен. Проверьте соединение." : "Никого не нашли по @username."}
          </p>
        ) : null}
        {needle.length < 2 && candidates.length === 0 ? (
          <p className="t-sub px-2 py-6 text-center text-faint">
            Начните вводить @username, чтобы найти человека.
          </p>
        ) : null}
      </div>
    </div>
  );
}
