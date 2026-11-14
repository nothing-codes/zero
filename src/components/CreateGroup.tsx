import { Camera, Megaphone, Users } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { cn, haptic } from "../lib/utils";
import type { GroupMember } from "../types";
import { Avatar } from "./Avatar";
import { PeoplePicker } from "./PeoplePicker";
import { PhotoEditor } from "./PhotoEditor";
import { Button, Sheet } from "./ui";

export function CreateGroup({
  open,
  kind,
  onClose,
  onCreate,
}: {
  open: boolean;
  kind: "group" | "channel";
  onClose: () => void;
  onCreate: (input: {
    name: string;
    kind: "group" | "channel";
    avatar?: string | null;
    description?: string;
    members: GroupMember[];
  }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [editorFile, setEditorFile] = useState<File | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setAvatar(null);
    setMembers([]);
    setEditorFile(null);
  }, [open, kind]);

  const pickPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setEditorFile(file);
  };

  const channel = kind === "channel";

  return (
    <Sheet open={open} onClose={onClose} title={channel ? "Новый канал" : "Новая группа"} full>
      <div className="flex items-center gap-4 pb-4">
        <button
          type="button"
          onClick={() => photoRef.current?.click()}
          className="relative rounded-full"
          aria-label="Добавить фото"
        >
          <Avatar name={name || (channel ? "Канал" : "Группа")} src={avatar} size={72} />
          <span className="absolute -bottom-0.5 -right-0.5 grid size-6 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground">
            <Camera size={12} />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="t-body font-medium">{channel ? "Фото канала" : "Фото группы"}</p>
          <p className="t-sub mt-0.5 text-faint">Можно изменить позже.</p>
        </div>
        <span className="grid size-10 place-items-center rounded-full bg-foreground/6 text-foreground/60">
          {channel ? <Megaphone size={18} /> : <Users size={18} />}
        </span>
        <input ref={photoRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden" />
      </div>

      <div className="space-y-4 pb-4">
        <div>
          <label className="t-cap block text-faint" htmlFor="group-name">
            Название
          </label>
          <input
            id="group-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={64}
            placeholder={channel ? "Например, «Новости»" : "Например, «Друзья»"}
            className="field mt-2"
          />
        </div>
        <div>
          <label className="t-cap block text-faint" htmlFor="group-description">
            Описание
          </label>
          <textarea
            id="group-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            maxLength={180}
            placeholder="Необязательно"
            className="field mt-2 h-auto resize-none py-3.5"
          />
        </div>
      </div>

      <div className={cn("rounded-[16px] border border-foreground/8 bg-foreground/[0.02] p-3")}>
        <p className="t-body pb-2 font-medium">{channel ? "Подписчики" : "Участники"}</p>
        <PeoplePicker selected={members} onChange={setMembers} />
      </div>

      <div className="pb-2 pt-5">
        <Button
          className="w-full"
          disabled={name.trim().length < 2}
          onClick={() => {
            haptic(8);
            onCreate({
              name: name.trim(),
              kind,
              avatar,
              description,
              members,
            });
          }}
        >
          {channel ? "Создать канал" : "Создать группу"}
        </Button>
      </div>

      {editorFile ? (
        <PhotoEditor
          file={editorFile}
          mode="avatar"
          onCancel={() => setEditorFile(null)}
          onDone={({ dataUrl }) => {
            setAvatar(dataUrl);
            setEditorFile(null);
            haptic(6);
          }}
        />
      ) : null}
    </Sheet>
  );
}
