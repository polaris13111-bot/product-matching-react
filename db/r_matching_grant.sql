-- =============================================================================
-- r_matching  —  product-matching-react 전용 READ-ONLY 롤
-- 2026-07-08 생성 · product-matching-react 전용 READ-ONLY 롤
-- ⚠️ 임시/폐기 예정 — 용도 종료 시 하단 롤백블록으로 DROP
-- nf_main 에 테이블/컬럼/뷰 신설 0, SELECT 권한만 부여한다.
-- =============================================================================
--
-- 실행 방법 (소유롤로 나눠서 실행):
--   ① 롤 생성 + 스키마 USAGE + product_masters/product_master_pricing/product_variants
--      → r_registrar 접속으로 실행 (이 테이블들의 소유롤)
--   ② companies SELECT
--      → r_company 접속으로 실행 (companies 소유롤이 r_company)
--
-- (앱은 이 롤로 READ-ONLY SELECT 만 수행. INSERT/UPDATE/DELETE/DDL 없음.)
-- =============================================================================

-- ── ① r_registrar 접속으로 실행 ──────────────────────────────────────────────
-- 롤 생성 (LOGIN 비밀번호는 Secret Manager 값으로 대체. 여기 하드코딩 금지)
CREATE ROLE r_matching LOGIN PASSWORD '<<SET_VIA_SECRET_MANAGER>>';
COMMENT ON ROLE r_matching IS '2026-07-08 생성 · product-matching 전용 read-only · 용도 종료 후 DROP 예정(임시)';

GRANT USAGE ON SCHEMA common TO r_matching;

GRANT SELECT ON common.product_masters        TO r_matching;
GRANT SELECT ON common.product_master_pricing TO r_matching;
GRANT SELECT ON common.product_variants       TO r_matching;

-- ── ② r_company 접속으로 실행 (companies 소유롤) ────────────────────────────
GRANT SELECT ON common.companies TO r_matching;


-- =============================================================================
-- 롤백 블록 (용도 종료 시 주석 해제 후 실행 — 임시롤이므로 DROP)
--   ①은 r_registrar, ②는 r_company 접속으로 각각 REVOKE 후 DROP ROLE.
-- =============================================================================
-- -- ② r_company 접속:
-- REVOKE SELECT ON common.companies FROM r_matching;
--
-- -- ① r_registrar 접속:
-- REVOKE SELECT ON common.product_masters        FROM r_matching;
-- REVOKE SELECT ON common.product_master_pricing FROM r_matching;
-- REVOKE SELECT ON common.product_variants       FROM r_matching;
-- REVOKE USAGE  ON SCHEMA common                 FROM r_matching;
-- DROP ROLE r_matching;
-- =============================================================================
