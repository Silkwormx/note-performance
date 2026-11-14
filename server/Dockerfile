# Scan backend in one container: FastAPI + OpenCV cleanup + Audiveris 5.11 (AGPL-3.0)
# + English OCR data. Build from the repo root:
#   docker build -f server/Dockerfile -t note-scan .
#   docker run --rm -p 8840:8840 -e SCAN_KEY=choose-a-key note-scan
# Then open http://localhost:8840/scan.html?key=choose-a-key  (add a tunnel for your phone,
# see server/README.md). Needs ~1.5 GB RAM while a page is being read. x86-64 only
# (the Audiveris .deb is built for amd64; use --platform linux/amd64 on Apple Silicon).
FROM ubuntu:24.04
ARG AUDIVERIS_VERSION=5.11.0
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 NP_CACHE=/opt/np
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl python3 python3-venv poppler-utils \
      libasound2t64 libbsd0 libmd0 libx11-6 libxau6 libxcb1 libxdmcp6 libxext6 libxi6 libxrender1 libxtst6 zlib1g \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p $NP_CACHE/tessdata \
    && curl -fL -o /tmp/a.deb https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-ubuntu24.04-x86_64.deb \
    && dpkg-deb -x /tmp/a.deb $NP_CACHE/audiveris && rm /tmp/a.deb \
    && curl -fL -o $NP_CACHE/tessdata/eng.traineddata https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata
COPY server/requirements.txt /app/server/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r /app/server/requirements.txt
# the static app (player, scan page, editor) is served from the same address
COPY index.html scan.html editor.html manifest.webmanifest sw.js /app/
COPY css /app/css
COPY js /app/js
COPY fonts /app/fonts
COPY assets /app/assets
COPY songs /app/songs
COPY server/*.py /app/server/
WORKDIR /app/server
EXPOSE 8840
CMD ["/opt/venv/bin/uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8840"]
