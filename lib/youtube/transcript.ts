import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AppError } from "@/lib/errors/app-error";
import { normalizeYouTubeUrl } from "@/lib/validators/youtube";

interface CaptionTrack {
  baseUrl?: string;
  kind?: string;
  languageCode?: string;
}

interface PlayerResponse {
  videoDetails?: {
    title?: string;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
    };
  };
}

export interface YouTubePromptContext {
  promptInput: string;
  transcript: string;
  normalizedUrl: string;
  videoId: string;
  title: string;
  languageCode: string;
}

interface TranscriptPayload {
  events?: Array<{
    segs?: Array<{
      utf8?: string;
    }>;
  }>;
}

const WATCH_TIMEOUT_MS = 12_000;
const TRANSCRIPT_TIMEOUT_MS = 12_000;
const TRANSCRIPT_MAX_CHARS = 14_000;
const YTDLP_TIMEOUT_MS = 45_000;
const NO_TRACK_LANGUAGE_CANDIDATES = ["ko", "en", "ja"];

const INNERTUBE_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player";
const INNERTUBE_CLIENT_NAME = "WEB";
const INNERTUBE_CLIENT_VERSION = "2.20231219.01.00";

const PLAYER_RESPONSE_MARKERS = [
  "var ytInitialPlayerResponse = ",
  "ytInitialPlayerResponse = ",
  'window["ytInitialPlayerResponse"] = ',
];
const BLOCKED_BODY_MARKERS = [
  "consent.youtube.com",
  "before you continue to youtube",
  "sign in to confirm you",
  "unusual traffic",
  "detected unusual traffic",
  "www.google.com/sorry",
  "captcha",
  "automated queries",
];

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const clipped = value.slice(0, maxChars);
  const boundary = clipped.lastIndexOf(" ");
  if (boundary > maxChars * 0.7) {
    return `${clipped.slice(0, boundary).trim()}...`;
  }
  return `${clipped.trim()}...`;
}

function normalizeChunk(value: string): string {
  const normalized = value.replace(/\r/g, " ").replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  if (/^\[[^\]]+\]$/.test(normalized)) {
    return "";
  }

  return normalized;
}

function extractJsonBlock(source: string, fromIndex: number): string | null {
  const start = source.indexOf("{", fromIndex);
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char !== "}") {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }

  return null;
}

function extractPlayerResponse(html: string): PlayerResponse | null {
  for (const marker of PLAYER_RESPONSE_MARKERS) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) {
      continue;
    }

    const block = extractJsonBlock(html, markerIndex + marker.length);
    if (!block) {
      continue;
    }

    try {
      const parsed = JSON.parse(block) as PlayerResponse;
      return parsed;
    } catch {
      continue;
    }
  }

  return null;
}

function scoreCaptionTrack(track: CaptionTrack): number {
  const languageCode = track.languageCode?.toLowerCase() ?? "";
  let score = 10;
  if (languageCode.startsWith("ko")) {
    score = 100;
  } else if (languageCode.startsWith("en")) {
    score = 90;
  } else if (languageCode.startsWith("ja")) {
    score = 70;
  }
  if (track.kind === "asr") {
    score -= 5;
  }
  return score;
}

function rankCaptionTracks(captionTracks: CaptionTrack[]): CaptionTrack[] {
  if (captionTracks.length === 0) {
    return [];
  }

  return captionTracks
    .filter((track) => typeof track.baseUrl === "string" && track.baseUrl.length > 0)
    .sort((left, right) => scoreCaptionTrack(right) - scoreCaptionTrack(left));
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
      headers: {
        accept:
          "text/plain,text/vtt,application/json,application/xml,text/xml,text/html;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        origin: "https://www.youtube.com",
        referer: "https://www.youtube.com/",
        cookie: "CONSENT=YES+cb.20210328-17-p0.en+FX+667; SOCS=CAI; PREF=hl=ko",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPlayerResponseViaInnertube(videoId: string): Promise<PlayerResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WATCH_TIMEOUT_MS);
  try {
    const response = await fetch(INNERTUBE_PLAYER_URL, {
      method: "POST",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        accept: "*/*",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        origin: "https://www.youtube.com",
        referer: "https://www.youtube.com/",
        "x-youtube-client-name": "1",
        "x-youtube-client-version": INNERTUBE_CLIENT_VERSION,
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: INNERTUBE_CLIENT_NAME,
            clientVersion: INNERTUBE_CLIENT_VERSION,
            hl: "ko",
            gl: "KR",
          },
        },
      }),
    });

    if (!response.ok) {
      console.info("[youtube-transcript] innertube player not ok", {
        videoId,
        status: response.status,
      });
      return null;
    }

    const data = (await response.json()) as PlayerResponse;
    if (!data?.videoDetails && !data?.captions) {
      return null;
    }
    return data;
  } catch (error) {
    console.info("[youtube-transcript] innertube player failed", {
      videoId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPlayerResponse(videoId: string): Promise<PlayerResponse> {
  // Innertube API 우선 시도 (JSON 기반, HTML 파싱 불필요, 서버 차단 우회에 강함)
  const innertubeResponse = await fetchPlayerResponseViaInnertube(videoId);
  if (innertubeResponse) {
    return innertubeResponse;
  }

  // 폴백: watch 페이지 HTML에서 ytInitialPlayerResponse 추출
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=ko`;

  let response: Response;
  try {
    response = await fetchWithTimeout(watchUrl, WATCH_TIMEOUT_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    throw new AppError(
      `YouTube 메타데이터 요청 실패: ${message}`,
      "YOUTUBE_METADATA_FETCH_FAILED",
      502,
    );
  }

  if (!response.ok) {
    throw new AppError(
      `YouTube 메타데이터 응답 실패 (${response.status})`,
      "YOUTUBE_METADATA_FETCH_FAILED",
      502,
    );
  }

  const html = await response.text();
  const blockedByWatchPage = isBlockedWatchHtmlResponse(
    response.headers.get("content-type"),
    html,
    response.url,
  );
  const playerResponse = extractPlayerResponse(html);
  if (!playerResponse) {
    if (blockedByWatchPage) {
      throw new AppError(
        "YouTube가 서버 요청을 차단해 영상 정보를 가져오지 못했습니다.",
        "YOUTUBE_TRANSCRIPT_BLOCKED",
        502,
      );
    }
    throw new AppError(
      "YouTube 메타데이터를 파싱하지 못했습니다.",
      "YOUTUBE_METADATA_FETCH_FAILED",
      502,
    );
  }

  return playerResponse;
}

function extractTranscriptText(payload: TranscriptPayload): string {
  const chunks: string[] = [];

  for (const event of payload.events ?? []) {
    for (const segment of event.segs ?? []) {
      const value = normalizeChunk(segment.utf8 ?? "");
      if (!value) {
        continue;
      }

      if (chunks[chunks.length - 1] === value) {
        continue;
      }
      chunks.push(value);
    }
  }

  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => {
      const parsed = Number.parseInt(code, 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : "";
    });
}

function parseXmlTranscript(raw: string): string {
  const chunks: string[] = [];
  const regex = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
  let match: RegExpExecArray | null = regex.exec(raw);

  while (match) {
    const value = normalizeChunk(decodeHtmlEntities(match[1] ?? ""));
    if (value && chunks[chunks.length - 1] !== value) {
      chunks.push(value);
    }
    match = regex.exec(raw);
  }

  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function parseVttTranscript(raw: string): string {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^WEBVTT$/i.test(line))
    .filter((line) => !/^kind:\s+/i.test(line))
    .filter((line) => !/^language:\s+/i.test(line))
    .filter((line) => !/^note(\s|$)/i.test(line))
    .filter((line) => !/^(style|region)(\s|$)/i.test(line))
    .filter((line) => !/^\d+$/.test(line))
    .filter(
      (line) =>
        !/^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}(\s+.+)?$/.test(line),
    )
    .filter((line) => !/^\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}\.\d{3}(\s+.+)?$/.test(line))
    .map((line) => line.replace(/<[^>]+>/g, ""))
    .map((line) => normalizeChunk(decodeHtmlEntities(line)))
    .filter(Boolean);

  const unique: string[] = [];
  for (const line of lines) {
    if (unique[unique.length - 1] !== line) {
      unique.push(line);
    }
  }

  return unique.join(" ").replace(/\s+/g, " ").trim();
}

function parseTranscriptFromBody(rawBody: string, contentType: string | null): string {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return "";
  }

  const loweredContentType = (contentType ?? "").toLowerCase();
  if (loweredContentType.includes("application/json") || trimmed.startsWith("{")) {
    try {
      const payload = JSON.parse(trimmed) as TranscriptPayload;
      return extractTranscriptText(payload);
    } catch {
      return "";
    }
  }

  if (
    loweredContentType.includes("text/xml") ||
    loweredContentType.includes("application/xml") ||
    trimmed.startsWith("<")
  ) {
    return parseXmlTranscript(trimmed);
  }

  return parseVttTranscript(trimmed);
}

function isTranscriptUnavailableResponse(status: number, body: string): boolean {
  if (status === 404 || status === 410) {
    return true;
  }

  const lowered = body.toLowerCase();
  return (
    lowered.includes("transcript is unavailable") ||
    lowered.includes("captions are not available") ||
    lowered.includes("<transcript/>") ||
    lowered.includes("<transcript></transcript>")
  );
}

function isBlockedHtmlResponse(
  contentType: string | null,
  body: string,
  responseUrl: string | undefined,
): boolean {
  const loweredBody = body.toLowerCase();
  const looksLikeHtml = isHtmlLikeBody(contentType, loweredBody);

  if (!looksLikeHtml) {
    return false;
  }

  if (responseUrl?.includes("/api/timedtext")) {
    return true;
  }

  if (body.trim().length === 0) {
    return true;
  }

  return includesBlockedBodyMarker(loweredBody);
}

function isBlockedWatchHtmlResponse(
  contentType: string | null,
  body: string,
  responseUrl: string | undefined,
): boolean {
  const loweredBody = body.toLowerCase();
  const looksLikeHtml = isHtmlLikeBody(contentType, loweredBody);
  if (!looksLikeHtml) {
    return false;
  }

  if (responseUrl?.includes("consent.youtube.com") || responseUrl?.includes("google.com/sorry")) {
    return true;
  }

  if (body.trim().length === 0) {
    return true;
  }

  return includesBlockedBodyMarker(loweredBody);
}

function isHtmlLikeBody(contentType: string | null, loweredBody: string): boolean {
  const loweredContentType = (contentType ?? "").toLowerCase();
  return (
    loweredContentType.includes("text/html") ||
    loweredBody.includes("<html") ||
    loweredBody.includes("<!doctype html")
  );
}

function includesBlockedBodyMarker(loweredBody: string): boolean {
  return BLOCKED_BODY_MARKERS.some((marker) => loweredBody.includes(marker));
}

function summarizeBodyHead(rawBody: string): string {
  return rawBody.replace(/\s+/g, " ").slice(0, 220).trim();
}

function buildUnsignedCaptionUrl(videoId: string, track: CaptionTrack, format?: "json3" | "vtt"): string {
  const url = new URL("https://www.youtube.com/api/timedtext");
  url.searchParams.set("v", videoId);

  const languageCode = track.languageCode?.trim();
  if (languageCode) {
    url.searchParams.set("lang", languageCode);
  }

  if (track.kind) {
    url.searchParams.set("kind", track.kind);
  }

  if (format) {
    url.searchParams.set("fmt", format);
  }

  return url.toString();
}

function scoreSubtitleFile(name: string): number {
  const lowered = name.toLowerCase();
  if (lowered.includes(".ko.")) {
    return 100;
  }
  if (lowered.includes(".en.")) {
    return 90;
  }
  if (lowered.includes(".ja.")) {
    return 70;
  }
  return 10;
}

interface ParsedSubtitleFile {
  file: string;
  transcript: string;
}

async function parseBestSubtitleFile(workDir: string): Promise<{
  parsed: ParsedSubtitleFile | null;
  vttCount: number;
}> {
  const files = await readdir(workDir);
  const vttFiles = files
    .filter((file) => file.toLowerCase().endsWith(".vtt"))
    .sort((left, right) => scoreSubtitleFile(right) - scoreSubtitleFile(left));

  for (const file of vttFiles) {
    const fullPath = join(workDir, file);
    const raw = await readFile(fullPath, "utf8");
    const transcript = parseVttTranscript(raw);
    if (!transcript) {
      continue;
    }
    return {
      parsed: {
        file,
        transcript,
      },
      vttCount: vttFiles.length,
    };
  }

  return {
    parsed: null,
    vttCount: vttFiles.length,
  };
}

function shouldRetryYtDlpWithCookies(stderr: string): boolean {
  const lowered = stderr.toLowerCase();
  return (
    lowered.includes("too many requests") ||
    lowered.includes("http error 429") ||
    lowered.includes("sign in to confirm") ||
    lowered.includes("use --cookies-from-browser") ||
    lowered.includes("captcha") ||
    lowered.includes("unable to download video subtitles")
  );
}

function resolveAutoCookieBrowsers(): string[] {
  const raw = process.env.YTDLP_AUTO_COOKIES_BROWSERS?.trim() || "chrome,brave,safari,firefox";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 4000) {
        stdout = stdout.slice(-4000);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) {
        stderr = stderr.slice(-4000);
      }
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function fetchTranscriptWithYtDlp(videoId: string): Promise<string | null> {
  if (process.env.YTDLP_DISABLED === "1") {
    return null;
  }

  const workDir = await mkdtemp(join(tmpdir(), "docusumm-ytdlp-"));
  const outputTemplate = join(workDir, `${videoId}.%(ext)s`);
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const subLangs = process.env.YTDLP_SUB_LANGS?.trim() || "ko.*,ko,en.*,en";
  const ytDlpPath = process.env.YTDLP_PATH?.trim() || "yt-dlp";
  const explicitCookiesFromBrowser = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim() || null;
  const autoCookieBrowsers = resolveAutoCookieBrowsers();
  const cookieCandidates = explicitCookiesFromBrowser
    ? [{ browser: explicitCookiesFromBrowser, source: "explicit" as const }]
    : [
        { browser: null as string | null, source: "none" as const },
        ...autoCookieBrowsers.map((browser) => ({ browser, source: "auto" as const })),
      ];

  try {
    for (let index = 0; index < cookieCandidates.length; index += 1) {
      const attempt = cookieCandidates[index];
      const args = [
        "--skip-download",
        "--write-auto-subs",
        "--write-subs",
        "--sub-format",
        "vtt",
        "--sub-langs",
        subLangs,
        "--output",
        outputTemplate,
        "--no-warnings",
        "--no-progress",
        "--restrict-filenames",
        videoUrl,
      ];

      if (attempt.browser) {
        args.unshift(attempt.browser);
        args.unshift("--cookies-from-browser");
      }

      const { code, stderr } = await runProcess(ytDlpPath, args, YTDLP_TIMEOUT_MS);
      const { parsed, vttCount } = await parseBestSubtitleFile(workDir);
      const retryWithCookies = shouldRetryYtDlpWithCookies(stderr);
      console.info("[youtube-transcript] yt-dlp result", {
        attemptIndex: index,
        code,
        stderrHead: summarizeBodyHead(stderr),
        workDir,
        subLangs,
        cookiesFromBrowser: attempt.browser,
        cookiesSource: attempt.source,
        retryWithCookies,
        vttCount,
        parsedFile: parsed?.file ?? null,
      });

      // yt-dlp may exit non-zero when one requested language fails (e.g., en 429)
      // even though another language subtitle file was saved successfully.
      if (parsed) {
        console.info("[youtube-transcript] yt-dlp parsed", {
          attemptIndex: index,
          file: parsed.file,
          transcriptChars: parsed.transcript.length,
          exitCode: code,
        });
        return clipText(parsed.transcript, TRANSCRIPT_MAX_CHARS);
      }

      if (explicitCookiesFromBrowser) {
        continue;
      }

      if (!retryWithCookies && attempt.source === "none") {
        break;
      }
    }

    return null;
  } catch (error) {
    console.info("[youtube-transcript] yt-dlp failed", {
      message: error instanceof Error ? error.message : "unknown",
      workDir,
    });
    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function fetchTranscript(
  track: CaptionTrack,
  videoId: string,
  options?: { skipYtDlpFallback?: boolean },
): Promise<string> {
  const baseUrl = track.baseUrl;

  const candidates: string[] = [];
  const pushCandidate = (url: string) => {
    if (!url || candidates.includes(url)) {
      return;
    }
    candidates.push(url);
  };

  if (baseUrl) {
    pushCandidate(baseUrl);
    try {
      const json3Url = new URL(baseUrl);
      json3Url.searchParams.set("fmt", "json3");
      pushCandidate(json3Url.toString());

      const vttUrl = new URL(baseUrl);
      vttUrl.searchParams.set("fmt", "vtt");
      pushCandidate(vttUrl.toString());
    } catch {
      // Keep original URL fallback only.
    }
  }

  pushCandidate(buildUnsignedCaptionUrl(videoId, track, "json3"));
  pushCandidate(buildUnsignedCaptionUrl(videoId, track, "vtt"));
  pushCandidate(buildUnsignedCaptionUrl(videoId, track));

  let lastFetchError: AppError | null = null;
  let sawUnavailable = false;
  let sawBlocked = false;

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const transcriptUrl = candidates[candidateIndex];
    try {
      const response = await fetchWithTimeout(transcriptUrl, TRANSCRIPT_TIMEOUT_MS);
      const rawBody = await response.text();
      const bodyHead = summarizeBodyHead(rawBody);

      if (!response.ok) {
        console.info("[youtube-transcript] candidate not ok", {
          candidateIndex,
          status: response.status,
          responseUrl: response.url,
          contentType: response.headers.get("content-type"),
          bodyHead,
          languageCode: track.languageCode ?? null,
          kind: track.kind ?? null,
        });
        if (isTranscriptUnavailableResponse(response.status, rawBody)) {
          sawUnavailable = true;
          continue;
        }
        if (isBlockedHtmlResponse(response.headers.get("content-type"), rawBody, response.url)) {
          sawBlocked = true;
          continue;
        }
        lastFetchError = new AppError(
          `YouTube 자막 응답 실패 (${response.status})`,
          "YOUTUBE_TRANSCRIPT_FETCH_FAILED",
          502,
        );
        continue;
      }

      const transcript = parseTranscriptFromBody(rawBody, response.headers.get("content-type"));
      if (transcript) {
        console.info("[youtube-transcript] candidate parsed", {
          candidateIndex,
          responseUrl: response.url,
          contentType: response.headers.get("content-type"),
          transcriptChars: transcript.length,
          languageCode: track.languageCode ?? null,
          kind: track.kind ?? null,
        });
        return clipText(transcript, TRANSCRIPT_MAX_CHARS);
      }

      console.info("[youtube-transcript] candidate parse empty", {
        candidateIndex,
        status: response.status,
        responseUrl: response.url,
        contentType: response.headers.get("content-type"),
        bodyHead,
        languageCode: track.languageCode ?? null,
        kind: track.kind ?? null,
      });
      if (isTranscriptUnavailableResponse(response.status, rawBody)) {
        sawUnavailable = true;
        continue;
      }
      if (isBlockedHtmlResponse(response.headers.get("content-type"), rawBody, response.url)) {
        sawBlocked = true;
        continue;
      }

      lastFetchError = new AppError(
        "YouTube 자막 본문을 파싱하지 못했습니다.",
        "YOUTUBE_TRANSCRIPT_FETCH_FAILED",
        502,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      console.info("[youtube-transcript] candidate request failed", {
        candidateIndex,
        transcriptUrl,
        message,
        languageCode: track.languageCode ?? null,
        kind: track.kind ?? null,
      });
      lastFetchError = new AppError(
        `YouTube 자막 요청 실패: ${message}`,
        "YOUTUBE_TRANSCRIPT_FETCH_FAILED",
        502,
      );
    }
  }

  if (sawBlocked && !options?.skipYtDlpFallback) {
    const fallbackTranscript = await fetchTranscriptWithYtDlp(videoId);
    if (fallbackTranscript) {
      return fallbackTranscript;
    }
  }

  if (sawBlocked) {
    throw new AppError(
      "YouTube가 서버 요청을 차단해 자막을 가져오지 못했습니다.",
      "YOUTUBE_TRANSCRIPT_BLOCKED",
      502,
    );
  }

  if (sawUnavailable) {
    throw new AppError(
      "영상에서 사용 가능한 자막을 찾지 못했습니다.",
      "YOUTUBE_TRANSCRIPT_UNAVAILABLE",
      422,
    );
  }

  throw (
    lastFetchError ??
    new AppError(
      "YouTube 자막을 불러오지 못했습니다.",
      "YOUTUBE_TRANSCRIPT_FETCH_FAILED",
      502,
    )
  );
}

export async function buildYouTubePromptContext(content: string): Promise<YouTubePromptContext> {
  const normalizedUrl = normalizeYouTubeUrl(content);
  if (!normalizedUrl) {
    throw new AppError("유효한 YouTube URL이 아닙니다.", "YOUTUBE_URL_INVALID", 422);
  }

  const videoId = new URL(normalizedUrl).searchParams.get("v");
  if (!videoId) {
    throw new AppError("영상 ID를 추출하지 못했습니다.", "YOUTUBE_URL_INVALID", 422);
  }

  const playerResponse = await fetchPlayerResponse(videoId);
  const captionTracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const rankedTracks = rankCaptionTracks(captionTracks);

  let selectedTrack: CaptionTrack | null = null;
  let transcript = "";
  let blockedError: AppError | null = null;
  let unavailableError: AppError | null = null;
  let lastTranscriptError: AppError | null = null;

  if (rankedTracks.length === 0) {
    for (let languageIndex = 0; languageIndex < NO_TRACK_LANGUAGE_CANDIDATES.length; languageIndex += 1) {
      const languageCode = NO_TRACK_LANGUAGE_CANDIDATES[languageIndex];
      const syntheticTrack: CaptionTrack = { languageCode };
      try {
        transcript = await fetchTranscript(syntheticTrack, videoId, { skipYtDlpFallback: true });
        selectedTrack = syntheticTrack;
        break;
      } catch (error) {
        if (!(error instanceof AppError)) {
          throw error;
        }

        lastTranscriptError = error;
        if (error.code === "YOUTUBE_TRANSCRIPT_BLOCKED") {
          blockedError = blockedError ?? error;
        }
        if (error.code === "YOUTUBE_TRANSCRIPT_UNAVAILABLE") {
          unavailableError = unavailableError ?? error;
        }

        console.info("[youtube-transcript] no-track attempt failed", {
          languageIndex,
          languageCode,
          errorCode: error.code,
        });
      }
    }

    if (!transcript && blockedError) {
      const fallbackTranscript = await fetchTranscriptWithYtDlp(videoId);
      if (fallbackTranscript) {
        transcript = fallbackTranscript;
      }
    }
  } else {
    for (let trackIndex = 0; trackIndex < rankedTracks.length; trackIndex += 1) {
      const track = rankedTracks[trackIndex];
      try {
        transcript = await fetchTranscript(track, videoId, { skipYtDlpFallback: true });
        selectedTrack = track;
        break;
      } catch (error) {
        if (!(error instanceof AppError)) {
          throw error;
        }

        lastTranscriptError = error;
        if (error.code === "YOUTUBE_TRANSCRIPT_BLOCKED") {
          blockedError = blockedError ?? error;
        }
        if (error.code === "YOUTUBE_TRANSCRIPT_UNAVAILABLE") {
          unavailableError = unavailableError ?? error;
        }

        console.info("[youtube-transcript] track attempt failed", {
          trackIndex,
          languageCode: track.languageCode ?? null,
          kind: track.kind ?? null,
          errorCode: error.code,
        });
      }
    }

    if (!transcript && blockedError) {
      const fallbackTranscript = await fetchTranscriptWithYtDlp(videoId);
      if (fallbackTranscript) {
        transcript = fallbackTranscript;
        selectedTrack = selectedTrack ?? rankedTracks[0];
      }
    }
  }

  if (!transcript) {
    throw (
      blockedError ??
      unavailableError ??
      lastTranscriptError ??
      new AppError(
        "YouTube 자막을 불러오지 못했습니다.",
        "YOUTUBE_TRANSCRIPT_FETCH_FAILED",
        502,
      )
    );
  }

  if (!selectedTrack) {
    selectedTrack = rankedTracks[0] ?? null;
  }

  const title = playerResponse.videoDetails?.title?.trim() || "(확인 불가)";
  const languageCode = selectedTrack?.languageCode?.trim() || "(yt-dlp)";

  const promptInput = [
    `YouTube URL: ${normalizedUrl}`,
    `영상 ID: ${videoId}`,
    `영상 제목: ${title}`,
    `자막 언어: ${languageCode}`,
    "",
    "영상 자막 텍스트:",
    transcript,
  ].join("\n");

  return {
    promptInput,
    transcript,
    normalizedUrl,
    videoId,
    title,
    languageCode,
  };
}

export async function buildYouTubePromptInput(content: string): Promise<string> {
  const context = await buildYouTubePromptContext(content);
  return context.promptInput;
}

export const __testables = {
  isBlockedHtmlResponse,
  isBlockedWatchHtmlResponse,
  parseTranscriptFromBody,
  parseXmlTranscript,
  parseVttTranscript,
  parseBestSubtitleFile,
  rankCaptionTracks,
};
