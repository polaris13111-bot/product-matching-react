# 상품 매칭 프로그램 (React Version)

주문 상품명을 **nf_main 상품 마스터(Postgres)** 와 매칭하고 결과를 Google Sheets 에 기록하는
React 기반 웹 애플리케이션입니다. (상품 마스터 소스는 예전 Google Drive Excel → nf_main DB
직접 SELECT 로 교체됨.)

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## 🚀 기술 스택

### Frontend
- **React** 19 - UI 프레임워크
- **Axios** - HTTP 클라이언트

### Backend
- **Express.js** - Node.js 웹 프레임워크
- **pg** - nf_main Postgres 상품 마스터 조회 (읽기 전용, 롤 `r_matching`)
- **Google Sheets API** - 주문 시트 조회 / 매칭 결과 기록
- **매칭 알고리즘** - 자체 구현 Dice bigram 유사도 (`backend/matcher.js`). Fuse.js 미사용.

## 📋 주요 기능

- ✅ 상품명 100% 일치 자동 매칭
- ✅ 모델명 100% 포함 자동 매칭 (짧은/숫자 코드 오매칭 가드)
- ✅ Dice bigram 유사도로 유사 상품 추천 (UI 최소 유사도/추천 개수 슬라이더 반영)
- ✅ 매칭 결과 시트 기록 시 서식 경고 (기존값 보존·새로채움 초록·역마진 빨강·단종 빨강·동공급가 미설정 노랑)

## 🛠️ 설치 및 실행

### 1. 의존성 설치

```bash
# Frontend
npm install

# Backend (pg 포함)
cd backend
npm install
```

### 2. 자격 증명 설정

- **Google Sheets**: 서비스 계정 JSON → `backend/config/Google Sheets API.json`
  (프로덕션은 `GOOGLE_CREDENTIALS_JSON` 환경변수 / Secret Manager 주입)
- **nf_main DB**: 롤 `r_matching` (읽기 전용). 로컬은 `DATABASE_URL`,
  프로덕션(Cloud Run)은 Cloud SQL 소켓(`DB_USER`/`DB_PASSWORD`/`CLOUD_SQL_INSTANCE`/
  `CLOUD_SQL_DATABASE`) — 형제앱 registrar/pricing 과 동일 관례.
  GRANT SQL 은 `db/r_matching_grant.sql` 참고 (소유롤로 실행하는 임시 롤).

### 3. 애플리케이션 실행

```bash
# Backend 시작 (터미널 1)
cd backend
DATABASE_URL=postgres://r_matching:...@host:5432/nf_main npm start

# Frontend 시작 (터미널 2)
npm start
```

- Backend: http://localhost:5003
- Frontend: http://localhost:3333

## 📁 프로젝트 구조

```
product-matching-react/
├── src/
│   ├── components/        # React 컴포넌트
│   │   ├── ProductMatching.js
│   │   ├── MatchCard.js
│   │   └── SpreadsheetViewer.js
│   ├── App.js
│   └── index.css
├── backend/
│   ├── config/            # Google API 설정 (로컬)
│   ├── server.js          # Express 서버 + Sheets 기록/서식 경고
│   ├── db.js              # nf_main 상품 마스터 조회 (SQL·조인키 한 곳에)
│   ├── matcher.js         # Dice 유사도 매칭 로직
│   └── package.json
├── db/
│   └── r_matching_grant.sql   # 읽기전용 롤 GRANT (임시 롤, 소유롤로 실행)
└── README.md
```

## 🎯 사용 방법

1. 페이지 로드 시 상품 마스터(DB)와 미매칭 주문(시트)을 자동으로 불러와 매칭
2. 100% 일치·모델명 일치는 시트에 자동 기록 (기존값은 보존)
3. 나머지는 후보 목록에서 "매칭" 버튼으로 수동 확정
4. 수동 검색으로 임의 상품명 매칭 확인 가능

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
