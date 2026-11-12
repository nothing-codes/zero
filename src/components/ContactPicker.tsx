import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CONTACTS, type Contact } from "../lib/data";
import { cn } from "../lib/utils";
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
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CONTACTS;
    return CONTACTS.filter(
      (contact) =>
        contact.name.toLowerCase().includes(q) ||
        contact.username.toLowerCase().includes(q) ||
        contact.phone.includes(q),
    );
  }, [query]);

  return (
    <Sheet open={open} onClose={onClose} title={title} full>
      <div className="flex h-11 items-center gap-2 rounded-[14px] border border-foreground/10 bg-foreground/5 px-3.5">
        <Search size={16} className="text-faint" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Имя или @username"
          className="h-full flex-1 bg-transparent text-[15px] outline-none"
          autoFocus
        />
      </div>
      <div className="mt-2 pb-4">
        {filtered.map((contact) => (
          <button
            key={contact.id}
            type="button"
            onClick={() => {
              onPick(contact);
              onClose();
            }}
            className="press flex w-full items-center gap-3 rounded-[14px] px-2 py-2.5 text-left hover:bg-foreground/5"
          >
            <Avatar name={contact.name} size={44} online={contact.online} />
            <span className="min-w-0 flex-1">
              <span className="t-body block truncate font-medium">{contact.name}</span>
              <span className="t-sub block truncate text-faint">
                @{contact.username} · {contact.online ? "в сети" : "недавно"}
              </span>
            </span>
            <Check size={15} className="text-transparent" />
          </button>
        ))}
        {filtered.length === 0 ? (
          <p className="t-sub py-8 text-center text-faint">Ничего не найдено</p>
        ) : null}
      </div>
      <div className={cn("mx-2 mb-3 rounded-[16px] border border-foreground/8 bg-foreground/[0.03] p-3.5")}>
        <p className="t-cap text-faint">Пригласить</p>
        <p className="t-sub mt-1.5 text-muted-foreground">
          Отправьте другу ссылку на Zero — он окажется здесь через минуту.
        </p>
        <p className="t-sub t-num mt-2 text-foreground">zero.app/join</p>
      </div>
    </Sheet>
  );
}
