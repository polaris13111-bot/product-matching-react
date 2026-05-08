import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5003';

function SpreadsheetViewer({ spreadsheetId }) {
  const [selectedTab, setSelectedTab] = useState('sheet1');
  const [sheetData, setSheetData] = useState({ headers: [], data: [] });
  const [loading, setLoading] = useState(false);

  const loadData = async (range) => {
    if (!spreadsheetId) return;
    setLoading(true);
    try {
      // Use spreadsheetId directly to fetch data
      const res = await axios.get(`${API_URL}/api/sheets/상품매칭용시트`, {
        params: { range }
      });
      setSheetData({ headers: res.data.headers || [], data: res.data.data || [] });
    } catch (err) {
      console.error('Sheet load error:', err);
      setSheetData({ headers: [], data: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedTab === 'sheet1') {
      loadData('시트1!A1:Z200');
    } else {
      loadData('매칭완료!A1:Z200');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab, spreadsheetId]);

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2>스프레드시트 데이터</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className={`nav-tab ${selectedTab === 'sheet1' ? 'active' : ''}`}
              onClick={() => setSelectedTab('sheet1')}
            >
              시트1 (주문)
            </button>
            <button
              className={`nav-tab ${selectedTab === 'matched' ? 'active' : ''}`}
              onClick={() => setSelectedTab('matched')}
            >
              매칭완료
            </button>
            <button
              className="btn-secondary btn-sm"
              onClick={() => loadData(selectedTab === 'sheet1' ? '시트1!A1:Z200' : '매칭완료!A1:Z200')}
            >
              새로고침
            </button>
          </div>
        </div>

        {!spreadsheetId ? (
          <div className="empty-state">
            <div className="icon">📊</div>
            <h3>스프레드시트 미연결</h3>
            <p>Google Sheets 연결을 확인해주세요.</p>
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '2rem', justifyContent: 'center' }}>
            <span className="spinner"></span>
            <span style={{ color: '#6b7280' }}>데이터 로딩 중...</span>
          </div>
        ) : sheetData.headers.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📋</div>
            <h3>데이터가 없습니다</h3>
            <p>해당 시트에 데이터가 없습니다.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  {sheetData.headers.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheetData.data.slice(0, 100).map((row, ri) => (
                  <tr key={ri}>
                    {sheetData.headers.map((_, ci) => (
                      <td key={ci}>{row[ci] || ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {sheetData.data.length > 100 && (
              <div style={{ textAlign: 'center', padding: '0.75rem', fontSize: '0.8rem', color: '#9ca3af' }}>
                {sheetData.data.length}개 중 100개만 표시
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SpreadsheetViewer;
