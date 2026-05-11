FROM runpod/pytorch:2.5.1-py3.11-cuda12.4.1-devel-ubuntu22.04

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY handler.py .
COPY config ./config

ENV MODEL_CONFIG_PATH=/workspace/models/config/models.json
ENV DEFAULT_GUIDANCE_SCALE=1.8
ENV DEFAULT_SCHEDULER=dpmpp_2m_karras
ENV OUTPUT_FORMAT=PNG

CMD ["python", "-u", "handler.py"]

