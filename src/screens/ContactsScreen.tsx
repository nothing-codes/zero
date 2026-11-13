import { MessageCircle, Phone, Search, UserPlus } from "lucide-react";
import { useState } from "react";
import { Avatar } from "../components/Avatar";
import { ContactPicker } from "../components/ContactPicker";
import { Button } from "../components/ui";
import type { Contact } from "../lib/data";
import { useAuthedStore } from "../lib/store";

export function ContactsScreen({
  onOpenChat,
  onCall,
}: {
  onOpenChat?: (chatId: string) => void;
  onCall?: (chatId: string) => void;
}) {
  const { state, openOrCreateChat } = useAuthedStore();
  const [picker, setPicker] = useState(false);

  // Только настоящие собеседники — у них есть email и remote-чат.
  const contacts = state.chats.filter(
    (chat) => !chat.group && chat.id !== "c_zero" && Boolean(chat.email),
  );

  const pick = (contact: Contact) => {
    const chatId = openOrCreateChat({
      name: contact.name,
      username: contact.username,
      email: contact.email,
      phone: contact.phone,
      avatar: contact.avatar,
      online: contact.online,
      lastSeen: contact.lastSeen,
      remote: Boolean(contact.email),
    });
    onOpenChat?.(chatId);
  };

  return (
    <div className="flex h-full flex-col px-5 pt-[max(16px,env(safe-area-inset-top,0px))]">
      <h1 className="t-display">Контакты</h1>

      <button
        type="button"
        onClick={() => setPicker(true)}
        className="mt-4 flex h-11 w-full items-center gap-2 rounded-[14px] border border-foreground/10 bg-foreground/[0.045] px-3.5 text-left text-[14px] text-faint transition-colors hover:border-foreground/20"
      >
        <Search size={16} className="shrink-0" />
        Найти по @username или Gmail
      </button>

      <div className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pb-[122px]">
        {contacts.length > 0 ? (
          <div className="overflow-hidden rounded-[18px] border border-foreground/8 bg-foreground/[0.02]">
            {contacts.map((chat, index) => (
              <div
                key={chat.id}
                className={index > 0 ? "flex items-center gap-3 border-t border-foreground/[0.05] px-3 py-3" : "flex items-center gap-3 px-3 py-3"}
              >
                <button
                  type="button"
                  onClick={() => onOpenChat?.(chat.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <Avatar name={chat.name} src={chat.avatar} size={46} online={chat.online} />
                  <span className="min-w-0 flex-1">
                    <span className="t-body block truncate font-medium">{chat.name}</span>
                    <span className="t-sub block truncate text-faint">
                      {chat.username ? `@${chat.username}` : chat.email}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Написать ${chat.name}`}
                  onClick={() => onOpenChat?.(chat.id)}
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground/6 text-foreground/70"
                >
                  <MessageCircle size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Позвонить ${chat.name}`}
                  onClick={() => onCall?.(chat.id)}
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground/6 text-foreground/70"
                >
                  <Phone size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[18px] border border-foreground/8 bg-foreground/[0.03] p-5 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-foreground/6 text-foreground/60">
              <UserPlus size={20} />
            </span>
            <p className="t-body mt-3 font-medium">Пока никого нет</p>
            <p className="t-sub mt-1.5 text-faint">
              Найдите человека по @username.
            </p>
            <Button className="mt-4 w-full" onClick={() => setPicker(true)}>
              Найти человека
            </Button>
          </div>
        )}
      </div>

      <ContactPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={pick}
        title="Найти человека"
      />
    </div>
  );
}
