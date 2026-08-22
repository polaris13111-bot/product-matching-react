const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { findMatchingProducts, autoMatchProducts, DISCONTINUED_STATUS } = require('./matcher');
const { getCatalog } = require('./db');
const { toNumberOrNull, readPurchaseDecision } = require('./pricing');
require('dotenv').config();

// 주문/매칭결과가 있는 Google Sheet 의 탭 이름. 하드코딩 제거 → env 로 조정 가능.
const ORDER_SHEET = process.env.ORDER_SHEET_NAME || '시트1';

const app = express();
const PORT = process.env.PORT || 5003;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ── Google Sheets API (주문/결과 시트용. 상품마스터는 DB=db.js) ──
let sheetsClient = null;
let authClient = null;

function initGoogleSheets() {
  try {
    let credentials;
    // 프로덕션: GOOGLE_CREDENTIALS_JSON 환경변수 (Secret Manager에서 주입)
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
      credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
      console.log('Google credentials loaded from environment variable');
    } else {
      // 로컬 개발: 파일에서 로드
      const configPath = path.join(__dirname, 'config', 'Google Sheets API.json');
      if (!fs.existsSync(configPath)) {
        console.error('Google Sheets API JSON file not found. Set GOOGLE_CREDENTIALS_JSON env var for production.');
        return null;
      }
      credentials = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log('Google credentials loaded from file');
    }

    authClient = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
      ]
    });

    sheetsClient = google.sheets({ version: 'v4', auth: authClient });
    console.log('Google Sheets client initialized');
    return sheetsClient;
  } catch (error) {
    console.error('Failed to initialize Google Sheets:', error.message);
    return null;
  }
}

// Cache spreadsheet ID
let cachedSpreadsheetId = null;

async function findSpreadsheetId(name) {
  if (cachedSpreadsheetId) return cachedSpreadsheetId;

  const drive = google.drive({ version: 'v3', auth: authClient });
  const fileList = await drive.files.list({
    q: `name='${name}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id, name)'
  });

  if (fileList.data.files && fileList.data.files.length > 0) {
    cachedSpreadsheetId = fileList.data.files[0].id;
    return cachedSpreadsheetId;
  }
  return null;
}

initGoogleSheets();

// ── 매칭_* 채우기 매핑 + 서식 경고 플래그 계산 ──────────────────
// 관리 컬럼(기존 시트 컬럼만; 신규 컬럼 추가 없음)
const MANAGED_COLUMNS = [
  '매칭상품_상품명',
  '매칭_매입(업체)',
  '매칭_매입',
  '매칭_매출',
  '매칭_옵션',
  '매칭_탭',
  '매칭방식',
];

// 수량 컬럼: 열 위치(N열 등)가 아니라 헤더 문자열로 찾는다 — 열이 끼어들어도 안 깨지게.
const QTY_COLUMN = '수량';
// 수량이 이 값 이상이면 형광 초록 표시 + 매칭_매입에 수량 곱셈
const MULTI_QTY_MIN = 2;
// 🟧 행 경고(주황) 전용 업체 판정 — **가격 기준이 아니다.**
//    업체명에 '내셔널'/'내셔날'이 들어가면 전부 경고 (사장님 지시 2026-07-31:
//    "내셔널 들어간 업체들 모두다" — 넓게 잡는 쪽을 명시적으로 고르셨다).
//    '신영인터내셔널'·'HS인터내셔널' 같은 무관한 업체도 걸리지만, 경고는 값을 바꾸지 않고
//    사람 눈을 한 번 더 붙잡을 뿐이라 넓어도 손해가 없다 — 그래서 좁히지 않는다.
//
//    ⛔ 이 정규식을 매입가 결정에 쓰지 마라. 가격 기준은 훨씬 좁고(사장님 지시 2026-08-08
//       "내셔널만"), backend/pricing.js 의 정확한 이름 집합이 단독으로 정한다.
//       예전엔 이 하나를 둘 다에 썼고, 그래서 '신영인터내셔널' 상품이 생기면 조용히
//       기획가가 적용되는 결함이 있었다(2026-08-08 적발). 다시 합치지 마라.
const WARN_SUPPLIER_RE = /내셔[널날]/;

// 시트 수량 파싱. 시트는 FORMATTED_VALUE 로 읽으므로 '1,200'·' 2 ' 처럼
// 천단위 콤마와 공백이 섞여 들어온다 → Number() 가 그대로면 NaN.
function parseQty(v) {
  if (v == null) return null;
  const s = String(v).replace(/[\s,]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// master(카탈로그 행) + matchType + 시트 수량 → 시트에 채울 값 + 경고 플래그
function computeFill(master, matchType, qty) {
  const shipping = toNumberOrNull(master.shipping_fee) ?? 0;
  const saleRaw = toNumberOrNull(master.sale_c);

  // 매입가 기준은 여기서 판별하지 않는다 — backend/pricing.js 가 단독으로 정하고,
  // 카탈로그 행(db.js)에 purchase_effective / purchase_basis / purchase_fell_back 로
  // 박혀서 내려온다. 화면 카드도 같은 필드를 읽으므로 시트와 화면이 어긋날 수 없다.
  // (행에 안 붙어 있으면 readPurchaseDecision 이 같은 규칙으로 정해 준다.)
  const {
    purchase: purchaseRaw,
    basis: purchaseBasis,
    fellBack: purchaseFellBack,
  } = readPurchaseDecision(master);

  const multiQty = qty != null && qty >= MULTI_QTY_MIN;

  // 매칭_매입 ← (선택된 매입가 + 배송비) × 수량 (수량 2 이상일 때만 곱함)
  const purchaseUnit = purchaseRaw == null ? null : purchaseRaw + shipping;
  const purchase = purchaseUnit == null
    ? null
    : Math.round(multiQty ? purchaseUnit * qty : purchaseUnit);
  // 매칭_매출 ← sale_c NULL 이면 빈칸, 아니면 (sale_c + 배송비) × 수량.
  // 매입만 곱하면 시트에서 매입만 몇 배로 뛰어 손해처럼 보이는 착시가 생긴다(현장 지적 2026-08-03).
  // 매입과 같은 규칙으로 곱한다 — 곱하는 조건(수량 2 이상)도 같아야 둘이 어긋나지 않는다.
  const saleUnit = saleRaw == null ? null : saleRaw + shipping;
  const sale = saleUnit == null
    ? null
    : Math.round(multiQty ? saleUnit * qty : saleUnit);

  const discontinued = master.status === DISCONTINUED_STATUS;
  // 역마진 판정은 실제로 시트에 적히는 매입가(=선택된 기준)로 한다.
  // 상시로 판정하면 기획가로 적힌 금액과 빨강 경고가 어긋난다.
  const reverseMargin = saleRaw != null && purchaseRaw != null && saleRaw < purchaseRaw;
  const saleNull = saleRaw == null;
  // 행 경고는 가격 기준과 **다른 잣대**다(넓은 정규식). 위 WARN_SUPPLIER_RE 주석 참고.
  const warnSupplier = WARN_SUPPLIER_RE.test(String(master.operator_name ?? ''));

  // 금액 컬럼(매칭_매입/매칭_매출)은 number|null 로 둔다 → 시트에 numberValue 로 기록
  // (텍스트로 넣으면 SUM 무시·사전식 정렬 파손). 나머지는 문자열.
  const values = {
    '매칭상품_상품명': master.name ?? '',
    '매칭_매입(업체)': master.operator_name ?? '',
    '매칭_매입': purchase,   // number | null
    '매칭_매출': sale,       // number | null
    '매칭_옵션': master.옵션 ?? '',
    // 매칭_탭 = 단종 경고 전용. 단종이면 '단종' 표시, 아니면 빈칸.
    '매칭_탭': discontinued ? '단종' : '',
    '매칭방식': matchType || '수동매칭',
  };

  return { values, flags: { discontinued, reverseMargin, saleNull, warnSupplier, multiQty, purchaseBasis, purchaseFellBack } };
}

// 숫자로 기록할 컬럼 (SUM/정렬 유지)
const NUMERIC_COLUMNS = new Set(['매칭_매입', '매칭_매출']);

// 서식 색상 (Sheets API color: 0~1)
// 여기를 고치면 화면 도움말(src/components/HelpLegend.js)과 시트_표시_규칙.md 도 같이 고칠 것.
const COLOR = {
  green: { red: 0.85, green: 0.94, blue: 0.83 },       // 연한 초록 = 새로 채움
  greenHighlight: { red: 0.62, green: 1.0, blue: 0.55 }, // 형광 초록 = 수량 2 이상
  red: { red: 0.96, green: 0.80, blue: 0.80 },         // 진한 빨강 경고
  yellow: { red: 1.0, green: 0.95, blue: 0.70 },       // 노랑 경고
  orange: { red: 1.0, green: 0.85, blue: 0.62 },       // 주황 = 행 경고(업체명에 내셔널/내셔날)
  blue: { red: 0.72, green: 0.85, blue: 1.0 },         // 파랑 = 기획가가 없어 상시로 대체
};

// 셀 배경색 결정. 경고(red>yellow) > 수량형광 > 새로채움(green).
function cellColor(colName, flags) {
  if (flags.reverseMargin && (colName === '매칭_매입' || colName === '매칭_매출')) return COLOR.red;
  if (flags.discontinued && colName === '매칭_탭') return COLOR.red;
  if (flags.saleNull && colName === '매칭_매출') return COLOR.yellow;
  // 수량이 곱해진 금액칸은 형광으로 표시한다. 매입·매출 둘 다 곱하므로 둘 다 칠한다
  // (한쪽만 칠하면 "이 칸만 곱해졌다"는 거짓 신호가 된다).
  if (flags.multiQty && (colName === '매칭_매입' || colName === '매칭_매출')) return COLOR.greenHighlight;
  // 기획가 기준 업체인데 기획가가 없어 상시로 대체한 경우 — 그 사실을 숨기지 않고 매입칸을 파랑으로.
  if (flags.purchaseFellBack && colName === '매칭_매입') return COLOR.blue;
  // 경고 업체 행은 새로 채운 칸도 주황으로 — 안 그러면 채운 칸만 초록이 되어 행 경고가 끊긴다.
  if (flags.warnSupplier) return COLOR.orange;
  return COLOR.green; // 새로 채운 셀 표시
}

// ── Routes ──────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    googleSheetsConnected: sheetsClient !== null,
  });
});

// Get Google Sheets data (주문 시트 조회)
app.get('/api/sheets/:sheetName', async (req, res) => {
  try {
    if (!sheetsClient) {
      return res.status(500).json({ error: 'Google Sheets client not initialized' });
    }

    const { sheetName } = req.params;
    const { range = `${ORDER_SHEET}!A1:Z1000` } = req.query;

    const spreadsheetId = await findSpreadsheetId(sheetName);
    if (!spreadsheetId) {
      return res.status(404).json({ error: 'Spreadsheet not found' });
    }

    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return res.json({ headers: [], data: [], spreadsheetId });
    }

    res.json({ headers: rows[0], data: rows.slice(1), spreadsheetId });
  } catch (error) {
    console.error('Error fetching sheet data:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 상품 마스터 카탈로그 (nf_main DB). refresh=1 로 캐시 무효화.
app.get('/api/products', async (req, res) => {
  try {
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    const products = await getCatalog({ force });
    res.json({ count: products.length });
  } catch (error) {
    console.error('Error loading product catalog:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Find matching products (수동 검색). 상품 소스=DB.
app.post('/api/find-matches', async (req, res) => {
  try {
    const { orderProductName, topN = 5, threshold = 0 } = req.body;
    if (!orderProductName) {
      return res.status(400).json({ error: 'Missing orderProductName' });
    }
    const products = await getCatalog();
    const matches = findMatchingProducts(orderProductName, products, topN, threshold);
    res.json({ matches });
  } catch (error) {
    console.error('Error finding matches:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Bulk find matches — 미매칭 주문 전체를 한 번에.
// 주문별: 먼저 autoMatch(상품명100% or 모델명100%). 히트 → autoMatch 반환.
// 아니면 threshold 필터된 top-N 후보 반환. 상품 소스=DB.
app.post('/api/find-matches-bulk', async (req, res) => {
  try {
    const { orders, topN = 5, threshold = 0 } = req.body;
    if (!Array.isArray(orders)) {
      return res.status(400).json({ error: 'Missing required parameter (orders)' });
    }
    const products = await getCatalog();

    const results = orders.map((o) => {
      const auto = autoMatchProducts(o.orderProductName, products);
      if (auto.match) {
        return {
          rowIndex: o.rowIndex,
          autoMatch: { match: auto.match, matchType: auto.matchType },
          matches: [],
        };
      }
      return {
        rowIndex: o.rowIndex,
        autoMatch: null,
        matches: findMatchingProducts(o.orderProductName, products, topN, threshold),
      };
    });

    res.json({ results });
  } catch (error) {
    console.error('Error in bulk find-matches:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Helper: 주문 시트의 sheetId(숫자) 얻기
async function getOrderSheetId(spreadsheetId) {
  const meta = await sheetsClient.spreadsheets.get({ spreadsheetId });
  const sheet = (meta.data.sheets || []).find(s => s.properties.title === ORDER_SHEET);
  return sheet ? sheet.properties.sheetId : null;
}

// Batch update matches — 매칭 결과를 주문 시트에 일괄 기록.
// 규칙: (1) 기존 값 보존(이미 값 있는 셀 덮어쓰기 금지) + 새로 채운 셀 연한초록,
//       (2) 역마진 빨강, (3) 단종 빨강(매칭_탭), (4) 동공급가 미설정 노랑(매칭_매출).
// 신규 컬럼 append 없음 — 헤더에 없는 관리컬럼은 스킵(missingColumns 로 보고).
app.post('/api/batch-update-match', async (req, res) => {
  try {
    if (!sheetsClient) {
      return res.status(500).json({ error: 'Google Sheets client not initialized' });
    }
    const { spreadsheetId, matches } = req.body;
    // matches: [{ rowIndex, master, matchType }]
    if (!spreadsheetId || !Array.isArray(matches)) {
      return res.status(400).json({ error: 'Missing spreadsheetId or matches array' });
    }
    if (matches.length === 0) {
      return res.json({ success: true, updatedCount: 0, skippedCells: 0, missingColumns: [] });
    }

    const sheetId = await getOrderSheetId(spreadsheetId);
    if (sheetId == null) {
      return res.status(404).json({ error: `Sheet '${ORDER_SHEET}' not found` });
    }

    // 요청의 master 를 그대로 믿지 않는다. 상품 id 로 서버 카탈로그를 다시 찾아
    // 금액·업체·상태를 서버 값으로 덮는다. 두 가지를 동시에 막는다:
    //   (1) 요청자가 보낸 가격이 그대로 시트에 적히는 것
    //   (2) 브라우저가 오래 들고 있던 옛 가격(카탈로그 캐시·오래 열어둔 탭)이 적히는 것
    // 옵션 문자열도 카탈로그 행이 들고 있으므로(db.js getCatalog) 서버 행을 통째로 쓴다.
    // force: true — 캐시(5분)를 쓰면 '옛 가격이 적히는 것을 막는다'는 이 검증의 취지가
    // 그대로 무너진다. 배치 기록은 자주 일어나지 않으므로 매번 새로 읽는다.
    const catalogById = new Map();
    try {
      for (const row of await getCatalog({ force: true })) catalogById.set(row.id, row);
    } catch (err) {
      // 카탈로그를 못 읽으면 검증 없이 진행하지 않는다 — 틀린 금액을 적느니 실패가 낫다.
      // 원인은 서버 로그에만 남긴다. DB 드라이버 오류엔 호스트·쿼리·설정이 섞여 나온다.
      console.error('[batch-update-match] 카탈로그 조회 실패:', err);
      return res.status(503).json({ error: '상품 목록을 읽을 수 없어 기록을 중단했습니다. 잠시 후 다시 시도해 주세요.' });
    }
    // 카탈로그에 없는 상품(삭제·id 불일치)은 아예 기록하지 않는다. 요청 값으로 되돌리면
    // 요청자가 보낸 금액이 그대로 시트에 적히는 경로가 다시 열린다.
    // 대신 건너뛴 상품을 응답에 담아 화면이 조용히 넘어가지 않게 한다.
    const unverifiedMasterIds = [];
    let processedCount = 0; // 실제로 계산해 기록 대상이 된 행 수(요청 수가 아니다)

    // 헤더 + 대상 행들의 기존 값을 한 번에 읽는다(기존값 보존 판정용).
    const maxRow = matches.reduce((m, x) => Math.max(m, Number(x.rowIndex) || 0), 1);
    const gridRes = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `${ORDER_SHEET}!A1:AZ${maxRow}`,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const grid = gridRes.data.values || [];
    const headers = grid[0] || [];

    // 관리 컬럼 → 컬럼 인덱스(헤더 정확 일치). 없으면 스킵.
    const colIndex = {};
    const missingColumns = [];
    for (const name of MANAGED_COLUMNS) {
      const idx = headers.findIndex(h => h === name);
      if (idx === -1) missingColumns.push(name);
      else colIndex[name] = idx;
    }

    // 수량 컬럼: 값은 쓰지 않고 읽기 + 형광 표시만. 헤더 문자열로 탐색(열 위치 하드코딩 금지).
    const qtyIndex = headers.findIndex(h => String(h).trim() === QTY_COLUMN);
    if (qtyIndex === -1) {
      // 조용히 넘어가면 수량이 곱해지지 않은 1개 단가가 정상값처럼 기록된다 → 소리 내서 알린다.
      // (프론트도 응답의 missingColumns 를 화면에 띄운다)
      missingColumns.push(QTY_COLUMN);
      console.warn(`[batch-update-match] '${QTY_COLUMN}' 헤더 없음 — 매칭_매입에 수량을 곱하지 않고 1개 단가로 기록함`);
    }

    const requests = [];
    let skippedCells = 0;
    let coloredEmptyCells = 0;
    let warnedRows = 0;
    let qtyHighlightedCells = 0;

    // 셀 요청 헬퍼 (row/col 0-based)
    const cellAt = (row, col, fields, cell) => ({
      updateCells: {
        rows: [{ values: [cell] }],
        fields,
        start: { sheetId, rowIndex: row, columnIndex: col },
      },
    });

    for (const { rowIndex, master, matchType } of matches) {
      const r = Number(rowIndex);
      if (!master || !Number.isInteger(r) || r < 2) continue;
      const existingRow = grid[r - 1] || []; // grid[0]=header(row1), grid[r-1]=sheet row r
      const qty = qtyIndex === -1 ? null : parseQty(existingRow[qtyIndex]);

      // 서버 카탈로그에 있는 상품만 기록한다.
      const trusted = master.id != null ? catalogById.get(master.id) : null;
      if (!trusted) {
        unverifiedMasterIds.push(master.id ?? null);
        continue;
      }
      const { values, flags } = computeFill(trusted, matchType, qty);
      processedCount++;

      // 행 경고: 대상 매입 업체면 행 전체(헤더 폭)를 주황으로.
      // 개별 셀 색칠보다 먼저 넣어야 뒤의 경고색(빨강/노랑/형광초록)이 위에 덮인다.
      // 주의: 이 틴트는 '기존 값 있으면 색도 보존' 원칙의 예외다(행 단위 경고라 폭이 행 전체).
      // 호출부가 미매칭 행만 보내므로(App.js 미매칭 필터) 기존 경고색을 지울 일은 없다.
      if (flags.warnSupplier && headers.length > 0) {
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: r - 1,
              endRowIndex: r,
              startColumnIndex: 0,
              endColumnIndex: headers.length,
            },
            fields: 'userEnteredFormat.backgroundColor',
            cell: { userEnteredFormat: { backgroundColor: COLOR.orange } },
          },
        });
        warnedRows++;
      }

      // 수량 형광: 수량 셀은 값을 건드리지 않고 배경색만 칠한다(기존 수량 값 보존).
      if (flags.multiQty && qtyIndex !== -1) {
        requests.push(cellAt(r - 1, qtyIndex, 'userEnteredFormat.backgroundColor', {
          userEnteredFormat: { backgroundColor: COLOR.greenHighlight },
        }));
        qtyHighlightedCells++;
      }

      for (const name of MANAGED_COLUMNS) {
        const idx = colIndex[name];
        if (idx == null) continue; // 헤더에 없는 컬럼은 스킵(append 안 함)

        // 기존 값 보존: 이미 값 있으면 값도 색도 건드리지 않음.
        const existing = existingRow[idx];
        if (existing != null && String(existing).trim() !== '') {
          skippedCells++;
          continue;
        }

        const raw = values[name];
        const isNumeric = NUMERIC_COLUMNS.has(name);
        const hasValue = isNumeric
          ? (raw != null && Number.isFinite(raw))
          : (raw != null && String(raw) !== '');

        if (hasValue) {
          // 값 + 배경색 (금액은 numberValue, 나머지는 stringValue)
          const userEnteredValue = isNumeric
            ? { numberValue: Number(raw) }
            : { stringValue: String(raw) };
          requests.push(cellAt(r - 1, idx, 'userEnteredValue,userEnteredFormat.backgroundColor', {
            userEnteredValue,
            userEnteredFormat: { backgroundColor: cellColor(name, flags) },
          }));
        } else if (name === '매칭_매출' && flags.saleNull) {
          // 동공급가 미설정: 매칭_매출 값은 비워두되(기존값 보존 원칙) 배경만 노랑.
          requests.push(cellAt(r - 1, idx, 'userEnteredFormat.backgroundColor', {
            userEnteredFormat: { backgroundColor: COLOR.yellow },
          }));
          coloredEmptyCells++;
        }
        // 그 외 빈 값(예: 단종 아닌 매칭_탭)은 아무것도 쓰지 않음.
      }
    }

    if (requests.length > 0) {
      await sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
      });
    }

    res.json({
      success: true,
      updatedCount: processedCount,   // 요청 수가 아니라 실제 처리한 행 수
      writtenCells: requests.length,
      unverifiedMasterIds,
      coloredEmptyCells,
      warnedRows,
      qtyHighlightedCells,
      skippedCells,
      missingColumns,
    });
  } catch (error) {
    console.error('Error batch updating matches:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 전화번호 보정 — 시트 전체 스캔, 진짜 휴대폰(01X)에서 빠진 앞자리 0만 복원.
// (주문번호 등 '1' 시작 9~10자리 오보정 방지: 두번째 자리가 휴대폰 접두여야 함)
function looksLikeKoreanMobileMissingZero(digits) {
  // 앞자리 0 빠진 휴대폰: 10자리(예 1012345678) 또는 9자리(예 111234567).
  // 반드시 '1' 시작 + 두번째 자리 ∈ {0,1,6,7,8,9} (010/011/016/017/018/019).
  if (digits.length < 9 || digits.length > 10) return false;
  if (digits[0] !== '1') return false;
  return ['0', '1', '6', '7', '8', '9'].includes(digits[1]);
}

app.post('/api/fix-all-phones', async (req, res) => {
  try {
    if (!sheetsClient) {
      return res.status(500).json({ error: 'Google Sheets client not initialized' });
    }
    const { spreadsheetId } = req.body;
    if (!spreadsheetId) {
      return res.status(400).json({ error: 'Missing spreadsheetId' });
    }

    const sheetRes = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `${ORDER_SHEET}!A1:AC10000`,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const rows = sheetRes.data.values || [];
    if (rows.length < 2) return res.json({ fixed: 0 });

    const headers = rows[0];
    const colIndices = ['수령인휴대폰', '수령인연락처', '주문자 연락처']
      .map(name => headers.indexOf(name))
      .filter(idx => idx >= 0);

    // 해당 컬럼 TEXT 서식 강제(앞자리 0 보존)
    if (colIndices.length > 0) {
      try {
        const sheetId = await getOrderSheetId(spreadsheetId);
        if (sheetId != null) {
          const formatRequests = colIndices.map(colIdx => ({
            repeatCell: {
              range: { sheetId, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
              cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
              fields: 'userEnteredFormat.numberFormat',
            },
          }));
          await sheetsClient.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: formatRequests },
          });
        }
      } catch (formatErr) {
        console.error('Phone column format error:', formatErr.message);
      }
    }

    const updates = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      for (const colIdx of colIndices) {
        const val = row[colIdx];
        if (val == null || val === '') continue;
        const s = String(val);
        const digits = s.replace(/\D/g, '');
        if (looksLikeKoreanMobileMissingZero(digits)) {
          const colLetter = columnIndexToLetter(colIdx);
          updates.push({ range: `${ORDER_SHEET}!${colLetter}${i + 1}`, values: [['0' + s]] });
        }
      }
    }

    if (updates.length > 0) {
      await sheetsClient.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data: updates },
      });
    }

    res.json({ fixed: updates.length });
  } catch (error) {
    console.error('Error fixing phones:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 시트 초기화 — 헤더(1행)만 남기고 2행부터 값+서식 전부 삭제.
// updateCells 에 rows 없이 fields 만 주면 해당 범위의 값/서식이 삭제된다.
// fields 를 '*' 로 하면 메모·데이터검증까지 지워지므로 값+서식만 지정.
app.post('/api/clear-sheet', async (req, res) => {
  try {
    if (!sheetsClient) {
      return res.status(500).json({ error: 'Google Sheets client not initialized' });
    }
    const { spreadsheetId } = req.body;
    if (!spreadsheetId) {
      return res.status(400).json({ error: 'Missing spreadsheetId' });
    }

    const sheetId = await getOrderSheetId(spreadsheetId);
    if (sheetId == null) {
      return res.status(404).json({ error: `Sheet '${ORDER_SHEET}' not found` });
    }

    await sheetsClient.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          updateCells: {
            range: { sheetId, startRowIndex: 1 }, // 2행부터 시트 끝까지
            fields: 'userEnteredValue,userEnteredFormat',
          },
        }],
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error clearing sheet:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Helper: Convert column index (0-based) to letter (A, B, ... Z, AA, AB, ...)
function columnIndexToLetter(index) {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

// ── React SPA 서빙 (프로덕션 빌드) ────────────────────────
const clientBuildPath = path.join(__dirname, 'client');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
  console.log('Serving React build from:', clientBuildPath);
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API endpoints:`);
  console.log(`   GET  /api/health`);
  console.log(`   GET  /api/products`);
  console.log(`   GET  /api/sheets/:sheetName`);
  console.log(`   POST /api/find-matches`);
  console.log(`   POST /api/find-matches-bulk`);
  console.log(`   POST /api/batch-update-match`);
  console.log(`   POST /api/fix-all-phones`);
  console.log(`   POST /api/clear-sheet`);
});
