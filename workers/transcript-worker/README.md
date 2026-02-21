# Transcript Worker

외부 배포용 YouTube 자막 수집 워커입니다.

## Endpoint

- `GET /healthz`
- `POST /v1/youtube-transcript`

### Request

```json
{
  "youtubeUrl": "https://www.youtube.com/watch?v=VIDEO_ID",
  "requestId": "worker-req-id",
  "preferredLanguages": ["ko", "en", "ja"],
  "maxChars": 14000
}
```

### Response (success)

```json
{
  "transcript": "자막 본문...",
  "videoId": "VIDEO_ID",
  "title": "영상 제목",
  "languageCode": "ko",
  "provider": "yt-dlp",
  "durationMs": 812
}
```

### Response (failure)

```json
{
  "code": "YOUTUBE_TRANSCRIPT_BLOCKED",
  "message": "YouTube 측 제한으로 자막을 수집하지 못했습니다.",
  "retryable": false
}
```

## Environment Variables

- `TRANSCRIPT_WORKER_KEY` (required): 요청 인증 키, `x-transcript-worker-key`와 일치해야 함
- `PORT` (optional, default `8080`)
- `YTDLP_PATH` (optional, default `yt-dlp`)
- `YTDLP_TIMEOUT_MS` (optional, default `45000`)
- `YTDLP_SUB_LANGS` (optional, default `ko.*,ko,en.*,en,ja.*,ja`)

## Local Run

```bash
TRANSCRIPT_WORKER_KEY=replace-me node workers/transcript-worker/server.mjs
```

## Container Run

```bash
docker build -f workers/transcript-worker/Dockerfile -t docusumm-transcript-worker .
docker run --rm -p 8080:8080 -e TRANSCRIPT_WORKER_KEY=replace-me docusumm-transcript-worker
```

