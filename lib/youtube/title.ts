import { normalizeYouTubeUrl } from "@/lib/validators/youtube";

function extractVideoId(normalizedUrl: string): string | null {
  try {
    const parsed = new URL(normalizedUrl);
    const id = parsed.searchParams.get("v")?.trim();
    return id || null;
  } catch {
    return null;
  }
}

export interface YouTubeTitleResult {
  title: string;
  normalizedUrl: string;
  videoId: string | null;
}

export async function fetchYouTubeTitle(rawYouTubeUrl: string): Promise<YouTubeTitleResult | null> {
  const normalizedUrl = normalizeYouTubeUrl(rawYouTubeUrl);
  if (!normalizedUrl) {
    return null;
  }

  const videoId = extractVideoId(normalizedUrl);
  const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(normalizedUrl)}`;

  const response = await fetch(oembedUrl, {
    cache: "no-store",
    headers: {
      "User-Agent": "DocuSumm/1.0",
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { title?: string };
  const title = data.title?.trim();
  if (!title) {
    return null;
  }

  return { title, normalizedUrl, videoId };
}
