import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { WifiOff } from "lucide-react";
import { CallOverlay } from "./components/CallOverlay";
import { Dock, type Tab } from "./components/Dock";
import { callRoom, slug, subscribeCall, type IncomingCall } from "./lib/rtc";
import { supabase } from "./lib/supabase";
import { useStore } from "./lib/store";
import { cn, haptic } from "./lib/utils";
import { AuthFlow } from "./screens/Auth";
import { CallsScreen } from "./screens/CallsScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { ChatsScreen } from "./screens/ChatsScreen";
import { ContactsScreen } from "./screens/ContactsScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

type Overlay = { type: "chat"; chatId: string } | { type: "profile" } | null;
type ActiveCall = { chatId: string; incoming?: IncomingCall } | null;

const TABS: Tab[] = ["chats", "contacts", "calls", "settings"];

export function App() {
  const { state, user, receiveMessage, openOrCreateChat } = useStore();
  const [tab, setTab] = useState<Tab>("chats");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [call, setCall] = useState<ActiveCall>(null);
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const greeted = useRef(false);
  const chatsRef = useRef(state.chats);
  chatsRef.current = state.chats;
  const callRef = useRef<ActiveCall>(null);
  callRef.current = call;

  useEffect(() => {
    const online = () => setOffline(false);
    const down = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setOverlay(null);
      setCall(null);
      setTab("chats");
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const rooms = new Set([callRoom(user.username), callRoom(user.name)]);
    const channels = [...rooms].map((room) =>
      subscribeCall(room, (signal) => {
        if (signal.kind !== "offer" || callRef.current) return;
        const handle = slug(signal.handle || signal.from);
        if (!handle) return;
        const existing = chatsRef.current.find(
          (chat) => slug(chat.username ?? "") === handle || slug(chat.name) === handle,
        );
        const chatId =
          existing?.id ??
          openOrCreateChat({
            name: signal.from || signal.handle,
            username: signal.handle,
            online: true,
          });
        haptic([12, 40, 12]);
        setCall({
          chatId,
          incoming: {
            chatId,
            from: signal.from || signal.handle,
            handle: signal.handle,
            room,
            sdp: signal.sdp,
          },
        });
      }),
    );
    return () => {
      channels.forEach((channel) => {
        void supabase.removeChannel(channel);
      });
    };
  }, [user, openOrCreateChat]);

  useEffect(() => {
    if (!user || greeted.current) return;
    greeted.current = true;
    const target = chatsRef.current.find((chat) => !chat.group && !chat.muted);
    if (!target) return;
    const timer = window.setTimeout(() => {
      receiveMessage(target.id, {
        kind: "text",
        text: "Привет! Увидел, что ты уже здесь. Как тебе Zero?",
      });
    }, 11_000);
    return () => window.clearTimeout(timer);
  }, [user, receiveMessage]);

  const openChat = (chatId: string) => {
    haptic(4);
    setOverlay({ type: "chat", chatId });
  };

  if (!user) {
    return (
      <Frame>
        <AuthFlow />
      </Frame>
    );
  }

  const dockHidden = Boolean(overlay) || Boolean(call);

  return (
    <Frame>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {TABS.map((item) => {
          const active = tab === item;
          return (
            <div
              key={item}
              aria-hidden={!active}
              inert={!active}
              className={cn(
                "absolute inset-0 transition-opacity duration-200",
                active ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0",
              )}
            >
              {item === "chats" ? (
                <ChatsScreen onOpenChat={openChat} />
              ) : null}
              {item === "contacts" ? (
                <ContactsScreen onOpenChat={openChat} onCall={(chatId) => setCall({ chatId })} />
              ) : null}
              {item === "calls" ? (
                <CallsScreen onCall={(chatId) => setCall({ chatId })} />
              ) : null}
              {item === "settings" ? (
                <SettingsScreen onOpenProfile={() => setOverlay({ type: "profile" })} />
              ) : null}
            </div>
          );
        })}
      </div>

      {!dockHidden ? (
        <Dock active={tab} onChange={setTab} />
      ) : null}

      <AnimatePresence>
        {overlay ? (
          <motion.div
            key={overlay.type === "chat" ? `chat-${overlay.chatId}` : "profile"}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38, mass: 0.7 }}
            className="absolute inset-0 z-50 overflow-hidden bg-background"
          >
            {overlay.type === "chat" ? (
              <ChatScreen
                chatId={overlay.chatId}
                onBack={() => setOverlay(null)}
                onCall={() => setCall({ chatId: overlay.chatId })}
              />
            ) : (
              <ProfileScreen
                onBack={() => setOverlay(null)}
                onOpenSettings={() => {
                  setOverlay(null);
                  setTab("settings");
                }}
              />
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {call ? (
          <CallOverlay
            key={call.chatId}
            chatId={call.chatId}
            incoming={call.incoming}
            onClose={() => setCall(null)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {offline ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="pointer-events-none absolute inset-x-0 top-[max(8px,env(safe-area-inset-top,0px))] z-[75] flex justify-center px-4"
          >
            <span className="t-sub flex items-center gap-1.5 rounded-full border border-foreground/10 bg-card/90 px-3 py-1.5 text-muted-foreground shadow-lg backdrop-blur-xl">
              <WifiOff size={13} />
              Офлайн — сообщения сохранятся
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[100dvh] min-h-0 w-full justify-center overflow-hidden bg-shell">
      <div className="relative flex h-full min-h-0 w-full max-w-[520px] flex-col overflow-hidden bg-background shadow-[0_0_0_1px_rgba(255,255,255,0.04)] sm:border-x sm:border-foreground/8">
        {children}
      </div>
    </div>
  );
}