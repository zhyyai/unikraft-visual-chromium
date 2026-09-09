FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    xvfb \
    x11vnc \
    openbox \
    x11-utils \
    chromium \
    python3 \
    nodejs \
    npm \
    build-essential \
    binutils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json /app/
RUN npm install --omit=dev \
 && apt-get purge -y build-essential npm \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* /root/.npm

# Install minimal noVNC and websockify without git history
RUN mkdir -p /opt/noVNC/utils/websockify \
 && curl -fsSL https://github.com/novnc/noVNC/archive/refs/tags/v1.5.0.tar.gz | tar -xz --strip-components=1 -C /opt/noVNC \
 && curl -fsSL https://github.com/novnc/websockify/archive/refs/tags/v0.12.0.tar.gz | tar -xz --strip-components=1 -C /opt/noVNC/utils/websockify \
 && ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html \
 && rm -rf /opt/noVNC/docs /opt/noVNC/tests

# Extreme rootfs slimming to fit Harbor 1.0 GiB quota:
# 1. Prune redundant chromium locales (keep only en-US and zh-CN)
RUN find /usr/lib/chromium/locales -type f ! -name "en-US.pak" ! -name "zh-CN.pak" -delete 2>/dev/null || true

# 2. Prune doc, man, info, icons, and unused components
RUN rm -rf /usr/share/doc /usr/share/man /usr/share/info /usr/share/locale \
           /usr/share/icons /usr/share/mime \
           /usr/lib/chromium/chromedriver 2>/dev/null || true

# 3. Strip all binaries and shared objects
RUN find /usr/lib/chromium -type f -exec strip -s {} + 2>/dev/null || true \
 && strip -s /usr/bin/node /usr/bin/Xvfb /usr/bin/x11vnc /usr/bin/openbox 2>/dev/null || true \
 && find /usr/lib/x86_64-linux-gnu -type f -name "*.so*" -exec strip -s {} + 2>/dev/null || true

COPY proxy.js xvfb_startup.sh openbox_startup.sh x11vnc_startup.sh novnc_startup.sh wrapper.sh /app/
RUN chmod +x /app/*.sh

EXPOSE 6080 8080

ENTRYPOINT ["/app/wrapper.sh"]
