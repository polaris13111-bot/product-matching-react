# ── 1단계: React 빌드 ─────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY src/ ./src/
COPY public/ ./public/
# 백엔드가 /api/ 경로로 서빙하므로 API URL은 상대 경로
ENV REACT_APP_API_URL=""
RUN npm run build

# ── 2단계: Express 서버 ───────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# 백엔드 의존성
COPY backend/package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund

# 백엔드 코드
COPY backend/ .

# React 빌드 결과 → 백엔드의 client/ 폴더로 복사
COPY --from=frontend-build /app/build ./client

# uploads 디렉토리 생성
RUN mkdir -p uploads

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
