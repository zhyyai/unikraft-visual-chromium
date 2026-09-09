FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    xvfb \
    x11vnc \
    openbox \
    x11-utils \
    python3 \
    python3-pip \
    binutils \
    build-essential \
    libcups2 \
    libnss3 \
    libatk1.0-0 \
    libnspr4 \
    libpango-1.0-0 \
    libasound2 \
    libatspi2.0-0 \
    libxdamage1 \
    libatk-bridge2.0-0 \
    libxkbcommon0 \
    libdrm2 \
    libxcomposite1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# Install noVNC & websockify
RUN git clone --depth 1 --branch v1.5.0 https://github.com/novnc/noVNC.git /opt/noVNC \
 && git clone --depth 1 --branch v0.12.0 https://github.com/novnc/websockify /opt/noVNC/utils/websockify \
 && ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html \
 && rm -rf /opt/noVNC/.git /opt/noVNC/utils/websockify/.git

WORKDIR /app

COPY package.json /app/
RUN npm install --omit=dev \
 && npx playwright install --with-deps chromium \
 && rm -rf /root/.cache/ms-playwright/chromium-*/chrome-linux/locales/* \
 && rm -rf /var/lib/apt/lists/* \
 && apt-get purge -y build-essential \
 && apt-get autoremove -y

COPY proxy.js xvfb_startup.sh openbox_startup.sh x11vnc_startup.sh novnc_startup.sh wrapper.sh /app/
RUN chmod +x /app/*.sh

EXPOSE 6080 8080

ENTRYPOINT ["/app/wrapper.sh"]
