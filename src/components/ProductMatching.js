import React, { useState, useEffect } from 'react';
import axios from 'axios';
import MatchCard from './MatchCard';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:5003';

function ProductMatching({ productCount, unmatchedOrders, spreadsheetId, threshold, topN, refreshKey, onRefresh }) {
  const [orderMatches, setOrderMatches] = useState({}); // { rowIndex: [matches] }
  const [bulkLoading, setBulkLoading] = useState(false);
  const [autoApplied, setAutoApplied] = useState({}); // { rowIndex: matchInfo } — 100% auto-matched (current run)
  const [sessionTotals, setSessionTotals] = useState({ exact: 0, model: 0 }); // cumulative across runs

  const [manualSearch, setManualSearch] = useState('');
  const [manualMatches, setManualMatches] = useState([]);
  const [manualLoading, setManualLoading] = useState(false);

  const hasCatalog = (productCount ?? 0) > 0;

  const runBulkSearch = async () => {
    if (!hasCatalog || unmatchedOrders.length === 0) return;
    setBulkLoading(true);
    try {
      // Fire-and-forget: fix phone numbers across the entire sheet (single, server-side path)
      if (spreadsheetId) {
        axios.post(`${API_URL}/api/fix-all-phones`, { spreadsheetId })
          .then(r => { if (r.data?.fixed) console.log(`Fixed ${r.data.fixed} phone numbers`); })
          .catch(err => console.error('Phone fix error', err));
      }

      const res = await axios.post(`${API_URL}/api/find-matches-bulk`, {
        orders: unmatchedOrders.map(o => ({
          rowIndex: o._rowIndex,
          orderProductName: o._orderName
        })),
        topN: Math.max(topN, 3),
        threshold
      });

      const matchMap = {};
      const autoMap = {};
      const autoBatch = []; // 자동매칭 일괄 기록 (헤더경합 방지: 단일 batch 호출)

      for (const r of res.data.results || []) {
        if (r.autoMatch?.match) {
          autoMap[r.rowIndex] = { ...r.autoMatch.match, _matchType: r.autoMatch.matchType };
          autoBatch.push({
            rowIndex: r.rowIndex,
            master: r.autoMatch.match,
            matchType: r.autoMatch.matchType
          });
        } else {
          matchMap[r.rowIndex] = r.matches || [];
        }
      }

      setOrderMatches(matchMap);
      setAutoApplied(autoMap);

      if (spreadsheetId && autoBatch.length > 0) {
        const exactNew = Object.values(autoMap).filter(m => m._matchType === '100%일치').length;
        const modelNew = Object.values(autoMap).filter(m => m._matchType === '모델명100%일치').length;
        setSessionTotals(prev => ({ exact: prev.exact + exactNew, model: prev.model + modelNew }));
        await axios.post(`${API_URL}/api/batch-update-match`, {
          spreadsheetId,
          matches: autoBatch
        }).catch(err => console.error('Auto-apply batch write error', err));
        if (onRefresh) onRefresh();
      }
    } catch (err) {
      console.error('Bulk search error:', err);
    } finally {
      setBulkLoading(false);
    }
  };

  useEffect(() => {
    if (!hasCatalog || unmatchedOrders.length === 0) return;
    runBulkSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productCount, unmatchedOrders, refreshKey]);

  // Manual search
  const handleManualSearch = async () => {
    if (!manualSearch.trim() || !hasCatalog) return;
    setManualLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/find-matches`, {
        orderProductName: manualSearch,
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
          <div className="number">{productCount ?? 0}</div>
          <div className="label">상품 마스터 수</div>
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
            onClick={runBulkSearch}
            disabled={bulkLoading || !hasCatalog || unmatchedOrders.length === 0}
          >
            {bulkLoading ? (
              <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }}></span> 실행 중...</>
            ) : (
              '자동 매칭 다시 실행'
            )}
          </button>
        </div>

        {!hasCatalog ? (
          <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
            상품 마스터(DB)를 불러오지 못했습니다. 연결 상태를 확인해주세요.
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
            disabled={bulkLoading || !hasCatalog}
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: '#16a34a', padding: '0.5rem 0' }}>
                        {auto.representative_image_url && (
                          <img
                            src={auto.representative_image_url}
                            alt=""
                            loading="lazy"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }}
                          />
                        )}
                        <span>→ {auto.name} {auto.status === 'discontinued' && <span style={{ color: '#dc2626', fontWeight: 600 }}>[단종]</span>}</span>
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
            disabled={manualLoading || !hasCatalog}
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
