# =====================================================
# STAGE 1: BUILDER
# =====================================================
FROM python:3.14-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    pkg-config \
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Install CPU-only PyTorch to avoid downloading CUDA libraries
RUN pip install --no-cache-dir \
    torch torchvision \
    --index-url https://download.pytorch.org/whl/cpu

# Install application dependencies
RUN grep -v -E '^[[:space:]]*(torch|torchvision|ultralytics)([<=>~!].*)?$' \
    requirements.txt > /tmp/requirements-app.txt && \
    pip install --no-cache-dir -r /tmp/requirements-app.txt

# Install Ultralytics without allowing it to replace CPU-only PyTorch
RUN pip install --no-cache-dir --no-deps ultralytics==8.4.48


# =====================================================
# STAGE 2: RUNTIME
# =====================================================
FROM python:3.14-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 \
    libsqlite3-0 \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONFAULTHANDLER=1 \
    DB_PATH=/app/data/crusher_data.db \
    YOLO_CONFIG_DIR=/tmp/Ultralytics

RUN groupadd -r appuser && \
    useradd -r -g appuser -d /app -s /usr/sbin/nologin appuser && \
    mkdir -p /app/data /app/logs /app/debug_output /tmp/Ultralytics && \
    chown -R appuser:appuser /app /tmp/Ultralytics

COPY --chown=appuser:appuser . .

USER appuser

EXPOSE 8000

CMD ["python", "main.py"]
