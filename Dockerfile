# Stage 1: Dependencies and downloads
FROM node:20-bookworm-slim AS builder

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && mkdir -p /opt/noVNC/utils/websockify \
 && curl -fsSL https://github.com/novnc/noVNC/archive/refs/tags/v1.5.0.tar.gz | tar -xz --strip-components=1 -C /opt/noVNC \
 && curl -fsSL https://github.com/novnc/websockify/archive/refs/tags/v0.12.0.tar.gz | tar -xz --strip-components=1 -C /opt/noVNC/utils/websockify \
 && ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html \
 && rm -rf /opt/noVNC/docs /opt/noVNC/tests

# Stage 2: Final ultra-slim runtime image
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY_NUM=1 \
    DISPLAY=:1

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    openbox \
    x11-utils \
    chromium \
    fonts-wqy-zenhei \
    nodejs \
    python3 \
    procps \
 && find /usr/lib/chromium/locales -type f ! -name "en-US.pak" ! -name "zh-CN.pak" -delete \
 && rm -rf /usr/share/doc /usr/share/man /usr/share/info /usr/share/locale \
           /usr/share/icons /usr/share/mime \
           /usr/lib/chromium/chromedriver \
           /usr/lib/chromium/libvk_swiftshader.so \
           /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app
COPY --from=builder /opt/noVNC /opt/noVNC
COPY --from=builder /app/node_modules /app/node_modules
COPY package.json proxy.js xvfb_startup.sh openbox_startup.sh x11vnc_startup.sh novnc_startup.sh wrapper.sh /app/
RUN chmod +x /app/*.sh

EXPOSE 6080 8080

ENTRYPOINT ["/app/wrapper.sh"]
