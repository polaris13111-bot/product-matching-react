const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { findMatchingProducts, autoMatchProducts, DISCONTINUED_STATUS } = require('./matcher');
const { getCatalog } = require('./db');
require('dotenv').config();

// 주문/매칭결과가 있는 Google Sheet. 시트명 하드코딩 제거 → env 로 조정 가능.
const SPREADSHEET_NAME = process.env.SPREADSHEET_NAME || '상품매칭용시트';
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

function toNumberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// master(카탈로그 행) + matchType → 시트에 채울 값 + 경고 플래그
function computeFill(master, matchType) {
  const shipping = toNumberOrNull(master.shipping_fee) ?? 0;
  const purchaseRaw = toNumberOrNull(master.purchase_normal);
  const saleRaw = toNumberOrNull(master.sale_c);

  // 매칭_매입 ← purchase_normal + 배송비 (상시가 통일, 정수 V+)
  const purchase = purchaseRaw == null ? null : Math.round(purchaseRaw + shipping);
  // 매칭_매출 ← sale_c NULL 이면 빈칸, 아니면 sale_c + 배송비 (동공급가 배송포함)
  const sale = saleRaw == null ? null : Math.round(saleRaw + shipping);

  const discontinued = master.status === DISCONTINUED_STATUS;
  const reverseMargin = saleRaw != null && purchaseRaw != null && saleRaw < purchaseRaw;
  const saleNull = saleRaw == null;

  const values = {
    '매칭상품_상품명': master.name ?? '',
    '매칭_매입(업체)': master.operator_name ?? '',
    '매칭_매입': purchase == null ? '' : String(purchase),
    '매칭_매출': sale == null ? '' : String(sale),
    '매칭_옵션': master.옵션 ?? '',
    // 매칭_탭 = 단종 경고 전용. 단종이면 '단종' 표시, 아니면 빈칸.
    '매칭_탭': discontinued ? '단종' : '',
    '매칭방식': matchType || '수동매칭',
  };

  return { values, flags: { discontinued, reverseMargin, saleNull } };
}

// 서식 색상 (Sheets API color: 0~1)
const COLOR = {
  green: { red: 0.85, green: 0.94, blue: 0.83 }, // 연한 초록 = 새로 채움
  red: { red: 0.96, green: 0.80, blue: 0.80 },   // 진한 빨강 경고
  yellow: { red: 1.0, green: 0.95, blue: 0.70 }, // 노랑 경고
};

// 셀 배경색 결정. 경고(red>yellow) > 새로채움(green).
function cellColor(colName, flags) {
  if (flags.reverseMargin && (colName === '매칭_매입' || colName === '매칭_매출')) return COLOR.red;
  if (flags.discontinued && colName === '매칭_탭') return COLOR.red;
  if (flags.saleNull && colName === '매칭_매출') return COLOR.yellow;
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

// Get spreadsheet URL
app.get('/api/spreadsheet-url', async (req, res) => {
  try {
    const id = await findSpreadsheetId(SPREADSHEET_NAME);
    if (id) {
      res.json({ url: `https://docs.google.com/spreadsheets/d/${id}`, spreadsheetId: id });
    } else {
      res.json({ url: '', spreadsheetId: null });
    }
  } catch (error) {
    res.json({ url: '', spreadsheetId: null });
  }
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

    const requests = [];
    let skippedCells = 0;

    for (const { rowIndex, master, matchType } of matches) {
      const r = Number(rowIndex);
      if (!master || !Number.isInteger(r) || r < 2) continue;
      const existingRow = grid[r - 1] || []; // grid[0]=header(row1), grid[r-1]=sheet row r
      const { values, flags } = computeFill(master, matchType);

      for (const name of MANAGED_COLUMNS) {
        const idx = colIndex[name];
        if (idx == null) continue; // 헤더에 없는 컬럼은 스킵(append 안 함)

        const value = values[name];
        // 매칭_탭은 단종일 때만 채운다(빈 값이면 아예 쓰지 않음).
        if (value === '' || value == null) continue;

        // 기존 값 보존: 이미 값 있으면 덮어쓰지 않음.
        const existing = existingRow[idx];
        if (existing != null && String(existing).trim() !== '') {
          skippedCells++;
          continue;
        }

        requests.push({
          updateCells: {
            rows: [{
              values: [{
                userEnteredValue: { stringValue: String(value) },
                userEnteredFormat: { backgroundColor: cellColor(name, flags) },
              }],
            }],
            fields: 'userEnteredValue,userEnteredFormat.backgroundColor',
            start: { sheetId, rowIndex: r - 1, columnIndex: idx },
          },
        });
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
      updatedCount: matches.length,
      writtenCells: requests.length,
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
  console.log(`   GET  /api/spreadsheet-url`);
  console.log(`   POST /api/find-matches`);
  console.log(`   POST /api/find-matches-bulk`);
  console.log(`   POST /api/batch-update-match`);
  console.log(`   POST /api/fix-all-phones`);
});
