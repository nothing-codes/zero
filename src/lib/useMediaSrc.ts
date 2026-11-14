import { useEffect, useState } from "react";
import type { MediaEncryption } from "../types";
import { decryptedMediaUrl } from "./e2ee";

/**
 * Возвращает ссылку на вложение: обычную для старых файлов и object URL
 * после расшифровки для новых зашифрованных.
 */
export function useMediaSrc(src?: string, enc?: MediaEncryption) {
  const [url, setUrl] = useState<string | undefined>(enc ? undefined : src);

  useEffect(() => {
    if (!src) {
      setUrl(undefined);
      return;
    }
    if (!enc) {
      setUrl(src);
      return;
    }

    let active = true;
    setUrl(undefined);
    decryptedMediaUrl(src, enc)
      .then((value) => {
        if (active) setUrl(value);
      })
      .catch(() => {
        if (active) setUrl(undefined);
      });

    return () => {
      active = false;
    };
  }, [src, enc?.key, enc?.iv]);

  return url;
}
