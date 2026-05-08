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
function findMatchingProducts(orderProductName, excelProducts, topN = 5, threshold = 0) {
  if (!orderProductName || String(orderProductName).trim() === '') {
    return [];
  }

  const matches = [];

  for (const [tabName, tabData] of Object.entries(excelProducts)) {
    const { headers, data } = tabData;

    const productCol = headers.find(h =>
      h.includes('상품명') || h.includes('제품명') || h.toLowerCase().includes('product')
    );
    if (!productCol) continue;

    data.forEach(row => {
      const rawValue = row[productCol];
      if (rawValue === undefined || rawValue === null) return;
      const excelProductName = String(rawValue);
      if (excelProductName.trim() === '') return;

      const similarity = calculateSimilarity(orderProductName, excelProductName);
      if (similarity <= 0) return;

      const supplyPriceResult = findColumnValue(
        row,
        headers,
        ['공급가(V+) 배송비 포함', '공급가', '매출']
      );

      let optionValue = '';
      for (const col of ['옵션', 'Option', '규격']) {
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
    });
  }

  matches.sort((a, b) => b.유사도 - a.유사도);
  return matches.slice(0, Math.max(topN, 3));
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
      const rawProductName = row[productCol];
      if (rawProductName === undefined || rawProductName === null) continue;
      const excelProductName = String(rawProductName);
      if (excelProductName.trim() === '') continue;

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

      const modelName = modelCol ? String(row[modelCol] ?? '') : '';

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
