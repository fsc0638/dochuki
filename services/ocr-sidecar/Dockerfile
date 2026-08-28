FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
# 建置期先跑一次推論引擎初始化,把 ONNX 模型權重烤進 image layer,
# 容器第一個真實請求就不必再對外下載模型
RUN python -c "from rapidocr_onnxruntime import RapidOCR; RapidOCR()"
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
