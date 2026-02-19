const URL_CANDIDATE_REGEX =
  /(https?:\/\/[^\s<>"')\]}]+|(?:www\.)?(?:m\.)?(?:music\.)?youtube\.com\/[^\s<>"')\]}]+|(?:www\.)?youtu\.be\/[^\s<>"')\]}]+)/gi;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{6,}$/;

function sanitizeCandidate(text: string): string {
  return text
    .trim()
    .replace(/^[\s<([{'"`]+/, "")
    .replace(/[\s>)\]}'"`.,!?;:]+$/, "");
}

function normalizeCandidateProtocol(candidate: string): string {
  if (/^https?:\/\//i.test(candidate)) {
    return candidate;
  }
  return `https://${candidate}`;
}

function extractCandidates(raw: string): string[] {
  const normalized = sanitizeCandidate(raw);
  if (!normalized) {
    return [];
  }

  const matches = normalized.match(URL_CANDIDATE_REGEX) ?? [];
  if (matches.length === 0) {
    return [normalized];
  }

  return matches.map(sanitizeCandidate).filter(Boolean);
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

function extractVideoId(url: URL): string {
  const hostname = normalizeHostname(url.hostname);

  if (hostname === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return id;
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/watch") {
    return url.searchParams.get("v") ?? "";
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 2 && ["shorts", "embed", "live", "v"].includes(segments[0])) {
    return segments[1];
  }

  return "";
}

export function normalizeYouTubeUrl(value: string): string | null {
  for (const rawCandidate of extractCandidates(value)) {
    const candidate = normalizeCandidateProtocol(rawCandidate);

    try {
      const parsed = new URL(candidate);
      const hostname = normalizeHostname(parsed.hostname);

      if (!YOUTUBE_HOSTS.has(hostname)) {
        continue;
      }

      const id = extractVideoId(parsed).trim();
      if (!VIDEO_ID_REGEX.test(id)) {
        continue;
      }

      return `https://www.youtube.com/watch?v=${id}`;
    } catch {
      continue;
    }
  }

  return null;
}

export function isValidYouTubeUrl(value: string): boolean {
  return normalizeYouTubeUrl(value) !== null;
}
