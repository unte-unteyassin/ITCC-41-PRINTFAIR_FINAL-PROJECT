/* shared, dependency-free validation rules used by the app and the smoke tests */
(() => {
  'use strict';
  function parsePageRange(value, maximumPages) {
    const max = Number(maximumPages);
    if (!Number.isInteger(max) || max < 1 || max > 5000) return null;
    const input = String(value ?? '').replace(/\s+/g, '');
    if (!input || input.length > 200) return null;
    const parts = input.split(',');
    if (!parts.length || parts.length > max) return null;
    const selected = new Set();
    for (const part of parts) {
      if (!/^\d+(?:-\d+)?$/.test(part)) return null;
      const [first, last = first] = part.split('-').map(Number);
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > max) return null;
      for (let page = first; page <= last; page++) selected.add(page);
    }
    return selected.size || null;
  }
  function expandPageRange(value, maximumPages) {
    const max = Number(maximumPages);
    if (!Number.isInteger(max) || max < 1 || max > 5000) return null;
    const input = String(value ?? '').replace(/\s+/g, '');
    if (!input || input.length > 200) return null;
    const selected = [];
    const seen = new Set();
    for (const part of input.split(',')) {
      if (!/^\d+(?:-\d+)?$/.test(part)) return null;
      const [first, last = first] = part.split('-').map(Number);
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > max) return null;
      for (let page = first; page <= last; page++) {
        if (!seen.has(page)) { seen.add(page); selected.push(page); }
      }
    }
    return selected.length ? selected : null;
  }
  function canReserve(remainingPages, requestedPages) {
    const remaining = Number(remainingPages);
    const requested = Number(requestedPages);
    return Number.isInteger(remaining) && Number.isInteger(requested) && requested > 0 && requested <= remaining;
  }
  const rules = Object.freeze({ parsePageRange, expandPageRange, canReserve });
  if (typeof module !== 'undefined' && module.exports) module.exports = rules;
  if (typeof window !== 'undefined') window.PrintFairRules = rules;
})();
