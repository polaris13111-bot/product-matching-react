import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import './App.css';
import ProductMatching from './components/ProductMatching';
import SpreadsheetViewer from './components/SpreadsheetViewer';
import HelpLegend from './components/HelpLegend';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:5003';

function App() {
  const [currentPage, setCurrentPage] = useState('matching');
  const [productCount, setProductCount] = useState(null);
  const [productStatus, setProductStatus] = useState({ loading: false, error: '' });
  const [sheetsStatus, setSheetsStatus] = useState({ connected: false, loading: false });
  const [unmatchedOrders, setUnmatchedOrders] = useState([]);
  const [spreadsheetId, setSpreadsheetId] = useState(null);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState('');
  const [threshold, setThreshold] = useState(70);
  const [topN, setTopN] = useState(3);
  const [refreshKey, setRefreshKey] = useState(0);
  const [clearing, setClearing] = useState(false);

  // Load product master catalog count from nf_main DB
  const loadProductCount = useCallback(async () => {
    setProductStatus({ loading: true, error: '' });
    try {
      const res = await axios.get(`${API_URL}/api/products`);
      setProductCount(res.data.count ?? 0);
      setProductStatus({ loading: false, error: '' });
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.log('Product catalog load error:', msg);
      setProductCount(null);
      setProductStatus({ loading: false, error: msg });
    }
  }, []);

  useEffect(() => { loadProductCount(); }, [loadProductCount]);

  // Load unmatched orders from Google Sheets
  const loadUnmatchedOrders = useCallback(async () => {
    setSheetsStatus({ connected: false, loading: true });
    try {
      const res = await axios.get(`${API_URL}/api/sheets/상품매칭용시트`, {
        params: { range: '시트1!A1:Z5000' }
      });
      if (res.data) {
        setSheetsStatus({ connected: true, loading: false });
        setSpreadsheetId(res.data.spreadsheetId);
        if (res.data.spreadsheetId) {
          setSpreadsheetUrl(`https://docs.google.com/spreadsheets/d/${res.data.spreadsheetId}`);
        }
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

  useEffect(() => { loadUnmatchedOrders(); }, [loadUnmatchedOrders]);

  const handleRefresh = () => {
    setRefreshKey(k => k + 1);
    loadUnmatchedOrders();
  };

  const handleClearSheet = async () => {
    if (!spreadsheetId || clearing) return;
    if (!window.confirm('헤더 아래 모든 데이터와 서식을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return;
    setClearing(true);
    try {
      await axios.post(`${API_URL}/api/clear-sheet`, { spreadsheetId });
      handleRefresh();
    } catch (err) {
      alert(`시트 초기화 실패: ${err.response?.data?.error || err.message}`);
    } finally {
      setClearing(false);
    }
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
            <span className={`status-dot ${productCount != null ? 'green' : productStatus.loading ? 'yellow' : 'red'}`}></span>
            상품 마스터: {productCount != null ? `${productCount}개` : productStatus.loading ? '로딩...' : 'DB 오류'}
          </div>
          {productStatus.error && (
            <div style={{ fontSize: '0.7rem', color: '#ef4444', paddingLeft: '1rem' }}>
              {productStatus.error}
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
          <button
            className="sidebar-link danger"
            onClick={handleClearSheet}
            disabled={!spreadsheetId || clearing}
          >
            {clearing ? '삭제 중...' : '시트 초기화'}
          </button>
        </div>

        {/* 시트 색/계산 규칙 도움말 — 자세한 설명은 시트_표시_규칙.md */}
        <div className="sidebar-section">
          <HelpLegend />
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
              productCount={productCount}
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
