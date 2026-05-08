import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import MatchCard from './MatchCard';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:5003';

function ProductMatching({ excelData, unmatchedOrders, spreadsheetId, threshold, topN, onRefresh }) {
  const [orderMatches, setOrderMatches] = useState({}); // { rowIndex: [matches] }
  const [bulkLoading, setBulkLoading] = useState(false);
  const [autoApplied, setAutoApplied] = useState({}); // { rowIndex: matchInfo } — 100% auto-matched
  const [autoMatchLog, setAutoMatchLog] = useState([]);
  const [autoMatchRunning, setAutoMatchRunning] = useState(false);

  const [manualSearch, setManualSearch] = useState('');
  const [manualMatches, setManualMatches] = useState([]);
  const [manualLoading, setManualLoading] = useState(false);

  const lastBulkKeyRef = useRef(null);

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
      const map = {};
      (res.data.results || []).forEach(r => { map[r.rowIndex] = r.matches || []; });
      setOrderMatches(map);

      // Auto-apply 100% matches
      if (spreadsheetId) {
        const autoMap = {};
        const writeOps = [];
        for (const r of res.data.results || []) {
          const top = r.matches?.[0];
          if (top && top.유사도 === 100) {
            autoMap[r.rowIndex] = top;
            writeOps.push(
              axios.post(`${API_URL}/api/update-match`, {
                spreadsheetId,
                rowIndex: r.rowIndex,
                matchedData: {
                  매칭상품_상품명: top.상품명,
                  매입: top.입고가계 || '',
                  매출: top['공급가(V+) 배송비 포함'] || '',
                  업체: top.운영사 || '',
                  탭: top.탭 || '',
                  옵션: top.옵션 || '',
                  매칭방식: '자동매칭(100%)'
                }
              }).catch(err => console.error('Auto-apply write error', err))
            );
          }
        }
        if (writeOps.length > 0) {
          setAutoApplied(autoMap);
          await Promise.all(writeOps);
          if (onRefresh) onRefresh();
        }
      }
    } catch (err) {
      console.error('Bulk search error:', err);
    } finally {
      setBulkLoading(false);
    }
  };

  useEffect(() => {
    if (!excelData || unmatchedOrders.length === 0) return;
    const key = `${Object.keys(excelData).length}|${unmatchedOrders.map(o => o._rowIndex).join(',')}`;
    if (lastBulkKeyRef.current === key) return;
    lastBulkKeyRef.current = key;
    runBulkSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excelData, unmatchedOrders]);

  // Run auto-match for all unmatched orders
  const runAutoMatch = async () => {
    if (!excelData || unmatchedOrders.length === 0) return;
    setAutoMatchRunning(true);
    setAutoMatchLog([]);

    const results = [];
    for (const order of unmatchedOrders) {
      try {
        const res = await axios.post(`${API_URL}/api/auto-match`, {
          orderProductName: order._orderName,
          excelProducts: excelData
        });

        if (res.data.match) {
          // Auto-match succeeded, write to spreadsheet
          const logEntry = { order: order._orderName, success: true, matchType: res.data.matchType, match: res.data.match };
          results.push(logEntry);
          setAutoMatchLog(prev => [...prev, logEntry]);

          // Write to spreadsheet
          try {
            await axios.post(`${API_URL}/api/update-match`, {
              spreadsheetId,
              rowIndex: order._rowIndex,
              matchedData: {
                매칭상품_상품명: res.data.match.상품명,
                매입: res.data.match.입고가계,
                매출: res.data.match['공급가(V+) 배송비 포함'],
                업체: res.data.match.운영사,
                탭: res.data.match.탭,
                옵션: res.data.match.옵션 || '',
                매칭방식: res.data.matchType
              }
            });
          } catch (writeErr) {
            console.error('Sheet write error:', writeErr);
          }
        } else {
          const logEntry = { order: order._orderName, success: false };
          results.push(logEntry);
          setAutoMatchLog(prev => [...prev, logEntry]);
        }
      } catch (err) {
        const logEntry = { order: order._orderName, success: false, error: err.message };
        results.push(logEntry);
        setAutoMatchLog(prev => [...prev, logEntry]);
      }
    }

    setAutoMatchRunning(false);
    const successCount = results.filter(r => r.success).length;
    if (successCount > 0 && onRefresh) {
      onRefresh();
    }
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

  const successCount = autoMatchLog.filter(l => l.success).length;
  const failCount = autoMatchLog.filter(l => !l.success).length;

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
        {autoMatchLog.length > 0 && (
          <div className="stat-box">
            <div className="number">{successCount}/{autoMatchLog.length}</div>
            <div className="label">자동매칭 성공</div>
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
            disabled={autoMatchRunning || !excelData || unmatchedOrders.length === 0}
          >
            {autoMatchRunning ? (
              <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }}></span> 실행 중...</>
            ) : (
              '자동 매칭 실행'
            )}
          </button>
        </div>

        {!excelData && (
          <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
            엑셀 데이터를 먼저 로드해주세요.
          </div>
        )}

        {autoMatchLog.length > 0 && (
          <div className="log-area">
            {autoMatchLog.map((log, i) => (
              <div key={i} className={`log-entry ${log.success ? 'success' : 'fail'}`}>
                {log.success
                  ? `[성공] ${log.order} → ${log.match?.상품명} (${log.matchType})`
                  : `[실패] ${log.order}`
                }
              </div>
            ))}
            <div className="log-entry info" style={{ marginTop: '0.5rem', fontWeight: 600 }}>
              완료: 성공 {successCount}건, 실패 {failCount}건
            </div>
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
