import React, { useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:5003';

// match = nf_main 카탈로그 행 + { 유사도 }
function MatchCard({ match, index, spreadsheetId, rowIndex, orderName, onMatched }) {
  const [matching, setMatching] = useState(false);
  const [matched, setMatched] = useState(false);

  const similarity = match.유사도 || 0;
  const badgeClass =
    similarity >= 90 ? 'tier-excellent'
    : similarity >= 70 ? 'tier-good'
    : similarity >= 50 ? 'tier-fair'
    : similarity >= 30 ? 'tier-low'
    : 'tier-poor';

  const imageUrl = match.representative_image_url;
  const discontinued = match.status === 'discontinued';
  const reverseMargin =
    match.sale_c != null && match.sale_c !== '' &&
    match.purchase_normal != null && Number(match.sale_c) < Number(match.purchase_normal);

  const handleMatch = async () => {
    if (!spreadsheetId || !rowIndex) {
      alert('스프레드시트 정보가 없습니다.');
      return;
    }

    setMatching(true);
    try {
      // 단일 항목도 batch 경로로 기록 (헤더경합/신규컬럼 append 없음, 서식경고 적용)
      await axios.post(`${API_URL}/api/batch-update-match`, {
        spreadsheetId,
        matches: [{ rowIndex, master: match, matchType: '수동매칭' }]
      });
      setMatched(true);
      if (onMatched) onMatched();
    } catch (err) {
      console.error('Match update error:', err);
      alert('매칭 기록 실패: ' + (err.response?.data?.error || err.message));
    } finally {
      setMatching(false);
    }
  };

  if (matched) {
    return (
      <div className="match-card" style={{ borderColor: '#22c55e', background: '#f0fdf4' }}>
        <div className="match-info">
          <div className="product-name" style={{ color: '#16a34a' }}>
            ✓ {match.name}
          </div>
          <div className="details">
            <span>매칭 완료</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="match-card">
      <span className={`similarity-badge ${badgeClass}`}>
        {similarity}%
      </span>

      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="match-thumbnail"
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, marginRight: 12 }}
        />
      )}

      <div className="match-info">
        <div className="product-name">
          {match.name}
          {discontinued && <span style={{ color: '#dc2626', fontWeight: 600, marginLeft: 6 }}>[단종]</span>}
        </div>
        <div className="details">
          {match.operator_name && <span>업체: {match.operator_name}</span>}
          {match.purchase_normal != null && <span>매입: {match.purchase_normal}</span>}
          {match.sale_c != null && match.sale_c !== '' && (
            <span style={reverseMargin ? { color: '#dc2626', fontWeight: 600 } : undefined}>
              매출: {match.sale_c}{reverseMargin ? ' (역마진)' : ''}
            </span>
          )}
          {match.옵션 && <span>옵션: {match.옵션}</span>}
        </div>
      </div>

      {spreadsheetId && rowIndex && (
        <button
          className="btn-match"
          onClick={handleMatch}
          disabled={matching}
        >
          {matching ? '...' : '매칭'}
        </button>
      )}
    </div>
  );
}

export default MatchCard;
