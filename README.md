# 상품 매칭 프로그램 (React Version)

Google Sheets와 Excel 파일을 연동하여 상품명을 자동으로 매칭하는 React 기반 웹 애플리케이션입니다.

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## 🚀 기술 스택

### Frontend
- **React** 18+ - UI 프레임워크
- **Axios** - HTTP 클라이언트
- **Tailwind CSS** - 스타일링
- **XLSX** - Excel 파일 처리

### Backend
- **Express.js** - Node.js 웹 프레임워크
- **Google Sheets API** - 스프레드시트 연동
- **XLSX** - Excel 파일 처리
- **Fuse.js** - 상품 매칭 알고리즘

## 📋 주요 기능

- ✅ 상품명 100% 일치 자동 매칭
- ✅ 모델명 100% 포함 자동 매칭
- ✅ Fuzzy matching으로 유사 상품 추천
- ✅ Excel 파일 업로드 및 다중 탭 지원
- ✅ Google Sheets 실시간 연동
- ✅ 이미지 URL 미리보기

## 🛠️ 설치 및 실행

### 1. 의존성 설치

```bash
# Frontend
npm install

# Backend
cd backend
npm install
```

### 2. Google Sheets API 설정

1. Google Cloud Console에서 프로젝트 생성
2. Google Sheets API 활성화
3. 서비스 계정 생성 및 JSON 키 다운로드
4. `backend/config/` 폴더에 `Google Sheets API.json` 파일로 저장

### 3. 애플리케이션 실행

```bash
# Backend 시작 (터미널 1)
cd backend
npm start

# Frontend 시작 (터미널 2)
npm start
```

- Backend: http://localhost:5000
- Frontend: http://localhost:3000

## 📁 프로젝트 구조

```
product-matching-react/
├── src/
│   ├── components/        # React 컴포넌트
│   │   ├── FileUpload.js
│   │   ├── ProductMatching.js
│   │   ├── MatchCard.js
│   │   └── SpreadsheetViewer.js
│   ├── App.js
│   └── index.css
├── backend/
│   ├── config/            # Google API 설정
│   ├── server.js          # Express 서버
│   ├── matcher.js         # 매칭 로직
│   └── package.json
└── README.md
```

## 🎯 사용 방법

1. 엑셀 파일 업로드 (왼쪽 사이드바)
2. 주문 상품명 입력
3. "유사 상품 검색" 또는 "자동 매칭" 클릭
4. 결과 확인 및 "매칭하기" 버튼 클릭

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
