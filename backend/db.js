// backend/db.js — 상품 마스터 소스 (nf_main Postgres 직접 SELECT)
//
// 예전 Google Drive Excel 파이프라인을 대체한다. 주문/매칭결과는 여전히
// Google Sheets 에 있고, "상품 마스터"만 DB 에서 읽는다(읽기 전용, 롤=r_matching).
//
// 접속은 env 로만. 자격증명 하드코딩 금지. 우선순위:
//   1) DATABASE_URL            — 로컬/유연 (예: postgres://user:pw@host:5432/db)
//   2) CLOUD_SQL_INSTANCE +    — 프로덕션(Cloud Run) 형제앱 관례. Cloud SQL 유닉스 소켓.
//      DB_USER + DB_PASSWORD     host=/cloudsql/<INSTANCE>, database=CLOUD_SQL_DATABASE
//      (+CLOUD_SQL_DATABASE)     비밀번호는 Secret Manager(nf-db-role-matching) 주입.
//   3) PG* 개별                — PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT
//
// nf_main = Cloud SQL 인스턴스 blackyak-493519:asia-northeast3:nf-db (형제앱 registrar/pricing 과 동일).
//
// ⚠️ 조인키/컬럼명은 여기 한 곳에만 있다. DB 스키마가 바뀌면 아래 두 상수만 고쳐라.
//    (2026-07-08 DB조사팀 확정: pmp.master_id / pv.master_id / pm.operator_id→companies.id)

const { Pool } = require('pg');

// ── 상품 마스터 조회 SQL (확정 컬럼) ──────────────────────────
// 대표이미지 = common.product_images 중 image_type='representative' 을
// sort_order(동률이면 id) 최소 1건의 url (공개 GCS URL). LATERAL 로 master당 1행.
//
// 🥉 동공급가 = pmp.bronze_medal_supply (레지스트라 가격 컬럼 물리 개명: 구 sale_c → 신
//    bronze_medal_supply). `AS sale_c` 별칭으로 하류(matcher.js/server.js/MatchCard.js)의
//    row.sale_c 필드명은 불변 — 값 출처만 신 컬럼으로 옮긴다.
const PRODUCT_QUERY = `
SELECT pm.id, pm.name, pm.name_raw,
       COALESCE(oc.name, pm.notes->>'operator_raw') AS operator_name,
       pm.model_code, pm.status,
       pmp.purchase_normal, pmp.bronze_medal_supply AS sale_c, pmp.shipping_fee,
       img.url AS representative_image_url
FROM common.product_masters pm
LEFT JOIN common.companies oc ON oc.id = pm.operator_id
LEFT JOIN common.product_master_pricing pmp ON pmp.master_id = pm.id
LEFT JOIN LATERAL (
  SELECT url FROM common.product_images pi
  WHERE pi.master_id = pm.id AND pi.image_type = 'representative'
  ORDER BY pi.sort_order, pi.id
  LIMIT 1
) img ON true
WHERE pm.deleted_at IS NULL`;

// 옵션값(매칭_옵션용) — 매칭된 master 들에 대해서만
const VARIANTS_QUERY = `
SELECT master_id, option1_name, option1_value, option2_name, option2_value
FROM common.product_variants
WHERE master_id = ANY($1) AND is_active`;

// ── 접속 풀 (지연 초기화) ─────────────────────────────────────
let _pool = null;
function buildPoolConfig() {
  const base = { application_name: 'product-matcher' };
  // 1) DATABASE_URL
  if (process.env.DATABASE_URL) {
    return { ...base, connectionString: process.env.DATABASE_URL };
  }
  // 2) Cloud SQL 유닉스 소켓 (형제앱 관례). pg 는 host 가 '/' 로 시작하면 소켓 디렉터리로 취급.
  if (process.env.CLOUD_SQL_INSTANCE && process.env.DB_USER && process.env.DB_PASSWORD) {
    return {
      ...base,
      host: `/cloudsql/${process.env.CLOUD_SQL_INSTANCE}`,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.CLOUD_SQL_DATABASE || 'nf_main',
    };
  }
  // 3) PG* 개별 (pg 가 PGHOST/PGUSER/... 자동 인식)
  if (process.env.PGHOST || process.env.PGUSER) {
    return base;
  }
  return null;
}

function getPool() {
  if (_pool) return _pool;
  const cfg = buildPoolConfig();
  if (!cfg) {
    throw new Error(
      'DB 접속 정보 없음: DATABASE_URL 또는 (CLOUD_SQL_INSTANCE+DB_USER+DB_PASSWORD) 또는 PG* 를 설정하세요 (롤=r_matching, 읽기전용)'
    );
  }
  _pool = new Pool(cfg);
  // idle client 에러로 프로세스가 크래시하지 않도록 (네트워크/서버 재시작 등)
  _pool.on('error', (err) => {
    console.error('pg pool idle client error:', err.message);
  });
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
