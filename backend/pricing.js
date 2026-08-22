// backend/pricing.js — "어느 매입가를 쓰나"의 단일 결정 지점
//
// ⚠️ 매입가 기준(상시/기획)을 정하는 곳은 **여기 한 곳뿐이다.**
//    시트에 기록하는 서버(backend/server.js 의 computeFill)도,
//    화면의 후보 카드(src/components/MatchCard.js)도 여기서 나온 값만 본다.
//    카탈로그 행(backend/db.js)에 결정 결과를 박아서 내려보내므로
//    한 번 결정하면 서버·화면이 같은 값을 본다.
//
//    예전엔 computeFill 과 MatchCard 가 각자 업체명 정규식으로 따로 판별했다.
//    같은 규칙을 두 곳에 복사해 둔 탓에 (1) 화면과 시트가 어긋날 수 있었고
//    (2) 무관한 업체까지 기획가가 조용히 적용됐다 (2026-08-08 적발).
//    판별 로직을 다시 복사하지 마라 — 필요하면 이 모듈을 불러 써라.
//
// ── 왜 '행 경고'와 '가격 기준'이 서로 다른 잣대인가 (실수가 아니라 의도다) ──
//
//   행 경고(주황) = backend/server.js 의 WARN_SUPPLIER_RE (업체명 부분 매칭)   ← 넓다
//     사장님 지시 2026-07-31: "내셔널 들어간 업체들 모두다" (명시 선택).
//     경고는 값을 바꾸지 않고 사람 눈을 한 번 더 붙잡는 장치라 넓어도 손해가 없다.
//     '신영인터내셔널' 행이 주황으로 칠해져도 사람이 보고 넘기면 끝난다.
//
//   가격 기준(기획) = 아래 PLANNED_BASIS_SUPPLIERS (정확한 이름 집합)      ← 좁다
//     사장님 지시 2026-08-08: "내셔널만".
//     가격은 시트에 숫자로 조용히 박히는 것이라 틀려도 아무도 눈치채지 못한다.
//     그래서 부분 문자열 매칭을 쓰지 않는다 — 부분 매칭이면 '신영인터내셔널',
//     'HS인터내셔널', '뉴페이스인터내셔날' 같은 무관한 회사에도 기획가가 적용된다.
//
//   요약: 넓은 쪽은 사람을 부르고, 좁은 쪽은 숫자를 정한다. 둘을 다시 합치지 마라.

// 기획 입고가를 기본으로 쓰는 업체 — **정확한 이름**만. 부분 문자열 매칭 금지.
// 이 집합을 늘리는 건 사장님 결정 사항이다. 코드가 추측해서 넓히지 마라.
// (2026-08-08 운영DB 실측: 이름에 내셔널/내셔날이 든 업체는 6곳이지만
//  기획/특판 가격을 실제로 가진 건 '내셔널'(상품 63개)뿐이고,
//  나머지 4곳 — 신영인터내셔널 · 뉴페이스인터내셔날 · 뉴페이스인터내셔널 · HS인터내셔널 —
//  은 이름만 비슷한 무관한 회사다. '내셔널지오그래픽'은 같은 계열이라 함께 못박는다.)
const PLANNED_BASIS_SUPPLIERS = new Set(['내셔널', '내셔널지오그래픽']);

// 카탈로그 행에 붙이는 필드명 (db.js → matcher → API → 프론트/시트 로 흐른다)
const PURCHASE_FIELDS = {
  effective: 'purchase_effective',   // 실제로 쓸 매입가 (number | null)
  basis: 'purchase_basis',           // '기획' | '상시'
  fellBack: 'purchase_fell_back',    // 기획을 쓰려 했는데 값이 없어 상시로 대체했나
};

function toNumberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 이 업체는 기획 입고가를 기본으로 쓰는가? (정확한 이름 비교, 앞뒤 공백만 제거)
 * @param {string|null|undefined} operatorName
 * @returns {boolean}
 */
function usesPlannedPurchase(operatorName) {
  if (operatorName == null) return false;
  return PLANNED_BASIS_SUPPLIERS.has(String(operatorName).trim());
}

/**
 * 매입가 결정 — 이 앱에서 매입가 기준을 정하는 유일한 함수. 순수 함수.
 *
 * 기획 기준 업체인데 기획가가 없으면 상시로 대체하되, 대체 사실을 fellBack 으로 남긴다
 * (조용히 넘어가면 화면이 거짓말을 한다 → 시트에선 매입칸을 파랑으로 칠한다).
 *
 * @param {{operator_name?: string, purchase_normal?: *, purchase_planned?: *}} row 카탈로그 행
 * @returns {{purchase: number|null, basis: '기획'|'상시', fellBack: boolean}}
 */
function resolvePurchase(row) {
  const normal = toNumberOrNull(row && row.purchase_normal);
  const planned = toNumberOrNull(row && row.purchase_planned);
  const wantPlanned = usesPlannedPurchase(row && row.operator_name);
  const usePlanned = wantPlanned && planned != null;

  return {
    purchase: usePlanned ? planned : normal,
    basis: usePlanned ? '기획' : '상시',
    fellBack: wantPlanned && planned == null && normal != null,
  };
}

/**
 * 카탈로그 행에 결정 결과를 박아 넣는다 (db.js 가 행을 내려보내기 직전에 호출).
 * 이 행이 matcher → API → 프론트 카드 → 다시 서버(computeFill) 로 흐르므로
 * 모두가 같은 값을 본다.
 * @param {object} row 제자리에서 수정된다
 * @returns {object} 같은 행
 */
function attachPurchaseBasis(row) {
  if (!row) return row;
  const { purchase, basis, fellBack } = resolvePurchase(row);
  row[PURCHASE_FIELDS.effective] = purchase;
  row[PURCHASE_FIELDS.basis] = basis;
  row[PURCHASE_FIELDS.fellBack] = fellBack;
  return row;
}

/**
 * 행에 이미 붙어 있는 결정을 읽는다. 안 붙어 있으면(옛 화면이 되돌려준 행 등)
 * 같은 규칙으로 지금 결정한다 — 규칙 자체는 위 resolvePurchase 한 곳에만 있다.
 * 값 없이 조용히 빈칸을 쓰는 것보다 같은 규칙으로 다시 정하는 쪽이 안전하다.
 * @param {object} row
 * @returns {{purchase: number|null, basis: '기획'|'상시', fellBack: boolean}}
 */
function readPurchaseDecision(row) {
  if (row && row[PURCHASE_FIELDS.basis] != null) {
    return {
      purchase: toNumberOrNull(row[PURCHASE_FIELDS.effective]),
      basis: row[PURCHASE_FIELDS.basis],
      fellBack: row[PURCHASE_FIELDS.fellBack] === true,
    };
  }
  return resolvePurchase(row);
}

module.exports = {
  PLANNED_BASIS_SUPPLIERS,
  PURCHASE_FIELDS,
  toNumberOrNull,
  usesPlannedPurchase,
  resolvePurchase,
  attachPurchaseBasis,
  readPurchaseDecision,
};
