import React, { useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:5003';

function MatchCard({ match, index, spreadsheetId, rowIndex, orderName, onMatched }) {
  const [matching, setMatching] = useState(false);
  const [matched, setMatched] = useState(false);

  const similarity = match.유사도 || 0;
  const badgeClass = similarity >= 90 ? 'high' : similarity >= 70 ? 'medium' : 'low';

  const handleMatch = async () => {
    if (!spreadsheetId || !rowIndex) {
      alert('스프레드시트 정보가 없습니다.');
      return;
    }

    setMatching(true);
    try {
      await axios.post(`${API_URL}/api/update-match`, {
        spreadsheetId,
        rowIndex,
        matchedData: {
          매칭상품_상품명: match.상품명,
          매입: match.입고가계 || '',
          매출: match['공급가(V+) 배송비 포함'] || '',
          업체: match.운영사 || '',
          탭: match.탭 || '',
          옵션: match.옵션 || '',
          매칭방식: '수동매칭'
        }
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
            ✓ {match.상품명}
          </div>
          <div className="details">
            <span>매칭 완료</span>
          </div>
        </div>
      </div>
    );
  }

  const thumbnailUrl = match['대표 1'];
  const isImageUrl = typeof thumbnailUrl === 'string' && /^https?:\/\//.test(thumbnailUrl);

  return (
    <div className="match-card">
      <span className={`similarity-badge ${badgeClass}`}>
        {similarity}%
      </span>

      {isImageUrl && (
        <img
          src={thumbnailUrl}
          alt=""
          className="match-thumbnail"
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, marginRight: 12 }}
        />
      )}

      <div className="match-info">
        <div className="product-name">{match.상품명}</div>
        <div className="details">
          {match.탭 && <span>탭: {match.탭}</span>}
          {match.입고가계 && <span>입고: {match.입고가계}</span>}
          {match['공급가(V+) 배송비 포함'] && <span>공급가: {match['공급가(V+) 배송비 포함']}</span>}
          {match.운영사 && <span>업체: {match.운영사}</span>}
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
