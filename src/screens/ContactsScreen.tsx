import { Check, Share2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui";
import { shareText } from "../lib/image";
import { haptic } from "../lib/utils";

export function ContactsScreen(_: {
  onOpenChat?: (chatId: string) => void;
  onCall?: (chatId: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const invite = async () => {
    haptic(6);
    const ok = await shareText("Заходи в Zero: https://zero.app/join");
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 2200);
  };

  return (
    <div className="flex h-full flex-col px-5 pt-[max(16px,env(safe-area-inset-top,0px))]">
      <h1 className="t-display">Контакты</h1>

      <div className="mt-8 rounded-[18px] border border-foreground/8 bg-foreground/[0.03] p-5">
        <p className="t-body text-muted-foreground">
          В Zero нет списка пользователей. Только одна ссылка для приглашения.
        </p>

        <p className="t-sub t-num mt-4 text-foreground">zero.app/join</p>

        <Button className="mt-5 w-full" onClick={invite}>
          {copied ? <Check size={17} /> : <Share2 size={17} />}
          {copied ? "Ссылка скопирована" : "Пригласить в Zero"}
        </Button>
      </div>
    </div>
  );
}