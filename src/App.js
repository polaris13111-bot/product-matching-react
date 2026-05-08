import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import './App.css';
import FileUpload from './components/FileUpload';
import ProductMatching from './components/ProductMatching';
import SpreadsheetViewer from './components/SpreadsheetViewer';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:5003';

function App() {
  const [currentPage, setCurrentPage] = useState('matching');
  const [excelData, setExcelData] = useState(null);
  const [driveStatus, setDriveStatus] = useState({ loading: false, message: '', fileName: '' });
  const [sheetsStatus, setSheetsStatus] = useState({ connected: false, loading: false });
  const [unmatchedOrders, setUnmatchedOrders] = useState([]);
  const [spreadsheetId, setSpreadsheetId] = useState(null);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState('');
  const [threshold, setThreshold] = useState(70);
  const [topN, setTopN] = useState(3);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load Excel from Drive on startup
  useEffect(() => {
    async function loadFromDrive() {
      setDriveStatus({ loading: true, message: 'Google Drive에서 로드 중...', fileName: '' });
      try {
        const res = await axios.get(`${API_URL}/api/load-latest-excel`);
        if (res.data.success) {
          setExcelData(res.data.products);
          setDriveStatus({ loading: false, message: 'Drive에서 자동 로드됨', fileName: res.data.fileName });
        }
      } catch (err) {
        console.log('Drive auto-load not available:', err.response?.data?.error || err.message);
        setDriveStatus({ loading: false, message: 'Drive 로드 실패', fileName: '' });
      }
    }
    loadFromDrive();
  }, []);

  // Load unmatched orders from Google Sheets
  const loadUnmatchedOrders = useCallback(async () => {
    setSheetsStatus({ connected: false, loading: true });
    try {
      const res = await axios.get(`${API_URL}/api/sheets/상품매칭용시트`, {
        params: { range: '시트1!A1:Z5000', unmatchedOnly: true }
      });
      if (res.data) {
        setSheetsStatus({ connected: true, loading: false });
        setSpreadsheetId(res.data.spreadsheetId);
        if (res.data.spreadsheetId) {
          setSpreadsheetUrl(`https://docs.google.com/spreadsheets/d/${res.data.spreadsheetId}`);
        }
        // Filter unmatched orders (매칭상품_상품명 is empty)
        const headers = res.data.headers || [];
        const matchColIdx = headers.findIndex(h =>
          h && (h.includes('매칭상품_상품명') || h.includes('매칭상품'))
        );
        const orderNameIdx = headers.findIndex(h =>
          h && (h.includes('주문상품명') || h.includes('상품명') || h.includes('주문_상품명'))
        );

        const orders = [];
        (res.data.data || []).forEach((row, idx) => {
          const orderName = orderNameIdx >= 0 ? row[orderNameIdx] : '';
          const matched = matchColIdx >= 0 ? row[matchColIdx] : '';
          if (orderName && orderName.trim() && (!matched || !matched.trim())) {
            const orderObj = {};
            headers.forEach((h, i) => { orderObj[h] = row[i] || ''; });
            orderObj._rowIndex = idx + 2; // 1-based + header row
            orderObj._orderName = orderName;
            orders.push(orderObj);
          }
        });
        setUnmatchedOrders(orders);
      }
    } catch (err) {
      console.log('Sheets load error:', err.response?.data?.error || err.message);
      setSheetsStatus({ connected: false, loading: false });
    }
  }, []);

  useEffect(() => {
    loadUnmatchedOrders();
  }, [loadUnmatchedOrders]);

  // Fetch spreadsheet URL
  useEffect(() => {
    async function fetchUrl() {
      try {
        const res = await axios.get(`${API_URL}/api/spreadsheet-url`);
        if (res.data.url) setSpreadsheetUrl(res.data.url);
      } catch (e) { /* ignore */ }
    }
    fetchUrl();
  }, []);

  const handleRefresh = () => {
    setRefreshKey(k => k + 1);
    loadUnmatchedOrders();
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">상품 매칭</div>

        {/* Status */}
        <div className="sidebar-section">
          <h3>연결 상태</h3>
          <div className="status-row">
            <span className={`status-dot ${excelData ? 'green' : driveStatus.loading ? 'yellow' : 'red'}`}></span>
            엑셀: {excelData ? `${Object.keys(excelData).length}개 탭` : driveStatus.loading ? '로딩...' : '없음'}
          </div>
          {driveStatus.fileName && (
            <div style={{ fontSize: '0.7rem', color: '#9ca3af', paddingLeft: '1rem' }}>
              {driveStatus.fileName}
            </div>
          )}
          <div className="status-row">
            <span className={`status-dot ${sheetsStatus.connected ? 'green' : sheetsStatus.loading ? 'yellow' : 'red'}`}></span>
            구글 시트: {sheetsStatus.connected ? '연결됨' : sheetsStatus.loading ? '연결 중...' : '미연결'}
          </div>
          <div className="status-row">
            <span className={`status-dot ${unmatchedOrders.length > 0 ? 'yellow' : 'green'}`}></span>
            미매칭: {unmatchedOrders.length}건
          </div>
        </div>

        {/* Excel Upload */}
        <div className="sidebar-section">
          <h3>엑셀 파일</h3>
          <FileUpload onDataLoaded={setExcelData} />
        </div>

        {/* Matching Settings */}
        <div className="sidebar-section">
          <h3>매칭 설정</h3>
          <div className="slider-group">
            <label>
              최소 유사도 <span>{threshold}%</span>
            </label>
            <input
              type="range" min="30" max="100" step="5"
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value))}
            />
          </div>
          <div className="slider-group">
            <label>
              추천 개수 <span>{topN}개</span>
            </label>
            <input
              type="range" min="3" max="10"
              value={topN}
              onChange={(e) => setTopN(parseInt(e.target.value))}
            />
          </div>
        </div>

        {/* Links */}
        <div className="sidebar-section">
          <h3>바로가기</h3>
          {spreadsheetUrl && (
            <a href={spreadsheetUrl} target="_blank" rel="noopener noreferrer" className="sidebar-link">
              스프레드시트 열기
            </a>
          )}
          <button className="sidebar-link" onClick={handleRefresh}>
            새로고침
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="main-content">
        {/* Header */}
        <header className="app-header">
          <h1>상품 매칭 프로그램</h1>
          <div className="header-actions">
            <div className="nav-tabs">
              <button
                className={`nav-tab ${currentPage === 'matching' ? 'active' : ''}`}
                onClick={() => setCurrentPage('matching')}
              >
                상품 매칭
              </button>
              <button
                className={`nav-tab ${currentPage === 'spreadsheet' ? 'active' : ''}`}
                onClick={() => setCurrentPage('spreadsheet')}
              >
                스프레드시트
              </button>
            </div>
            <button className="btn-secondary btn-sm" onClick={handleRefresh}>
              새로고침
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="content-area">
          {currentPage === 'matching' ? (
            <ProductMatching
              excelData={excelData}
              unmatchedOrders={unmatchedOrders}
              spreadsheetId={spreadsheetId}
              threshold={threshold}
              topN={topN}
              refreshKey={refreshKey}
              onRefresh={handleRefresh}
            />
          ) : (
            <SpreadsheetViewer spreadsheetId={spreadsheetId} />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
