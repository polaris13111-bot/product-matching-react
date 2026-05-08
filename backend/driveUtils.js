const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

async function getAuthClient() {
  const configPath = path.join(__dirname, 'config', 'Google Sheets API.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Google Sheets API JSON file not found');
  }
  const credentials = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });
  return auth;
}

async function findFolder(drive, folderName) {
  const res = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive'
  });
  return res.data.files && res.data.files.length > 0 ? res.data.files[0] : null;
}

async function getLatestExcel(drive, folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and (mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType='application/vnd.ms-excel') and trashed=false`,
    fields: 'files(id, name, modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 1
  });
  return res.data.files && res.data.files.length > 0 ? res.data.files[0] : null;
}

async function downloadExcelFromDrive(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

async function loadLatestExcelFromDrive(folderName) {
  const auth = await getAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  const folder = await findFolder(drive, folderName);
  if (!folder) {
    return { success: false, error: `폴더 '${folderName}'을(를) 찾을 수 없습니다` };
  }

  const file = await getLatestExcel(drive, folder.id);
  if (!file) {
    return { success: false, error: '폴더에 엑셀 파일이 없습니다' };
  }

  const buffer = await downloadExcelFromDrive(drive, file.id);
  const workbook = XLSX.read(buffer, { type: 'buffer' });

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
          headers,
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

  return {
    success: true,
    fileName: file.name,
    tabsCount: Object.keys(products).length,
    products
  };
}

module.exports = { loadLatestExcelFromDrive };
