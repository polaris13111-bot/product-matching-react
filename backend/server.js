const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { findMatchingProducts, autoMatchProducts } = require('./matcher');
const { loadLatestExcelFromDrive } = require('./driveUtils');
require('dotenv').config();

const DRIVE_FOLDER_NAME = '상품매칭삭제하지마';
const SPREADSHEET_NAME = '상품매칭용시트';

const app = express();
const PORT = process.env.PORT || 5003;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// Google Sheets API setup
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

// Initialize Google Sheets on startup
initGoogleSheets();

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    googleSheetsConnected: sheetsClient !== null
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

// Get Google Sheets data
app.get('/api/sheets/:sheetName', async (req, res) => {
  try {
    if (!sheetsClient) {
      return res.status(500).json({ error: 'Google Sheets client not initialized' });
    }

    const { sheetName } = req.params;
    const { range = 'Sheet1!A1:Z1000' } = req.query;

    const spreadsheetId = await findSpreadsheetId(sheetName);
    if (!spreadsheetId) {
      return res.status(404).json({ error: 'Spreadsheet not found' });
    }

    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: range,
      valueRenderOption: 'FORMATTED_VALUE'
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return res.json({ headers: [], data: [], spreadsheetId });
    }

    const headers = rows[0];
    const data = rows.slice(1);

    res.json({ headers, data, spreadsheetId });
  } catch (error) {
    console.error('Error fetching sheet data:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Upload and process Excel file
app.post('/api/upload-excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(req.file.path);

    const excludeTabs = ['월말재고현황'];
    const products = {};

    workbook.SheetNames.forEach(sheetName => {
      if (!excludeTabs.includes(sheetName)) {
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (data.length > 0) {
          const headers = data[0];
          const rows = data.slice(1);

          products[sheetName] = {
            headers: headers,
            data: rows.map(row => {
              const obj = {};
              headers.forEach((header, idx) => {
                obj[header] = row[idx] || '';
              });
              return obj;
            })
          };
        }
      }
    });

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      tabsCount: Object.keys(products).length,
      products: products
    });
  } catch (error) {
    console.error('Error processing Excel file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Find matching products
app.post('/api/find-matches', async (req, res) => {
  try {
    const { orderProductName, excelProducts, topN = 5, threshold = 0 } = req.body;

    if (!orderProductName || !excelProducts) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const matches = findMatchingProducts(orderProductName, excelProducts, topN, threshold);

    res.json({ matches });
  } catch (error) {
    console.error('Error finding matches:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk find matches — single request to process all unmatched orders.
// For each order: first try autoMatch (100% string OR 100% model name).
// If hit → return the auto-match (frontend will apply). Else → return top-N candidates.
app.post('/api/find-matches-bulk', async (req, res) => {
  try {
    const { orders, excelProducts, topN = 5 } = req.body;

    if (!Array.isArray(orders) || !excelProducts) {
      return res.status(400).json({ error: 'Missing required parameters (orders, excelProducts)' });
    }

    const results = orders.map(o => {
      const auto = autoMatchProducts(o.orderProductName, excelProducts);
      if (auto.match) {
        return {
          rowIndex: o.rowIndex,
          autoMatch: { match: auto.match, matchType: auto.matchType },
          matches: []
        };
      }
      return {
        rowIndex: o.rowIndex,
        autoMatch: null,
        matches: findMatchingProducts(o.orderProductName, excelProducts, topN, 0)
      };
    });

    res.json({ results });
  } catch (error) {
    console.error('Error in bulk find-matches:', error);
    res.status(500).json({ error: error.message });
  }
});

// Auto match products
app.post('/api/auto-match', async (req, res) => {
  try {
    const { orderProductName, excelProducts } = req.body;

    if (!orderProductName || !excelProducts) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const result = autoMatchProducts(orderProductName, excelProducts);

    res.json(result);
  } catch (error) {
    console.error('Error auto matching:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update matching result in Google Sheets
app.post('/api/update-match', async (req, res) => {
  try {
    if (!sheetsClient) {
      return res.status(500).json({ error: 'Google Sheets client not initialized' });
    }

    const { spreadsheetId, rowIndex, matchedData } = req.body;

    if (!spreadsheetId || !rowIndex || !matchedData) {
      return res.status(400).json({ error: 'Missing spreadsheetId, rowIndex, or matchedData' });
    }

    // First, get the headers to find column positions
    const headerRes = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: '시트1!1:1'
    });

    const headers = headerRes.data.values ? headerRes.data.values[0] : [];

    const columnsToWrite = {
      '매칭상품_상품명': matchedData.매칭상품_상품명 || '',
      '매칭_매입': matchedData.매입 || '',
      '매칭_매출': matchedData.매출 || '',
      '매칭_매입(업체)': matchedData.업체 || '',
      '업체': matchedData.업체 || '',
      '매칭_탭': matchedData.탭 || '',
      '매칭_옵션': matchedData.옵션 || '',
      '매칭방식': matchedData.매칭방식 || ''
    };

    // Optional phone-number fixes (only written when caller provides them)
    if (matchedData.수령인휴대폰 != null) columnsToWrite['수령인휴대폰'] = matchedData.수령인휴대폰;
    if (matchedData.수령인연락처 != null) columnsToWrite['수령인연락처'] = matchedData.수령인연락처;

    // Find or add columns
    let needsHeaderUpdate = false;
    const updates = [];

    for (const [colName, value] of Object.entries(columnsToWrite)) {
      let colIdx = headers.findIndex(h => h === colName);

      if (colIdx === -1) {
        // Column doesn't exist, add it
        colIdx = headers.length;
        headers.push(colName);
        needsHeaderUpdate = true;
      }

      // Convert column index to letter (A, B, ... Z, AA, AB, ...)
      const colLetter = columnIndexToLetter(colIdx);
      updates.push({
        range: `시트1!${colLetter}${rowIndex}`,
        values: [[value]]
      });
    }

    // Update header if new columns were added
    if (needsHeaderUpdate) {
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId,
        range: '시트1!1:1',
        valueInputOption: 'RAW',
        requestBody: { values: [headers] }
      });
    }

    // Batch update the values
    if (updates.length > 0) {
      await sheetsClient.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: updates
        }
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating match:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Batch update matches (for auto-matching)
app.post('/api/batch-update-match', async (req, res) => {
  try {
    if (!sheetsClient) {
      return res.status(500).json({ error: 'Google Sheets client not initialized' });
    }

    const { spreadsheetId, matches } = req.body;
    // matches: [{ rowIndex, matchedData }]

    if (!spreadsheetId || !matches || !Array.isArray(matches)) {
      return res.status(400).json({ error: 'Missing spreadsheetId or matches array' });
    }

    // Get headers
    const headerRes = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: '시트1!1:1'
    });

    const headers = headerRes.data.values ? headerRes.data.values[0] : [];
    const columnNames = ['매칭상품_상품명', '매칭_매입', '매칭_매출', '매칭_매입(업체)', '업체', '매칭_탭', '매칭_옵션', '매칭방식'];

    let needsHeaderUpdate = false;
    const colIndices = {};

    for (const colName of columnNames) {
      let idx = headers.findIndex(h => h === colName);
      if (idx === -1) {
        idx = headers.length;
        headers.push(colName);
        needsHeaderUpdate = true;
      }
      colIndices[colName] = idx;
    }

    if (needsHeaderUpdate) {
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId,
        range: '시트1!1:1',
        valueInputOption: 'RAW',
        requestBody: { values: [headers] }
      });
    }

    const aliasMap = {
      '매칭_매입': '매입',
      '매칭_매출': '매출',
      '매칭_매입(업체)': '업체',
      '매칭_탭': '탭',
      '매칭_옵션': '옵션'
    };

    const updates = [];
    for (const { rowIndex, matchedData } of matches) {
      for (const colName of columnNames) {
        const colLetter = columnIndexToLetter(colIndices[colName]);
        const value = matchedData[colName] ?? matchedData[aliasMap[colName]] ?? '';
        updates.push({
          range: `시트1!${colLetter}${rowIndex}`,
          values: [[value]]
        });
      }
    }

    if (updates.length > 0) {
      await sheetsClient.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: updates
        }
      });
    }

    res.json({ success: true, updatedCount: matches.length });
  } catch (error) {
    console.error('Error batch updating matches:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Scan whole sheet, prepend leading 0 to Korean phone numbers in
// 수령인휴대폰 / 수령인연락처 columns when missing.
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
      range: '시트1!A1:AC10000',
      valueRenderOption: 'FORMATTED_VALUE'
    });
    const rows = sheetRes.data.values || [];
    if (rows.length < 2) return res.json({ fixed: 0 });

    const headers = rows[0];
    const colIndices = ['수령인휴대폰', '수령인연락처']
      .map(name => headers.indexOf(name))
      .filter(idx => idx >= 0);

    const updates = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      for (const colIdx of colIndices) {
        const val = row[colIdx];
        if (val == null || val === '') continue;
        const s = String(val);
        const digits = s.replace(/\D/g, '');
        if (digits.length >= 9 && digits.length <= 10 && digits.startsWith('1')) {
          const colLetter = columnIndexToLetter(colIdx);
          updates.push({
            range: `시트1!${colLetter}${i + 1}`,
            values: [['0' + s]]
          });
        }
      }
    }

    if (updates.length > 0) {
      await sheetsClient.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data: updates }
      });
    }

    res.json({ fixed: updates.length });
  } catch (error) {
    console.error('Error fixing phones:', error);
    res.status(500).json({ error: error.message });
  }
});

// Load latest Excel from Google Drive
app.get('/api/load-latest-excel', async (req, res) => {
  try {
    const result = await loadLatestExcelFromDrive(DRIVE_FOLDER_NAME);
    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Error loading from Drive:', error);
    res.status(500).json({ success: false, error: error.message });
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
// 반드시 모든 API 라우트 등록 후 마지막에 위치
const clientBuildPath = path.join(__dirname, 'client');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  // SPA fallback: React Router가 처리
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
  console.log(`   GET  /api/sheets/:sheetName`);
  console.log(`   GET  /api/spreadsheet-url`);
  console.log(`   POST /api/upload-excel`);
  console.log(`   POST /api/find-matches`);
  console.log(`   POST /api/auto-match`);
  console.log(`   POST /api/update-match`);
  console.log(`   POST /api/batch-update-match`);
  console.log(`   GET  /api/load-latest-excel`);
});
