# Local-dev image. Vercel doesn't use this — see vercel.json.
# PDF conversion is delegated to the Gotenberg sidecar (see pdf-service/),
# so this image is small.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt uvicorn[standard]

COPY . .

ENV PYTHONUNBUFFERED=1 \
    WORK_DIR=/tmp/archaeo-pro

RUN mkdir -p /tmp/archaeo-pro

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
