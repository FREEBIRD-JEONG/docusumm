export const CREDIT_PACKAGES = [
  {
    id: "starter",
    credits: 30,
    priceUsd: 5,
    label: "Starter",
    description: "30 크레딧",
  },
  {
    id: "pro",
    credits: 50,
    priceUsd: 8,
    label: "Pro",
    description: "50 크레딧",
  },
  {
    id: "max",
    credits: 100,
    priceUsd: 15,
    label: "Max",
    description: "100 크레딧",
  },
] as const;

export type CreditPackage = (typeof CREDIT_PACKAGES)[number];
export type CreditPackageId = CreditPackage["id"];

export function isCreditPackageId(value: string): value is CreditPackageId {
  return CREDIT_PACKAGES.some((item) => item.id === value);
}

export function getCreditPackageById(id: string | null | undefined): CreditPackage | null {
  if (!id || !isCreditPackageId(id)) {
    return null;
  }

  return CREDIT_PACKAGES.find((item) => item.id === id) ?? null;
}
