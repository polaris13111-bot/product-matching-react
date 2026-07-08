// backend/matcher.js — 상품명 유사도 매칭 (자체 Dice bigram, Fuse.js 아님)
//
// 입력 상품(product)은 nf_main 카탈로그 행:
//   { id, name, name_raw, operator_name, model_code, status,
//     purchase_normal, sale_c, shipping_fee, 옵션 }
// 매칭에 쓰는 상품명 = product.name. id 는 올바른 행을 집는 데만 쓰고 시트엔 저장하지 않는다.

// 단종 판정값 (2026-07-08 DB조사 확정). status 다른 값: active/out_of_stock/hidden 은 단종 아님.
const DISCONTINUED_STATUS = 'discontinued';

// 모델명(model_code) 100% 매칭 오매칭 가드
const MODEL_CODE_MIN_LEN = 3;        // 정규화 길이 3 미만이면 스킵 (예: 'S', 'A1')
const MODEL_MATCH_MIN_SIMILARITY = 30; // 모델코드 포함이어도 상품명 유사도가 이 이하면 스킵

function normalizeString(text) {
  if (!text || text === '') return '';
  return String(text)
    .trim()
    .replace(/[\n\r]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, '');
}

function bigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function calculateSimilarity(str1, str2) {
  const n1 = normalizeString(str1);
  const n2 = normalizeString(str2);
  if (!n1 || !n2) return 0;
  if (n1 === n2) return 100;
  if (n1.length < 2 || n2.length < 2) return 0;

  const a = bigrams(n1);
  const b = bigrams(n2);
  let inter = 0;
  for (const bg of a) if (b.has(bg)) inter++;
  const dice = (2 * inter) / (a.size + b.size);

  return Math.round(dice * 1000) / 10;
}

/**
 * 상품 매칭 후보 찾기 (Dice 유사도).
 * @param {string} orderProductName 주문 상품명
 * @param {Array} products          카탈로그 (nf_main product_masters 조인)
 * @param {number} topN             상위 N개
 * @param {number} threshold        최소 유사도(이하 후보 제거) — UI 슬라이더값
 * @returns {Array} product + { 유사도 }
 */
function findMatchingProducts(orderProductName, products, topN = 5, threshold = 0) {
  if (!orderProductName || String(orderProductName).trim() === '') return [];
  if (!Array.isArray(products)) return [];

  const matches = [];
  for (const p of products) {
    if (!p || !p.name) continue;
    const similarity = calculateSimilarity(orderProductName, p.name);
    if (similarity <= 0 || similarity < threshold) continue;
    matches.push({ ...p, 유사도: similarity });
  }

  matches.sort((a, b) => b.유사도 - a.유사도);
  return matches.slice(0, Math.max(1, topN));
}

/**
 * 자동 매칭 (상품명 100% 일치 또는 모델명 100% 포함).
 * 모델명 매칭은 짧은/숫자 model_code 광범위 오매칭을 막기 위해 길이·유사도 가드를 건다.
 * @returns {{ match: object|null, matchType: string|null }}
 */
function autoMatchProducts(orderProductName, products) {
  if (!orderProductName || String(orderProductName).trim() === '') {
    return { match: null, matchType: null };
  }
  if (!Array.isArray(products)) return { match: null, matchType: null };

  const normalizedOrder = normalizeString(orderProductName);

  // 1순위: 상품명 완전 일치 (전체 스캔 우선)
  for (const p of products) {
    if (p && p.name && orderProductName === p.name) {
      return { match: { ...p, 유사도: 100 }, matchType: '100%일치' };
    }
  }

  // 2순위: 모델명 100% 포함 (가드 통과 + 상품명 유사도 보조조건, 최고 유사도 채택)
  let best = null;
  let bestSim = -1;
  for (const p of products) {
    if (!p || !p.model_code) continue;
    const normalizedModel = normalizeString(p.model_code);
    // 가드: 정규화 길이 부족하거나 순수 숫자면 스킵
    if (normalizedModel.length < MODEL_CODE_MIN_LEN) continue;
    if (/^\d+$/.test(normalizedModel)) continue;
    if (!normalizedOrder.includes(normalizedModel)) continue;
    // 보조조건: 상품명 유사도가 최소치 이상이어야 오매칭 방지
    const sim = calculateSimilarity(orderProductName, p.name || '');
    if (sim < MODEL_MATCH_MIN_SIMILARITY) continue;
    if (sim > bestSim) {
      bestSim = sim;
      best = p;
    }
  }
  if (best) {
    return { match: { ...best, 유사도: bestSim }, matchType: '모델명100%일치' };
  }

  return { match: null, matchType: null };
}

module.exports = {
  DISCONTINUED_STATUS,
  normalizeString,
  calculateSimilarity,
  findMatchingProducts,
  autoMatchProducts,
};
