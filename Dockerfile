FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .

RUN useradd --system --no-create-home rusnipez
USER rusnipez

EXPOSE 8000
CMD ["sh", "-c", "rusnipez migrate && rusnipez serve --host 0.0.0.0 --port 8000"]
