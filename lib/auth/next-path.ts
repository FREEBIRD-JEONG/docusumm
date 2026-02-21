const DEFAULT_NEXT_PATH = "/dashboard";

export function sanitizeNextPath(
  nextPath: string | null | undefined,
  fallbackPath = DEFAULT_NEXT_PATH,
): string {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return fallbackPath;
  }
  return nextPath;
}

