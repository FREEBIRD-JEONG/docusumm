const DEFAULT_GUEST_USER_ID = "00000000-0000-0000-0000-000000000001";

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isAuthEnabled(): boolean {
  return parseBoolean(process.env.NEXT_PUBLIC_AUTH_ENABLED);
}

export function getGuestUserId(): string {
  const configured = process.env.DEV_GUEST_USER_ID?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_GUEST_USER_ID;
}

export function getGuestUserEmail(userId: string): string {
  return `guest-${userId}@local.invalid`;
}
