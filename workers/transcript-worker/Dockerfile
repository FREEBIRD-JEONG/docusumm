FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends yt-dlp ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY workers/transcript-worker/server.mjs ./server.mjs

ENV PORT=8080

CMD ["node", "server.mjs"]

