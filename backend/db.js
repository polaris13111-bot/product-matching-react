// backend/db.js — 상품 마스터 소스 (nf_main Postgres 직접 SELECT)
//
// 예전 Google Drive Excel 파이프라인을 대체한다. 주문/매칭결과는 여전히
// Google Sheets 에 있고, "상품 마스터"만 DB 에서 읽는다(읽기 전용, 롤=r_matching).
//
// 접속은 env 로만. 자격증명 하드코딩 금지.
//   - DATABASE_URL (권장, Secret Manager 주입)  예) postgres://user:pw@host:5432/db
//   - 또는 PG* 개별 (PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT)
//
// ⚠️ 조인키/컬럼명은 여기 한 곳에만 있다. DB 스키마가 바뀌면 아래 두 상수만 고쳐라.
//    (2026-07-08 DB조사팀 확정: pmp.master_id / pv.master_id / pm.operator_id→companies.id)

const { Pool } = require('pg');

// ── 상품 마스터 조회 SQL (확정 컬럼) ──────────────────────────
const PRODUCT_QUERY = `
SELECT pm.id, pm.name, pm.name_raw,
       COALESCE(oc.name, pm.notes->>'operator_raw') AS operator_name,
       pm.model_code, pm.status,
       pmp.purchase_normal, pmp.sale_c, pmp.shipping_fee
FROM common.product_masters pm
LEFT JOIN common.companies oc ON oc.id = pm.operator_id
LEFT JOIN common.product_master_pricing pmp ON pmp.master_id = pm.id
WHERE pm.deleted_at IS NULL`;

// 옵션값(매칭_옵션용) — 매칭된 master 들에 대해서만
const VARIANTS_QUERY = `
SELECT master_id, option1_name, option1_value, option2_name, option2_value
FROM common.product_variants
WHERE master_id = ANY($1) AND is_active`;

// ── 접속 풀 (지연 초기화) ─────────────────────────────────────
let _pool = null;
function getPool() {
  if (_pool) return _pool;
  if (process.env.DATABASE_URL) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      application_name: 'product-matcher',
    });
  } else if (process.env.PGHOST || process.env.PGUSER) {
    // pg 가 PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT 를 자동으로 읽는다
    _pool = new Pool({ application_name: 'product-matcher' });
  } else {
    throw new Error(
      'DB 접속 정보 없음: DATABASE_URL 또는 PG* 환경변수를 설정하세요 (롤=r_matching, 읽기전용)'
    );
  }
  return _pool;
}

// ── 로더 ──────────────────────────────────────────────────────
async function loadProductMasters() {
  const { rows } = await getPool().query(PRODUCT_QUERY);
  return rows;
}

async function loadVariants(masterIds) {
  if (!masterIds || masterIds.length === 0) return [];
  const { rows } = await getPool().query(VARIANTS_QUERY, [masterIds]);
  return rows;
}

// master 별로 축(option1/option2)별 distinct value 를 모아
// "색상: 레드, 핑크 / 사이즈: S, M" 형태 문자열로.
function buildOptionString(variants) {
  const axes = new Map(); // 축이름 -> 값 Set(순서 보존)
  for (const v of variants) {
    for (const [name, val] of [
      [v.option1_name, v.option1_value],
      [v.option2_name, v.option2_value],
    ]) {
      if (!name || val == null || val === '') continue;
      if (!axes.has(name)) axes.set(name, new Set());
      axes.get(name).add(String(val));
    }
  }
  return [...axes.entries()]
    .map(([name, set]) => `${name}: ${[...set].join(', ')}`)
    .join(' / ');
}

// ── 카탈로그 (마스터 + 옵션문자열), 짧은 메모리 캐시 ───────────
const CATALOG_TTL_MS = 5 * 60 * 1000;
let _catalog = { at: 0, products: null };

async function getCatalog({ force = false } = {}) {
  if (!force && _catalog.products && Date.now() - _catalog.at < CATALOG_TTL_MS) {
    return _catalog.products;
  }
  const masters = await loadProductMasters();
  const ids = masters.map((m) => m.id);
  const variants = await loadVariants(ids);

  const byMaster = new Map();
  for (const v of variants) {
    if (!byMaster.has(v.master_id)) byMaster.set(v.master_id, []);
    byMaster.get(v.master_id).push(v);
  }
  for (const m of masters) {
    m.옵션 = buildOptionString(byMaster.get(m.id) || []);
  }

  _catalog = { at: Date.now(), products: masters };
  return masters;
}

module.exports = {
  PRODUCT_QUERY,
  VARIANTS_QUERY,
  getPool,
  loadProductMasters,
  loadVariants,
  buildOptionString,
  getCatalog,
};
