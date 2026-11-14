# 日本語→英語翻訳サービス（FastAPI）のイメージです。
# 非 root ユーザーで動作し、SQLite は /data volume に置かれます。
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
# 依存関係を先にコピーして層キャッシュを使いやすくします。
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
# 最小権限の実行ユーザーを作り、データ領域だけ書き込めるようにします。
RUN useradd --system --uid 10001 --create-home translator \
    && mkdir -p /data \
    && chown translator:translator /data

USER translator
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
