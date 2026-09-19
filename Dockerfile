FROM node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

# Install the pinned yt-dlp runtime and media dependencies.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv curl ffmpeg \
    && ffmpeg -version \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/python -m pip install --no-cache-dir --require-hashes -r /tmp/requirements.txt \
    && rm -f /tmp/requirements.txt

ENV PATH="/opt/venv/bin:${PATH}" \
    YOUTUBE_DL_DIR=/opt/venv/bin \
    YOUTUBE_DL_SKIP_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build

# Create data directory for volume mapping
RUN mkdir -p /data/jobs /tmp
ENV DATA_DIR=/data/jobs
ENV TEMP_DIR=/tmp
ENV NODE_ENV=production

EXPOSE 3000

# Node bleibt der Container-Hauptprozess (PID 1), damit ein kontrollierter
# process.exit(0) den Container zuverlässig beendet.
CMD ["node", "dist/server.cjs"]
