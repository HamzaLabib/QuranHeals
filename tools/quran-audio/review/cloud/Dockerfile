# Quran Heals audio review dashboard (Phase 4.8.2): the private cloud service. Build context: the repository root.
# Only the files the server needs are copied (explicitly); no recording, review data or secret is in the image.
FROM node:24-bookworm-slim

# Python for the waveform tool (review/dashboard/peaks.py: numpy + miniaudio), in its own virtual environment.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/py \
 && /opt/py/bin/pip install --no-cache-dir "numpy>=2,<3" "miniaudio>=1.61,<2"

ENV NODE_ENV=production PYTHON=/opt/py/bin/python SCRATCH_DIR=/tmp/qh-audio-scratch PORT=10000
WORKDIR /app

COPY tools/quran-audio/review/cloud/package.json tools/quran-audio/review/cloud/package-lock.json tools/quran-audio/review/cloud/
RUN cd tools/quran-audio/review/cloud && npm ci --omit=dev --no-audit --no-fund

COPY tools/quran-audio/fingerprint.mjs tools/quran-audio/reciters.mjs tools/quran-audio/
COPY tools/quran-audio/review/manual/manual-lib.mjs tools/quran-audio/review/manual/export.mjs tools/quran-audio/review/manual/index.html tools/quran-audio/review/manual/
COPY tools/quran-audio/review/dashboard/dashboard-lib.mjs tools/quran-audio/review/dashboard/views.mjs tools/quran-audio/review/dashboard/dashboard.html tools/quran-audio/review/dashboard/peaks.py tools/quran-audio/review/dashboard/
COPY tools/quran-audio/review/cloud/server.mjs tools/quran-audio/review/cloud/db.mjs tools/quran-audio/review/cloud/pg-store.mjs tools/quran-audio/review/cloud/auth.mjs tools/quran-audio/review/cloud/audio.mjs tools/quran-audio/review/cloud/import.mjs tools/quran-audio/review/cloud/backup.mjs tools/quran-audio/review/cloud/migrate.mjs tools/quran-audio/review/cloud/registry.mjs tools/quran-audio/review/cloud/publisher.mjs tools/quran-audio/review/cloud/publication-rules.mjs tools/quran-audio/review/cloud/login.html tools/quran-audio/review/cloud/admin.html tools/quran-audio/review/cloud/
COPY tools/quran-verification/input/quran-uthmani.txt tools/quran-verification/input/quran-data.xml tools/quran-verification/input/

RUN mkdir -p /tmp/qh-audio-scratch && chown node:node /tmp/qh-audio-scratch
USER node
EXPOSE 10000
CMD ["node", "tools/quran-audio/review/cloud/server.mjs"]
