#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(cond, msg) {
  if (!cond) {
    const err = new Error(msg || 'assertion failed');
    err.name = 'AssertionError';
    throw err;
  }
}

function loadScript(filePath, context) {
  const code = fs.readFileSync(filePath, 'utf8');
  vm.runInContext(code, context, { filename: filePath });
}

function allWordsMatchLength(words, len) {
  if (!Array.isArray(words)) return false;
  for (const w of words) {
    if (typeof w !== 'string') return false;
    if (w.length !== len) return false;
    if (!/^[a-z]+$/.test(w)) return false;
  }
  return true;
}

function main() {
  const appDir = path.resolve(__dirname, '..');
  const context = vm.createContext({ window: {}, console });

  loadScript(path.join(appDir, 'src', 'wordlist.js'), context);
  loadScript(path.join(appDir, 'src', 'wordlists-curated.js'), context);

  const { WORD_LISTS, GUESS_LISTS } = context.window;
  assert(WORD_LISTS && typeof WORD_LISTS === 'object', 'window.WORD_LISTS missing');
  assert(GUESS_LISTS && typeof GUESS_LISTS === 'object', 'window.GUESS_LISTS missing');

  assert(Array.isArray(WORD_LISTS[5]) && WORD_LISTS[5].length > 1000, 'WORD_LISTS[5] missing/too small');
  assert(Array.isArray(GUESS_LISTS[5]) && GUESS_LISTS[5].length >= WORD_LISTS[5].length, 'GUESS_LISTS[5] missing/too small');

  for (const L of [3, 4, 6, 7]) {
    assert(Array.isArray(WORD_LISTS[L]) && WORD_LISTS[L].length > 0, `WORD_LISTS[${L}] missing`);
    assert(Array.isArray(GUESS_LISTS[L]) && GUESS_LISTS[L].length > 0, `GUESS_LISTS[${L}] missing`);
    assert(allWordsMatchLength(WORD_LISTS[L], L), `WORD_LISTS[${L}] has invalid words`);
    assert(allWordsMatchLength(GUESS_LISTS[L], L), `GUESS_LISTS[${L}] has invalid words`);
  }

  console.log('OK: wordlists loaded and validated');
}

if (require.main === module) {
  main();
}

