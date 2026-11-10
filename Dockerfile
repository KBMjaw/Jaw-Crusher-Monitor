w# =====================================================
# STAGE 1: BUILDER
# =====================================================
FROM python:3.14-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    pkg-config \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Create isolated Python environment
RUN python -m venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"

# Copy dependency file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt


# =====================================================
# STAGE 2: PRODUCTION RUNTIME
# =====================================================
FROM python:3.14-slim AS runtime

WORKDIR /app

# Install runtime system libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# Copy Python environment
COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONFAULTHANDLER=1

# Application configuration
ENV DB_PATH=/app/data/crusher_data.db
ENV YOLO_CONFIG_DIR=/tmp/Ultralytics

# Create non-root user
RUN groupadd -r appuser && \
    useradd -r -g appuser -d /app -s /usr/sbin/nologin appuser

# Create runtime directories
RUN mkdir -p /app/data \
    /app/logs \
    /app/debug_output \
    /tmp/Ultralytics && \
    chown -R appuser:appuser /app /tmp/Ultralytics && \
    chmod -R u+rwX /app

# Copy application source
COPY --chown=appuser:appuser . .

# Ensure runtime directories are writable
RUN mkdir -p /app/data /app/logs /app/debug_output && \
    chown -R appuser:appuser /app/data /app/logs /app/debug_output

# Run as non-root user
USER appuser

# Start application
CMD ["python", "main.py"]