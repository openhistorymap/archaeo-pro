FROM python:3.12-slim

# LibreOffice for DOCX → PDF conversion + GDAL/PROJ headers for shapely
RUN apt-get update && apt-get install -y --no-install-recommends \
        libreoffice \
        fonts-dejavu \
        curl \
        ca-certificates \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && ln -s /root/.local/bin/uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml ./
RUN uv pip install --system -e .

COPY . .

ENV PYTHONUNBUFFERED=1 \
    UPLOADS_DIR=/data/uploads \
    EXPORTS_DIR=/data/exports

RUN mkdir -p /data/uploads /data/exports

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
