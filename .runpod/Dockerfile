FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

WORKDIR /app

COPY worker/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY worker /app/worker
COPY .runpod/handler.py /app/handler.py

ENV MODEL_CONFIG_PATH=/workspace/models/config/models.json
ENV DEFAULT_GUIDANCE_SCALE=1.8
ENV OUTPUT_FORMAT=PNG
ENV MAX_IMAGE_SIDE=1536

CMD ["python", "-u", "handler.py"]
