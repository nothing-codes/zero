import { useEffect, useState } from "react";

/** ПК-версия включается только на устройствах с мышью и достаточной шириной. */
const DESKTOP_QUERY = "(min-width: 900px) and (hover: hover) and (pointer: fine)";

export function useIsDesktop() {
  const [desktop, setDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return desktop;
}
