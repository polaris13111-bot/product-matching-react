import React, { useState, useEffect } from 'react';
import axios from 'axios';
import MatchCard from './MatchCard';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:5003';

function ProductMatching({ excelData, unmatchedOrders, spreadsheetId, threshold, topN, refreshKey, onRefresh }) {
  const [orderMatches, setOrderMatches] = useState({}); // { rowIndex: [matches] }
  const [bulkLoading, setBulkLoading] = useState(false);
  const [autoApplied, setAutoApplied] = useState({}); // { rowIndex: matchInfo } — 100% auto-matched (current run)
  const [sessionTotals, setSessionTotals] = useState({ exact: 0, model: 0 }); // cumulative across runs
  const [autoMatchLog, setAutoMatchLog] = useState([]);
  const [autoMatchRunning, setAutoMatchRunning] = useState(false);

  const [manualSearch, setManualSearch] = useState('');
  const [manualMatches, setManualMatches] = useState([]);
  const [manualLoading, setManualLoading] = useState(false);

  const runBulkSearch = async () => {
    if (!excelData || unmatchedOrders.length === 0) return;
    setBulkLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/find-matches-bulk`, {
        orders: unmatchedOrders.map(o => ({
          rowIndex: o._rowIndex,
          orderProductName: o._orderName
        })),
        excelProducts: excelData,
        topN: Math.max(topN, 3)
      });

      const matchMap = {};
      const autoMap = {};
      const writeOps = [];

      for (const r of res.data.results || []) {
        if (r.autoMatch?.match) {
          autoMap[r.rowIndex] = { ...r.autoMatch.match, _matchType: r.autoMatch.matchType };
          if (spreadsheetId) {
            const m = r.autoMatch.match;
            writeOps.push(
              axios.post(`${API_URL}/api/update-match`, {
                spreadsheetId,
                rowIndex: r.rowIndex,
                matchedData: {
                  매칭상품_상품명: m.상품명,
                  매입: m.입고가계 || '',
                  매출: m['공급가(V+) 배송비 포함'] || '',
                  업체: m.운영사 || '',
                  탭: m.탭 || '',
                  옵션: m.옵션 || '',
                  매칭방식: r.autoMatch.matchType
                }
              }).catch(err => console.error('Auto-apply write error', err))
            );
          }
        } else {
          matchMap[r.rowIndex] = r.matches || [];
        }
      }

      setOrderMatches(matchMap);
      setAutoApplied(autoMap);

      if (writeOps.length > 0) {
        const exactNew = Object.values(autoMap).filter(m => m._matchType === '100%일치').length;
        const modelNew = Object.values(autoMap).filter(m => m._matchType === '모델명100%일치').length;
        setSessionTotals(prev => ({ exact: prev.exact + exactNew, model: prev.model + modelNew }));
        await Promise.all(writeOps);
        if (onRefresh) onRefresh();
      }
    } catch (err) {
      console.error('Bulk search error:', err);
    } finally {
      setBulkLoading(false);
    }
  };

  useEffect(() => {
    if (!excelData || unmatchedOrders.length === 0) return;
    runBulkSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excelData, unmatchedOrders, refreshKey]);

  const runAutoMatch = async () => {
    setAutoMatchLog([]);
    await runBulkSearch();
  };

  // Manual search
  const handleManualSearch = async () => {
    if (!manualSearch.trim() || !excelData) return;
    setManualLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/find-matches`, {
        orderProductName: manualSearch,
        excelProducts: excelData,
        topN,
        threshold
      });
      setManualMatches(res.data.matches || []);
    } catch (err) {
      console.error('Manual search error:', err);
    } finally {
      setManualLoading(false);
    }
  };

  const autoCount = Object.keys(autoApplied).length;
  const candidateCount = Object.keys(orderMatches).length;
  const sessionTotal = sessionTotals.exact + sessionTotals.model;

  return (
    <div>
      {/* Stats */}
      <div className="stats-row">
        <div className="stat-box">
          <div className="number">{unmatchedOrders.length}</div>
          <div className="label">미매칭 주문</div>
        </div>
        <div className="stat-box">
          <div className="number">{excelData ? Object.values(excelData).reduce((sum, tab) => sum + tab.data.length, 0) : 0}</div>
          <div className="label">엑셀 상품 수</div>
        </div>
        <div className="stat-box">
          <div className="number">{excelData ? Object.keys(excelData).length : 0}</div>
          <div className="label">엑셀 탭 수</div>
        </div>
        {sessionTotal > 0 && (
          <div className="stat-box">
            <div className="number">{sessionTotal}</div>
            <div className="label">자동 적용 (정확 {sessionTotals.exact} · 모델명 {sessionTotals.model})</div>
          </div>
        )}
      </div>

      {/* Auto Match Section */}
      <div className="card">
        <div className="card-header">
          <h2>자동 매칭</h2>
          <button
            className="btn-primary"
            onClick={runAutoMatch}
            disabled={bulkLoading || !excelData || unmatchedOrders.length === 0}
          >
            {bulkLoading ? (
              <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }}></span> 실행 중...</>
            ) : (
              '자동 매칭 다시 실행'
            )}
          </button>
        </div>

        {!excelData ? (
          <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
            엑셀 데이터를 먼저 로드해주세요.
          </div>
        ) : (
          <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
            페이지 로드 시 자동으로 매칭됩니다. 100% 유사도 또는 모델명 일치는 시트에 자동 기록됩니다.
            {autoCount > 0 && (
              <span style={{ marginLeft: '0.5rem', color: '#16a34a', fontWeight: 600 }}>
                이번 실행: {autoCount}건 (정확 {Object.values(autoApplied).filter(m => m._matchType === '100%일치').length} · 모델명 {Object.values(autoApplied).filter(m => m._matchType === '모델명100%일치').length})
              </span>
            )}
            {sessionTotal > autoCount && (
              <span style={{ marginLeft: '0.5rem', color: '#6b7280' }}>
                · 세션 누적: {sessionTotal}건
              </span>
            )}
          </div>
        )}
      </div>

      {/* Unmatched Orders List */}
      <div className="card">
        <div className="card-header">
          <h2>미매칭 주문 ({unmatchedOrders.length}건)</h2>
          <button
            className="btn-secondary btn-sm"
            onClick={runBulkSearch}
            disabled={bulkLoading || !excelData}
          >
            {bulkLoading ? '검색 중...' : '전체 재검색'}
          </button>
        </div>

        {bulkLoading && Object.keys(orderMatches).length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '1rem 0' }}>
            <span className="spinner"></span>
            <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
              {unmatchedOrders.length}건 자동 검색 중...
            </span>
          </div>
        )}

        {unmatchedOrders.length === 0 ? (
          <div className="empty-state">
            <div className="icon">✅</div>
            <h3>모든 주문이 매칭되었습니다</h3>
            <p>미매칭된 주문이 없습니다.</p>
          </div>
        ) : (
          <div className="order-list">
            {unmatchedOrders.map((order) => {
              const matches = orderMatches[order._rowIndex] || [];
              const auto = autoApplied[order._rowIndex];
              return (
                <div key={order._rowIndex} className="order-item" style={auto ? { borderColor: '#22c55e', background: '#f0fdf4' } : undefined}>
                  <div className="order-item-header">
                    <span className="row-num">#{order._rowIndex}</span>
                    <span className="order-name">{order._orderName}</span>
                    {auto && <span style={{ color: '#16a34a', fontSize: '0.85rem', fontWeight: 600 }}>✓ 100% 자동매칭</span>}
                  </div>
                  <div className="order-item-body">
                    {auto ? (
                      <div style={{ fontSize: '0.85rem', color: '#16a34a', padding: '0.5rem 0' }}>
                        → {auto.상품명} (탭: {auto.탭})
                      </div>
                    ) : matches.length === 0 ? (
                      <div style={{ fontSize: '0.85rem', color: '#9ca3af', padding: '0.5rem 0' }}>
                        {bulkLoading ? '검색 중...' : '유사 상품 없음'}
                      </div>
                    ) : (
                      matches.map((match, idx) => (
                        <MatchCard
                          key={idx}
                          match={match}
                          index={idx}
                          spreadsheetId={spreadsheetId}
                          rowIndex={order._rowIndex}
                          orderName={order._orderName}
                          onMatched={onRefresh}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Manual Search (secondary) */}
      <div className="card">
        <div className="card-header">
          <h2>수동 검색</h2>
        </div>
        <div className="search-row">
          <div className="input-group">
            <label>상품명 입력</label>
            <input
              type="text"
              value={manualSearch}
              onChange={(e) => setManualSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
              placeholder="검색할 상품명을 입력하세요..."
            />
          </div>
          <button
            className="btn-primary"
            onClick={handleManualSearch}
            disabled={manualLoading || !excelData}
          >
            {manualLoading ? '검색 중...' : '검색'}
          </button>
        </div>

        {manualMatches.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.5rem' }}>
              {manualMatches.length}개 결과
            </div>
            {manualMatches.map((match, idx) => (
              <MatchCard key={idx} match={match} index={idx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ProductMatching;
