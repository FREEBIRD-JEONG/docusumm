"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ToastTone = "info" | "success" | "error";

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
}

interface ToastStackProps {
  items: ToastMessage[];
  onDismiss: (id: string) => void;
}

const TONE_STYLES: Record<ToastTone, string> = {
  info: "border-border/80 bg-card text-foreground",
  success: "border-emerald-300/70 bg-emerald-50 text-emerald-900",
  error: "border-destructive/50 bg-destructive/5 text-destructive",
};

export function ToastStack({ items, onDismiss }: ToastStackProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed top-4 right-4 z-[70] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
    >
      {items.map((item) => {
        const tone = item.tone ?? "info";

        return (
          <div
            key={item.id}
            role="status"
            className={cn(
              "pointer-events-auto rounded-lg border px-3 py-2 shadow-md backdrop-blur-sm",
              TONE_STYLES[tone],
            )}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.title}</p>
                {item.description ? (
                  <p className="mt-1 text-xs leading-5 opacity-90">{item.description}</p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="h-6 w-6 rounded-md opacity-80 hover:opacity-100"
                onClick={() => onDismiss(item.id)}
                aria-label="알림 닫기"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
