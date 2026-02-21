import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT || 8080);
const MAX_BODY_BYTES = 1_000_000;
const DEFAULT_MAX_CHARS = 14_000;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_LANGUAGES = ["ko", "en", "ja"];

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function normalizeYouTubeUrl(rawUrl) {
  if (typeof rawUrl !== "string") {
    return null;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  const supportedHosts = new Set(["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);
  if (!supportedHosts.has(hostname)) {
    return null;
  }

  if (hostname === "youtu.be") {
    const id = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) {
      return null;
    }
    return `https://www.youtube.com/watch?v=${id}`;
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  let videoId = parsed.searchParams.get("v") ?? "";
  if (path !== "/watch") {
    const segments = path.split("/").filter(Boolean);
    if (segments.length >= 2 && ["shorts", "embed", "live", "v"].includes(segments[0])) {
      videoId = segments[1] ?? "";
    }
  }
  if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId)) {
    return null;
  }

  return `https://www.youtube.com/watch?v=${videoId}`;
}

function extractVideoId(normalizedUrl) {
  return new URL(normalizedUrl).searchParams.get("v");
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const parsed = Number.parseInt(code, 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : "";
    });
}

function normalizeChunk(value) {
  const normalized = value.replace(/\r/g, " ").replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  if (/^\[[^\]]+\]$/.test(normalized)) {
    return "";
  }

  return normalized;
}

function parseVttTranscript(raw) {
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

  const unique = [];
  for (const line of lines) {
    if (unique[unique.length - 1] !== line) {
      unique.push(line);
    }
  }

  return unique.join(" ").replace(/\s+/g, " ").trim();
}

function scoreSubtitleFile(name) {
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

function detectLanguageCode(fileName) {
  const lowered = fileName.toLowerCase();
  if (lowered.includes(".ko.")) {
    return "ko";
  }
  if (lowered.includes(".en.")) {
    return "en";
  }
  if (lowered.includes(".ja.")) {
    return "ja";
  }
  const match = lowered.match(/\.([a-z]{2,3}(?:-[a-z0-9]+)?)\.vtt$/);
  return match?.[1] ?? "(yt-dlp)";
}

async function parseBestSubtitleFile(workDir) {
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
    return { file, transcript, vttCount: vttFiles.length };
  }

  return { file: null, transcript: "", vttCount: vttFiles.length };
}

function clipText(value, maxChars) {
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

function resolveMaxChars(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_CHARS;
  }
  const normalized = Math.floor(value);
  if (normalized < 1_000) {
    return 1_000;
  }
  if (normalized > 50_000) {
    return 50_000;
  }
  return normalized;
}

function resolveTimeoutMs() {
  const parsed = Number(process.env.YTDLP_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.floor(parsed);
}

function resolveSubLangs(preferredLanguages) {
  const fromEnv = process.env.YTDLP_SUB_LANGS?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const normalized = Array.isArray(preferredLanguages)
    ? preferredLanguages
        .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
        .filter(Boolean)
        .filter((entry, index, all) => all.indexOf(entry) === index)
    : [];
  const languages = normalized.length > 0 ? normalized : DEFAULT_LANGUAGES;

  const parts = [];
  for (const language of languages) {
    parts.push(`${language}.*`, language);
  }
  return parts.join(",");
}

function shouldTreatAsBlocked(stderr) {
  const lowered = stderr.toLowerCase();
  return (
    lowered.includes("too many requests") ||
    lowered.includes("http error 429") ||
    lowered.includes("sign in to confirm") ||
    lowered.includes("captcha") ||
    lowered.includes("use --cookies-from-browser")
  );
}

function runProcess(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 8_000) {
        stdout = stdout.slice(-8_000);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8_000) {
        stderr = stderr.slice(-8_000);
      }
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

async function fetchVideoTitle(youtubeUrl) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtubeUrl)}`;
    const response = await fetch(oembedUrl, { cache: "no-store" });
    if (!response.ok) {
      return "(확인 불가)";
    }
    const payload = await response.json();
    if (payload && typeof payload.title === "string" && payload.title.trim()) {
      return payload.title.trim();
    }
  } catch {
    return "(확인 불가)";
  }

  return "(확인 불가)";
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("request body too large");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

async function handleTranscriptRequest(request, response) {
  const workerKey = process.env.TRANSCRIPT_WORKER_KEY?.trim();
  if (!workerKey) {
    sendJson(response, 503, {
      code: "TRANSCRIPT_WORKER_UNAVAILABLE",
      message: "TRANSCRIPT_WORKER_KEY가 설정되지 않았습니다.",
      retryable: true,
    });
    return;
  }

  const providedKey = request.headers["x-transcript-worker-key"];
  if (providedKey !== workerKey) {
    sendJson(response, 401, {
      code: "TRANSCRIPT_WORKER_UNAVAILABLE",
      message: "Unauthorized transcript worker request",
      retryable: false,
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, {
      code: "YOUTUBE_URL_INVALID",
      message: error instanceof Error ? error.message : "invalid request body",
      retryable: false,
    });
    return;
  }

  const normalizedUrl = normalizeYouTubeUrl(body.youtubeUrl);
  if (!normalizedUrl) {
    sendJson(response, 422, {
      code: "YOUTUBE_URL_INVALID",
      message: "유효한 YouTube URL이 아닙니다.",
      retryable: false,
    });
    return;
  }

  const videoId = extractVideoId(normalizedUrl);
  if (!videoId) {
    sendJson(response, 422, {
      code: "YOUTUBE_URL_INVALID",
      message: "영상 ID를 추출하지 못했습니다.",
      retryable: false,
    });
    return;
  }

  const startedAt = Date.now();
  const requestId = typeof body.requestId === "string" && body.requestId.trim() ? body.requestId.trim() : crypto.randomUUID();
  const maxChars = resolveMaxChars(body.maxChars);
  const subLangs = resolveSubLangs(body.preferredLanguages);
  const ytDlpPath = process.env.YTDLP_PATH?.trim() || "yt-dlp";
  const timeoutMs = resolveTimeoutMs();
  const workDir = await mkdtemp(join(tmpdir(), "docusumm-remote-ytdlp-"));
  const outputTemplate = join(workDir, `${videoId}.%(ext)s`);

  try {
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
      normalizedUrl,
    ];

    const runResult = await runProcess(ytDlpPath, args, timeoutMs);
    const parsed = await parseBestSubtitleFile(workDir);

    if (!parsed.transcript) {
      if (runResult.timedOut) {
        sendJson(response, 504, {
          code: "TRANSCRIPT_WORKER_TIMEOUT",
          message: `yt-dlp 실행이 ${timeoutMs}ms를 초과했습니다.`,
          retryable: true,
        });
        return;
      }

      if (shouldTreatAsBlocked(runResult.stderr)) {
        sendJson(response, 502, {
          code: "YOUTUBE_TRANSCRIPT_BLOCKED",
          message: "YouTube 측 제한으로 자막을 수집하지 못했습니다.",
          retryable: false,
        });
        return;
      }

      if (parsed.vttCount === 0) {
        sendJson(response, 422, {
          code: "YOUTUBE_TRANSCRIPT_UNAVAILABLE",
          message: "영상에서 사용 가능한 자막을 찾지 못했습니다.",
          retryable: false,
        });
        return;
      }

      sendJson(response, 502, {
        code: "YOUTUBE_TRANSCRIPT_FETCH_FAILED",
        message: "yt-dlp로 자막 파일을 파싱하지 못했습니다.",
        retryable: true,
      });
      return;
    }

    const title = await fetchVideoTitle(normalizedUrl);
    const transcript = clipText(parsed.transcript, maxChars);
    const durationMs = Date.now() - startedAt;
    sendJson(response, 200, {
      transcript,
      videoId,
      title,
      languageCode: detectLanguageCode(parsed.file ?? ""),
      provider: "yt-dlp",
      durationMs,
      requestId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    sendJson(response, 503, {
      code: "TRANSCRIPT_WORKER_UNAVAILABLE",
      message: `transcript worker runtime error: ${message}`,
      retryable: true,
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const server = createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 404, { error: "Not Found" });
    return;
  }

  const { pathname } = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (pathname === "/healthz" && request.method === "GET") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === "/v1/youtube-transcript" && request.method === "POST") {
    await handleTranscriptRequest(request, response);
    return;
  }

  sendJson(response, 404, { error: "Not Found" });
});

server.listen(PORT, () => {
  console.info(`[transcript-worker] listening on :${PORT}`);
});

