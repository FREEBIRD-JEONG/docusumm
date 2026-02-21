import { NextResponse } from "next/server";

import { normalizeYouTubeUrl } from "@/lib/validators/youtube";

export const dynamic = "force-dynamic";

function extractVideoId(normalizedUrl: string): string | null {
  try {
    const parsed = new URL(normalizedUrl);
    const id = parsed.searchParams.get("v")?.trim();
    return id || null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawYouTubeUrl = url.searchParams.get("url")?.trim() ?? "";
  const normalizedUrl = normalizeYouTubeUrl(rawYouTubeUrl);

  if (!normalizedUrl) {
    return NextResponse.json({ error: "유효한 YouTube URL이 아닙니다." }, { status: 422 });
  }

  const videoId = extractVideoId(normalizedUrl);
  const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(normalizedUrl)}`;

  try {
    const response = await fetch(oembedUrl, {
      cache: "no-store",
      headers: {
        "User-Agent": "DocuSumm/1.0",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "YouTube 제목을 조회하지 못했습니다.",
          normalizedUrl,
          videoId,
        },
        { status: response.status },
      );
    }

    const data = (await response.json()) as { title?: string };
    const title = data.title?.trim();
    if (!title) {
      return NextResponse.json(
        { error: "YouTube 제목이 비어 있습니다.", normalizedUrl, videoId },
        { status: 502 },
      );
    }

    return NextResponse.json({ title, normalizedUrl, videoId }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "YouTube 제목 조회 중 알 수 없는 오류가 발생했습니다.",
        normalizedUrl,
        videoId,
      },
      { status: 502 },
    );
  }
}
