FROM node:20-slim

WORKDIR /app

# Create package.json for dependency management
RUN echo '{"type":"module","dependencies":{"qrcode":"^1.5","xlsx":"^0.18"}}' > package.json && npm install

# Copy application files
COPY shared/ ./shared/
COPY server.js .
COPY automations.js .
COPY logistics.js .
COPY notify.js .
COPY dashboard.js .
COPY ai_analysis.js .
COPY delivery_analysis.js .
COPY classify_skus.js .
COPY print_labels.js .
COPY rules_config.json .
COPY agents.json .
COPY public/ ./public/
COPY public/qrcodes/ ./public/qrcodes/

# Create directories for runtime data
RUN mkdir -p public/qrcodes

EXPOSE 3210

CMD ["node", "server.js"]
