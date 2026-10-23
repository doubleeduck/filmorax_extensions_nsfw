import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLiteral, literalProperty } from '../sdk/literal.mjs';
test('restricted data reader accepts player literals without evaluating expressions', () => {
  assert.deepEqual(
    literalProperty(
      'setup({sources:[{file:"https:\\/\\/v.example/a.mp4?q=\\x26",label:\'720p\',default:true,},]});',
      'sources',
    ),
    [{ file: 'https://v.example/a.mp4?q=&', label: '720p', default: true }],
  );
  assert.equal(parseLiteral('{file: fetch("secret")}'), null);
  assert.equal(parseLiteral('{__proto__: {polluted:true}}'), null);
  assert.equal(parseLiteral('{file:1,file:2}'), null);
  assert.equal(parseLiteral('['.repeat(40) + ']'.repeat(40)), null);
  assert.deepEqual(parseLiteral('{value:"a } ] b", nested:[1,null,false]}'), {
    value: 'a } ] b',
    nested: [1, null, false],
  });
});
