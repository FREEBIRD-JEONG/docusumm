"use client";

import type { RefObject } from "react";
import { useLayoutEffect } from "react";

export function useAutoResizeTextarea(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 360)}px`;
  }, [textareaRef, value]);
}
