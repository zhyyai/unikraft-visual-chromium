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
    chromium \
    python3 \
    nodejs \
    npm \
    build-essential \
 && rm -rf /var/lib/apt/lists/*

# Install noVNC & websockify
RUN git clone --depth 1 --branch v1.5.0 https://github.com/novnc/noVNC.git /opt/noVNC \
 && git clone --depth 1 --branch v0.12.0 https://github.com/novnc/websockify /opt/noVNC/utils/websockify \
 && ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html \
 && rm -rf /opt/noVNC/.git /opt/noVNC/utils/websockify/.git

WORKDIR /app

COPY package.json /app/
RUN npm install --omit=dev \
 && apt-get purge -y build-essential npm git \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* /root/.npm

COPY proxy.js xvfb_startup.sh openbox_startup.sh x11vnc_startup.sh novnc_startup.sh wrapper.sh /app/
RUN chmod +x /app/*.sh

EXPOSE 6080 8080

ENTRYPOINT ["/app/wrapper.sh"]
