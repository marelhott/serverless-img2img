FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace frontend

COPY frontend /app/frontend
RUN npm run build --workspace frontend

FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

WORKDIR /app

COPY app_runtime/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app_runtime /app/app_runtime
COPY config /app/config
COPY pod/start.sh /app/start.sh
RUN chmod +x /app/start.sh
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

ENV PYTHONPATH=/app
ENV HOST=0.0.0.0
ENV PORT=8000
ENV MODEL_CONFIG_PATH=/workspace/models/config/models.json
ENV DEFAULT_GUIDANCE_SCALE=1.8
ENV OUTPUT_FORMAT=PNG
ENV MAX_IMAGE_SIDE=1536

EXPOSE 8000

CMD ["/bin/bash", "/app/start.sh"]
