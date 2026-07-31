import React from 'react';

// 시트 표시 규칙 요약(사이드바 도움말).
// 색 원본 = backend/server.js 의 COLOR, 자세한 설명 = 시트_표시_규칙.md
// 셋 중 하나를 고치면 나머지도 같이 고칠 것.
const LEGEND = [
  { color: '#FFD99E', label: '행 전체', desc: '매입 업체에 내셔널/내셔날 포함 (채운 칸도 주황)' },
  { color: '#9EFF8C', label: '수량·매입', desc: '수량 2개 이상 (매입에 수량 곱함)' },
  { color: '#F5CCCC', label: '매입·매출', desc: '역마진 / 단종' },
  { color: '#FFF2B3', label: '매출', desc: '동공급가 미정' },
  { color: '#D9F0D4', label: '채운 칸', desc: '이번에 새로 채움' },
];

function HelpLegend() {
  return (
    <details className="help-legend">
      <summary>표시 규칙</summary>
      <ul>
        {LEGEND.map(({ color, label, desc }) => (
          <li key={label}>
            <span className="help-legend-swatch" style={{ background: color }} />
            <b>{label}</b>
            <span>{desc}</span>
          </li>
        ))}
      </ul>
      <p>
        매입 = (매입가 + 배송비) × 수량<span className="help-legend-note">(배송비도 곱해짐 · 매출은 안 곱함)</span>
      </p>
      <p>값이 이미 있는 칸은 건드리지 않음. 수량 칸은 색만 칠함.</p>
    </details>
  );
}

export default HelpLegend;
