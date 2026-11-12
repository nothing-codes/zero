import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function initInstallPrompt() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function useInstallPrompt() {
  const [available, setAvailable] = useState(Boolean(deferred));

  useEffect(() => {
    const update = () => setAvailable(Boolean(deferred));
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);

  const install = async () => {
    const event = deferred;
    if (!event) return false;
    deferred = null;
    notify();
    try {
      await event.prompt();
      const choice = await event.userChoice;
      return choice.outcome === "accepted";
    } catch {
      return false;
    }
  };

  return { available, install };
}
