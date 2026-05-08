const Fuse = require('fuse.js');

/**
 * 문자열 정규화 함수
 * - 공백, 줄바꿈 제거
 * - 특수문자 제거
 * - 알파벳 소문자로 변환
 * - 숫자는 유지
 */
function normalizeString(text) {
  if (!text || text === '') return '';

  text = String(text).trim();
  text = text.replace(/[\n\r]/g, '');
  text = text.toLowerCase();
  text = text.replace(/[^a-z0-9가-힣]/g, '');

  return text;
}

/**
 * 두 문자열 간의 유사도 계산 (token_set_ratio와 유사)
 * Fuse.js의 점수를 0-100 범위로 변환
 */
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;

  const fuse = new Fuse([str2], {
    includeScore: true,
    threshold: 1.0, // 모든 매칭 허용
  });

  const result = fuse.search(str1);

  if (result.length === 0) return 0;

  // Fuse.js score는 0(완벽한 매칭) ~ 1(매칭 안 됨)
  // 이를 100(완벽) ~ 0(매칭 안 됨)으로 변환
  const similarity = (1 - result[0].score) * 100;

  return Math.round(similarity * 10) / 10; // 소수점 1자리
}

/**
 * 컬럼 값 찾기 (3단계 매칭)
 */
function findColumnValue(row, columns, targetNames) {
  if (typeof targetNames === 'string') {
    targetNames = [targetNames];
  }

  // 1단계: 정확한 매칭
  for (const col of columns) {
    if (targetNames.includes(col)) {
      return { value: row[col] || '', method: '1단계:정확' };
    }
  }

  // 2단계: 정규화 매칭
  const normalizedTargets = targetNames.map(t => normalizeString(t));
  for (const col of columns) {
    const normalizedCol = normalizeString(col);
    if (normalizedTargets.includes(normalizedCol)) {
      return { value: row[col] || '', method: '2단계:정규화' };
    }
  }

  // 3단계: 95% 이상 유사도 매칭
  for (const col of columns) {
    const normalizedCol = normalizeString(col);
    for (const normTarget of normalizedTargets) {
      if (normTarget && normalizedCol) {
        const similarity = calculateSimilarity(normalizedCol, normTarget);
        if (similarity >= 95) {
          return { value: row[col] || '', method: `3단계:유사도${Math.round(similarity)}%` };
        }
      }
    }
  }

  return { value: '', method: null };
}

/**
 * 상품 매칭 찾기 (Fuzzy matching)
 */
function findMatchingProducts(orderProductName, excelProducts, topN = 5, threshold = 60) {
  if (!orderProductName || orderProductName.trim() === '') {
    return [];
  }

  const matches = [];

  // 각 탭별로 상품명 검색
  for (const [tabName, tabData] of Object.entries(excelProducts)) {
    const { headers, data } = tabData;

    // 상품명 컬럼 찾기
    let productCol = headers.find(h =>
      h.includes('상품명') || h.includes('제품명') || h.toLowerCase().includes('product')
    );

    if (!productCol) continue;

    // 각 상품과 유사도 비교
    data.forEach(row => {
      const excelProductName = row[productCol];

      if (!excelProductName || excelProductName.trim() === '') return;

      // 유사도 계산
      const similarity = calculateSimilarity(orderProductName, excelProductName);

      if (similarity >= threshold) {
        // 공급가 찾기 (3단계 매칭)
        const supplyPriceResult = findColumnValue(
          row,
          headers,
          ['공급가(V+) 배송비 포함', '공급가', '매출']
        );

        // 옵션 찾기
        let optionValue = '';
        const optionCols = ['옵션', 'Option', '규격'];
        for (const col of optionCols) {
          if (headers.includes(col)) {
            optionValue = row[col] || '';
            break;
          }
        }

        matches.push({
          탭: tabName,
          상품명: excelProductName,
          유사도: similarity,
          입고가계: row['입고가계'] || '',
          '공급가(V+) 배송비 포함': supplyPriceResult.value,
          운영사: row['운영사'] || '',
          '대표 1': row['대표 1'] || '',
          옵션: optionValue,
          매칭로그: supplyPriceResult.method ? { '매출(공급가)': supplyPriceResult.method } : {}
        });
      }
    });
  }

  // 유사도 순으로 정렬
  matches.sort((a, b) => b.유사도 - a.유사도);

  // 상위 N개만 반환
  return matches.slice(0, topN);
}

/**
 * 자동 매칭 (100% 일치 또는 모델명 100% 일치)
 */
function autoMatchProducts(orderProductName, excelProducts) {
  if (!orderProductName || orderProductName.trim() === '') {
    return { match: null, matchType: null };
  }

  const normalizedOrder = normalizeString(orderProductName);

  // 각 탭별로 검색
  for (const [tabName, tabData] of Object.entries(excelProducts)) {
    const { headers, data } = tabData;

    // 상품명 컬럼 찾기
    let productCol = headers.find(h =>
      h.includes('상품명') || h.includes('제품명') || h.toLowerCase().includes('product')
    );

    if (!productCol) continue;

    // 모델명 컬럼 찾기
    let modelCol = headers.find(h =>
      h.includes('모델명') || h.toLowerCase().includes('model')
    );

    // 각 상품 확인
    for (const row of data) {
      const excelProductName = row[productCol];

      if (!excelProductName || excelProductName.trim() === '') continue;

      // 데이터 추출
      const supplyPriceResult = findColumnValue(
        row,
        headers,
        ['공급가(V+) 배송비 포함', '공급가', '매출']
      );

      const purchasePriceResult = findColumnValue(row, headers, ['입고가계', '매입']);
      const vendorResult = findColumnValue(row, headers, ['운영사', '공급사', '업체']);
      const imageResult = findColumnValue(row, headers, ['대표 1', '이미지', 'Image']);
      const optionResult = findColumnValue(row, headers, ['옵션', 'Option', '규격']);

      const modelName = modelCol ? (row[modelCol] || '') : '';

      const matchInfo = {
        탭: tabName,
        상품명: excelProductName,
        유사도: 100.0,
        입고가계: purchasePriceResult.value,
        '공급가(V+) 배송비 포함': supplyPriceResult.value,
        운영사: vendorResult.value,
        '대표 1': imageResult.value,
        모델명: modelName,
        옵션: optionResult.value,
        매칭로그: supplyPriceResult.method ? { '매출(공급가)': supplyPriceResult.method } : {}
      };

      // 1. 상품명 100% 일치 확인
      if (orderProductName === excelProductName) {
        return { match: matchInfo, matchType: '100%일치' };
      }

      // 2. 모델명 100% 포함 확인
      if (modelName && modelName.trim() !== '') {
        const normalizedModel = normalizeString(modelName);
        if (normalizedModel && normalizedOrder.includes(normalizedModel)) {
          return { match: matchInfo, matchType: '모델명100%일치' };
        }
      }
    }
  }

  return { match: null, matchType: null };
}

module.exports = {
  normalizeString,
  calculateSimilarity,
  findMatchingProducts,
  autoMatchProducts,
  findColumnValue
};
