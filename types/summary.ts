export type SourceType = "text" | "youtube";

export type SummaryStatus = "pending" | "processing" | "completed" | "failed";

export type SummaryJobStatus = "queued" | "processing" | "completed" | "failed";

export interface SummaryRecord {
  id: string;
  userId: string | null;
  sourceType: SourceType;
  originalContent: string;
  summaryText: string | null;
  status: SummaryStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SummaryListItem {
  id: string;
  title: string;
  status: SummaryStatus;
  createdAt: string;
}

const URL_LIKE_REGEX = /^(https?:\/\/|www\.)\S+$/i;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{6,}$/;

function truncateTitle(value: string, max = 42): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max).trim()}...`;
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

function extractYouTubeVideoId(url: URL): string | null {
  const hostname = normalizeHostname(url.hostname);

  if (hostname === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return VIDEO_ID_REGEX.test(id) ? id : null;
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/watch") {
    const id = url.searchParams.get("v") ?? "";
    return VIDEO_ID_REGEX.test(id) ? id : null;
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 2 && ["shorts", "embed", "live", "v"].includes(segments[0])) {
    const id = segments[1] ?? "";
    return VIDEO_ID_REGEX.test(id) ? id : null;
  }

  return null;
}

function buildUrlTitle(value: string): string | null {
  if (!URL_LIKE_REGEX.test(value)) {
    return null;
  }

  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    const hostname = normalizeHostname(parsed.hostname);

    if (YOUTUBE_HOSTS.has(hostname)) {
      const videoId = extractYouTubeVideoId(parsed);
      if (videoId) {
        return `YouTube 영상 요약 (${videoId})`;
      }
      return "YouTube 영상 요약";
    }

    const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return truncateTitle(`${hostname}${pathname}`);
  } catch {
    return null;
  }
}

export function deriveSummaryTitle(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Untitled summary";
  }

  const urlTitle = buildUrlTitle(normalized);
  if (urlTitle) {
    return urlTitle;
  }

  return truncateTitle(normalized);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function extractTldr(summaryText: string | null): string[] {
  if (!summaryText) {
    return [];
  }

  const lines = summaryText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim());

  let inTldrSection = false;
  const bullets: string[] = [];

  for (const line of lines) {
    if (!inTldrSection) {
      if (/^TL;DR$/i.test(line)) {
        inTldrSection = true;
      }
      continue;
    }

    if (/^전체 요약$/.test(line)) {
      break;
    }

    const match = line.match(/^[-•]\s+(.+)$/);
    if (!match?.[1]) {
      continue;
    }
    bullets.push(`- ${match[1].trim()}`);
    if (bullets.length >= 3) {
      break;
    }
  }

  if (bullets.length > 0) {
    return bullets;
  }

  return splitSentences(summaryText).slice(0, 3);
}

export function extractFullSummaryText(summaryText: string | null): string {
  if (!summaryText) {
    return "";
  }

  const lines = summaryText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());

  let inFullSummary = false;
  const body: string[] = [];

  for (const line of lines) {
    if (!inFullSummary) {
      if (/^\s*전체 요약\s*$/.test(line.trim())) {
        inFullSummary = true;
      }
      continue;
    }
    body.push(line);
  }

  const normalizedBody = body.join("\n").trim();
  return normalizedBody || summaryText;
}

export function toSummaryListItem(summary: SummaryRecord): SummaryListItem {
  return {
    id: summary.id,
    title: deriveSummaryTitle(summary.originalContent),
    status: summary.status,
    createdAt: summary.createdAt,
  };
}
