"use client";

import { useMemo, useState } from "react";
import { LoaderCircle, LogIn } from "lucide-react";
import type { Provider } from "@supabase/supabase-js";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

interface LoginFormProps {
  nextPath: string;
  callbackError: string | null;
}

interface OAuthProviderOption {
  id: string;
  label: string;
  provider: Provider;
}

const PROVIDERS: OAuthProviderOption[] = [
  { id: "google", label: "Google로 로그인", provider: "google" },
];

export function LoginForm({ nextPath, callbackError }: LoginFormProps) {
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  const sharedError = useMemo(() => localError ?? callbackError, [callbackError, localError]);

  const handleSignIn = async (option: OAuthProviderOption) => {
    setPendingProviderId(option.id);
    setLocalError(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const origin = appUrl ?? window.location.origin;
      const redirectUrl = new URL("/auth/callback", origin);
      redirectUrl.searchParams.set("next", nextPath);

      const { error } = await supabase.auth.signInWithOAuth({
        provider: option.provider,
        options: {
          redirectTo: redirectUrl.toString(),
        },
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : "로그인 요청을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
      setPendingProviderId(null);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md border-border/80 bg-card/95 shadow-sm">
        <CardHeader className="space-y-2">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-primary uppercase">
            DocuSumm
          </p>
          <CardTitle className="text-xl">로그인</CardTitle>
          <CardDescription>
            로그인 후 개인 히스토리와 요약 기능을 사용할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {PROVIDERS.map((option) => (
            <Button
              key={option.id}
              type="button"
              variant="outline"
              className="w-full justify-center gap-2"
              disabled={Boolean(pendingProviderId)}
              onClick={() => void handleSignIn(option)}
            >
              {pendingProviderId === option.id ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <LogIn className="size-4" />
              )}
              {option.label}
            </Button>
          ))}
          {sharedError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {sharedError}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
