"use client";

import { LoaderCircle, WalletCards } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ApiClientError,
  createCheckoutSessionRequest,
  type CreateCheckoutSessionResponse,
} from "@/lib/api/summary-client";
import { CREDIT_PACKAGES, type CreditPackageId } from "@/lib/stripe/packages";

interface CreditTopupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCheckoutCreated?: (payload: CreateCheckoutSessionResponse) => void;
  onError?: (message: string, code: string | null) => void;
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function CreditTopupDialog({
  open,
  onOpenChange,
  onCheckoutCreated,
  onError,
}: CreditTopupDialogProps) {
  const [submittingPackageId, setSubmittingPackageId] = useState<CreditPackageId | null>(null);

  const isSubmitting = submittingPackageId !== null;

  const close = () => {
    if (isSubmitting) {
      return;
    }
    onOpenChange(false);
  };

  const handlePurchase = async (packageId: CreditPackageId) => {
    if (isSubmitting) {
      return;
    }

    setSubmittingPackageId(packageId);
    try {
      const response = await createCheckoutSessionRequest(packageId);
      onCheckoutCreated?.(response);
      window.location.href = response.url;
    } catch (error) {
      if (error instanceof ApiClientError) {
        onError?.(error.message, error.code);
      } else {
        onError?.("결제 페이지를 여는 중 오류가 발생했습니다.", null);
      }
    } finally {
      setSubmittingPackageId(null);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credit-topup-dialog-title"
      onClick={close}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-[#d8d8d8] bg-white p-5 shadow-[0_20px_60px_rgba(15,15,15,0.2)] sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="credit-topup-dialog-title" className="text-xl font-semibold text-[#1d1d1d]">
              크레딧 충전
            </h2>
            <p className="mt-1 text-sm text-[#6a6a6a]">
              필요한 만큼 충전하고 즉시 요약을 계속하세요.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={close}
            disabled={isSubmitting}
            className="h-8 text-[#606060] hover:bg-[#f3f3f3]"
          >
            닫기
          </Button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {CREDIT_PACKAGES.map((item) => {
            const isCurrentSubmitting = submittingPackageId === item.id;
            return (
              <div
                key={item.id}
                className="rounded-xl border border-[#e2e2e2] bg-[#fafafa] p-4 shadow-[0_1px_0_rgba(20,20,20,0.04)]"
              >
                <p className="text-xs font-medium tracking-wide text-[#8b8b8b]">{item.label}</p>
                <p className="mt-1 text-2xl font-semibold text-[#1f1f1f]">{item.credits.toLocaleString()} 크레딧</p>
                <p className="mt-1 text-sm text-[#666666]">{item.description}</p>
                <p className="mt-3 text-lg font-semibold text-[#1859de]">{formatUsd(item.priceUsd)}</p>
                <Button
                  type="button"
                  onClick={() => void handlePurchase(item.id)}
                  disabled={isSubmitting}
                  className="mt-4 h-10 w-full bg-[#2f6df6] text-white shadow-none hover:bg-[#215be0] disabled:opacity-70"
                >
                  {isCurrentSubmitting ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      이동 중...
                    </>
                  ) : (
                    <>
                      <WalletCards className="size-4" />
                      구매하기
                    </>
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
