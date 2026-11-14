'use strict';
const assert = require('node:assert/strict');
const rules = require('../www/domain.js');

const valid = [
  ['1-5', 5],
  ['1,3,5', 3],
  ['2-4,7', 4],
  [' 1 - 3 , 5 ', 4],
  ['1-3,3-5', 5] // repeated pages count once
];
for (const [range, expected] of valid) {
  assert.equal(rules.parsePageRange(range, 10), expected, `valid range ${range}`);
}
const invalid = ['0-3', '8-4', 'letters', '1-11', '', '1,,3', '1-2,a'];
for (const range of invalid) {
  assert.equal(rules.parsePageRange(range, 10), null, `invalid range ${range}`);
}
assert.equal(rules.parsePageRange('1-8', 7), null, 'pages beyond the PDF must fail');
assert.equal(rules.parsePageRange('1-5', 0), null, 'a PDF must have at least one page');
assert.deepEqual(rules.expandPageRange('1-3, 5, 4', 10), [1,2,3,5,4]);
assert.deepEqual(rules.expandPageRange('1-3,3-5', 10), [1,2,3,4,5]);
assert.equal(rules.expandPageRange('1-11', 10), null);
assert.equal(rules.canReserve(8, 8), true);
assert.equal(rules.canReserve(7, 8), false);
assert.equal(rules.canReserve(20, 0), false);
console.log(`PrintFair smoke tests passed: ${valid.length} valid ranges, ${invalid.length + 2} invalid cases, and allowance checks.`);
