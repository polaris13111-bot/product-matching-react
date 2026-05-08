import React, { useState } from 'react';
import axios from 'axios';
import MatchCard from './MatchCard';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:5003';

function ProductMatching({ excelData, unmatchedOrders, spreadsheetId, threshold, topN, onRefresh }) {
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [orderMatches, setOrderMatches] = useState({}); // { rowIndex: [matches] }
  const [loadingOrder, setLoadingOrder] = useState(null);
  const [autoMatchLog, setAutoMatchLog] = useState([]);
  const [autoMatchRunning, setAutoMatchRunning] = useState(false);

  // Manual search state
  const [manualSearch, setManualSearch] = useState('');
  const [manualMatches, setManualMatches] = useState([]);
  const [manualLoading, setManualLoading] = useState(false);

  // Find matches for a specific order
  const findMatchesForOrder = async (order) => {
    if (!excelData) return;
    const rowIdx = order._rowIndex;
    setLoadingOrder(rowIdx);
    setExpandedOrder(rowIdx);

    try {
      const res = await axios.post(`${API_URL}/api/find-matches`, {
        orderProductName: order._orderName,
        excelProducts: excelData,
        topN,
        threshold
      });
      setOrderMatches(prev => ({ ...prev, [rowIdx]: res.data.matches || [] }));
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoadingOrder(null);
    }
  };

  // Toggle order expansion
  const toggleOrder = (order) => {
    if (expandedOrder === order._rowIndex) {
      setExpandedOrder(null);
    } else {
      setExpandedOrder(order._rowIndex);
      if (!orderMatches[order._rowIndex]) {
        findMatchesForOrder(order);
      }
    }
  };

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
        </div>

        {unmatchedOrders.length === 0 ? (
          <div className="empty-state">
            <div className="icon">✅</div>
            <h3>모든 주문이 매칭되었습니다</h3>
            <p>미매칭된 주문이 없습니다.</p>
          </div>
        ) : (
          <div className="order-list">
            {unmatchedOrders.map((order) => (
              <div key={order._rowIndex} className="order-item">
                <div className="order-item-header" onClick={() => toggleOrder(order)}>
                  <span className="row-num">#{order._rowIndex}</span>
                  <span className="order-name">{order._orderName}</span>
                  <span className="toggle-icon">
                    {expandedOrder === order._rowIndex ? '▲' : '▼'}
                  </span>
                </div>

                {expandedOrder === order._rowIndex && (
                  <div className="order-item-body">
                    {loadingOrder === order._rowIndex ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '1rem 0' }}>
                        <span className="spinner"></span>
                        <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>유사 상품 검색 중...</span>
                      </div>
                    ) : (
                      <>
                        {(orderMatches[order._rowIndex] || []).length === 0 ? (
                          <div style={{ fontSize: '0.85rem', color: '#9ca3af', padding: '0.5rem 0' }}>
                            유사 상품을 찾지 못했습니다. 유사도 기준을 낮춰보세요.
                          </div>
                        ) : (
                          (orderMatches[order._rowIndex] || []).map((match, idx) => (
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
                        <button
                          className="btn-secondary btn-sm"
                          style={{ marginTop: '0.5rem' }}
                          onClick={() => findMatchesForOrder(order)}
                        >
                          다시 검색
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
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
