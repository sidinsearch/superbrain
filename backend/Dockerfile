# ────────────────────────────────────────────────────────────────────────────────
# Multi-stage build for optimized image size
# ────────────────────────────────────────────────────────────────────────────────

FROM python:3.11-slim as builder

WORKDIR /app

# Install system build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Build dependencies in separate layer
RUN pip install --user --no-cache-dir -r requirements.txt


# ────────────────────────────────────────────────────────────────────────────────
# Final production image
# ────────────────────────────────────────────────────────────────────────────────

FROM python:3.11-slim

LABEL maintainer="SuperBrain <sidinsearch@gmail.com>"
LABEL description="SuperBrain API - AI-powered content analysis and archival"
LABEL version="1.0.0"

WORKDIR /app

# ──── Install runtime dependencies only ────
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libmagic1 \
    libgl1-mesa-glx \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ──── Copy Python dependencies from builder ────
COPY --from=builder /root/.local /root/.local

# ──── Set environment variables ────
ENV PATH=/root/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ENVIRONMENT=production

# ──── Copy application code ────
COPY . .

# ──── Create necessary directories with proper permissions ────
RUN mkdir -p temp config static logs && \
    chmod 755 temp config static logs

# ──── Health check ────
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# ──── Run as non-root user for security ────
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app

USER appuser

# ──── Expose port ────
EXPOSE 5000

# ──── Run the application ────
CMD ["python", "-m", "uvicorn", "api:app", \
     "--host", "0.0.0.0", \
     "--port", "5000", \
     "--workers", "4", \
     "--loop", "uvloop", \
     "--no-access-log"]
