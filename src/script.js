let answerList = [];
let guessList = [];
let baseAnswerList = [];
let baseGuessList = [];
let filteredWords = [];
let filteredWordsVersion = 0;
let currentTile = null;
let tiles = [];
let currentScoreMode = 'positional-frequency+language-frequency';
let selectedScoreMethods = ['positional-frequency', 'language-frequency']; // Track selected methods for blending
let blendWeight = 0.494949; // Default to 50 out of 100 (50-1)/99 = 0.494949
let currentSortMode = 'highest';
let scoredWordsCache = [];
let lastScoredVersion = -1;
let lastScoredMode = '';
let activeScoringToken = null;
let autofillGreenEnabled = true; // Track autofill toggle state
let hideDoubleLetters = false; // Toggle for hiding words with double letters
let modeMessageTimeoutId = null;
let artTiles = []; // Tiles for Wordle Art Planner
let artWordList = []; // Always 5-letter list for art tools
let patternLibraryDebounceTimer = null;
let analyzeBoardScheduled = false;

const INVALID_WORDS_STORAGE_KEY = 'invalidWords';
let invalidWordSet = new Set();

// Row confirmations prevent "typed but not yet colored" rows from constraining candidates.
// A row is considered confirmed when:
// - the user explicitly marks any tile's feedback (1/2/3, Tab, shift-click, tap-cycle), OR
// - the user presses Enter on a completed row (to confirm an all-gray result).
let confirmedRowWords = [];

function scheduleAnalyzeBoard() {
    if (analyzeBoardScheduled) return;
    analyzeBoardScheduled = true;
    requestAnimationFrame(() => {
        analyzeBoardScheduled = false;
        analyzeBoard();
    });
}
const HEAVY_SCORE_MODES = new Set(['entropy', 'expected', 'minimax', 'positional-entropy']);
const BOARD_ROWS = 6;
const WORD_LENGTH_MIN = 3;
const WORD_LENGTH_MAX = 7;
let WORD_LENGTH = 5;

if (!confirmedRowWords.length) {
    confirmedRowWords = Array.from({ length: BOARD_ROWS }, () => null);
}

function boardRows() {
    return BOARD_ROWS;
}

function boardCols() {
    return WORD_LENGTH;
}

function boardTileIndex(row, col) {
    return row * boardCols() + col;
}

function boardTileCount() {
    return boardRows() * boardCols();
}

function normalizeCandidateWord(word) {
    if (typeof word !== 'string') return '';
    const normalized = word.toLowerCase().trim();
    if (!normalized || !/^[a-z]+$/.test(normalized)) return '';
    return normalized;
}

function loadInvalidWordsFromStorage() {
    invalidWordSet = new Set();
    try {
        const raw = localStorage.getItem(INVALID_WORDS_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        for (const entry of parsed) {
            const normalized = normalizeCandidateWord(entry);
            if (normalized) invalidWordSet.add(normalized);
        }
    } catch {
        // Ignore corrupt storage.
    }
}

function saveInvalidWordsToStorage() {
    try {
        const list = Array.from(invalidWordSet).sort();
        localStorage.setItem(INVALID_WORDS_STORAGE_KEY, JSON.stringify(list));
    } catch {
        // Ignore storage failures.
    }
}

function isWordInvalidForWordle(word) {
    const normalized = normalizeCandidateWord(word);
    return normalized ? invalidWordSet.has(normalized) : false;
}

function applyInvalidWordFilterToLists() {
    if (Array.isArray(baseAnswerList) && baseAnswerList.length) {
        answerList = baseAnswerList.filter(w => !invalidWordSet.has(w));
    }
    if (Array.isArray(baseGuessList) && baseGuessList.length) {
        guessList = baseGuessList.filter(w => !invalidWordSet.has(w));
    }
    if (!guessList.length && Array.isArray(answerList) && answerList.length) {
        guessList = [...answerList];
    }
    updateListCountsUI();
}

function addInvalidWord(word) {
    const normalized = normalizeCandidateWord(word);
    if (!normalized) return false;
    if (invalidWordSet.has(normalized)) return false;
    invalidWordSet.add(normalized);
    saveInvalidWordsToStorage();
    applyInvalidWordFilterToLists();
    analyzeBoard();
    renderInvalidWordsUI();
    return true;
}

function removeInvalidWord(word) {
    const normalized = normalizeCandidateWord(word);
    if (!normalized) return false;
    if (!invalidWordSet.delete(normalized)) return false;
    saveInvalidWordsToStorage();
    applyInvalidWordFilterToLists();
    analyzeBoard();
    renderInvalidWordsUI();
    return true;
}

function clearAllInvalidWords() {
    if (!invalidWordSet.size) return;
    invalidWordSet.clear();
    saveInvalidWordsToStorage();
    applyInvalidWordFilterToLists();
    analyzeBoard();
    renderInvalidWordsUI();
}

function removeInvalidWordsBulk(words) {
    if (!Array.isArray(words) || words.length === 0) return 0;
    let removed = 0;
    for (const w of words) {
        const normalized = normalizeCandidateWord(w);
        if (!normalized) continue;
        if (invalidWordSet.delete(normalized)) removed += 1;
    }
    if (!removed) return 0;
    saveInvalidWordsToStorage();
    applyInvalidWordFilterToLists();
    analyzeBoard();
    renderInvalidWordsUI();
    return removed;
}

function invalidWordsText() {
    if (!invalidWordSet.size) return '';
    return Array.from(invalidWordSet).sort().join('\n');
}

function renderInvalidWordsUI() {
    const listEl = document.getElementById('invalidWordsList');
    const countEl = document.getElementById('invalidWordsCount');
    const countWidgetEl = document.getElementById('invalidWordsCountWidget');
    const textareaEl = document.getElementById('invalidWordsTextarea');
    if (countEl) {
        countEl.textContent = invalidWordSet.size ? String(invalidWordSet.size) : '0';
    }
    if (countWidgetEl) {
        countWidgetEl.textContent = invalidWordSet.size ? String(invalidWordSet.size) : '0';
    }
    if (textareaEl) {
        textareaEl.value = invalidWordsText();
    }
    if (!listEl) return;

    if (!invalidWordSet.size) {
        listEl.innerHTML = '<span style="opacity:0.7;">—</span>';
        return;
    }

    const words = Array.from(invalidWordSet).sort();
    const renderLimit = 60;
    const shown = words.slice(0, renderLimit);
    const truncated = words.length > renderLimit;

    listEl.innerHTML = `
        <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
            ${shown.map(w => `<button class="small-btn invalid-word-chip" data-word="${w}" title="Remove">${w.toUpperCase()} ×</button>`).join('')}
            ${truncated ? `<span style="opacity:0.75; font-size:12px;">+${words.length - renderLimit} more</span>` : ''}
        </div>
    `;

    listEl.querySelectorAll('.invalid-word-chip').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const w = btn.dataset.word;
            if (w) removeInvalidWord(w);
        });
    });
}

function getRowWordIfComplete(row) {
    const L = boardCols();
    const start = row * L;
    let w = '';
    for (let col = 0; col < L; col++) {
        const ch = tiles[start + col]?.textContent?.toLowerCase?.().trim?.() || '';
        if (!/^[a-z]$/.test(ch)) return null;
        w += ch;
    }
    return w;
}

function clearRowConfirmation(row) {
    if (row >= 0 && row < confirmedRowWords.length) {
        confirmedRowWords[row] = null;
    }
}

function clearRowFeedbackFlags(row) {
    const L = boardCols();
    const start = row * L;
    for (let col = 0; col < L; col++) {
        const tile = tiles[start + col];
        if (!tile) continue;
        delete tile.dataset.manualState;
        delete tile.dataset.autoColored;
    }
}

function confirmRowIfComplete(row) {
    const w = getRowWordIfComplete(row);
    if (!w) return false;
    confirmedRowWords[row] = w;
    return true;
}

function isRowConfirmed(row) {
    const w = getRowWordIfComplete(row);
    if (!w) return false;
    return confirmedRowWords[row] === w;
}

function rowHasAnyFeedbackFlags(row) {
    const L = boardCols();
    const start = row * L;
    for (let col = 0; col < L; col++) {
        const tile = tiles[start + col];
        if (!tile) continue;
        if (tile.dataset.autoColored === 'true') return true;
        if (tile.dataset.manualState) return true;
    }
    return false;
}

function autoConfirmRowsFromFeedbackFlags() {
    for (let row = 0; row < boardRows(); row++) {
        if (isRowConfirmed(row)) continue;
        const w = getRowWordIfComplete(row);
        if (!w) continue;
        if (!rowHasAnyFeedbackFlags(row)) continue;
        confirmedRowWords[row] = w;
    }
}

function setCssBoardDims() {
    // Keep CSS layout in sync with current word length.
    // (Used by #grid, .row-controls, and per-position filters.)
    document.documentElement.style.setProperty('--board-cols', String(boardCols()));
    document.documentElement.style.setProperty('--board-rows', String(boardRows()));
}

// Cached precomputations for scoring (avoid O(n^2) when word lists grow).
let positionalFrequencyTableCache = {
    version: -1,
    length: null,
    denom: 1,
    table: null
};

let positionalPatternTableCache = {
    version: -1,
    length: null,
    bigramCounts: null,
    trigramCounts: null,
    transitionCounts: null,
    start2Counts: null,
    end2Counts: null,
    prefixCounts: null,
    suffixCounts: null
};

function ensurePositionalFrequencyTable() {
    const L = boardCols();
    if (positionalFrequencyTableCache.version === filteredWordsVersion &&
        positionalFrequencyTableCache.length === L &&
        positionalFrequencyTableCache.table) {
        return;
    }

    const table = Array.from({ length: L }, () => Object.create(null));
    for (const w of filteredWords) {
        for (let i = 0; i < L; i++) {
            const letter = w[i];
            table[i][letter] = (table[i][letter] || 0) + 1;
        }
    }

    positionalFrequencyTableCache = {
        version: filteredWordsVersion,
        length: L,
        denom: Math.max(filteredWords.length, 1),
        table
    };
}

function ensurePositionalPatternTables() {
    const L = boardCols();
    if (positionalPatternTableCache.version === filteredWordsVersion &&
        positionalPatternTableCache.length === L &&
        positionalPatternTableCache.bigramCounts) {
        return;
    }

    const bigramCounts = Object.create(null);
    const trigramCounts = Object.create(null);
    const transitionCounts = Object.create(null);
    const start2Counts = Object.create(null);
    const end2Counts = Object.create(null);
    const prefixCounts = Object.create(null);
    const suffixCounts = Object.create(null);
    const affixLen = Math.min(3, L);

    for (const w of filteredWords) {
        const start2 = w.slice(0, 2);
        const end2 = w.slice(-2);
        const prefix = w.slice(0, affixLen);
        const suffix = w.slice(-affixLen);

        start2Counts[start2] = (start2Counts[start2] || 0) + 1;
        end2Counts[end2] = (end2Counts[end2] || 0) + 1;
        prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
        suffixCounts[suffix] = (suffixCounts[suffix] || 0) + 1;

        for (let i = 0; i < Math.max(0, L - 1); i++) {
            const bigramKey = `${i}:${w[i]}${w[i+1]}`;
            bigramCounts[bigramKey] = (bigramCounts[bigramKey] || 0) + 1;

            const transitionKey = `${i}:${w[i]}->${w[i+1]}`;
            transitionCounts[transitionKey] = (transitionCounts[transitionKey] || 0) + 1;
        }
        for (let i = 0; i < Math.max(0, L - 2); i++) {
            const trigramKey = `${i}:${w[i]}${w[i+1]}${w[i+2]}`;
            trigramCounts[trigramKey] = (trigramCounts[trigramKey] || 0) + 1;
        }
    }

    positionalPatternTableCache = {
        version: filteredWordsVersion,
        length: L,
        bigramCounts,
        trigramCounts,
        transitionCounts,
        start2Counts,
        end2Counts,
        prefixCounts,
        suffixCounts
    };
}

// Cache for individual method scores when blending
let blendScoresCache = {
    method1: null,
    method2: null,
    method1Name: null,
    method2Name: null,
    filteredWordsVersion: -1
};

// Letter presence counts in Wordle answers (from wordle-cribs.md)
// How many words each letter appears in (out of ~2315 total)
const LETTER_PRESENCE_COUNTS = {
    'e': 1056, 'a': 909, 'r': 837, 'o': 673, 't': 667, 'l': 648, 'i': 647, 's': 618,
    'n': 550, 'u': 457, 'c': 448, 'y': 417, 'h': 379, 'd': 370, 'p': 346, 'g': 300,
    'm': 298, 'b': 267, 'f': 207, 'k': 202, 'w': 194, 'v': 149, 'x': 37, 'z': 35,
    'q': 29, 'j': 27
};

// Contingency table from wordle-cribs.md
// Given letter in row, how many words contain letter in column
const CONTINGENCY_TABLE = {
    'a': {'a': 70, 'b': 107, 'c': 179, 'd': 130, 'e': 362, 'f': 66, 'g': 110, 'h': 123, 'i': 142, 'j': 7, 'k': 83, 'l': 288, 'm': 124, 'n': 198, 'o': 151, 'p': 119, 'q': 12, 'r': 318, 's': 224, 't': 257, 'u': 76, 'v': 66, 'w': 59, 'x': 12, 'y': 144, 'z': 19},
    'b': {'a': 107, 'b': 13, 'c': 29, 'd': 38, 'e': 119, 'f': 7, 'g': 25, 'h': 26, 'i': 62, 'j': 2, 'k': 17, 'l': 83, 'm': 26, 'n': 46, 'o': 82, 'p': 6, 'q': 1, 'r': 94, 's': 35, 't': 56, 'u': 62, 'v': 4, 'w': 9, 'x': 4, 'y': 41, 'z': 6},
    'c': {'a': 179, 'b': 29, 'c': 29, 'd': 37, 'e': 171, 'f': 25, 'g': 13, 'h': 118, 'i': 115, 'j': 3, 'k': 68, 'l': 101, 'm': 49, 'n': 88, 'o': 125, 'p': 54, 'q': 2, 'r': 145, 's': 85, 't': 95, 'u': 90, 'v': 18, 'w': 20, 'x': 3, 'y': 43, 'z': 2},
    'd': {'a': 130, 'b': 38, 'c': 37, 'd': 22, 'e': 179, 'f': 18, 'g': 42, 'h': 29, 'i': 123, 'j': 2, 'k': 8, 'l': 83, 'm': 32, 'n': 76, 'o': 109, 'p': 29, 'q': 1, 'r': 129, 's': 38, 't': 61, 'u': 71, 'v': 15, 'w': 33, 'x': 3, 'y': 82, 'z': 2},
    'e': {'a': 362, 'b': 119, 'c': 171, 'd': 179, 'e': 172, 'f': 83, 'g': 131, 'h': 136, 'i': 232, 'j': 9, 'k': 65, 'l': 280, 'm': 114, 'n': 218, 'o': 209, 'p': 156, 'q': 13, 'r': 424, 's': 256, 't': 277, 'u': 140, 'v': 98, 'w': 86, 'x': 23, 'y': 97, 'z': 19},
    'f': {'a': 66, 'b': 7, 'c': 25, 'd': 18, 'e': 83, 'f': 22, 'g': 15, 'h': 24, 'i': 71, 'j': 2, 'k': 17, 'l': 72, 'm': 11, 'n': 34, 'o': 51, 'p': 3, 'q': 0, 'r': 78, 's': 32, 't': 57, 'u': 40, 'v': 2, 'w': 9, 'x': 2, 'y': 37, 'z': 4},
    'g': {'a': 110, 'b': 25, 'c': 13, 'd': 42, 'e': 131, 'f': 15, 'g': 11, 'h': 31, 'i': 98, 'j': 1, 'k': 4, 'l': 72, 'm': 28, 'n': 101, 'o': 84, 'p': 19, 'q': 0, 'r': 95, 's': 39, 't': 51, 'u': 73, 'v': 15, 'w': 16, 'x': 0, 'y': 47, 'z': 4},
    'h': {'a': 123, 'b': 26, 'c': 118, 'd': 29, 'e': 136, 'f': 24, 'g': 31, 'h': 10, 'i': 87, 'j': 1, 'k': 26, 'l': 61, 'm': 38, 'n': 62, 'o': 98, 'p': 42, 'q': 2, 'r': 101, 's': 114, 't': 135, 'u': 68, 'v': 10, 'w': 40, 'x': 2, 'y': 49, 'z': 1},
    'i': {'a': 142, 'b': 62, 'c': 115, 'd': 123, 'e': 232, 'f': 71, 'g': 98, 'h': 87, 'i': 24, 'j': 6, 'k': 46, 'l': 168, 'm': 75, 'n': 192, 'o': 91, 'p': 96, 'q': 11, 'r': 194, 's': 147, 't': 192, 'u': 63, 'v': 51, 'w': 45, 'x': 20, 'y': 85, 'z': 9},
    'j': {'a': 7, 'b': 2, 'c': 3, 'd': 2, 'e': 9, 'f': 2, 'g': 1, 'h': 1, 'i': 6, 'j': 0, 'k': 2, 'l': 3, 'm': 3, 'n': 7, 'o': 12, 'p': 1, 'q': 0, 'r': 6, 's': 2, 't': 8, 'u': 10, 'v': 0, 'w': 1, 'x': 0, 'y': 9, 'z': 1},
    'k': {'a': 83, 'b': 17, 'c': 68, 'd': 8, 'e': 65, 'f': 17, 'g': 4, 'h': 26, 'i': 46, 'j': 2, 'k': 8, 'l': 54, 'm': 12, 'n': 55, 'o': 39, 'p': 23, 'q': 5, 'r': 56, 's': 69, 't': 29, 'u': 35, 'v': 3, 'w': 13, 'x': 0, 'y': 33, 'z': 0},
    'l': {'a': 288, 'b': 83, 'c': 101, 'd': 83, 'e': 280, 'f': 72, 'g': 72, 'h': 61, 'i': 168, 'j': 3, 'k': 54, 'l': 71, 'm': 65, 'n': 99, 'o': 158, 'p': 86, 'q': 6, 'r': 114, 's': 129, 't': 123, 'u': 114, 'v': 45, 'w': 46, 'x': 10, 'y': 108, 'z': 8},
    'm': {'a': 124, 'b': 26, 'c': 49, 'd': 32, 'e': 114, 'f': 11, 'g': 28, 'h': 38, 'i': 75, 'j': 3, 'k': 12, 'l': 65, 'm': 15, 'n': 46, 'o': 91, 'p': 44, 'q': 1, 'r': 87, 's': 61, 't': 55, 'u': 69, 'v': 5, 'w': 8, 'x': 3, 'y': 54, 'z': 2},
    'n': {'a': 198, 'b': 46, 'c': 88, 'd': 76, 'e': 218, 'f': 34, 'g': 101, 'h': 62, 'i': 192, 'j': 7, 'k': 55, 'l': 99, 'm': 46, 'n': 23, 'o': 173, 'p': 52, 'q': 1, 'r': 132, 's': 113, 't': 119, 'u': 106, 'v': 25, 'w': 49, 'x': 7, 'y': 81, 'z': 4},
    'o': {'a': 151, 'b': 82, 'c': 125, 'd': 109, 'e': 209, 'f': 51, 'g': 84, 'h': 98, 'i': 91, 'j': 12, 'k': 39, 'l': 158, 'm': 91, 'n': 173, 'o': 81, 'p': 82, 'q': 3, 'r': 253, 's': 154, 't': 181, 'u': 96, 'v': 56, 'w': 71, 'x': 13, 'y': 98, 'z': 9},
    'p': {'a': 119, 'b': 6, 'c': 54, 'd': 29, 'e': 156, 'f': 3, 'g': 19, 'h': 42, 'i': 96, 'j': 1, 'k': 23, 'l': 86, 'm': 44, 'n': 52, 'o': 82, 'p': 19, 'q': 2, 'r': 116, 's': 116, 't': 79, 'u': 64, 'v': 6, 'w': 12, 'x': 5, 'y': 69, 'z': 5},
    'q': {'a': 12, 'b': 1, 'c': 2, 'd': 1, 'e': 13, 'f': 0, 'g': 0, 'h': 2, 'i': 11, 'j': 0, 'k': 5, 'l': 6, 'm': 1, 'n': 1, 'o': 3, 'p': 2, 'q': 0, 'r': 5, 's': 6, 't': 9, 'u': 29, 'v': 0, 'w': 0, 'x': 0, 'y': 1, 'z': 0},
    'r': {'a': 318, 'b': 94, 'c': 145, 'd': 129, 'e': 424, 'f': 78, 'g': 95, 'h': 101, 'i': 194, 'j': 6, 'k': 56, 'l': 114, 'm': 87, 'n': 132, 'o': 253, 'p': 116, 'q': 5, 'r': 60, 's': 165, 't': 205, 'u': 139, 'v': 56, 'w': 76, 'x': 7, 'y': 109, 'z': 10},
    's': {'a': 224, 'b': 35, 'c': 85, 'd': 38, 'e': 256, 'f': 32, 'g': 39, 'h': 114, 'i': 147, 'j': 2, 'k': 69, 'l': 129, 'm': 61, 'n': 113, 'o': 154, 'p': 116, 'q': 6, 'r': 165, 's': 49, 't': 201, 'u': 129, 'v': 22, 'w': 49, 'x': 3, 'y': 91, 'z': 2},
    't': {'a': 257, 'b': 56, 'c': 95, 'd': 61, 'e': 277, 'f': 57, 'g': 51, 'h': 135, 'i': 192, 'j': 8, 'k': 29, 'l': 123, 'm': 55, 'n': 119, 'o': 181, 'p': 79, 'q': 9, 'r': 205, 's': 201, 't': 61, 'u': 138, 'v': 20, 'w': 42, 'x': 13, 'y': 81, 'z': 5},
    'u': {'a': 76, 'b': 62, 'c': 90, 'd': 71, 'e': 140, 'f': 40, 'g': 73, 'h': 68, 'i': 63, 'j': 10, 'k': 35, 'l': 114, 'm': 69, 'n': 106, 'o': 96, 'p': 64, 'q': 29, 'r': 139, 's': 129, 't': 138, 'u': 10, 'v': 15, 'w': 6, 'x': 2, 'y': 71, 'z': 4},
    'v': {'a': 66, 'b': 4, 'c': 18, 'd': 15, 'e': 98, 'f': 2, 'g': 15, 'h': 10, 'i': 51, 'j': 0, 'k': 3, 'l': 45, 'm': 5, 'n': 25, 'o': 56, 'p': 6, 'q': 0, 'r': 56, 's': 22, 't': 20, 'u': 15, 'v': 4, 'w': 5, 'x': 1, 'y': 13, 'z': 0},
    'w': {'a': 59, 'b': 9, 'c': 20, 'd': 33, 'e': 86, 'f': 9, 'g': 16, 'h': 40, 'i': 45, 'j': 1, 'k': 13, 'l': 46, 'm': 8, 'n': 49, 'o': 71, 'p': 12, 'q': 0, 'r': 76, 's': 49, 't': 42, 'u': 6, 'v': 5, 'w': 1, 'x': 2, 'y': 29, 'z': 2},
    'x': {'a': 12, 'b': 4, 'c': 3, 'd': 3, 'e': 23, 'f': 2, 'g': 0, 'h': 2, 'i': 20, 'j': 0, 'k': 0, 'l': 10, 'm': 3, 'n': 7, 'o': 13, 'p': 5, 'q': 0, 'r': 7, 's': 3, 't': 13, 'u': 2, 'v': 1, 'w': 2, 'x': 0, 'y': 3, 'z': 0},
    'y': {'a': 144, 'b': 41, 'c': 43, 'd': 82, 'e': 97, 'f': 37, 'g': 47, 'h': 49, 'i': 85, 'j': 9, 'k': 33, 'l': 108, 'm': 54, 'n': 81, 'o': 98, 'p': 69, 'q': 1, 'r': 109, 's': 91, 't': 81, 'u': 71, 'v': 13, 'w': 29, 'x': 3, 'y': 8, 'z': 8},
    'z': {'a': 19, 'b': 6, 'c': 2, 'd': 2, 'e': 19, 'f': 4, 'g': 4, 'h': 1, 'i': 9, 'j': 1, 'k': 0, 'l': 8, 'm': 2, 'n': 4, 'o': 9, 'p': 5, 'q': 0, 'r': 10, 's': 2, 't': 5, 'u': 4, 'v': 0, 'w': 2, 'x': 0, 'y': 8, 'z': 5}
};

const SCORE_MODE_LABELS = {
    'frequency': 'Letter Frequency',
    'language-frequency': 'Common Usage',
    'presence': 'Presence',
    'contingency': 'Contingency',
    'probe': 'Probe',
    'entropy': 'Entropy',
    'expected': 'Expected Value',
    'minimax': 'Minimax',
    'positional-frequency': 'Positional Frequency',
    'positional-entropy': 'Positional Entropy',
    'positional-entropy-heuristic': 'Positional Entropy+',
    'positional-pattern': 'Positional Pattern',
    'positional-weight': 'Positional Weight',
    'blend': 'Blend'
};

const BLENDABLE_SCORE_MODES = [
    'frequency',
    'language-frequency',
    'presence',
    'contingency',
    'probe',
    'entropy',
    'expected',
    'minimax',
    'positional-frequency',
    'positional-entropy',
    'positional-entropy-heuristic',
    'positional-pattern',
    'positional-weight'
];

const BLEND_COLOR_MAP = {
    'frequency': '#8bc34a',
    'language-frequency': '#ffc857',
    'presence': '#ff6f61',
    'contingency': '#b388eb',
    'probe': '#4dd0e1',
    'entropy': '#00d084',
    'expected': '#f4a261',
    'minimax': '#ff4081',
    'positional-frequency': '#64b5f6',
    'positional-entropy': '#1e88e5',
    'positional-entropy-heuristic': '#43a047',
    'positional-pattern': '#ba68c8',
    'positional-weight': '#ff8f00',
    'blend': '#607d8b'
};

const MODERN_USAGE_TABLE = (typeof MODERN_WORD_FREQUENCY === 'object' && MODERN_WORD_FREQUENCY !== null)
    ? MODERN_WORD_FREQUENCY
    : {};

const NORMALIZED_MODERN_USAGE = (() => {
    const normalized = {};
    const temp = [];
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const [word, freq] of Object.entries(MODERN_USAGE_TABLE)) {
        const value = Math.log10((freq || 0) + 1);
        temp.push([word, value]);
        if (value < minVal) minVal = value;
        if (value > maxVal) maxVal = value;
    }
    const range = Math.max(maxVal - minVal, 1);
    for (const [word, value] of temp) {
        normalized[word] = (value - minVal) / range;
    }
    return normalized;
})();

let blendRowIdCounter = 0;
function nextBlendRowId() {
    blendRowIdCounter += 1;
    return `blend-${blendRowIdCounter}`;
}

let blendConfig = [
    { id: nextBlendRowId(), mode: 'language-frequency', weight: 50 },
    { id: nextBlendRowId(), mode: 'positional-entropy', weight: 50 }
];

function modernLanguageFrequencyScore(word) {
    // Multiply by 4.961 to make scores comparable to positional frequency
    return (NORMALIZED_MODERN_USAGE[word] ?? 0) * 4.961;
}

const STATES = {
    GRAY: 'gray',
    YELLOW: 'yellow',
    GREEN: 'green'
};

function setFilteredWords(newList) {
    filteredWords = newList;
    filteredWordsVersion++;
    _partitionCache.clear();
}

function getScoreLabel(mode) {
    // Handle blended modes like "method1+method2"
    if (mode.includes('+')) {
        const methods = mode.split('+');
        const labels = methods.map(m => SCORE_MODE_LABELS[m] || m);
        return labels.join(' + ');
    }
    return SCORE_MODE_LABELS[mode] || mode;
}

function isHeavyMode(mode) {
    return HEAVY_SCORE_MODES.has(mode);
}

function createScoringToken() {
    if (activeScoringToken) {
        activeScoringToken.cancelled = true;
    }
    const token = { cancelled: false };
    activeScoringToken = token;
    return token;
}

function cancelActiveScoring() {
    if (activeScoringToken) {
        activeScoringToken.cancelled = true;
        activeScoringToken = null;
    }
}

function shouldShowSpinnerForMode(mode) {
    if (mode === 'blend') {
        return getNormalizedBlendStrategies().some(entry => isHeavyMode(entry.mode));
    }
    // Check if mode is a blend of multiple methods (e.g., "method1+method2")
    if (mode.includes('+')) {
        const methods = mode.split('+');
        return methods.some(m => isHeavyMode(m));
    }
    return isHeavyMode(mode);
}

function getNormalizedBlendStrategies() {
    if (!blendConfig.length) return [];
    const total = blendConfig.reduce((sum, row) => sum + Math.max(row.weight, 0), 0);
    const safeTotal = total > 0 ? total : blendConfig.length;
    return blendConfig.map(row => ({
        id: row.id,
        mode: row.mode,
        weight: Math.max(row.weight, 0) / safeTotal
    }));
}

function ensureBlendMinimum() {
    while (blendConfig.length < 2) {
        const mode = BLENDABLE_SCORE_MODES[blendConfig.length] || BLENDABLE_SCORE_MODES[0];
        blendConfig.push({ id: nextBlendRowId(), mode, weight: 50 });
    }
}

function findNextBlendMode() {
    for (const mode of BLENDABLE_SCORE_MODES) {
        if (!blendConfig.some(row => row.mode === mode)) {
            return mode;
        }
    }
    return BLENDABLE_SCORE_MODES[0];
}

function addBlendRow(preferredMode = null) {
    const mode = preferredMode || findNextBlendMode();
    blendConfig.push({ id: nextBlendRowId(), mode, weight: 50 });
}

function updateBlendGradientBar() {
    const bar = document.getElementById('blendGradientBar');
    if (!bar) return;
    const strategies = getNormalizedBlendStrategies();
    if (!strategies.length) {
        bar.style.background = 'linear-gradient(90deg, rgba(255,255,255,0.2), rgba(255,255,255,0.05))';
        return;
    }
    const stops = [];
    let cursor = 0;
    strategies.forEach(strategy => {
        const color = BLEND_COLOR_MAP[strategy.mode] || '#888888';
        const start = cursor * 100;
        cursor += strategy.weight;
        const end = cursor * 100;
        stops.push(`${color} ${start}% ${end}%`);
    });
    bar.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
}

// Define filterWords() - called in several places but was not defined
function filterWords() {
    analyzeBoard();
}

function clampWordLength(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return 5;
    return Math.max(WORD_LENGTH_MIN, Math.min(WORD_LENGTH_MAX, parsed));
}

function getRawListForLength(length, kind) {
    if (typeof window !== 'undefined') {
        const lists = window[kind];
        if (lists && Array.isArray(lists[length])) {
            return lists[length];
        }
    }
    return null;
}

function getRawAnswerListForLength(length) {
    const answer = getRawListForLength(length, 'WORD_LISTS');
    if (Array.isArray(answer)) return answer;
    if (length === 5 && typeof WORD_LIST !== 'undefined') return WORD_LIST;
    // Fallback: if only a guess pool is provided, use it as the candidate list.
    const guessFallback = getRawListForLength(length, 'GUESS_LISTS');
    if (Array.isArray(guessFallback)) return guessFallback;
    return null;
}

function getRawGuessListForLength(length) {
    const guess = getRawListForLength(length, 'GUESS_LISTS');
    if (Array.isArray(guess)) return guess;
    return getRawAnswerListForLength(length);
}

function ensureArtWordListLoaded() {
    if (Array.isArray(artWordList) && artWordList.length > 0) {
        return;
    }
    if (typeof WORD_LIST === 'undefined') {
        return;
    }
    artWordList = WORD_LIST
        .filter(word => word && word.length === 5)
        .map(word => word.toLowerCase().trim());
}

function renderPerPositionFilterInputs() {
    const perPosition = document.getElementById('perPositionInputs');
    if (!perPosition) return;
    const wraps = perPosition.querySelectorAll('.position-inputs');
    if (wraps.length < 2) return;
    const excludeWrap = wraps[0];
    const includeWrap = wraps[1];

    function buildInput(className, pos) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = className;
        input.dataset.pos = String(pos);
        input.placeholder = String(pos + 1);
        input.maxLength = 26;
        input.inputMode = 'text';
        input.setAttribute('autocapitalize', 'characters');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('spellcheck', 'false');
        return input;
    }

    excludeWrap.innerHTML = '';
    includeWrap.innerHTML = '';

    for (let pos = 0; pos < boardCols(); pos++) {
        excludeWrap.appendChild(buildInput('position-input', pos));
        includeWrap.appendChild(buildInput('position-include-input', pos));
    }
}

function normalizeWordArray(raw, length) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const result = [];
    for (const entry of raw) {
        if (typeof entry !== 'string') continue;
        const word = entry.toLowerCase().trim();
        if (word.length !== length) continue;
        if (!/^[a-z]+$/.test(word)) continue;
        if (seen.has(word)) continue;
        seen.add(word);
        result.push(word);
    }
    return result;
}

function updateListCountsUI() {
    const el = document.getElementById('listCounts');
    if (!el) return;
    const answers = Array.isArray(answerList) ? answerList.length : 0;
    const guesses = Array.isArray(guessList) ? guessList.length : 0;
    if (!answers && !guesses) {
        el.textContent = '—';
        return;
    }
    el.textContent = `${answers.toLocaleString()} answers • ${guesses.toLocaleString()} guesses`;
}

function loadWords() {
    const rawAnswers = getRawAnswerListForLength(WORD_LENGTH);
    const rawGuesses = getRawGuessListForLength(WORD_LENGTH);
    if (Array.isArray(rawAnswers)) {
        baseAnswerList = normalizeWordArray(rawAnswers, WORD_LENGTH);
        baseGuessList = normalizeWordArray(rawGuesses || rawAnswers, WORD_LENGTH);
        answerList = baseAnswerList.filter(w => !invalidWordSet.has(w));
        guessList = baseGuessList.filter(w => !invalidWordSet.has(w));
        if (!guessList.length) guessList = [...answerList];

        setFilteredWords([...answerList]);
        console.log(`Loaded ${answerList.length} answers, ${guessList.length} guesses (length ${WORD_LENGTH})`);
        updateListCountsUI();
        updateWordDisplay();
    } else {
        if (WORD_LENGTH !== 5) {
            console.error(`Word list for length ${WORD_LENGTH} not found. Falling back to 5.`);
            WORD_LENGTH = 5;
            try { localStorage.setItem('wordLength', '5'); } catch {}
            setCssBoardDims();
            const select = document.getElementById('wordLengthSelect');
            if (select) select.value = '5';
            renderPerPositionFilterInputs();
            createGrid();
            loadWords();
            return;
        }
        if (!loadWords._retries) loadWords._retries = 0;
        loadWords._retries++;
        if (loadWords._retries > 10) {
            console.error('Word list failed to load after 10 retries.');
            document.getElementById('wordList').innerHTML =
                '<p style="color:#e55; padding:12px;">Word list failed to load. Please refresh the page.</p>';
            return;
        }
        const delay = Math.min(100 * Math.pow(2, loadWords._retries - 1), 5000);
        console.error(`Word list not found (attempt ${loadWords._retries}/10). Retrying in ${delay}ms...`);
        setTimeout(loadWords, delay);
    }
}


function highlightNextInput() {
    // Remove existing highlight
    tiles.forEach(t => t.classList.remove('next-input'));

    // Find first empty tile
    for (let i = 0; i < tiles.length; i++) {
        if (!tiles[i].textContent) {
            tiles[i].classList.add('next-input');
            break;
        }
    }
}

function createGrid() {
    const grid = document.getElementById('grid');
    const rowControls = document.getElementById('rowControls');
    grid.innerHTML = '';
    rowControls.innerHTML = '';
    tiles = [];
    confirmedRowWords = Array.from({ length: boardRows() }, () => null);
    setCssBoardDims();

    // Create trash buttons for each row
    for (let row = 0; row < boardRows(); row++) {
        const trashBtn = document.createElement('button');
        trashBtn.className = 'trash-btn';
        trashBtn.innerHTML = '🗑️';
        trashBtn.title = `Clear row ${row + 1}`;
        trashBtn.addEventListener('click', () => clearRow(row));
        rowControls.appendChild(trashBtn);
    }

    for (let row = 0; row < boardRows(); row++) {
        for (let col = 0; col < boardCols(); col++) {
            const tile = document.createElement('div');
            tile.className = 'tile gray';
            tile.dataset.row = row;
            tile.dataset.col = col;
            tile.dataset.state = STATES.GRAY;
            tile.contentEditable = true;
            tile.tabIndex = boardTileIndex(row, col);
            tile.inputMode = 'text';
            tile.setAttribute('autocapitalize', 'characters');
            tile.setAttribute('autocorrect', 'off');
            tile.setAttribute('autocomplete', 'off');

            // Track if tile was focused before interaction
            let wasFocusedBeforeInteraction = false;
            let lastTouchTime = 0;

            // Prevent iOS text selection on touch
            tile.addEventListener('touchstart', (e) => {
                wasFocusedBeforeInteraction = (document.activeElement === tile);
                lastTouchTime = Date.now();

                // If already focused, prevent default to avoid text selection
                if (wasFocusedBeforeInteraction) {
                    e.preventDefault();
                }
            }, { passive: false });

            tile.addEventListener('touchend', (e) => {
                const touchDuration = Date.now() - lastTouchTime;

                // Only handle quick taps (not long press)
                if (touchDuration < 300) {
                    if (wasFocusedBeforeInteraction) {
                        // Already focused - cycle color
                        e.preventDefault();
                        cycleState(tile);
                    } else {
                        // First tap - focus and show keyboard
                        e.preventDefault();
                        tile.focus();
                        // Move cursor to end
                        const range = document.createRange();
                        const sel = window.getSelection();
                        range.selectNodeContents(tile);
                        range.collapse(false);
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                }
            }, { passive: false });

            tile.addEventListener('mousedown', () => {
                wasFocusedBeforeInteraction = (document.activeElement === tile);
            });

            // Event listeners
            tile.addEventListener('focus', () => {
                currentTile = tile;
                tile.classList.add('selected');
                highlightActiveRow(row);
            });

            tile.addEventListener('blur', () => {
                tile.classList.remove('selected');
            });

            tile.addEventListener('click', (e) => {
                // Skip if this was a touch event (handled by touchend)
                if (lastTouchTime && (Date.now() - lastTouchTime) < 500) {
                    return;
                }

                if (e.ctrlKey || e.metaKey) {
                    // Ctrl/Cmd-click clears the tile (makes it blank and gray)
                    e.preventDefault();
                    clearRowConfirmation(row);
                    clearRowFeedbackFlags(row);
                    tile.textContent = '';
                    tile.classList.remove('yellow', 'green');
                    tile.classList.add('gray');
                    tile.dataset.state = STATES.GRAY;
                    delete tile.dataset.autofilled;
                    delete tile.dataset.autofilledSolution;
                    delete tile.dataset.manualEntry;
                    delete tile.dataset.manualState;
                    delete tile.dataset.autoColored;
                    filterWords();
                } else if (e.shiftKey) {
                    // Shift-click always cycles colors
                    e.preventDefault();
                    cycleState(tile);
                } else if (wasFocusedBeforeInteraction) {
                    // Regular click cycles if already focused
                    e.preventDefault();
                    cycleState(tile);
                }
                // If it wasn't focused, the click will naturally focus it
            });
            
            tile.addEventListener('keydown', (e) => handleKeyDown(e, tile));
            tile.addEventListener('input', (e) => handleInput(e, tile));
            tile.addEventListener('paste', (e) => handlePasteIntoTile(e, tile));
            tile.setAttribute('spellcheck', 'false');
            
            grid.appendChild(tile);
            tiles.push(tile);
        }
    }
    
    // Focus first tile and highlight next input
    if (tiles[0]) {
        // On touch devices, create a small input overlay on first tile to trigger keyboard
        // iOS only shows keyboard when user directly taps an input element
        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        if (isTouchDevice) {
            const firstTile = tiles[0];
            const overlay = document.createElement('input');
            overlay.type = 'text';
            overlay.className = 'keyboard-trigger-overlay';
            overlay.setAttribute('autocapitalize', 'characters');
            overlay.setAttribute('autocorrect', 'off');
            overlay.setAttribute('autocomplete', 'off');
            overlay.inputMode = 'text';

            // Position overlay exactly over the first tile
            Object.assign(overlay.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                background: 'transparent',
                border: 'none',
                zIndex: '10',
                fontSize: '16px', // Prevents iOS zoom
                color: 'transparent',
                caretColor: 'transparent',
                cursor: 'text'
            });

            firstTile.style.position = 'relative';
            firstTile.appendChild(overlay);

            const removeOverlay = () => {
                if (overlay.parentNode) overlay.remove();
            };

            // When user types, put character in tile and remove overlay
            overlay.addEventListener('input', (e) => {
                const char = e.target.value.slice(-1).toUpperCase();
                if (/^[A-Z]$/.test(char)) {
                    firstTile.textContent = char;
                    removeOverlay();
                    // Trigger the tile's input handler
                    const inputEvent = new Event('input', { bubbles: true });
                    firstTile.dispatchEvent(inputEvent);
                } else {
                    overlay.value = '';
                }
            });

            // Remove overlay if user taps elsewhere
            overlay.addEventListener('blur', () => {
                setTimeout(() => {
                    removeOverlay();
                }, 50);
            });
        } else {
            // Desktop: just focus the first tile
            tiles[0].focus();
        }
    }
    highlightNextInput();
    updateConstraintsDigest();
    updateGhostHints();
}

function highlightActiveRow(rowIndex) {
    // Remove active-row class from all tiles
    tiles.forEach(tile => {
        tile.classList.remove('active-row');
        tile.classList.remove('unused-row');
    });

    // Check each row and dim unused ones
    for (let row = 0; row < boardRows(); row++) {
        let rowIsEmpty = true;
        for (let col = 0; col < boardCols(); col++) {
            const tileIndex = boardTileIndex(row, col);
            if (tiles[tileIndex] && tiles[tileIndex].textContent.trim()) {
                rowIsEmpty = false;
                break;
            }
        }

        // Dim unused rows (empty rows after the active row)
        if (rowIsEmpty && row > rowIndex) {
            for (let col = 0; col < boardCols(); col++) {
                const tileIndex = boardTileIndex(row, col);
                if (tiles[tileIndex]) {
                    tiles[tileIndex].classList.add('unused-row');
                }
            }
        }
    }

    // Add active-row class to all tiles in the focused row
    for (let col = 0; col < boardCols(); col++) {
        const tileIndex = boardTileIndex(rowIndex, col);
        if (tiles[tileIndex]) {
            tiles[tileIndex].classList.add('active-row');
        }
    }

    // Update ghost hints for all rows
    updateGhostHints();
}

function updateGhostHints() {
    // First, remove all ghost hints
    tiles.forEach(tile => {
        tile.classList.remove('ghost-green', 'ghost-yellow');
    });

    // Collect green positions and yellow letters from all filled rows
    const greenPositions = {}; // { column: letter }
    const yellowLetters = new Set(); // All letters that are yellow somewhere

    for (let row = 0; row < boardRows(); row++) {
        for (let col = 0; col < boardCols(); col++) {
            const tileIndex = boardTileIndex(row, col);
            const tile = tiles[tileIndex];
            if (!tile) continue;

            const letter = tile.textContent.toLowerCase().trim();
            const state = tile.dataset.state;

            if (letter && state === STATES.GREEN) {
                greenPositions[col] = letter;
            } else if (letter && state === STATES.YELLOW) {
                yellowLetters.add(letter);
            }
        }
    }

    // Apply ghost hints to all rows
    for (let row = 0; row < boardRows(); row++) {
        for (let col = 0; col < boardCols(); col++) {
            const tileIndex = boardTileIndex(row, col);
            const tile = tiles[tileIndex];
            if (!tile) continue;

            const letter = tile.textContent.toLowerCase().trim();
            const state = tile.dataset.state;

            // Only apply ghost hints to empty tiles
            if (!letter) {
                // Add ghost-green hint if this column has a locked green letter
                if (greenPositions[col]) {
                    tile.classList.add('ghost-green');
                }
            }

            // Add ghost-yellow hint if this tile contains a yellow letter
            if (letter && yellowLetters.has(letter) && state !== STATES.GREEN && state !== STATES.YELLOW) {
                tile.classList.add('ghost-yellow');
            }
        }
    }
}

// ========== Art Planner: create a 6x5 color-selectable grid (no letters) ==========
function createArtPlannerGrid() {
    const artGrid = document.getElementById('artGrid');
    if (!artGrid) return;
    artGrid.innerHTML = '';
    artTiles = [];

    for (let row = 0; row < 6; row++) {
        // Create a row container for drag-drop
        const rowContainer = document.createElement('div');
        rowContainer.className = 'art-row-container';
        rowContainer.dataset.rowIndex = row;

        // Add drop event handlers
        rowContainer.addEventListener('dragover', handleArtRowDragOver);
        rowContainer.addEventListener('drop', handleArtRowDrop);
        rowContainer.addEventListener('dragleave', handleArtRowDragLeave);

        for (let col = 0; col < 5; col++) {
            const tile = document.createElement('div');
            tile.className = 'tile gray art-tile';
            tile.dataset.row = row;
            tile.dataset.col = col;
            tile.dataset.state = STATES.GRAY;
            tile.addEventListener('click', () => {
                cycleArtState(tile);
                updateArtPlanner();
            });
            rowContainer.appendChild(tile);
            artTiles.push(tile);
        }

        artGrid.appendChild(rowContainer);
    }

    const clearBtn = document.getElementById('clearArt');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            artTiles.forEach(t => {
                t.classList.remove('yellow', 'green');
                t.classList.add('gray');
                t.dataset.state = STATES.GRAY;
            });
            updateArtPlanner();
        });
    }
}

// Art grid row drop handlers
function handleArtRowDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    e.currentTarget.classList.add('drag-over');
}

function handleArtRowDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function handleArtRowDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');

    const patternData = e.dataTransfer.getData('pattern');
    if (!patternData) return;

    const pattern = JSON.parse(patternData);
    const rowIndex = parseInt(e.currentTarget.dataset.rowIndex);

    setArtGridRow(rowIndex, pattern);
}

function cycleArtState(tile) {
    const s = tile.dataset.state;
    let ns = STATES.GRAY;
    if (s === STATES.GRAY) ns = STATES.YELLOW;
    else if (s === STATES.YELLOW) ns = STATES.GREEN;
    else if (s === STATES.GREEN) ns = STATES.GRAY;
    tile.classList.remove('gray', 'yellow', 'green');
    tile.classList.add(ns);
    tile.dataset.state = ns;
}

function patternFromArtRow(rowIdx) {
    // Map states to Wordle feedback letters
    const map = { gray: 'B', yellow: 'Y', green: 'G' };
    let pat = '';
    for (let c = 0; c < 5; c++) {
        const tile = artTiles[rowIdx * 5 + c];
        const st = (tile?.dataset.state || STATES.GRAY).toLowerCase();
        pat += map[st] || 'B';
    }
    return pat;
}

function findWordsForPattern(pattern, answer, limit = 50) {
    if (!answer || answer.length !== 5) return { total: 0, words: [], truncated: false };
    ensureArtWordListLoaded();
    const res = [];
    for (const w of artWordList) {
        if (patternFor(w, answer) === pattern) {
            res.push(w);
            if (res.length >= limit) {
                // continue to count total accurately but stop collecting
                // We'll gather total below by counting all then slicing; for speed, do two passes? acceptable here.
                // To keep simple, we mark truncated and break; then compute total with a second pass if needed.
                break;
            }
        }
    }
    // Compute total matches (might be more than shown)
    let total = 0;
    for (const w of artWordList) if (patternFor(w, answer) === pattern) total++;
    const truncated = total > res.length;
    // Sort alphabetical for readability
    res.sort();
    return { total, words: res, truncated };
}

function renderArtRowSuggestions(rowIdx, data) {
    const el = document.getElementById(`artResultsRow${rowIdx}`);
    if (!el) return;
    if (!data) { el.innerHTML = ''; return; }
    const { total, words, truncated } = data;
    if (total === 0) {
        el.innerHTML = '<span class="art-empty">No matches</span>';
        return;
    }
    const items = words.map(w => `<span class="art-word" data-word="${w}">${w.toUpperCase()}</span>`).join(' ');
    const more = truncated ? ` <span class="art-more">(+${total - words.length} more)</span>` : '';
    el.innerHTML = `<span class="art-count">${total} match${total!==1?'es':''}:</span> ${items}${more}`;
    // Click to fill suggested word into next row on main grid
    el.querySelectorAll('.art-word').forEach(sp => {
        sp.addEventListener('click', () => fillNextAvailableRow(sp.dataset.word));
    });
}

function updateArtPlanner() {
    const answer = (document.getElementById('correctWord')?.value || '').toLowerCase().trim();
    if (!answer || answer.length !== 5) {
        for (let r = 0; r < 6; r++) {
            const el = document.getElementById(`artResultsRow${r}`);
            if (el) el.innerHTML = '<span class="art-empty">Set a 5-letter answer to see suggestions</span>';
        }
        return;
    }
    for (let r = 0; r < 6; r++) {
        const pattern = patternFromArtRow(r);
        const data = findWordsForPattern(pattern, answer, 50);
        renderArtRowSuggestions(r, data);
    }
}

// ========== Pattern Library System ==========
// Generate all possible row patterns (3^5 = 243 combinations)
// Get all achievable patterns for current answer via single-pass bucketing
function getAchievablePatterns(answer) {
    if (!answer || answer.length !== 5) {
        return [];
    }
    ensureArtWordListLoaded();

    const colorMap = { B: 'gray', Y: 'yellow', G: 'green' };
    const buckets = new Map(); // patternStr -> { pattern, examples }

    for (const word of artWordList) {
        const patternStr = patternFor(word, answer);
        let bucket = buckets.get(patternStr);
        if (!bucket) {
            bucket = {
                pattern: patternStr.split('').map(c => colorMap[c]),
                exampleWords: []
            };
            buckets.set(patternStr, bucket);
        }
        if (bucket.exampleWords.length < 3) {
            bucket.exampleWords.push(word);
        }
    }

    return Array.from(buckets.values());
}

// Render pattern library
function renderPatternLibrary() {
    const library = document.getElementById('patternLibrary');
    const countEl = document.getElementById('patternCount');
    if (!library) return;

    const answer = (document.getElementById('correctWord')?.value || '').toLowerCase().trim();

    if (!answer || answer.length !== 5) {
        library.innerHTML = '<p class="pattern-library-empty">Set a 5-letter answer to see available patterns</p>';
        if (countEl) countEl.textContent = '0';
        return;
    }

    const achievablePatterns = getAchievablePatterns(answer);

    if (countEl) countEl.textContent = achievablePatterns.length;

    library.innerHTML = '';
    achievablePatterns.forEach((item, index) => {
        const patternCard = document.createElement('div');
        patternCard.className = 'pattern-card';
        patternCard.draggable = true;
        patternCard.dataset.pattern = JSON.stringify(item.pattern);

        // Create mini row preview
        const miniRow = document.createElement('div');
        miniRow.className = 'pattern-row-preview';
        for (let i = 0; i < 5; i++) {
            const miniTile = document.createElement('div');
            miniTile.className = `mini-tile ${item.pattern[i]}`;
            miniRow.appendChild(miniTile);
        }

        // Add example words
        const examples = document.createElement('div');
        examples.className = 'pattern-examples';
        examples.textContent = item.exampleWords.map(w => w.toUpperCase()).join(', ');

        patternCard.appendChild(miniRow);
        patternCard.appendChild(examples);

        // Drag event handlers
        patternCard.addEventListener('dragstart', handlePatternDragStart);

        library.appendChild(patternCard);
    });
}

// Drag and drop handlers
function handlePatternDragStart(e) {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('pattern', e.target.dataset.pattern);
}

function setArtGridRow(rowIndex, pattern) {
    if (rowIndex < 0 || rowIndex > 5 || !pattern || pattern.length !== 5) return;

    const startIdx = rowIndex * 5;
    for (let i = 0; i < 5; i++) {
        const tile = artTiles[startIdx + i];
        const newState = pattern[i];
        tile.classList.remove('gray', 'yellow', 'green');
        tile.classList.add(newState);
        tile.dataset.state = newState;
    }

    updateArtPlanner();
}


function handleKeyDown(e, tile) {
    const index = parseInt(tile.tabIndex);
    const col = index % boardCols();
    const lastIndex = boardTileCount() - 1;
    const lastCol = boardCols() - 1;
    const row = Math.floor(index / boardCols());

    if (e.key === 'Tab') {
        e.preventDefault();
        cycleState(tile);
    } else if (e.key === '1') {
        // Set tile to gray
        e.preventDefault();
        if (tile.textContent.trim()) {
            tile.classList.remove('yellow', 'green');
            tile.classList.add('gray');
            tile.dataset.state = STATES.GRAY;
            tile.dataset.manualState = STATES.GRAY;
            delete tile.dataset.autoColored;
            confirmRowIfComplete(row);
            filterWords();
            updateGhostHints();
        }
    } else if (e.key === '2') {
        // Set tile to yellow
        e.preventDefault();
        if (tile.textContent.trim()) {
            tile.classList.remove('gray', 'green');
            tile.classList.add('yellow');
            tile.dataset.state = STATES.YELLOW;
            tile.dataset.manualState = STATES.YELLOW;
            delete tile.dataset.autoColored;
            confirmRowIfComplete(row);
            filterWords();
            updateGhostHints();
        }
    } else if (e.key === '3') {
        // Set tile to green
        e.preventDefault();
        if (tile.textContent.trim()) {
            tile.classList.remove('gray', 'yellow');
            tile.classList.add('green');
            tile.dataset.state = STATES.GREEN;
            tile.dataset.manualState = STATES.GREEN;
            delete tile.dataset.autoColored;
            confirmRowIfComplete(row);
            filterWords();
            updateGhostHints();
        }
    } else if (e.key === ' ') {
        e.preventDefault();
        // Move to next tile on spacebar
        if (index < lastIndex) {
            tiles[index + 1].focus();
        }
    } else if (e.key === 'Enter') {
        e.preventDefault();
        // Confirm this row's feedback (useful for an all-gray result).
        confirmRowIfComplete(row);
        // If at the last column of a row, move to next row
        if (col === lastCol && index < lastIndex) {
            tiles[index + 1].focus();
        }
        analyzeBoard();
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        clearRowConfirmation(row);
        clearRowFeedbackFlags(row);
        if (tile.textContent === '') {
            // Move to previous tile if current is empty and delete it
            if (index > 0) {
                const prevTile = tiles[index - 1];
                prevTile.focus();
                prevTile.textContent = '';
                // Reset to gray state
                prevTile.classList.remove('yellow', 'green');
                prevTile.classList.add('gray');
                prevTile.dataset.state = STATES.GRAY;
                delete prevTile.dataset.autofilled;
                delete prevTile.dataset.autofilledSolution;
                delete prevTile.dataset.manualEntry;
                delete prevTile.dataset.manualState;
                delete prevTile.dataset.autoColored;
            }
        } else {
            tile.textContent = '';
            // Reset to gray state
            tile.classList.remove('yellow', 'green');
            tile.classList.add('gray');
            tile.dataset.state = STATES.GRAY;
            delete tile.dataset.autofilled;
            delete tile.dataset.autofilledSolution;
            delete tile.dataset.manualEntry;
            delete tile.dataset.manualState;
            delete tile.dataset.autoColored;
        }
        analyzeBoard();
    } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        tiles[index - 1].focus();
    } else if (e.key === 'ArrowRight' && index < lastIndex) {
        e.preventDefault();
        tiles[index + 1].focus();
    } else if (e.key === 'ArrowUp' && index >= boardCols()) {
        e.preventDefault();
        tiles[index - boardCols()].focus();
    } else if (e.key === 'ArrowDown' && index + boardCols() < boardTileCount()) {
        e.preventDefault();
        tiles[index + boardCols()].focus();
    }
}

// Robust paste of full guesses into the current row
function handlePasteIntoTile(e, tile) {
    const clip = e.clipboardData || window.clipboardData;
    if (!clip) return;
    const text = (clip.getData('text') || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (!text) return;

    e.preventDefault();

    const startIdx = Math.floor(parseInt(tile.tabIndex, 10) / boardCols()) * boardCols();
    const rowIndex = Math.floor(startIdx / boardCols());
    clearRowConfirmation(rowIndex);
    clearRowFeedbackFlags(rowIndex);

    for (let i = 0; i < boardCols() && i < text.length; i++) {
        const t = tiles[startIdx + i];
        t.textContent = text[i];
        t.dataset.manualEntry = 'true';
        t.classList.remove('yellow', 'green');
        t.classList.add('gray');
        t.dataset.state = STATES.GRAY;
        delete t.dataset.autofilled;
        delete t.dataset.autofilledSolution;
        delete t.dataset.autoColored;
    }

    tiles[startIdx + Math.min(boardCols() - 1, text.length - 1)].focus();

    if (text.length >= boardCols()) {
        const correctWord = (document.getElementById('correctWord')?.value || '').toLowerCase().trim();
        if (WORD_LENGTH === 5 && correctWord && correctWord.length === 5) {
            applyColorsToRow(rowIndex, correctWord);
        }
    }
    analyzeBoard();
}

// Harden contentEditable typing: IME, multi-char, non-letters
function handleInput(e, tile) {
    e.preventDefault();

    // Get current visible text + incoming data; keep only letters; use LAST letter
    const rawVisible = tile.textContent || '';
    const rawNew = e.data || '';
    const letters = (rawVisible + rawNew).replace(/[^a-zA-Z]/g, '');
    const newLetter = letters ? letters.slice(-1).toUpperCase() : '';
    
    const index = parseInt(tile.tabIndex, 10);
    
    const oldLetter = tile.textContent;
    tile.textContent = newLetter;
    if (oldLetter !== newLetter) {
        const rowIndex = Math.floor(index / boardCols());
        clearRowConfirmation(rowIndex);
        clearRowFeedbackFlags(rowIndex);
    }

    if (newLetter) {
        tile.dataset.manualEntry = 'true';
    } else {
        delete tile.dataset.manualEntry;
    }
    delete tile.dataset.autofilledSolution;
    delete tile.dataset.autofilled;
    
    // If autofill is off, try to color conservatively based on prior info
    if (!autofillGreenEnabled && newLetter) {
        const col = parseInt(tile.dataset.col, 10);
        const row = parseInt(tile.dataset.row, 10);
        let shouldBeGreen = false;
        let shouldBeYellow = false;

        // Green same column above?
        for (let r = 0; r < row; r++) {
            const t = tiles[boardTileIndex(r, col)];
            if (t.dataset.state === STATES.GREEN && t.textContent === newLetter) {
                shouldBeGreen = true;
                break;
            }
        }

        // Else: if first in this row, see if earlier rows have Y/G
        if (!shouldBeGreen) {
            let firstInRow = true;
            for (let c = 0; c < col; c++) {
                if (tiles[boardTileIndex(row, c)].textContent === newLetter) { 
                    firstInRow = false; 
                    break; 
                }
            }
            if (firstInRow) {
                outer:
                for (let r = 0; r < row; r++) {
                    for (let c = 0; c < boardCols(); c++) {
                        const t = tiles[boardTileIndex(r, c)];
                        if (t.textContent === newLetter && (t.dataset.state === STATES.YELLOW || t.dataset.state === STATES.GREEN)) {
                            shouldBeYellow = true;
                            break outer;
                        }
                    }
                }
            }
        }

        tile.classList.remove('gray', 'yellow', 'green');
        if (shouldBeGreen) {
            tile.classList.add('green'); 
            tile.dataset.state = STATES.GREEN;
        } else if (shouldBeYellow) {
            tile.classList.add('yellow'); 
            tile.dataset.state = STATES.YELLOW;
        } else {
            tile.classList.add('gray'); 
            tile.dataset.state = STATES.GRAY;
        }
    }
    
    // If this tile is green and changed, reconcile column below
    if (tile.dataset.state === STATES.GREEN && oldLetter !== newLetter && newLetter) {
        const col = parseInt(tile.dataset.col, 10);
        const row = parseInt(tile.dataset.row, 10);
        tiles.forEach((otherTile, idx) => {
            const otherRow = parseInt(otherTile.dataset.row, 10);
            const otherCol = idx % boardCols();
            if (otherCol === col && otherRow > row) {
                if (otherTile.dataset.state === STATES.GREEN) {
                    if (otherTile.textContent === oldLetter) otherTile.textContent = newLetter;
                    else if (otherTile.textContent === newLetter) {
                        otherTile.classList.remove('gray', 'yellow');
                        otherTile.classList.add('green');
                        otherTile.dataset.state = STATES.GREEN;
                    }
                } else if (otherTile.textContent === newLetter) {
                    otherTile.classList.remove('gray', 'yellow');
                    otherTile.classList.add('green');
                    otherTile.dataset.state = STATES.GREEN;
                }
            }
        });
    }

    // Auto-advance on valid letter
    if (newLetter && index < boardTileCount() - 1) {
        tiles[index + 1].focus();
    }

    // If row complete and answer present, color the row
    const row = Math.floor(index / boardCols());
    setTimeout(() => {
        let rowComplete = true;
        for (let c = 0; c < boardCols(); c++) {
            if (!tiles[boardTileIndex(row, c)].textContent) {
                rowComplete = false;
                break;
            }
        }
        if (rowComplete) {
            const correctWord = (document.getElementById('correctWord')?.value || '').toLowerCase().trim();
            if (WORD_LENGTH === 5 && correctWord && correctWord.length === 5) {
                applyColorsToRow(row, correctWord);
                scheduleAnalyzeBoard();
            }
        }
    }, 0);

    scheduleAnalyzeBoard();
    highlightNextInput();
}

function revertToManualColors() {
    tiles.forEach(tile => {
        if (tile.dataset.autoColored === 'true' && tile.dataset.manualState) {
            // Revert to the manually set state
            const manualState = tile.dataset.manualState;
            tile.classList.remove('gray', 'yellow', 'green');
            tile.classList.add(manualState.toLowerCase());
            tile.dataset.state = manualState;
            delete tile.dataset.autoColored;
        }
    });
}

function applyColorsToRow(rowIndex, correctWord) {
    const startIndex = rowIndex * 5;
    let guessWord = '';
    
    // Get the word from this row
    for (let col = 0; col < 5; col++) {
        const tile = tiles[startIndex + col];
        guessWord += tile.textContent.toLowerCase();
    }
    
    if (guessWord.length !== 5) return;
    
    const answerArr = correctWord.split('');
    const guessArr = guessWord.split('');
    const answerLetterCounts = {};
    const tileStates = [];
    
    // Count letters in answer
    answerArr.forEach(letter => {
        answerLetterCounts[letter] = (answerLetterCounts[letter] || 0) + 1;
    });
    
    // First pass: identify greens
    guessArr.forEach((letter, i) => {
        if (letter === answerArr[i]) {
            tileStates[i] = 'green';
            answerLetterCounts[letter]--;
        } else {
            tileStates[i] = 'pending';
        }
    });
    
    // Second pass: identify yellows and grays
    guessArr.forEach((letter, i) => {
        if (tileStates[i] === 'pending') {
            if (answerLetterCounts[letter] > 0) {
                tileStates[i] = 'yellow';
                answerLetterCounts[letter]--;
            } else {
                tileStates[i] = 'gray';
            }
        }
    });
    
    // Apply the states to tiles
    for (let col = 0; col < 5; col++) {
        const tile = tiles[startIndex + col];
        
        // Save the user's manual color choice if not already saved
        if (!tile.dataset.manualState && !tile.dataset.autoColored) {
            tile.dataset.manualState = tile.dataset.state;
        }
        
        // Remove all color classes
        tile.classList.remove('gray', 'yellow', 'green');
        // Add the appropriate color class
        tile.classList.add(tileStates[col]);
        tile.dataset.state = STATES[tileStates[col].toUpperCase()];
        tile.dataset.autoColored = 'true'; // Mark as auto-colored by answer
    }

    confirmRowIfComplete(rowIndex);
}

function updateTileTooltip(tile, state) {
    const letter = tile.textContent;
    if (!letter) {
        tile.title = '';
        return;
    }

    switch (state) {
        case STATES.GRAY:
            tile.title = `${letter} - Letter is NOT in the word`;
            break;
        case STATES.YELLOW:
            tile.title = `${letter} - Letter is present but in the WRONG position`;
            break;
        case STATES.GREEN:
            tile.title = `${letter} - Letter is CORRECT (right position)`;
            break;
        default:
            tile.title = '';
    }
}

function cycleState(tile) {
    // Don't cycle color on empty tiles
    if (!tile.textContent.trim()) {
        return;
    }

    const currentState = tile.dataset.state;
    let newState;

    // Check if this tile is in a row with manual entries
    const row = parseInt(tile.dataset.row);
    const isInManualRow = checkIfRowHasManualEntries(row);

    switch (currentState) {
        case STATES.GRAY:
            newState = STATES.YELLOW;
            break;
        case STATES.YELLOW:
            newState = STATES.GREEN;
            break;
        case STATES.GREEN:
            newState = STATES.GRAY;
            break;
        default:
            newState = STATES.GRAY;
    }
    
    // Remove all state classes
    tile.classList.remove('gray', 'yellow', 'green');

    // Add flip animation
    tile.classList.add('flipping');
    setTimeout(() => tile.classList.remove('flipping'), 100);

    // Add new state class
    tile.classList.add(newState);
    tile.dataset.state = newState;

    // Update tooltip
    updateTileTooltip(tile, newState);
    
    // Save this as the manual state and clear auto-colored flag
    tile.dataset.manualState = newState;
    delete tile.dataset.autoColored;

    // User explicitly set feedback in this row; treat it as confirmed once complete.
    confirmRowIfComplete(row);
    
    const col = parseInt(tile.dataset.col);
    // row is already declared above at line 319
    
    // If this tile is now green AND autofill is enabled, update tiles in the same column below this row
    if (newState === STATES.GREEN && tile.textContent && autofillGreenEnabled) {
        const letter = tile.textContent;
        
        tiles.forEach((otherTile, index) => {
            const otherRow = parseInt(otherTile.dataset.row);
            // Update tiles in the same column below this row
            if (index % boardCols() === col && otherRow > row) {
                if (!otherTile.textContent) {
                    // Empty tile - fill with the letter
                    otherTile.textContent = letter;
                    otherTile.classList.remove('gray', 'yellow');
                    otherTile.classList.add('green');
                    otherTile.dataset.state = STATES.GREEN;
                    otherTile.dataset.autofilled = 'true'; // Mark as autofilled
                } else if (otherTile.textContent.toLowerCase() === letter.toLowerCase()) {
                    // Same letter already there - make it green
                    otherTile.classList.remove('gray', 'yellow');
                    otherTile.classList.add('green');
                    otherTile.dataset.state = STATES.GREEN;
                    otherTile.dataset.autofilled = 'true'; // Mark as autofilled
                }
            }
        });
    }
    // If this tile is now yellow, update matching gray letters in rows below
    else if (newState === STATES.YELLOW && tile.textContent) {
        const letter = tile.textContent;
        
        tiles.forEach((otherTile) => {
            const otherRow = parseInt(otherTile.dataset.row);
            // Update tiles in rows below that have the same letter and are currently gray
            if (otherRow > row && 
                otherTile.textContent && 
                otherTile.textContent.toLowerCase() === letter.toLowerCase() && 
                otherTile.dataset.state === STATES.GRAY) {
                otherTile.classList.remove('gray');
                otherTile.classList.add('yellow');
                otherTile.dataset.state = STATES.YELLOW;
            }
        });
    } 
    // If this tile was changed from green to something else, clear the auto-filled green tiles below
    else if (currentState === STATES.GREEN && newState !== STATES.GREEN) {
        tiles.forEach((otherTile, index) => {
            const otherRow = parseInt(otherTile.dataset.row);
            const otherCol = index % boardCols();
            
            // We need to check if this tile was auto-filled by checking if all green tiles 
            // above it in the same column have the same letter
            if (otherCol === col && otherRow > row && otherTile.dataset.state === STATES.GREEN) {
                let shouldClear = true;
                
                // Check if there's another green tile above this one (but below the changed tile)
                // that would justify keeping this green
                for (let checkRow = row + 1; checkRow < otherRow; checkRow++) {
                    const checkTile = tiles[boardTileIndex(checkRow, col)];
                    if (checkTile.dataset.state === STATES.GREEN && checkTile.textContent === otherTile.textContent) {
                        shouldClear = false;
                        break;
                    }
                }
                
                if (shouldClear) {
                    // Check if there's a green tile above the current row that matches
                    let hasGreenAbove = false;
                    for (let checkRow = 0; checkRow < row; checkRow++) {
                        const checkTile = tiles[boardTileIndex(checkRow, col)];
                        if (checkTile.dataset.state === STATES.GREEN && checkTile.textContent === otherTile.textContent) {
                            hasGreenAbove = true;
                            break;
                        }
                    }
                    
                    // Only clear if this tile has the same letter as the tile being changed
                    // and there's no other green source for it
                    if (!hasGreenAbove && otherTile.textContent === tile.textContent) {
                        otherTile.textContent = '';
                        otherTile.classList.remove('green', 'yellow');
                        otherTile.classList.add('gray');
                        otherTile.dataset.state = STATES.GRAY;
                    }
                }
            }
        });
    }
    
    scheduleAnalyzeBoard();
    updateGhostHints();

    // If this tile is in a row with manual entries and we changed colors,
    // clear and re-check the autofilled solution
}


function updateConstraintsDigest() {
    const grayLetters = new Set();
    const yellowLetters = new Set();
    const greenInfo = {}; // position -> letter

    tiles.forEach((tile, index) => {
        const row = Math.floor(index / boardCols());
        if (!isRowConfirmed(row)) return;
        const letter = tile.textContent.toLowerCase();
        const state = tile.dataset.state;
        const position = index % boardCols();

        if (letter) {
            if (state === STATES.GRAY) {
                grayLetters.add(letter);
            } else if (state === STATES.YELLOW) {
                yellowLetters.add(letter);
            } else if (state === STATES.GREEN) {
                greenInfo[position] = letter;
            }
        }
    });

    // Remove grays that are also yellow/green (duplicates with different positions)
    yellowLetters.forEach(l => grayLetters.delete(l));
    Object.values(greenInfo).forEach(l => {
        grayLetters.delete(l);
        yellowLetters.delete(l);
    });

    // Update UI
    document.getElementById('excludedLetters').textContent =
        grayLetters.size > 0 ? Array.from(grayLetters).sort().join(' ').toUpperCase() : '—';

    document.getElementById('presentLetters').textContent =
        yellowLetters.size > 0 ? Array.from(yellowLetters).sort().join(' ').toUpperCase() : '—';

    // Format green letters with positions
    const greenText = Object.keys(greenInfo).length > 0
        ? Object.entries(greenInfo)
            .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
            .map(([pos, letter]) => `${letter.toUpperCase()}${parseInt(pos) + 1}`)
            .join(' ')
        : '—';
    document.getElementById('lockedLetters').textContent = greenText;
}

function getWordleConstraintsFromBoard() {
    const grayLetters = new Set();
    const greenPositions = {};
    const yellowInfo = {}; // { position: Set(letters that can't be here) }
    const mustInclude = new Set(); // Letters that must be in the word (from yellow)

    tiles.forEach((tile, index) => {
        const row = Math.floor(index / boardCols());
        if (!isRowConfirmed(row)) return;
        const letter = tile.textContent.toLowerCase();
        const state = tile.dataset.state;
        const position = index % boardCols();

        if (!letter) return;
        switch (state) {
            case STATES.GRAY:
                grayLetters.add(letter);
                break;
            case STATES.GREEN:
                greenPositions[position] = letter;
                break;
            case STATES.YELLOW:
                mustInclude.add(letter);
                if (!yellowInfo[position]) {
                    yellowInfo[position] = new Set();
                }
                yellowInfo[position].add(letter);
                break;
        }
    });

    // Gray letters should not exclude letters that are also present somewhere (duplicate handling)
    Object.values(greenPositions).forEach(l => grayLetters.delete(l));
    mustInclude.forEach(l => grayLetters.delete(l));

    return { grayLetters, greenPositions, yellowInfo, mustInclude };
}

function clearModeMessage() {
    const el = document.getElementById('modeMessage');
    if (!el) return;
    el.style.display = 'none';
    el.textContent = '';
    el.classList.remove('info');
    if (modeMessageTimeoutId) {
        clearTimeout(modeMessageTimeoutId);
        modeMessageTimeoutId = null;
    }
}

function showModeMessage(text, { kind = 'error', timeoutMs = 4500 } = {}) {
    const el = document.getElementById('modeMessage');
    if (!el) return;
    if (!text) {
        clearModeMessage();
        return;
    }
    el.textContent = text;
    el.classList.toggle('info', kind === 'info');
    el.style.display = 'block';
    if (modeMessageTimeoutId) {
        clearTimeout(modeMessageTimeoutId);
    }
    modeMessageTimeoutId = setTimeout(() => {
        clearModeMessage();
    }, timeoutMs);
}

function getHardModeConstraintsFromBoard() {
    const greenPositions = {};
    const yellowInfo = {}; // { position: Set(letters that can't be here) }
    const minCounts = Object.create(null); // { letter: min count revealed }

    const rows = getCompletedGuessRowsWithPatterns();
    for (const row of rows) {
        const rowMinCounts = Object.create(null);
        for (let i = 0; i < row.guess.length; i++) {
            const ch = row.guess[i];
            const p = row.pattern[i];
            if (p === 'G') {
                greenPositions[i] = ch;
                rowMinCounts[ch] = (rowMinCounts[ch] || 0) + 1;
            } else if (p === 'Y') {
                if (!yellowInfo[i]) yellowInfo[i] = new Set();
                yellowInfo[i].add(ch);
                rowMinCounts[ch] = (rowMinCounts[ch] || 0) + 1;
            }
        }
        for (const [ch, cnt] of Object.entries(rowMinCounts)) {
            const prev = minCounts[ch] || 0;
            if (cnt > prev) minCounts[ch] = cnt;
        }
    }

    return { greenPositions, yellowInfo, minCounts };
}

function validateHardModeGuess(guess, constraints) {
    const reasons = [];
    const normalized = (guess || '').toLowerCase().trim();
    if (!normalized || normalized.length !== boardCols() || !/^[a-z]+$/.test(normalized)) {
        return { ok: false, reasons: ['invalid guess'] };
    }

    const greenPositions = constraints?.greenPositions || {};
    const yellowInfo = constraints?.yellowInfo || {};
    const minCounts = constraints?.minCounts || {};

    for (const [posStr, letter] of Object.entries(greenPositions)) {
        const pos = Number.parseInt(posStr, 10);
        if (!Number.isFinite(pos)) continue;
        if (normalized[pos] !== letter) {
            reasons.push(`pos ${pos + 1} must be ${letter.toUpperCase()}`);
        }
    }

    for (const [posStr, letters] of Object.entries(yellowInfo)) {
        const pos = Number.parseInt(posStr, 10);
        if (!Number.isFinite(pos)) continue;
        for (const letter of letters) {
            if (normalized[pos] === letter) {
                reasons.push(`pos ${pos + 1} cannot be ${letter.toUpperCase()}`);
            }
        }
    }

    // Hard mode (Wordle-style): enforce that all revealed yellow/green letters are reused.
    // Gray letters are not enforced by the game; we don't block them.
    const counts = Object.create(null);
    for (let i = 0; i < normalized.length; i++) {
        const ch = normalized[i];
        counts[ch] = (counts[ch] || 0) + 1;
    }
    for (const [ch, required] of Object.entries(minCounts)) {
        const actual = counts[ch] || 0;
        if (actual < required) {
            const suffix = required === 1 ? '' : ` ×${required}`;
            reasons.push(`must include ${ch.toUpperCase()}${suffix}`);
        }
    }

    return { ok: reasons.length === 0, reasons };
}

function analyzeBoard() {
    autoConfirmRowsFromFeedbackFlags();
    updateConstraintsDigest();
    const { grayLetters, greenPositions, yellowInfo, mustInclude } = getWordleConstraintsFromBoard();
    const completedGuessRows = getCompletedGuessRowsWithPatterns();

    // Get exclude and include letters from filter inputs
    const excludeInput = (document.getElementById('excludeLetters')?.value || '').toLowerCase().trim();
    const globalExcludeInput = (document.getElementById('globalExcludeLetters')?.value || '').toLowerCase().trim();
    const includeInput = (document.getElementById('includeLetters')?.value || '').toLowerCase().trim();
    const excludeLetters = new Set((excludeInput + globalExcludeInput).split('').filter(c => c.match(/[a-z]/)));
    const includeLetters = new Set(includeInput.split('').filter(c => c.match(/[a-z]/)));

    const excludedOverridesWordle = Array.from(excludeLetters).some(l => {
        if (mustInclude.has(l)) return true;
        return Object.values(greenPositions).includes(l);
    });
    const applyRowPatterns = completedGuessRows.length > 0 && !excludedOverridesWordle;

    const perPositionMode = document.getElementById('perPositionToggle').checked;
    
    // Get per-position filters if in per-position mode
    let positionExclude = {};
    let positionInclude = {};
    
    if (perPositionMode) {
        // Get exclude letters for each position
        document.querySelectorAll('.position-input').forEach(input => {
            const pos = parseInt(input.dataset.pos);
            const letters = input.value.toLowerCase().trim();
            if (letters) {
                positionExclude[pos] = new Set(letters.split('').filter(c => c.match(/[a-z]/)));
            }
        });

        // Get include letters for each position
        document.querySelectorAll('.position-include-input').forEach(input => {
            const pos = parseInt(input.dataset.pos);
            const letters = input.value.toLowerCase().trim();
            if (letters) {
                positionInclude[pos] = new Set(letters.split('').filter(c => c.match(/[a-z]/)));
            }
        });
    }
    
    // Filter words based on the board state and letter filters
    const newFilteredWords = answerList.filter(word => {
        // Global excluded letters apply in both whole-word and per-position modes.
        for (let letter of excludeLetters) {
            if (word.includes(letter)) {
                return false;
            }
        }

        // Apply per-position filters (from Letter Filter widget)
        if (perPositionMode) {
            // Per-position mode: check each position individually
            for (let pos = 0; pos < boardCols(); pos++) {
                const letterAtPos = word[pos];

                // Check if this letter is excluded at this position
                if (positionExclude[pos] && positionExclude[pos].has(letterAtPos)) {
                    return false;
                }

                // Check if we have include requirements for this position
                if (positionInclude[pos] && positionInclude[pos].size > 0) {
                    if (!positionInclude[pos].has(letterAtPos)) {
                        return false; // Letter at this position is not in the include set
                    }
                }
            }
        } else {
            // Whole word mode (original behavior)
            // Check included letters from filter (must be in word)
            for (let letter of includeLetters) {
                if (!word.includes(letter)) {
                    return false;
                }
            }
        }

        // Apply full Wordle feedback for completed guess rows (Wordle-accurate, handles duplicates).
        // This is intentionally limited to completed rows so partial typing doesn't constrain candidates.
        // If the user explicitly excludes a known-present letter, we treat that as an override and skip this.
        if (applyRowPatterns) {
            for (const row of completedGuessRows) {
                if (patternFor(row.guess, word) !== row.pattern) {
                    return false;
                }
            }
        }

        // Apply gray/green/yellow constraints from the grid (Wordle candidates)
        // (Non-candidate probes are handled separately by the "Next Guess" widget.)

        // Check gray letters (not in word) - but only if not explicitly excluded
        for (let gray of grayLetters) {
            const isGreen = Object.values(greenPositions).includes(gray);
            const isYellow = mustInclude.has(gray);
            const isIncluded = includeLetters.has(gray);
            const isExcluded = excludeLetters.has(gray);

            // Skip this check if the letter is excluded (already handled above)
            if (!isExcluded && !isGreen && !isYellow && !isIncluded && word.includes(gray)) {
                return false;
            }
        }

        // Check green positions - skip entirely if letter is excluded
        for (let [pos, letter] of Object.entries(greenPositions)) {
            if (excludeLetters.has(letter)) {
                // Skip this constraint - we want words WITHOUT this letter
                continue;
            }
            if (word[pos] !== letter) {
                return false;
            }
        }

        // Check yellow letters - skip entirely if letter is excluded
        for (let letter of mustInclude) {
            if (excludeLetters.has(letter)) {
                // Skip this constraint - we want words WITHOUT this letter
                continue;
            }
            if (!word.includes(letter)) {
                return false;
            }
        }

        // Check yellow positions (letters that can't be in specific positions)
        for (let [pos, letters] of Object.entries(yellowInfo)) {
            for (let letter of letters) {
                if (excludeLetters.has(letter)) {
                    // Skip this constraint - we want words WITHOUT this letter
                    continue;
                }
                if (word[pos] === letter) {
                    return false;
                }
            }
        }
        
        return true;
    });

    setFilteredWords(newFilteredWords);

    console.log(`Filtered to ${newFilteredWords.length} words`);

    updateWordDisplay();
}

function calculateMedian(scores) {
    const sorted = [...scores].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 
        ? sorted[mid] 
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calculateMode(scores) {
    const frequency = {};
    let maxFreq = 0;
    let mode = scores[0];

    scores.forEach(score => {
        frequency[score] = (frequency[score] || 0) + 1;
        if (frequency[score] > maxFreq) {
            maxFreq = frequency[score];
            mode = score;
        }
    });

    return mode;
}

function calculatePresenceScore(word) {
    const uniqueLetters = new Set(word.split(''));
    let score = 0;
    uniqueLetters.forEach(letter => {
        score += LETTER_PRESENCE_COUNTS[letter] || 0;
    });
    return score;
}

function calculateContingencyScore(word) {
    // Contingency score using actual contingency table
    // Sum of co-occurrence counts for all letter pairs in the word
    const letters = [...new Set(word.split(''))]; // unique letters only
    let score = 0;
    
    for (let i = 0; i < letters.length; i++) {
        for (let j = 0; j < letters.length; j++) {
            if (i !== j) {
                const l1 = letters[i];
                const l2 = letters[j];
                // Add the contingency value (how many words have l2 given l1)
                if (CONTINGENCY_TABLE[l1] && CONTINGENCY_TABLE[l1][l2]) {
                    score += CONTINGENCY_TABLE[l1][l2];
                }
            }
        }
    }
    
    return score;
}

/* ======== Pattern + partitions (Wordle-accurate) ======== */
function patternFor(guess, answer) {
  if (typeof guess !== 'string' || typeof answer !== 'string') return '';
  if (guess.length !== answer.length) {
    const L = Math.max(guess.length, answer.length);
    return 'B'.repeat(L);
  }
  const L = guess.length;
  const g = guess.split(''), a = answer.split('');
  const res = Array(L).fill('B'), counts = {};
  for (let i = 0; i < L; i++) counts[a[i]] = (counts[a[i]] || 0) + 1;
  for (let i = 0; i < L; i++) if (g[i] === a[i]) { res[i] = 'G'; counts[g[i]]--; }
  for (let i = 0; i < L; i++) if (res[i] !== 'G' && counts[g[i]] > 0) { res[i] = 'Y'; counts[g[i]]--; }
  return res.join('');
}
const _partitionCache = new Map();
const _candidatesId = new WeakMap();
let _candidatesIdCounter = 1;
function candidatesKey(cands) {
  if (!cands || (typeof cands !== 'object' && typeof cands !== 'function')) return '0';
  let id = _candidatesId.get(cands);
  if (!id) { id = _candidatesIdCounter++; _candidatesId.set(cands, id); }
  return String(id);
}
function partitionByPattern(guess, candidates) {
  const key = guess + '|' + candidatesKey(candidates);
  const hit = _partitionCache.get(key); if (hit) return hit;
  const buckets = new Map();
  for (const ans of candidates) {
    const p = patternFor(guess, ans);
    buckets.set(p, (buckets.get(p) || 0) + 1);
  }
  _partitionCache.set(key, buckets);
  return buckets;
}
function entropyForGuess(guess, candidates) {
  const buckets = partitionByPattern(guess, candidates);
  const n = candidates.length || 1;
  let H = 0;
  for (const cnt of buckets.values()) { const p = cnt / n; H -= p * Math.log2(p); }
  return H; // higher better
}
function expectedRemainingForGuess(guess, candidates) {
  const buckets = partitionByPattern(guess, candidates);
  const n = candidates.length || 1;
  let E = 0;
  for (const cnt of buckets.values()) { const p = cnt / n; E += p * cnt; } // sum cnt^2 / n
  return E; // lower better
}
function minimaxForGuess(guess, candidates) {
  const buckets = partitionByPattern(guess, candidates);
  let worst = 0; for (const cnt of buckets.values()) worst = Math.max(worst, cnt);
  return worst; // lower better
}

/* ======== Coverage/probe utilities ======== */
function computeLetterPresenceProbs(candidates) {
  const pres = Object.create(null), seenCount = Object.create(null);
  for (let c = 97; c <= 122; c++) { pres[String.fromCharCode(c)] = 0; seenCount[String.fromCharCode(c)] = 0; }
  const n = candidates.length || 1;
  for (const w of candidates) { const s = new Set(w); for (const ch of s) seenCount[ch]++; }
  for (const ch in pres) pres[ch] = seenCount[ch] / n;
  return pres;
}
function binaryEntropy01(p) {
  // Binary entropy in bits, in [0, 1]. Peaks at p=0.5, and is 0 at p=0 or 1.
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}
function computeLetterInfoWeights(presence) {
  // How informative it is to test whether a letter is present in the answer,
  // based on the remaining candidate set. Uncertain letters (p≈0.5) are best.
  const w = Object.create(null);
  for (let c = 97; c <= 122; c++) {
    const ch = String.fromCharCode(c);
    w[ch] = binaryEntropy01(presence?.[ch] ?? 0);
  }
  return w;
}
function probeCoverageScore(word, letterInfo, greenPositions) {
  // Normal-mode probe heuristic:
  // - Favor words that test *uncertain* letters (p≈0.5) rather than letters that are almost-certain (p≈0 or 1).
  // - Prefer unique letters (duplicates probe fewer new facts).
  // - Penalize reusing already-locked greens in their exact positions (wastes slots in Normal mode).
  const used = new Set();
  let s = 0;
  let duplicates = 0;

  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (used.has(ch)) {
      duplicates++;
      continue;
    }
    used.add(ch);
    s += (letterInfo?.[ch] ?? 0);
  }

  let lockedHits = 0;
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (greenPositions[i] && greenPositions[i] === ch) lockedHits++;
  }

  const lockedPenalty = 0.25;
  const duplicatePenalty = 0.65;
  return s - (lockedPenalty * lockedHits) - (duplicatePenalty * duplicates);
}

/* ======== Positional Scoring Functions ======== */

// Positional Frequency Scoring
function positionalFrequencyScore(word, filteredWords) {
    ensurePositionalFrequencyTable();
    const positionFrequencies = positionalFrequencyTableCache.table || [];
    const denom = positionalFrequencyTableCache.denom || Math.max(filteredWords?.length || 0, 1);
    const L = word.length;
    
    let score = 0;
    const usedPositions = new Set();
    
    for (let i = 0; i < L; i++) {
        const letter = word[i];
        const posKey = `${i}-${letter}`;
        
        if (!usedPositions.has(posKey)) {
            score += (positionFrequencies[i]?.[letter] || 0);
            usedPositions.add(posKey);
        }
    }
    
    const uniqueLetters = new Set(word.split(''));
    score *= (1 + uniqueLetters.size * 0.1);

    // Normalize to a 0-10 scale to match other scoring methods
    // Maximum possible score is approximately 5 * (max words per position) * 1.5 (unique letter bonus)
    // With ~2400 words, max per position is ~400, so max score ~3000
    // Normalize to ~0-10 range to match entropy scale
    const normalizedScore = (score / denom) * L;

    return normalizedScore;
}

// Positional Entropy Scoring (Wordle-accurate)
// Uses the same Wordle feedback partitions as entropyForGuess.
function positionalEntropyScore(word, filteredWords) {
    return entropyForGuess(word, filteredWords);
}

// Heuristic positional entropy (kept as a separate mode)
function positionalEntropyHeuristicScore(word, filteredWords) {
    const patternCounts = {};
    for (const candidate of filteredWords) {
        const pattern = getPositionalHeuristicPattern(word, candidate);
        const key = pattern.join(',');
        patternCounts[key] = (patternCounts[key] || 0) + 1;
    }
    let entropy = 0;
    const total = filteredWords.length;
    for (const count of Object.values(patternCounts)) {
        if (count > 0) {
            const probability = count / total;
            entropy -= probability * Math.log2(probability);
        }
    }
    const positionBonus = calculatePositionalCommonalityHeuristic(word, filteredWords);
    return entropy * (1 + positionBonus);
}

function getPositionalHeuristicPattern(guess, target) {
    if (typeof guess !== 'string' || typeof target !== 'string' || guess.length !== target.length) {
        return [];
    }
    const L = guess.length;
    const result = [];
    const targetLetters = target.split('');
    const guessLetters = guess.split('');
    const targetCounts = {};
    for (const letter of targetLetters) {
        targetCounts[letter] = (targetCounts[letter] || 0) + 1;
    }
    // Greens
    for (let i = 0; i < L; i++) {
        if (guessLetters[i] === targetLetters[i]) {
            result[i] = `g${i}`;
            targetCounts[guessLetters[i]]--;
        } else {
            result[i] = null;
        }
    }
    // Yellows/Grays with extra positional encoding
    for (let i = 0; i < L; i++) {
        if (result[i] === null) {
            if (targetCounts[guessLetters[i]] && targetCounts[guessLetters[i]] > 0) {
                let targetPos = -1;
                for (let j = 0; j < L; j++) {
                    if (targetLetters[j] === guessLetters[i] && j !== i) {
                        targetPos = j;
                        break;
                    }
                }
                result[i] = `y${i}_${targetPos}`;
                targetCounts[guessLetters[i]]--;
            } else {
                result[i] = `x${i}`;
            }
        }
    }
    return result;
}

function calculatePositionalCommonalityHeuristic(word, filteredWords) {
    let commonality = 0;
    const L = word.length;
    ensurePositionalFrequencyTable();
    const table = positionalFrequencyTableCache.table || [];
    const total = positionalFrequencyTableCache.denom || (filteredWords?.length || 1);
    for (let i = 0; i < L; i++) {
        const letter = word[i];
        const matchCount = table[i]?.[letter] || 0;
        if (matchCount > 0) {
            commonality += (matchCount / total) * 0.2;
        }
    }
    return commonality;
}

// Positional Pattern Scoring
function positionalPatternScore(word, filteredWords) {
    ensurePositionalPatternTables();
    const L = word.length;
    const bigramCounts = positionalPatternTableCache.bigramCounts || {};
    const trigramCounts = positionalPatternTableCache.trigramCounts || {};
    const transitionCounts = positionalPatternTableCache.transitionCounts || {};

    let bigramScore = 0;
    for (let i = 0; i < Math.max(0, L - 1); i++) {
        const bigramKey = `${i}:${word[i]}${word[i+1]}`;
        bigramScore += (bigramCounts[bigramKey] || 0);
    }

    let trigramScore = 0;
    for (let i = 0; i < Math.max(0, L - 2); i++) {
        const trigramKey = `${i}:${word[i]}${word[i+1]}${word[i+2]}`;
        trigramScore += (trigramCounts[trigramKey] || 0);
    }

    let transitionScore = 0;
    for (let i = 0; i < Math.max(0, L - 1); i++) {
        const transitionKey = `${i}:${word[i]}->${word[i+1]}`;
        transitionScore += (transitionCounts[transitionKey] || 0);
    }

    const start2Counts = positionalPatternTableCache.start2Counts || {};
    const end2Counts = positionalPatternTableCache.end2Counts || {};
    const prefixCounts = positionalPatternTableCache.prefixCounts || {};
    const suffixCounts = positionalPatternTableCache.suffixCounts || {};
    const affixLen = Math.min(3, L);
    const startPattern = word.slice(0, 2);
    const endPattern = word.slice(-2);
    const prefix = word.slice(0, affixLen);
    const suffix = word.slice(-affixLen);
    const startMatches = start2Counts[startPattern] || 0;
    const endMatches = end2Counts[endPattern] || 0;
    const prefixMatches = prefixCounts[prefix] || 0;
    const suffixMatches = suffixCounts[suffix] || 0;
    const boundaryScore = (startMatches * 2) + (endMatches * 2) +
        (prefixMatches * 1.5) + (suffixMatches * 1.5);

    return (bigramScore * 0.3) +
        (trigramScore * 0.2) +
        (transitionScore * 0.3) +
        (boundaryScore * 0.2);
}

function calculatePositionalBigrams(word, filteredWords) {
    const bigramCounts = {};
    const L = word.length;
    
    for (const w of filteredWords) {
        for (let i = 0; i < Math.max(0, L - 1); i++) {
            const bigram = `${i}:${w[i]}${w[i+1]}`;
            bigramCounts[bigram] = (bigramCounts[bigram] || 0) + 1;
        }
    }
    
    let score = 0;
    for (let i = 0; i < Math.max(0, L - 1); i++) {
        const bigram = `${i}:${word[i]}${word[i+1]}`;
        score += (bigramCounts[bigram] || 0);
    }
    
    return score;
}

function calculatePositionalTrigrams(word, filteredWords) {
    const trigramCounts = {};
    const L = word.length;
    
    for (const w of filteredWords) {
        for (let i = 0; i < Math.max(0, L - 2); i++) {
            const trigram = `${i}:${w[i]}${w[i+1]}${w[i+2]}`;
            trigramCounts[trigram] = (trigramCounts[trigram] || 0) + 1;
        }
    }
    
    let score = 0;
    for (let i = 0; i < Math.max(0, L - 2); i++) {
        const trigram = `${i}:${word[i]}${word[i+1]}${word[i+2]}`;
        score += (trigramCounts[trigram] || 0);
    }
    
    return score;
}

function calculateTransitionProbabilities(word, filteredWords) {
    const transitions = {};
    const L = word.length;
    
    for (const w of filteredWords) {
        for (let i = 0; i < Math.max(0, L - 1); i++) {
            const key = `${i}:${w[i]}->${w[i+1]}`;
            transitions[key] = (transitions[key] || 0) + 1;
        }
    }
    
    let score = 0;
    for (let i = 0; i < Math.max(0, L - 1); i++) {
        const key = `${i}:${word[i]}->${word[i+1]}`;
        score += (transitions[key] || 0);
    }
    
    return score;
}

function calculateBoundaryPatterns(word, filteredWords) {
    let score = 0;
    const L = word.length;
    const startPattern = word.slice(0, 2);
    const endPattern = word.slice(-2);
    const prefix = word.slice(0, Math.min(3, L));
    const suffix = word.slice(-Math.min(3, L));
    
    let startMatches = 0, endMatches = 0, prefixMatches = 0, suffixMatches = 0;
    
    for (const w of filteredWords) {
        if (w.slice(0, 2) === startPattern) startMatches++;
        if (w.slice(-2) === endPattern) endMatches++;
        if (w.slice(0, Math.min(3, L)) === prefix) prefixMatches++;
        if (w.slice(-Math.min(3, L)) === suffix) suffixMatches++;
    }
    
    score = (startMatches * 2) + (endMatches * 2) + 
            (prefixMatches * 1.5) + (suffixMatches * 1.5);
    
    return score;
}

// Positional Weight Scoring
function calculateLetterPositionScoreFromFrequency(frequency) {
    let entropyContribution = 0;
    if (frequency > 0 && frequency < 1) {
        entropyContribution = -frequency * Math.log2(frequency) - (1 - frequency) * Math.log2(1 - frequency);
    }
    const discriminationPower = Math.abs(0.5 - frequency) * 2;
    return (frequency * 100) + (entropyContribution * 50) + ((1 - discriminationPower) * 30);
}

function calculatePositionalDiversityFromCounts(word, table, denom) {
    let diversity = 0;
    const L = word.length;
    for (let i = 0; i < L; i++) {
        const letter = word[i];
        const commonality = ((table?.[i]?.[letter] || 0) / denom);
        if (commonality > 0.1 && commonality < 0.4) {
            diversity += 0.1;
        }
    }
    return diversity;
}

function positionalWeightScore(word, filteredWords) {
    ensurePositionalFrequencyTable();
    const table = positionalFrequencyTableCache.table || [];
    const denom = positionalFrequencyTableCache.denom || Math.max(filteredWords?.length || 0, 1);
    const L = word.length;
    const positionWeights = Array.from({ length: L }, (_, i) => {
        if (i === 0 || i === L - 1) return 1.5;
        if (i === 1 || i === L - 2) return 0.8;
        return 1.0;
    });
    
    let score = 0;
    
    for (let i = 0; i < L; i++) {
        const letter = word[i];
        const frequency = (table?.[i]?.[letter] || 0) / denom;
        const positionScore = calculateLetterPositionScoreFromFrequency(frequency);
        score += positionScore * positionWeights[i];
    }
    
    const diversityBonus = calculatePositionalDiversityFromCounts(word, table, denom);
    score *= (1 + diversityBonus);
    
    const strategicBonus = calculateStrategicPositions(word, filteredWords);
    score += strategicBonus;
    
    return score;
}

function calculatePositionDistributions(filteredWords) {
    const L = (filteredWords && filteredWords[0] && typeof filteredWords[0] === 'string')
        ? filteredWords[0].length
        : boardCols();
    const distributions = Array.from({ length: L }, () => ({}));
    
    for (const word of filteredWords) {
        for (let i = 0; i < L; i++) {
            const letter = word[i];
            distributions[i][letter] = (distributions[i][letter] || 0) + 1;
        }
    }
    
    for (let i = 0; i < L; i++) {
        const total = Object.values(distributions[i]).reduce((a, b) => a + b, 0);
        for (const letter in distributions[i]) {
            distributions[i][letter] /= total;
        }
    }
    
    return distributions;
}

function calculateLetterPositionScore(letter, position, distribution, filteredWords) {
    const frequency = distribution[letter] || 0;
    
    let entropyContribution = 0;
    if (frequency > 0 && frequency < 1) {
        entropyContribution = -frequency * Math.log2(frequency) - (1 - frequency) * Math.log2(1 - frequency);
    }
    
    const discriminationPower = Math.abs(0.5 - frequency) * 2;
    
    return (frequency * 100) + (entropyContribution * 50) + ((1 - discriminationPower) * 30);
}

function calculatePositionalDiversity(word, filteredWords) {
    let diversity = 0;
    const L = word.length;
    const avgProfiles = Array.from({ length: L }, () => ({}));
    
    for (const w of filteredWords) {
        for (let i = 0; i < L; i++) {
            avgProfiles[i][w[i]] = (avgProfiles[i][w[i]] || 0) + 1;
        }
    }
    
    for (let i = 0; i < L; i++) {
        const letter = word[i];
        const commonality = (avgProfiles[i][letter] || 0) / filteredWords.length;
        
        if (commonality > 0.1 && commonality < 0.4) {
            diversity += 0.1;
        }
    }
    
    return diversity;
}

function calculateStrategicPositions(word, filteredWords) {
    let strategicScore = 0;
    const L = word.length;
    
    const vowels = new Set(['a', 'e', 'i', 'o', 'u']);
    const vowelPositions = [];
    for (let i = 0; i < L; i++) {
        if (vowels.has(word[i])) {
            vowelPositions.push(i);
        }
    }
    
    if (vowelPositions.length >= 2) {
        const spread = Math.max(...vowelPositions) - Math.min(...vowelPositions);
        if (spread >= 2) {
            strategicScore += 20;
        }
    }
    
    const consonantClusters = ['st', 'tr', 'pr', 'cr', 'br', 'gr', 'sp', 'ch', 'sh', 'th'];
    for (let i = 0; i < Math.max(0, L - 1); i++) {
        const pair = word.substring(i, i + 2);
        if (consonantClusters.includes(pair)) {
            if (i === 0) strategicScore += 15;
            if (i === L - 2) strategicScore += 10;
        }
    }
    
    const commonEndings = ['ed', 'er', 'ly', 'es', 'ng', 'nt', 'st'];
    const ending = word.substring(Math.max(0, L - 2));
    if (commonEndings.includes(ending)) {
        strategicScore += 15;
    }
    
    return strategicScore;
}

/* ======== Toggle for allowing non-candidate probes ======== */
let allowProbeGuesses = true; // set via UI if you want (checkbox)
let solveMode = 'normal'; // 'normal' | 'hard'

/* ======== Probe strategy (Normal mode) ======== */
// Normal mode: you can guess words that don't follow your greens/yellows to probe more letters.
// Hard mode: restrict guesses to candidates only.
let activeProbeToken = null;
let probeSuggestionsCache = {
    version: -1,
    solveMode: null,
    allowProbes: null,
    allowProbeGuesses: null,
    hideDoubleLetters: null,
    excludeGreen: null,
    excludeYellow: null,
    items: null,
    summary: null
};

function createProbeToken() {
    if (activeProbeToken) {
        activeProbeToken.cancelled = true;
    }
    const token = { cancelled: false };
    activeProbeToken = token;
    return token;
}

function cancelActiveProbeToken() {
    if (activeProbeToken) {
        activeProbeToken.cancelled = true;
        activeProbeToken = null;
    }
}

function hasDuplicateLetters(word) {
    const seen = new Set();
    for (const ch of word) {
        if (seen.has(ch)) return true;
        seen.add(ch);
    }
    return false;
}

function getBoardLetterSets() {
    const grayLetters = new Set();
    const yellowLetters = new Set();
    const greenLetters = new Set();
    const greenPositions = {}; // position -> letter

    tiles.forEach((tile, index) => {
        const row = Math.floor(index / boardCols());
        if (!isRowConfirmed(row)) return;
        const letter = tile.textContent.toLowerCase();
        const state = tile.dataset.state;
        const position = index % boardCols();
        if (!letter) return;

        if (state === STATES.GREEN) {
            greenLetters.add(letter);
            greenPositions[position] = letter;
        } else if (state === STATES.YELLOW) {
            yellowLetters.add(letter);
        } else if (state === STATES.GRAY) {
            grayLetters.add(letter);
        }
    });

    // Prune grays that are also present (duplicate-letter situations)
    for (const l of Array.from(grayLetters)) {
        if (greenLetters.has(l) || yellowLetters.has(l)) grayLetters.delete(l);
    }

    const presentLetters = new Set([...greenLetters, ...yellowLetters]);
    return { grayLetters, yellowLetters, greenLetters, presentLetters, greenPositions };
}

function getCompletedGuesses() {
    const guessed = new Set();
    for (let row = 0; row < boardRows(); row++) {
        if (!isRowConfirmed(row)) continue;
        const startIndex = row * boardCols();
        let w = '';
        for (let col = 0; col < boardCols(); col++) {
            const ch = tiles[startIndex + col]?.textContent?.toLowerCase?.().trim?.() || '';
            w += ch;
        }
        if (w.length === boardCols() && /^[a-z]+$/.test(w)) {
            guessed.add(w);
        }
    }
    return guessed;
}

function stateToPatternChar(state) {
    if (state === STATES.GREEN) return 'G';
    if (state === STATES.YELLOW) return 'Y';
    return 'B';
}

function getCompletedGuessRowsWithPatterns() {
    const rows = [];
    const L = boardCols();
    for (let row = 0; row < boardRows(); row++) {
        if (!isRowConfirmed(row)) continue;
        const startIndex = row * L;
        let guess = '';
        let pattern = '';
        let complete = true;

        for (let col = 0; col < L; col++) {
            const tile = tiles[startIndex + col];
            const ch = tile?.textContent?.toLowerCase?.().trim?.() || '';
            if (!/^[a-z]$/.test(ch)) {
                complete = false;
                break;
            }
            guess += ch;
            pattern += stateToPatternChar(tile?.dataset?.state);
        }

        if (complete) rows.push({ guess, pattern, row });
    }
    return rows;
}

function effectiveAllowProbes() {
    return solveMode !== 'hard' && allowProbeGuesses;
}

async function computeProbeSuggestions(candidates, token, options = {}) {
    const allowProbes = options.allowProbes !== false;
    const { grayLetters, yellowLetters, greenLetters, greenPositions } = getBoardLetterSets();
    const alreadyGuessed = getCompletedGuesses();
    const excludeGreen = allowProbes && Boolean(document.getElementById('excludeGreenToggle')?.checked);
    const excludeYellow = allowProbes && Boolean(document.getElementById('excludeYellowToggle')?.checked);

    const candidatesSet = new Set(candidates);
    const pool = allowProbes ? (guessList.length ? guessList : candidates) : candidates;
    const presence = computeLetterPresenceProbs(candidates);
    const letterInfo = computeLetterInfoWeights(presence);

    const expectedCandidateLimit = 600;
    const shortlistSize = 250; // evaluate exact expected-remaining on the best K probe candidates
    const useExpectedPartitions = candidates.length <= expectedCandidateLimit;
    const maxResults = 12;
    const top = [];
    let bestOverall = null;
    let bestCandidate = null;

    function consider(item) {
        if (top.length < maxResults) {
            top.push(item);
            top.sort((a, b) => b.score - a.score);
            return;
        }
        if (item.score <= top[top.length - 1].score) return;
        top[top.length - 1] = item;
        top.sort((a, b) => b.score - a.score);
    }

    function shouldSkipWord(word, isCandidate) {
        if (alreadyGuessed.has(word)) return true;
        if (hideDoubleLetters && !isCandidate && hasDuplicateLetters(word)) return true;

        // Never spend a probe on confirmed-absent letters.
        for (const l of grayLetters) {
            if (word.includes(l)) return true;
        }

        // In Normal mode, "exclude green/yellow" is primarily a probe filter.
        // Candidates should still be considered so we can recommend a solve attempt when appropriate.
        if (!isCandidate && excludeGreen) {
            for (const l of greenLetters) {
                if (word.includes(l)) return true;
            }
        }
        if (!isCandidate && excludeYellow) {
            for (const l of yellowLetters) {
                if (word.includes(l)) return true;
            }
        }

        return false;
    }

    function considerBest(item) {
        if (!bestOverall || item.score > bestOverall.score) bestOverall = item;
        if (item.kind === 'candidate' && (!bestCandidate || item.score > bestCandidate.score)) bestCandidate = item;
    }

    function considerShortlist(list, item, limit) {
        if (list.length < limit) {
            list.push(item);
            list.sort((a, b) => b.preScore - a.preScore);
            return;
        }
        if (item.preScore <= list[list.length - 1].preScore) return;
        list[list.length - 1] = item;
        list.sort((a, b) => b.preScore - a.preScore);
    }

    const chunkSize = pool.length > 1500 ? 60 : 120;

    // Fast path: coverage-only strategy for large candidate sets.
    if (!useExpectedPartitions) {
        for (let i = 0; i < pool.length; i++) {
            if (token && token.cancelled) return null;
            const word = pool[i];
            const isCandidate = candidatesSet.has(word);
            if (!allowProbes && !isCandidate) continue;
            if (shouldSkipWord(word, isCandidate)) continue;

            const coverageScore = probeCoverageScore(word, letterInfo, greenPositions);
            const languageScore = modernLanguageFrequencyScore(word);
            let score = coverageScore + (0.05 * languageScore);

            const item = {
                word,
                kind: isCandidate ? 'candidate' : 'probe',
                expectedRemaining: null,
                coverageScore,
                score
            };

            considerBest(item);
            consider(item);

            if (i % chunkSize === 0) await nextFrame();
        }

        if (bestCandidate && !top.some(i => i.word === bestCandidate.word)) top.push(bestCandidate);
        if (bestOverall && !top.some(i => i.word === bestOverall.word)) top.push(bestOverall);
        top.sort((a, b) => b.score - a.score);
        return { items: top, bestOverall, bestCandidate, useExpectedPartitions: false };
    }

    // Expected-remaining mode: exact partitions on a shortlist (plus full scan for best candidate).
    const exactBudget = 2_500_000; // total guess*candidate expectedRemaining calls
    const desiredK = allowProbes ? Math.min(shortlistSize, pool.length) : pool.length;
    const estimatedCost = (candidates.length * candidates.length) + (desiredK * candidates.length);
    if (estimatedCost > exactBudget) {
        // Safety fallback: should be rare with small candidate sets and modest K.
        // Degrade to coverage-only mode.
        const summary = await computeProbeSuggestions(candidates, token, { allowProbes: false });
        return summary;
    }

    const useShortlist = allowProbes && pool.length > desiredK;
    const shortlist = [];

    for (let i = 0; i < pool.length; i++) {
        if (token && token.cancelled) return null;
        const word = pool[i];

        const isCandidate = candidatesSet.has(word);
        if (!allowProbes && !isCandidate) continue;
        if (shouldSkipWord(word, isCandidate)) continue;

        const coverageScore = probeCoverageScore(word, letterInfo, greenPositions);
        const languageScore = modernLanguageFrequencyScore(word);
        const preScore = coverageScore + (0.05 * languageScore);

        const entry = {
            word,
            kind: isCandidate ? 'candidate' : 'probe',
            coverageScore,
            languageScore,
            preScore
        };

        if (useShortlist) {
            considerShortlist(shortlist, entry, desiredK);
        } else {
            shortlist.push(entry);
        }

        if (i % chunkSize === 0) await nextFrame();
    }

    // Compute best candidate exactly across all candidates (candidateCount <= limit).
    for (let i = 0; i < candidates.length; i++) {
        if (token && token.cancelled) return null;
        const word = candidates[i];
        if (alreadyGuessed.has(word)) continue;

        const expectedRemaining = expectedRemainingForGuess(word, candidates);
        const coverageScore = probeCoverageScore(word, letterInfo, greenPositions);
        const languageScore = modernLanguageFrequencyScore(word);
        let score = -expectedRemaining + (0.03 * coverageScore) + (0.001 * languageScore);

        const item = {
            word,
            kind: 'candidate',
            expectedRemaining,
            coverageScore,
            score
        };
        if (!bestCandidate || item.score > bestCandidate.score) bestCandidate = item;

        if (i % 24 === 0) await nextFrame();
    }

    // Evaluate shortlist exactly.
    for (let i = 0; i < shortlist.length; i++) {
        if (token && token.cancelled) return null;
        const entry = shortlist[i];

        const expectedRemaining = expectedRemainingForGuess(entry.word, candidates);
        let score = -expectedRemaining + (0.03 * entry.coverageScore) + (0.001 * entry.languageScore);

        const item = {
            word: entry.word,
            kind: entry.kind,
            expectedRemaining,
            coverageScore: entry.coverageScore,
            score
        };

        if (!bestOverall || item.score > bestOverall.score) bestOverall = item;
        consider(item);

        if (i % 24 === 0) await nextFrame();
    }

    // Ensure key options are visible even if they fall outside the top-N cutoff.
    if (bestCandidate && !top.some(i => i.word === bestCandidate.word)) top.push(bestCandidate);
    if (bestOverall && !top.some(i => i.word === bestOverall.word)) top.push(bestOverall);
    top.sort((a, b) => b.score - a.score);

    return { items: top, bestOverall, bestCandidate, useExpectedPartitions: true };
}

function chooseRecommendedNextGuess(summary, candidateCount, allowProbes = true) {
    const guessesUsed = getCompletedGuesses().size;
    const guessesRemaining = Math.max(0, 6 - guessesUsed);

    const bestOverall = summary?.bestOverall || null;
    const bestCandidate = summary?.bestCandidate || null;
    if (!bestOverall && !bestCandidate) return null;
    if (!bestCandidate) return bestOverall;
    if (!bestOverall) return bestCandidate;

    if (!allowProbes) return bestCandidate;

    // If you're almost out of guesses, don't spend one on a probe.
    if (guessesRemaining <= 2) return bestCandidate;

    // If the candidate set is already tiny, just guess candidates.
    if (candidateCount <= 4) return bestCandidate;

    // If the best overall guess is already a candidate, always take it.
    if (bestOverall.kind === 'candidate') return bestOverall;

    // Expected-partitions mode: pick the guess that shrinks the candidate set fastest.
    // In Normal mode, probes are fine as long as they improve expected remaining.
    if (summary.useExpectedPartitions &&
        typeof bestOverall.expectedRemaining === 'number' &&
        typeof bestCandidate.expectedRemaining === 'number') {
        const delta = bestCandidate.expectedRemaining - bestOverall.expectedRemaining;
        if (!(delta > 0)) return bestCandidate;

        // Once the candidate set is moderately large, take any expected-improvement probe.
        if (candidateCount >= 12) return bestOverall;

        // For smaller candidate sets, require a meaningful improvement to justify a probe.
        const base = bestCandidate.expectedRemaining || 0;
        const relativeGain = base > 0 ? delta / base : 0;
        return (relativeGain >= 0.05 || delta >= 0.25) ? bestOverall : bestCandidate;
    }

    // Coverage-mode fallback: probe when there are lots of candidates.
    return candidateCount >= 12 ? bestOverall : bestCandidate;
}

function renderProbeSuggestions(items, hint, recommendedWord = null) {
    const container = document.getElementById('probeSuggestions');
    const list = document.getElementById('probeSuggestionsList');
    const hintEl = document.getElementById('probeSuggestionsHint');
    if (!container || !list || !hintEl) return;

    hintEl.textContent = hint || '';

    if (!Array.isArray(items) || items.length === 0) {
        list.innerHTML = '<div class="probe-hint">No next guesses fit your filters.</div>';
        return;
    }

    list.innerHTML = items.map(item => {
        const isRecommended = recommendedWord && item.word === recommendedWord;
        const baseTag = item.kind === 'candidate' ? 'Cand' : 'Probe';
        const tag = isRecommended ? `Rec · ${baseTag}` : baseTag;
        const titleParts = [];
        if (typeof item.expectedRemaining === 'number') {
            titleParts.push(`Expected remaining: ${item.expectedRemaining.toFixed(2)}`);
        }
        titleParts.push(`Click to fill next row`);
        const title = titleParts.join(' • ');
        const recClass = isRecommended ? ' recommended' : '';
        return `<button class="probe-chip${recClass}" data-word="${item.word}" title="${title}">
            ${item.word.toUpperCase()} <span class="probe-tag">${tag}</span>
        </button>`;
    }).join('');

    list.querySelectorAll('.probe-chip').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const word = btn.dataset.word;
            if (word) fillNextAvailableRow(word);
        });
    });
}

async function updateProbeSuggestions(force = false) {
    const container = document.getElementById('probeSuggestions');
    const list = document.getElementById('probeSuggestionsList');
    const hintEl = document.getElementById('probeSuggestionsHint');
    if (!container || !list || !hintEl) return;

    const allowProbes = effectiveAllowProbes();
    const modeLabel = solveMode === 'hard' ? 'Hard mode' : 'Normal mode';
    const excludeGreen = allowProbes && Boolean(document.getElementById('excludeGreenToggle')?.checked);
    const excludeYellow = allowProbes && Boolean(document.getElementById('excludeYellowToggle')?.checked);

    if (!Array.isArray(filteredWords) || filteredWords.length <= 1) {
        cancelActiveProbeToken();
        container.style.display = 'none';
        return;
    }

    const cacheValid = !force &&
        probeSuggestionsCache.version === filteredWordsVersion &&
        probeSuggestionsCache.solveMode === solveMode &&
        probeSuggestionsCache.allowProbes === allowProbes &&
        probeSuggestionsCache.allowProbeGuesses === allowProbeGuesses &&
        probeSuggestionsCache.hideDoubleLetters === hideDoubleLetters &&
        probeSuggestionsCache.excludeGreen === excludeGreen &&
        probeSuggestionsCache.excludeYellow === excludeYellow &&
        Array.isArray(probeSuggestionsCache.items) &&
        probeSuggestionsCache.summary;

    container.style.display = 'block';

    if (cacheValid) {
        const candidateCount = filteredWords.length;
        const recommended = chooseRecommendedNextGuess(probeSuggestionsCache.summary, candidateCount, allowProbes);
        const recWord = recommended?.word || probeSuggestionsCache.items[0]?.word || null;
        const hint = `${modeLabel} • ${candidateCount} candidates${allowProbes ? '' : ' • candidates only'}`;

        let ordered = probeSuggestionsCache.items;
        if (recWord) {
            const idx = ordered.findIndex(i => i.word === recWord);
            if (idx > 0) {
                ordered = [ordered[idx], ...ordered.slice(0, idx), ...ordered.slice(idx + 1)];
            }
        }

        renderProbeSuggestions(ordered, hint, recWord);
        return;
    }

    const token = createProbeToken();
    hintEl.textContent = `${modeLabel} • ${filteredWords.length} candidates${allowProbes ? '' : ' • candidates only'}`;
    list.innerHTML = '<div class="probe-hint">Calculating next guesses…</div>';

    const summary = await computeProbeSuggestions(filteredWords, token, { allowProbes });
    if (!summary || token.cancelled) return;

    probeSuggestionsCache = {
        version: filteredWordsVersion,
        solveMode,
        allowProbes,
        allowProbeGuesses,
        hideDoubleLetters,
        excludeGreen,
        excludeYellow,
        items: summary.items,
        summary
    };

    const candidateCount = filteredWords.length;
    const recommended = chooseRecommendedNextGuess(summary, candidateCount, allowProbes);
    const recWord = recommended?.word || summary.items[0]?.word || null;

    const guessesUsed = getCompletedGuesses().size;
    const guessesRemaining = Math.max(0, 6 - guessesUsed);

    let hint = `${modeLabel} • ${candidateCount} candidates • ${guessesRemaining} guesses left`;
    if (recommended && summary.useExpectedPartitions &&
        typeof recommended.expectedRemaining === 'number' &&
        typeof summary.bestCandidate?.expectedRemaining === 'number') {
        const delta = summary.bestCandidate.expectedRemaining - recommended.expectedRemaining;
        const recLabel = recommended.kind === 'candidate' ? 'Cand' : 'Probe';
        hint = `${modeLabel} • ${candidateCount} candidates • Rec: ${recommended.word.toUpperCase()} (${recLabel}) • ΔE≈${delta.toFixed(1)}`;
    } else if (recommended) {
        const recLabel = recommended.kind === 'candidate' ? 'Cand' : 'Probe';
        hint = `${modeLabel} • ${candidateCount} candidates • Rec: ${recommended.word.toUpperCase()} (${recLabel})`;
    }

    let ordered = summary.items;
    if (recWord) {
        const idx = ordered.findIndex(i => i.word === recWord);
        if (idx > 0) {
            ordered = [ordered[idx], ...ordered.slice(0, idx), ...ordered.slice(idx + 1)];
        }
    }
    renderProbeSuggestions(ordered, hint, recWord);
}

async function calculateWordScores(words, scoreMode, token = null) {
    if (!Array.isArray(words) || words.length === 0) {
        return [];
    }
    const scoringToken = token || activeScoringToken;

    // Handle blending if 2 methods are selected
    if (selectedScoreMethods.length === 2) {
        const [method1, method2] = selectedScoreMethods;

        // Check if we can use cached scores
        const cacheValid = blendScoresCache.filteredWordsVersion === filteredWordsVersion &&
                          blendScoresCache.method1Name === method1 &&
                          blendScoresCache.method2Name === method2 &&
                          blendScoresCache.method1 &&
                          blendScoresCache.method2;

        let scores1, scores2;

        if (cacheValid) {
            // Use cached scores
            scores1 = blendScoresCache.method1;
            scores2 = blendScoresCache.method2;
        } else {
            // Calculate and cache scores
            scores1 = await scoreSingleMode(words, method1, scoringToken);
            if (!scores1 || (scoringToken && scoringToken.cancelled)) return null;

            scores2 = await scoreSingleMode(words, method2, scoringToken);
            if (!scores2 || (scoringToken && scoringToken.cancelled)) return null;

            // Cache the scores
            blendScoresCache = {
                method1: scores1,
                method2: scores2,
                method1Name: method1,
                method2Name: method2,
                filteredWordsVersion: filteredWordsVersion
            };
        }

        // Blend the scores: slider at 0 = 100% method1, slider at 10000 = 100% method2
        const weight1 = 1 - blendWeight;
        const weight2 = blendWeight;

        const blended = scores1.map((item, index) => {
            const score1 = item.score;
            const score2 = scores2[index].score;
            const blendedScore = (weight1 * score1) + (weight2 * score2);
            return { word: item.word, score: blendedScore };
        });

        return blended;
    }

    // Single method scoring
    if (scoreMode === 'blend') {
        const blended = await calculateBlendScores(words, scoringToken);
        return blended || [];
    }
    const result = await scoreSingleMode(words, scoreMode, scoringToken);
    return result || [];
}

async function scoreSingleMode(words, scoreMode, token, progressMeta = {}) {
    if (token && token.cancelled) {
        return null;
    }
    if (isHeavyMode(scoreMode)) {
        const meta = { ...progressMeta, candidates: progressMeta.candidates || words };
        return await runHeavyScoringTask(words, scoreMode, token, meta);
    }
    const syncResult = scoreWordsSyncByMode(words, scoreMode);
    if (token && token.cancelled) {
        return null;
    }
    return syncResult;
}

function scoreWordsSyncByMode(words, scoreMode) {
    switch (scoreMode) {
        case 'frequency': {
            const letterFrequencies = calculateLetterFrequencies(filteredWords);
            return words.map(word => {
                const unique = new Set(word.split(''));
                let score = 0;
                unique.forEach(letter => {
                    score += letterFrequencies[letter] || 0;
                });
                return { word, score };
            });
        }
        case 'language-frequency':
            return words.map(word => ({ word, score: modernLanguageFrequencyScore(word) }));
        case 'presence':
            return words.map(word => ({ word, score: calculatePresenceScore(word) }));
        case 'contingency':
            return words.map(word => ({ word, score: calculateContingencyScore(word) }));
	        case 'probe': {
	            const greenPositions = {};
	            tiles.forEach((tile, idx) => {
	                if (tile.dataset.state === STATES.GREEN && tile.textContent) {
	                    const pos = idx % boardCols();
	                    greenPositions[pos] = tile.textContent.toLowerCase();
	                }
	            });
	            const presence = computeLetterPresenceProbs(filteredWords);
	            const letterInfo = computeLetterInfoWeights(presence);
	            return words.map(word => ({ word, score: probeCoverageScore(word, letterInfo, greenPositions) }));
	        }
        case 'positional-frequency':
            return words.map(word => ({ word, score: positionalFrequencyScore(word, filteredWords) }));
        case 'positional-entropy-heuristic':
            return words.map(word => ({ word, score: positionalEntropyHeuristicScore(word, filteredWords) }));
        case 'positional-pattern':
            return words.map(word => ({ word, score: positionalPatternScore(word, filteredWords) }));
        case 'positional-weight':
            return words.map(word => ({ word, score: positionalWeightScore(word, filteredWords) }));
        default: {
            const letterFrequencies = calculateLetterFrequencies(filteredWords);
            return words.map(word => {
                const unique = new Set(word.split(''));
                let score = 0;
                unique.forEach(letter => { score += letterFrequencies[letter] || 0; });
                return { word, score };
            });
        }
    }
}

async function calculateBlendScores(words, token) {
    const strategies = getNormalizedBlendStrategies();
    if (strategies.length === 0) {
        return scoreWordsSyncByMode(words, 'language-frequency');
    }
    const perModeResults = new Map();
    let progressBase = 0;
    for (const strategy of strategies) {
        if (token && token.cancelled) {
            return null;
        }
        const label = getScoreLabel(strategy.mode);
        if (isHeavyMode(strategy.mode)) {
            const result = await runHeavyScoringTask(words, strategy.mode, token, {
                progressOffset: progressBase,
                progressSpan: strategy.weight,
                detail: label,
                label: 'Blending scores',
                candidates: words
            });
            if (!result) {
                return null;
            }
            perModeResults.set(strategy.mode, arrayToScoreMap(result));
        } else {
            const syncScores = scoreWordsSyncByMode(words, strategy.mode);
            perModeResults.set(strategy.mode, arrayToScoreMap(syncScores));
            updateScoringStatus(progressBase + strategy.weight, label);
            await nextFrame();
        }
        progressBase += strategy.weight;
    }

    return words.map(word => {
        let combined = 0;
        strategies.forEach(strategy => {
            const value = perModeResults.get(strategy.mode)?.get(word) ?? 0;
            combined += value * strategy.weight;
        });
        return { word, score: combined };
    });
}

function arrayToScoreMap(entries) {
    const map = new Map();
    entries.forEach(entry => {
        if (entry && typeof entry.word === 'string') {
            map.set(entry.word, entry.score);
        }
    });
    return map;
}

async function runHeavyScoringTask(words, scoreMode, token, progressMeta = {}) {
    const candidates = progressMeta.candidates || words;
    const guessPool = words;
    const chunkSize = guessPool.length > 1500 ? 6 : 12;
    const label = progressMeta.label || `Calculating ${getScoreLabel(scoreMode)}`;
    const detail = progressMeta.detail || getScoreLabel(scoreMode);
    const offset = progressMeta.progressOffset || 0;
    const span = progressMeta.progressSpan || 1;
    const results = new Map();

    for (let start = 0; start < guessPool.length; start += chunkSize) {
        if (token && token.cancelled) {
            return null;
        }
        const end = Math.min(start + chunkSize, guessPool.length);
        for (let idx = start; idx < end; idx++) {
            const guess = guessPool[idx];
            let score = 0;
            if (scoreMode === 'entropy') {
                score = entropyForGuess(guess, candidates);
            } else if (scoreMode === 'expected') {
                score = -expectedRemainingForGuess(guess, candidates);
            } else if (scoreMode === 'minimax') {
                score = -minimaxForGuess(guess, candidates);
            } else if (scoreMode === 'positional-entropy') {
                score = positionalEntropyScore(guess, candidates);
            }
            results.set(guess, score);
        }
        const normalizedProgress = Math.min(1, offset + span * (end / guessPool.length));
        updateScoringStatus(normalizedProgress, detail, label);
        await nextFrame();
    }

    return words.map(word => ({ word, score: results.get(word) ?? -Infinity }));
}

function nextFrame() {
    return new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
        } else {
            setTimeout(resolve, 16);
        }
    });
}

function showScoringStatus(label, detail = '') {
    const container = document.getElementById('scoringStatus');
    if (!container) return;
    container.style.display = 'block';
    const title = document.getElementById('scoringStatusTitle');
    if (title) title.textContent = label;
    const desc = document.getElementById('scoringStatusDetail');
    if (desc) desc.textContent = detail;
    const fill = document.getElementById('scoringProgressFill');
    if (fill) fill.style.width = '0%';
}

function updateScoringStatus(progress, detail, label) {
    const container = document.getElementById('scoringStatus');
    if (!container || container.style.display === 'none') return;
    const title = document.getElementById('scoringStatusTitle');
    if (title && label) {
        title.textContent = label;
    }
    const desc = document.getElementById('scoringStatusDetail');
    if (desc && typeof detail === 'string') {
        desc.textContent = detail;
    }
    const fill = document.getElementById('scoringProgressFill');
    if (fill && typeof progress === 'number') {
        const clamped = Math.min(100, Math.max(0, Math.round(progress * 100)));
        fill.style.width = `${clamped}%`;
    }
}

function hideScoringStatus() {
    const container = document.getElementById('scoringStatus');
    if (container) {
        container.style.display = 'none';
    }
}

function sortWords(scoredWords, sortMode) {
    const wordsCopy = [...scoredWords];
    
    if (sortMode === 'highest') {
        // Sort by score descending (highest score first)
        wordsCopy.sort((a, b) => b.score - a.score);
    } else if (sortMode === 'lowest') {
        // Sort by score ascending (lowest score first)
        wordsCopy.sort((a, b) => a.score - b.score);
    } else if (sortMode === 'median') {
        // Sort by distance to median
        const scores = scoredWords.map(w => w.score);
        const median = calculateMedian(scores);
        wordsCopy.sort((a, b) => {
            const distA = Math.abs(a.score - median);
            const distB = Math.abs(b.score - median);
            return distA - distB;
        });
    } else if (sortMode === 'mode') {
        // Sort by distance to mode
        const scores = scoredWords.map(w => w.score);
        const mode = calculateMode(scores);
        wordsCopy.sort((a, b) => {
            const distA = Math.abs(a.score - mode);
            const distB = Math.abs(b.score - mode);
            return distA - distB;
        });
    }
    
    return wordsCopy;
}

function displayWords(scoredWords) {
    const wordListDiv = document.getElementById('wordList');
    
    // Get the current board state for coloring
    const greenPositions = {}; // position -> letter mapping for greens
    const yellowLetters = new Set(); // letters that are yellow somewhere
    const grayLetters = new Set(); // letters that are definitely not in word
    const greenLetters = new Set(); // letters that are green somewhere
    
    // Analyze the board to determine letter colors
    tiles.forEach((tile, index) => {
        const row = Math.floor(index / boardCols());
        if (!isRowConfirmed(row)) return;
        const letter = tile.textContent.toLowerCase();
        const state = tile.dataset.state;
        const position = index % boardCols();
        
        if (letter) {
            if (state === STATES.GREEN) { 
                greenPositions[position] = letter; 
                greenLetters.add(letter); 
            }
            else if (state === STATES.YELLOW) { 
                yellowLetters.add(letter); 
            }
            else if (state === STATES.GRAY) { 
                grayLetters.add(letter); 
            }
        }
    });
    
    // Prune any grays that are also green/yellow somewhere
    for (const l of Array.from(grayLetters)) {
        if (greenLetters.has(l) || yellowLetters.has(l)) {
            grayLetters.delete(l);
        }
    }
    
    // Sort based on current sort mode
    let sortedWords = sortWords(scoredWords, currentSortMode);

    // Filter out words with double letters if toggle is on
    if (hideDoubleLetters) {
        const hasDoubleLetters = (word) => {
            const letters = word.split('');
            for (let i = 0; i < letters.length; i++) {
                if (letters.indexOf(letters[i]) !== letters.lastIndexOf(letters[i])) {
                    return true;
                }
            }
            return false;
        };

        const filteredSorted = sortedWords.filter(item => !hasDoubleLetters(item.word));

        // Only apply filter if there's more than one word, or if the remaining word doesn't have double letters
        if (filteredSorted.length > 0) {
            sortedWords = filteredSorted;
        }
        // If all words have double letters (filteredSorted is empty), keep the original list
    }

    // Choose an adaptive scale so scores don't saturate at 9999.
    // (Avoid Math.max(...bigArray) to prevent argument-limit issues on large lists.)
    let maxAbsScore = 0;
    for (const item of sortedWords) {
        const s = item?.score;
        if (typeof s === 'number' && Number.isFinite(s)) {
            const abs = Math.abs(s);
            if (abs > maxAbsScore) maxAbsScore = abs;
        }
    }
    let scoreScale = 1;
    if (maxAbsScore <= 9.999) scoreScale = 1000;
    else if (maxAbsScore <= 99.99) scoreScale = 100;
    else if (maxAbsScore <= 999.9) scoreScale = 10;

    const scoreHeader = scoreScale === 1 ? 'Score' : `Score (×${scoreScale})`;

    const totalRows = sortedWords.length;
    const renderLimit = totalRows > 10000 ? 2000 : 5000;
    const isTruncated = totalRows > renderLimit;
    const renderWords = isTruncated ? sortedWords.slice(0, renderLimit) : sortedWords;

    // Display sorted words in a table with colored letters
    const tableRows = renderWords.map(({ word, score }, index) => {
        // Color each letter based on board state
        const coloredWord = word.split('').map((letter, letterIndex) => {
            let className = 'word-letter';

            // Check if this position should be green
            if (greenPositions[letterIndex] === letter) {
                className += ' letter-green';
            }
            // Check if this letter is yellow (in word but wrong position)
            else if (yellowLetters.has(letter)) {
                className += ' letter-yellow';
            }
            // Check if this letter is gray (not in word)
            else if (grayLetters.has(letter)) {
                className += ' letter-gray';
            }

            return `<span class="${className}">${letter.toUpperCase()}</span>`;
        }).join('');

        // Scale scores and round to integer for display
        let displayScore = score;
        if (typeof score === 'number') {
            if (Number.isFinite(score)) {
                displayScore = Math.round(score * scoreScale);
            } else {
                displayScore = '—';
            }
        }

        return `<tr class="word-row" data-word="${word}">
            <td class="word-rank">${index + 1}</td>
            <td class="word-text">${coloredWord}</td>
            <td class="word-score-cell">${displayScore}</td>
            <td class="word-action">
                <button class="use-word-btn" data-word="${word}">Use</button>
                <button class="invalid-word-btn" data-word="${word}" title="Mark as not valid in Wordle">🚫</button>
            </td>
        </tr>`;
    }).join('');

    const truncNote = isTruncated
        ? `<div style="padding: 8px 12px; font-size: 12px; opacity: 0.85;">
            Showing top ${renderLimit.toLocaleString()} of ${totalRows.toLocaleString()} results. Narrow filters to see more.
        </div>`
        : '';

	    wordListDiv.innerHTML = `
            ${truncNote}
	        <table class="words-table">
	            <thead>
	                <tr>
	                    <th>Rank</th>
	                    <th>Word</th>
	                    <th>${scoreHeader}</th>
	                    <th>Action</th>
	                </tr>
	            </thead>
	            <tbody>
	                ${tableRows}
            </tbody>
        </table>
    `;

}

function updateWordDisplay(forceRecalculate = false) {
    const wordListDiv = document.getElementById('wordList');
    const wordCount = document.getElementById('wordCount');

    wordCount.textContent = filteredWords.length;

    if (filteredWords.length === 0) {
        cancelActiveScoring();
        cancelActiveProbeToken();
        hideScoringStatus();
        wordListDiv.innerHTML = '<p style="padding: 20px; text-align: center; color: #dc3545;">No matching words found. Check your inputs.</p>';
        scoredWordsCache = [];
        updateLetterFrequency();
        updateProbeSuggestions(true);
        return;
    }

    const wordsChanged = filteredWordsVersion !== lastScoredVersion;
    const modeChanged = currentScoreMode !== lastScoredMode;
    if (wordsChanged || modeChanged || forceRecalculate || scoredWordsCache.length === 0) {
        console.log(`Recalculating scores (${currentScoreMode} mode) for ${filteredWords.length} words`);
        startScoringTask(filteredWords);
    } else {
        displayWords(scoredWordsCache);
    }

    updateLetterFrequency();
    updateProbeSuggestions();
}

function startScoringTask(words) {
    const token = createScoringToken();
    const versionAtStart = filteredWordsVersion;
    const modeAtStart = currentScoreMode;
    const spinnerNeeded = shouldShowSpinnerForMode(currentScoreMode);
    if (spinnerNeeded) {
        showScoringStatus(`Scoring with ${getScoreLabel(currentScoreMode)}`, 'Crunching feedback partitions…');
    } else {
        hideScoringStatus();
    }

    calculateWordScores(words, currentScoreMode, token)
        .then(result => {
            if (!result || token.cancelled) {
                return;
            }
            if (filteredWordsVersion !== versionAtStart || currentScoreMode !== modeAtStart) {
                return;
            }
            scoredWordsCache = result;
            lastScoredVersion = versionAtStart;
            lastScoredMode = modeAtStart;
            displayWords(scoredWordsCache);
        })
        .catch(err => {
            console.error('Failed to calculate scores:', err);
        })
        .finally(() => {
            if (token === activeScoringToken) {
                activeScoringToken = null;
                hideScoringStatus();
            }
        });
}

function calculateLetterFrequencies(source = filteredWords) {
    const letterCounts = {};
    const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
    
    // Initialize counts
    alphabet.forEach(letter => {
        letterCounts[letter] = 0;
    });
    
    // Count how many words contain each letter
    source.forEach(word => {
        const uniqueLetters = new Set(word.split(''));
        uniqueLetters.forEach(letter => {
            if (letterCounts.hasOwnProperty(letter)) {
                letterCounts[letter]++;
            }
        });
    });
    
    return letterCounts;
}

function calculatePositionalLetterFrequencies() {
    const L = boardCols();
    const positionCounts = Array.from({ length: L }, () => ({}));
    const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
    
    // Initialize counts for each position
    for (let pos = 0; pos < L; pos++) {
        alphabet.forEach(letter => {
            positionCounts[pos][letter] = 0;
        });
    }
    
    // Count letter occurrences at each position
    filteredWords.forEach(word => {
        for (let pos = 0; pos < L; pos++) {
            const letter = word[pos];
            if (letter && positionCounts[pos].hasOwnProperty(letter)) {
                positionCounts[pos][letter]++;
            }
        }
    });
    
    return positionCounts;
}

function getLetterStatus(letter) {
    let status = 'unused';
    
    tiles.forEach(tile => {
        const tileLetter = tile.textContent.toLowerCase();
        if (tileLetter === letter && tile.dataset.state) {
            const tileState = tile.dataset.state;
            // Priority: green > yellow > gray > unused
            if (tileState === STATES.GREEN) {
                status = 'green';
            } else if (tileState === STATES.YELLOW && status !== 'green') {
                status = 'yellow';
            } else if (tileState === STATES.GRAY && status !== 'green' && status !== 'yellow') {
                status = 'gray';
            }
        }
    });
    
    return status;
}

function updateLetterFrequency() {
    const frequencyDiv = document.getElementById('letterFrequency');
    const frequencyWidget = document.querySelector('[data-widget="frequency"] .widget-content');
    const showByPosition = true; // Always show positional frequency
    
    // Get the dimensions of the widget content area
    const widgetWidth = frequencyWidget ? frequencyWidget.offsetWidth : 400;
    const widgetHeight = frequencyWidget ? frequencyWidget.offsetHeight : 300;
    const aspectRatio = widgetWidth / widgetHeight;
    
    // Determine if we should use vertical layout (wide widget) or horizontal (tall widget)
    const isVertical = aspectRatio > 1.5;
    
    if (showByPosition) {
        // Position-based frequency display
        const positionCounts = calculatePositionalLetterFrequencies();
        let html = '<div class="position-frequency-container">';
        
        for (let pos = 0; pos < boardCols(); pos++) {
            html += `<div class="position-column">`;
            html += `<h4>Position ${pos + 1}</h4>`;
            html += `<div class="position-letters">`;
            
            // Sort letters by frequency for this position
            const sortedLetters = Object.entries(positionCounts[pos])
                .sort((a, b) => b[1] - a[1])
                .filter(([letter, count]) => count > 0)
                .slice(0, 10); // Show top 10 letters per position
            
            const maxCount = sortedLetters[0]?.[1] || 1;
            
            sortedLetters.forEach(([letter, count]) => {
                const percentage = (count / maxCount) * 100;
                const letterStatus = getLetterStatus(letter);

                // Check if this letter is the active filter for this position
                const positionInput = document.querySelector(`.position-include-input[data-pos="${pos}"]`);
                const activeLetter = positionInput ? positionInput.value.toLowerCase().trim() : '';
                const isActive = activeLetter === letter;
                const activeClass = isActive ? 'active-filter' : '';

                html += `
                    <div class="position-letter-item ${activeClass}" data-position="${pos}" data-letter="${letter}">
                        <span class="position-letter ${letterStatus}">${letter.toUpperCase()}</span>
                        <div class="position-bar-container">
                            <div class="position-bar bar-${letterStatus}" style="width: ${percentage}%;"></div>
                        </div>
                        <span class="position-count">${count}</span>
                    </div>
                `;
            });
            
            html += `</div></div>`;
        }
        
        html += '</div>';
        frequencyDiv.innerHTML = html;

        // Add click handlers for position-letter filtering
        frequencyDiv.querySelectorAll('.position-letter-item').forEach(item => {
            item.style.cursor = 'pointer';
            item.addEventListener('click', () => {
                const pos = parseInt(item.dataset.position);
                const letter = item.dataset.letter;

                // Get the "Include at positions" input for this position
                const positionInput = document.querySelector(`.position-include-input[data-pos="${pos}"]`);
                if (!positionInput) return;

                // Get current value
                const currentLetter = positionInput.value.toLowerCase().trim();

                // Toggle: if this letter is already set, clear it. Otherwise, set only this letter.
                if (currentLetter === letter) {
                    positionInput.value = '';
                } else {
                    positionInput.value = letter;
                }

                // Trigger the filter update
                analyzeBoard();
            });
        });

        return;
    }
    
    // Original whole-word frequency display
    const letterCounts = calculateLetterFrequencies();
    
    // Categorize letters based on their status in the grid
    const letterStatus = {};
    const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
    
    alphabet.forEach(letter => {
        letterStatus[letter] = 'unused'; // default to unused (blue/purple)
    });
    
    // Check all tiles to determine letter statuses
    tiles.forEach(tile => {
        const letter = tile.textContent.toLowerCase();
        if (letter && tile.dataset.state) {
            // Priority: green > yellow > gray > unused
            const currentStatus = letterStatus[letter];
            const tileState = tile.dataset.state;
            
            if (tileState === STATES.GREEN) {
                letterStatus[letter] = 'green';
            } else if (tileState === STATES.YELLOW && currentStatus !== 'green') {
                letterStatus[letter] = 'yellow';
            } else if (tileState === STATES.GRAY && currentStatus !== 'green' && currentStatus !== 'yellow') {
                letterStatus[letter] = 'gray';
            }
        }
    });
    
    const sortedLetters = Object.entries(letterCounts)
        .sort((a, b) => b[1] - a[1])
        .map(entry => ({ 
            letter: entry[0], 
            count: entry[1],
            status: letterStatus[entry[0]]
        }));
    
    const maxCount = Math.max(...Object.values(letterCounts), 1);
    
    let html = `<div class="frequency-chart ${isVertical ? 'vertical-layout' : 'horizontal-layout'}">`;
    
    sortedLetters.forEach(({ letter, count, status }) => {
        const percentage = (count / maxCount) * 100;
        
        // Determine gradient based on status
        let gradient;
        let gradientDirection = isVertical ? 'to top' : 'to right';
        switch (status) {
            case 'green':
                gradient = `linear-gradient(${gradientDirection}, #00aa00, #00ff00)`;
                break;
            case 'yellow':
                gradient = `linear-gradient(${gradientDirection}, #cc9900, #ffff00)`;
                break;
            case 'gray':
                gradient = `linear-gradient(${gradientDirection}, #606060, #808080)`;
                break;
            default: // unused
                gradient = `linear-gradient(${gradientDirection}, #667eea, #764ba2)`;
                break;
        }
        
        if (isVertical) {
            // Vertical bars (current layout)
            html += `
                <div class="letter-bar">
                    <div class="bar-container">
                        <div class="bar bar-${status}" style="height: ${percentage}%; background: ${gradient};">
                            <span class="bar-count">${count}</span>
                        </div>
                    </div>
                    <div class="letter-label">${letter.toUpperCase()}</div>
                </div>
            `;
        } else {
            // Horizontal bars (for narrow/tall widgets)
            html += `
                <div class="letter-bar-horizontal">
                    <div class="letter-label">${letter.toUpperCase()}</div>
                    <div class="bar-container-horizontal">
                        <div class="bar bar-${status}" style="width: ${percentage}%; background: ${gradient};">
                            <span class="bar-count">${count}</span>
                        </div>
                    </div>
                </div>
            `;
        }
    });
    
    html += '</div>';
    frequencyDiv.innerHTML = html;
}

function fillNextAvailableRow(word) {
    if (typeof word !== 'string') return;
    const normalized = word.toLowerCase().trim();
    if (!normalized || normalized.length !== boardCols()) {
        console.warn(`Skipping fill; word length ${normalized.length} != ${boardCols()}:`, word);
        return;
    }

    if (solveMode === 'hard') {
        const constraints = getHardModeConstraintsFromBoard();
        const validation = validateHardModeGuess(normalized, constraints);
        if (!validation.ok) {
            const shown = validation.reasons.slice(0, 3).join(' • ');
            const suffix = validation.reasons.length > 3 ? ` • +${validation.reasons.length - 3} more` : '';
            showModeMessage(`Hard mode: ${shown}${suffix}`);
            return;
        }
    }

    clearModeMessage();
    console.log(`Filling next available row with: ${normalized}`);

    // Find the first row that is mostly empty (can have some auto-filled green letters)
    for (let row = 0; row < boardRows(); row++) {
        const startIndex = row * boardCols();
        let letterCount = 0;
        let hasNonGreenLetters = false;
        
        // Count how many tiles have letters and check for non-green letters
        for (let col = 0; col < boardCols(); col++) {
            const tile = tiles[startIndex + col];
            if (tile.textContent && tile.textContent.trim() !== '') {
                letterCount++;
                // Check if this tile has a non-green letter (user-entered content)
                if (tile.dataset.state !== STATES.GREEN) {
                    hasNonGreenLetters = true;
                }
            }
        }
        
        // Only use this row if it's mostly empty (less than 3 letters)
        // OR if it only has auto-filled green letters (no user content)
        const canUseRow = letterCount < 3 || (letterCount > 0 && !hasNonGreenLetters);
        
        if (canUseRow) {
            console.log(`Filling row ${row + 1} with "${normalized.toUpperCase()}"`);
            clearRowConfirmation(row);
            clearRowFeedbackFlags(row);
            
            for (let col = 0; col < boardCols(); col++) {
                const tile = tiles[startIndex + col];
                const letter = normalized[col].toUpperCase();
                
                // Always fill the letter
                tile.textContent = letter;
                
                // If this position doesn't have a green letter from above, make it gray
                // If it does have green and matches, keep it green
                // If it has green but doesn't match, make it gray (user override)
                if (tile.dataset.state === STATES.GREEN) {
                    // Check if there's a green letter above that would justify this being green
                    let shouldStayGreen = false;
                    for (let checkRow = 0; checkRow < row; checkRow++) {
                        const checkTile = tiles[boardTileIndex(checkRow, col)];
                        if (checkTile.dataset.state === STATES.GREEN && 
                            checkTile.textContent === letter) {
                            shouldStayGreen = true;
                            break;
                        }
                    }
                    
                    if (!shouldStayGreen) {
                        tile.classList.remove('yellow', 'green');
                        tile.classList.add('gray');
                        tile.dataset.state = STATES.GRAY;
                    }
                } else {
                    // Make it gray by default
                    tile.classList.remove('yellow', 'green');
                    tile.classList.add('gray');
                    tile.dataset.state = STATES.GRAY;
                }
            }
            
            // Check if we have a correct answer and apply colors
            const correctWord = (document.getElementById('correctWord')?.value || '').toLowerCase().trim();
            if (WORD_LENGTH === 5 && correctWord && correctWord.length === 5) {
                applyColorsToRow(row, correctWord);
            }
            
            // Focus the first tile of the row we just filled
            tiles[startIndex].focus();
            
            // Analyze the board after filling
            analyzeBoard();
            return;
        }
    }
    
    console.log('No available row found to fill');
}


function checkIfRowHasManualEntries(row) {
    const startIndex = row * boardCols();
    for (let col = 0; col < boardCols(); col++) {
        const tile = tiles[startIndex + col];
        // If tile has manual entry flag or has content but isn't marked as autofilled, it's manual
        if (tile.dataset.manualEntry === 'true' ||
            (tile.textContent && 
             tile.dataset.autofilledSolution !== 'true' && 
             tile.dataset.autofilled !== 'true')) {
            return true;
        }
    }
    return false;
}

function toggleAutofillGreen(enabled) {
    autofillGreenEnabled = enabled;
    
    if (!enabled) {
        // Remove autofilled green tiles from rows with blank gray squares
        for (let row = 0; row < boardRows(); row++) {
            // Check if this row has any blank gray squares
            let hasBlankGray = false;
            for (let col = 0; col < boardCols(); col++) {
                const tile = tiles[boardTileIndex(row, col)];
                if (tile.dataset.state === STATES.GRAY && !tile.textContent) {
                    hasBlankGray = true;
                    break;
                }
            }
            
            // If row has blank gray squares, remove all autofilled greens
            if (hasBlankGray) {
                for (let col = 0; col < boardCols(); col++) {
                    const tile = tiles[boardTileIndex(row, col)];
                    if (tile.dataset.autofilled === 'true') {
                        tile.textContent = '';
                        tile.classList.remove('green', 'yellow');
                        tile.classList.add('gray');
                        tile.dataset.state = STATES.GRAY;
                        delete tile.dataset.autofilled;
                    }
                }
            }
        }
        filterWords();
    } else {
        // Re-apply green autofill based on current green tiles
        tiles.forEach((tile, index) => {
            if (tile.dataset.state === STATES.GREEN && tile.textContent && !tile.dataset.autofilled) {
                const col = index % boardCols();
                const row = parseInt(tile.dataset.row);
                const letter = tile.textContent;
                
                tiles.forEach((otherTile, otherIndex) => {
                    const otherRow = parseInt(otherTile.dataset.row);
                    if (otherIndex % boardCols() === col && otherRow > row) {
                        if (!otherTile.textContent) {
                            otherTile.textContent = letter;
                            otherTile.classList.remove('gray', 'yellow');
                            otherTile.classList.add('green');
                            otherTile.dataset.state = STATES.GREEN;
                            otherTile.dataset.autofilled = 'true';
                        } else if (otherTile.textContent.toLowerCase() === letter.toLowerCase() && 
                                   otherTile.dataset.state !== STATES.GREEN) {
                            otherTile.classList.remove('gray', 'yellow');
                            otherTile.classList.add('green');
                            otherTile.dataset.state = STATES.GREEN;
                            otherTile.dataset.autofilled = 'true';
                        }
                    }
                });
            }
        });
    }
    
    analyzeBoard();
}

function clearRow(rowIndex) {
    clearRowConfirmation(rowIndex);
    for (let col = 0; col < boardCols(); col++) {
        const tile = tiles[boardTileIndex(rowIndex, col)];
        tile.textContent = '';
        tile.dataset.state = STATES.GRAY;
        tile.classList.remove('yellow', 'green');
        tile.classList.add('gray');
        delete tile.dataset.autofilled;
        delete tile.dataset.autofilledSolution;
        delete tile.dataset.manualEntry;
        delete tile.dataset.manualState;
        delete tile.dataset.autoColored;
    }
    
    
    // Re-analyze the board to update possible words
    analyzeBoard();
    highlightNextInput();
}

function clearAll() {
    confirmedRowWords = Array.from({ length: boardRows() }, () => null);
    tiles.forEach(tile => {
        tile.textContent = '';
        tile.dataset.state = STATES.GRAY;
        tile.classList.remove('yellow', 'green');
        tile.classList.add('gray');
        delete tile.dataset.autofilled;
        delete tile.dataset.autofilledSolution;
        delete tile.dataset.manualEntry;
        delete tile.dataset.manualState;
        delete tile.dataset.autoColored;
    });
    
    
    // Clear filter inputs
    document.getElementById('excludeLetters').value = '';
    document.getElementById('includeLetters').value = '';
    const globalExclude = document.getElementById('globalExcludeLetters');
    if (globalExclude) globalExclude.value = '';

    // Clear per-position filter inputs
    document.querySelectorAll('.position-input').forEach(input => {
        input.value = '';
    });
    document.querySelectorAll('.position-include-input').forEach(input => {
        input.value = '';
    });

    // Don't clear correctWord - user may want to keep the answer while testing different guesses

    setFilteredWords([...answerList]);
    updateWordDisplay();
    
    if (tiles[0]) {
        tiles[0].focus();
    }
    highlightNextInput();
    updateConstraintsDigest();
    updateGhostHints();
}

function applyAnswerToGrid() {
    if (WORD_LENGTH !== 5) {
        return;
    }
    const correctWord = document.getElementById('correctWord').value.toLowerCase().trim();
    
    if (!correctWord || correctWord.length !== 5) {
        return; // Just return silently, no alert needed
    }
    
    // First revert any previous auto-coloring
    revertToManualColors();

    // Process each row that has content
    for (let row = 0; row < boardRows(); row++) {
        const startIndex = row * boardCols();
        let rowHasContent = false;
        let guessWord = '';
        
        // Check if this row has any letters
        for (let col = 0; col < boardCols(); col++) {
            const tile = tiles[startIndex + col];
            if (tile.textContent) {
                rowHasContent = true;
                guessWord += tile.textContent.toLowerCase();
            } else {
                guessWord += ' ';
            }
        }
        
        // If row has content, apply colors based on the correct word
        if (rowHasContent && guessWord.trim().length === boardCols()) {
            const answerArr = correctWord.split('');
            const guessArr = guessWord.split('');
            const answerLetterCounts = {};
            const tileStates = [];
            
            // Count letters in answer
            answerArr.forEach(letter => {
                answerLetterCounts[letter] = (answerLetterCounts[letter] || 0) + 1;
            });
            
            // First pass: identify greens
            guessArr.forEach((letter, i) => {
                if (letter === answerArr[i]) {
                    tileStates[i] = 'green';
                    answerLetterCounts[letter]--;
                } else {
                    tileStates[i] = 'pending';
                }
            });
            
            // Second pass: identify yellows and grays
            guessArr.forEach((letter, i) => {
                if (tileStates[i] === 'pending') {
                    if (answerLetterCounts[letter] > 0) {
                        tileStates[i] = 'yellow';
                        answerLetterCounts[letter]--;
                    } else {
                        tileStates[i] = 'gray';
                    }
                }
            });
            
            // Apply the states to tiles
            for (let col = 0; col < boardCols(); col++) {
                const tile = tiles[startIndex + col];
                if (tile.textContent) {
                    // Save the user's manual color choice if not already saved
                    if (!tile.dataset.manualState && !tile.dataset.autoColored) {
                        tile.dataset.manualState = tile.dataset.state;
                    }
                    
                    // Remove all color classes
                    tile.classList.remove('gray', 'yellow', 'green');
                    // Add the appropriate color class
                    tile.classList.add(tileStates[col]);
                    tile.dataset.state = STATES[tileStates[col].toUpperCase()];
                    tile.dataset.autoColored = 'true'; // Mark as auto-colored
                }
            }
        }
    }
    
    // Re-analyze the board with the new colors
    analyzeBoard();
}

// Widget management functions
function initializeWidgets() {
    const container = document.getElementById('widgetsContainer');
    if (!container) return;
    const widgets = container.querySelectorAll('.widget-section');
    let draggedElement = null;
    
    // Initialize collapse buttons
    widgets.forEach(widget => {
        const collapseBtn = widget.querySelector('.collapse-btn');
        collapseBtn.addEventListener('click', () => {
            widget.classList.toggle('collapsed');
            collapseBtn.textContent = widget.classList.contains('collapsed') ? '▸' : '▾';
            saveWidgetPreferences();
        });
        
        // Set up drag and drop - only on the drag handle
        const dragHandle = widget.querySelector('.drag-handle');
        if (dragHandle) {
            dragHandle.draggable = true;

            dragHandle.addEventListener('dragstart', (e) => {
                draggedElement = widget;
                widget.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            dragHandle.addEventListener('dragend', () => {
                widget.classList.remove('dragging');
                saveWidgetPreferences();
            });
        }

        // Still need dragover on the widget itself for drop targeting
        widget.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (draggedElement && draggedElement !== widget) {
                const rect = widget.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;

                if (e.clientY < midpoint) {
                    container.insertBefore(draggedElement, widget);
                } else {
                    container.insertBefore(draggedElement, widget.nextSibling);
                }
            }
        });
    });
    
    // Add ResizeObserver for frequency widget to update layout on resize
    const frequencyWidget = document.querySelector('[data-widget="frequency"]');
    if (frequencyWidget && window.ResizeObserver) {
        const resizeObserver = new ResizeObserver(() => {
            updateLetterFrequency();
        });
        resizeObserver.observe(frequencyWidget);
    }
    
    // Load saved preferences
    loadWidgetPreferences();
}

function saveWidgetPreferences() {
    const container = document.getElementById('widgetsContainer');
    if (!container) return;
    const widgets = container.querySelectorAll('.widget-section');
    const prefs = {
        order: Array.from(widgets).map(w => w.dataset.widget),
        collapsed: Array.from(widgets).filter(w => w.classList.contains('collapsed')).map(w => w.dataset.widget),
        layout: container.classList.contains('cols-2') ? '2' : container.classList.contains('cols-5') ? '5' : '1'
    };
    localStorage.setItem('wordleWidgetPrefs', JSON.stringify(prefs));
}

function loadWidgetPreferences() {
    const saved = localStorage.getItem('wordleWidgetPrefs');
    const container = document.getElementById('widgetsContainer');
    if (!container) return;

    if (!saved) {
        // No saved preferences - apply defaults.
        // Order:
        //   1) Possible Words (expanded)
        //   2) Letter Frequency in Possible Words (expanded)
        //   3) Wordle Art Planner (collapsed)
        //   4) Letter Filter (collapsed)
        const defaultOrder = ['results', 'frequency', 'art', 'filter'];
        const defaultExpanded = new Set(['results', 'frequency']);

        const widgets = Array.from(container.querySelectorAll('.widget-section'));
        defaultOrder.forEach((widgetId) => {
            const widget = widgets.find((w) => w.dataset.widget === widgetId);
            if (widget) container.appendChild(widget);
        });
        // Append any unknown widgets at the end (future-proofing).
        widgets.forEach((w) => {
            if (!defaultOrder.includes(w.dataset.widget)) container.appendChild(w);
        });

        container.querySelectorAll('.widget-section').forEach((widget) => {
            const collapseBtn = widget.querySelector('.collapse-btn');
            const widgetId = widget.dataset.widget;
            const expanded = defaultExpanded.has(widgetId);
            widget.classList.toggle('collapsed', !expanded);
            if (collapseBtn) collapseBtn.textContent = expanded ? '▾' : '▸';
        });
        return;
    }

    try {
        const prefs = JSON.parse(saved);

        // Restore order
        if (prefs.order) {
            const widgets = Array.from(container.querySelectorAll('.widget-section'));
            prefs.order.forEach(widgetId => {
                const widget = widgets.find(w => w.dataset.widget === widgetId);
                if (widget) {
                    container.appendChild(widget);
                }
            });
            const orderSet = new Set(prefs.order);
            widgets.forEach((w) => {
                if (!orderSet.has(w.dataset.widget)) container.appendChild(w);
            });
        }

        // Restore collapsed states
        // Normalize: start from "expanded" for all widgets, then apply collapsed list.
        container.querySelectorAll('.widget-section').forEach(widget => {
            widget.classList.remove('collapsed');
            const collapseBtn = widget.querySelector('.collapse-btn');
            if (collapseBtn) collapseBtn.textContent = '▾';
        });
        if (prefs.collapsed) {
            prefs.collapsed.forEach(widgetId => {
                const widget = container.querySelector(`[data-widget="${widgetId}"]`);
                if (widget) {
                    widget.classList.add('collapsed');
                    widget.querySelector('.collapse-btn').textContent = '▸';
                }
            });
        }
        
    } catch (e) {
        console.error('Failed to load widget preferences:', e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialize settings from localStorage
    if (window.SettingsManager) {
        SettingsManager.init();
    }

    loadInvalidWordsFromStorage();
    renderInvalidWordsUI();

    const invalidInput = document.getElementById('invalidWordInput');
    const invalidAddBtn = document.getElementById('invalidWordAddBtn');
    const invalidClearBtn = document.getElementById('invalidWordClearBtn');
    if (invalidInput) {
        invalidInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (addInvalidWord(invalidInput.value)) invalidInput.value = '';
        });
    }
    if (invalidAddBtn && invalidInput) {
        invalidAddBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (addInvalidWord(invalidInput.value)) invalidInput.value = '';
        });
    }
    if (invalidClearBtn) {
        invalidClearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            clearAllInvalidWords();
        });
    }

    const invalidCopyBtn = document.getElementById('invalidWordsCopyBtn');
    const invalidClearWidgetBtn = document.getElementById('invalidWordsClearBtn');
    const invalidStatusEl = document.getElementById('invalidWordsWidgetStatus');
    const bulkRemoveEl = document.getElementById('invalidWordsBulkRemove');
    const bulkRemoveBtn = document.getElementById('invalidWordsBulkRemoveBtn');

    async function copyInvalidWordsToClipboard() {
        const text = invalidWordsText();
        if (!text) {
            if (invalidStatusEl) invalidStatusEl.textContent = 'Nothing to copy';
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            if (invalidStatusEl) invalidStatusEl.textContent = `Copied ${invalidWordSet.size}`;
        } catch {
            // Fallback: select textarea content for manual copy.
            const ta = document.getElementById('invalidWordsTextarea');
            if (ta && typeof ta.select === 'function') {
                ta.focus();
                ta.select();
                if (invalidStatusEl) invalidStatusEl.textContent = 'Select + copy';
            }
        }
        if (invalidStatusEl) {
            setTimeout(() => {
                if (invalidStatusEl.textContent) invalidStatusEl.textContent = '';
            }, 2000);
        }
    }

    function parseBulkWords(text) {
        if (typeof text !== 'string') return [];
        const matches = text.toLowerCase().match(/[a-z]+/g) || [];
        const unique = new Set();
        const out = [];
        for (const m of matches) {
            const w = normalizeCandidateWord(m);
            if (!w) continue;
            if (unique.has(w)) continue;
            unique.add(w);
            out.push(w);
        }
        return out;
    }

    if (invalidCopyBtn) {
        invalidCopyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            copyInvalidWordsToClipboard();
        });
    }
    if (invalidClearWidgetBtn) {
        invalidClearWidgetBtn.addEventListener('click', (e) => {
            e.preventDefault();
            clearAllInvalidWords();
            if (invalidStatusEl) invalidStatusEl.textContent = 'Cleared';
            if (invalidStatusEl) setTimeout(() => (invalidStatusEl.textContent = ''), 1200);
        });
    }
    if (bulkRemoveBtn && bulkRemoveEl) {
        bulkRemoveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const words = parseBulkWords(bulkRemoveEl.value);
            const removed = removeInvalidWordsBulk(words);
            bulkRemoveEl.value = '';
            if (invalidStatusEl) invalidStatusEl.textContent = removed ? `Removed ${removed}` : 'No matches';
            if (invalidStatusEl) setTimeout(() => (invalidStatusEl.textContent = ''), 1800);
        });
    }

    const modeSelect = document.getElementById('solveModeSelect');
    const savedMode = localStorage.getItem('solveMode');
    solveMode = savedMode === 'hard' ? 'hard' : 'normal';
    if (modeSelect) {
        modeSelect.value = solveMode;
    }

    autofillGreenEnabled = document.getElementById('autofillToggle').checked;
    allowProbeGuesses = document.getElementById('allowProbeToggle').checked;

    // Event delegation for word list actions (instead of per-button handlers)
    const wordListEl = document.getElementById('wordList');
    if (wordListEl) {
        wordListEl.addEventListener('click', (e) => {
            const invalidBtn = e.target.closest('.invalid-word-btn');
            if (invalidBtn) {
                e.stopPropagation();
                const w = invalidBtn.dataset.word;
                if (w) addInvalidWord(w);
                return;
            }
            const useBtn = e.target.closest('.use-word-btn');
            if (!useBtn) return;
            e.stopPropagation();
            fillNextAvailableRow(useBtn.dataset.word);
        });
    }

    function syncSolveModeUi() {
        const hard = solveMode === 'hard';
        const probeToggle = document.getElementById('allowProbeToggle');
        const excludeGreenToggle = document.getElementById('excludeGreenToggle');
        const excludeYellowToggle = document.getElementById('excludeYellowToggle');
        if (probeToggle) probeToggle.disabled = hard;
        if (excludeGreenToggle) excludeGreenToggle.disabled = hard;
        if (excludeYellowToggle) excludeYellowToggle.disabled = hard;
    }
    syncSolveModeUi();

    if (modeSelect) {
        modeSelect.addEventListener('change', (e) => {
            solveMode = e.target.value === 'hard' ? 'hard' : 'normal';
            localStorage.setItem('solveMode', solveMode);
            syncSolveModeUi();
            clearModeMessage();
            analyzeBoard();
        });
    }

    // Sync visibility of filter sections with toggle state
    const perPositionMode = document.getElementById('perPositionToggle').checked;
    document.getElementById('wholeWordInputs').style.display = perPositionMode ? 'none' : 'block';
    document.getElementById('perPositionInputs').style.display = perPositionMode ? 'grid' : 'none';

    // Word length selection (3-7). Extra lists can be provided via `window.WORD_LISTS[length]`.
    const lengthSelect = document.getElementById('wordLengthSelect');
    const savedLength = localStorage.getItem('wordLength');
    WORD_LENGTH = clampWordLength(savedLength ?? lengthSelect?.value ?? 5);
    if (lengthSelect) {
        lengthSelect.value = String(WORD_LENGTH);
        lengthSelect.addEventListener('change', (e) => {
            const next = clampWordLength(e.target.value);
            if (next === WORD_LENGTH) return;
            WORD_LENGTH = next;
            localStorage.setItem('wordLength', String(next));

            // Reset filters when switching word length.
            const excludeInput = document.getElementById('excludeLetters');
            const includeInput = document.getElementById('includeLetters');
            if (excludeInput) excludeInput.value = '';
            if (includeInput) includeInput.value = '';
            const globalExclude = document.getElementById('globalExcludeLetters');
            if (globalExclude) globalExclude.value = '';

            clearModeMessage();
            setCssBoardDims();
            renderPerPositionFilterInputs();
            createGrid();
            loadWords();
        });
    }

    ensureArtWordListLoaded();
    setCssBoardDims();
    renderPerPositionFilterInputs();
    createGrid();
    loadWords();
    initializeWidgets();

    // Set help tooltip content based on device type
    const helpTooltip = document.getElementById('helpTooltip');
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    if (helpTooltip) {
        if (isTouchDevice) {
            helpTooltip.innerHTML = `
                <p><strong>How to use:</strong></p>
                <p>• Tap a tile to select it and type a letter</p>
                <p>• Tap a selected tile to cycle its color</p>
                <p>• Long-press a tile to clear it</p>
                <p class="color-cycle"><span class="gray-example">GRAY</span> → <span class="yellow-example">YELLOW</span> → <span class="green-example">GREEN</span></p>
                <p><strong>Color meanings:</strong></p>
                <p>• <span class="gray-example">GRAY</span> = letter not in word</p>
                <p>• <span class="yellow-example">YELLOW</span> = wrong position</p>
                <p>• <span class="green-example">GREEN</span> = correct position</p>
            `;
        } else {
            helpTooltip.innerHTML = `
                <p><strong>Change tile colors:</strong></p>
                <p>• Press <kbd>TAB</kbd> when tile is selected</p>
                <p>• Double-click on a tile</p>
                <p>• Shift-click on a tile</p>
                <p>• Keyboard: <kbd>1</kbd>=Gray, <kbd>2</kbd>=Yellow, <kbd>3</kbd>=Green</p>
                <p class="color-cycle"><span class="gray-example">GRAY</span> → <span class="yellow-example">YELLOW</span> → <span class="green-example">GREEN</span></p>
                <p><strong>Color meanings:</strong></p>
                <p>• <span class="gray-example">GRAY</span> = letter not in word</p>
                <p>• <span class="yellow-example">YELLOW</span> = wrong position</p>
                <p>• <span class="green-example">GREEN</span> = correct position</p>
            `;
        }
    }

    // Help tooltip toggle for touch devices
    const helpContainer = document.querySelector('.help-icon-container');
    if (helpContainer) {
        helpContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            helpContainer.classList.toggle('active');
        });
        // Close tooltip when tapping elsewhere
        document.addEventListener('click', () => {
            helpContainer.classList.remove('active');
        });
    }

    document.getElementById('clearBtn').addEventListener('click', clearAll);

    // Add autofill toggle handler
    document.getElementById('autofillToggle').addEventListener('change', (e) => {
        toggleAutofillGreen(e.target.checked);
    });

    // Add letter filter handlers
    const excludeInput = document.getElementById('excludeLetters');
    const includeInput = document.getElementById('includeLetters');
    const globalExcludeInput = document.getElementById('globalExcludeLetters');
    
    excludeInput.addEventListener('input', () => {
        analyzeBoard();
    });
    
    includeInput.addEventListener('input', () => {
        analyzeBoard();
    });

    if (globalExcludeInput) {
        globalExcludeInput.addEventListener('input', () => {
            analyzeBoard();
        });
    }
    
    document.getElementById('clearExclude').addEventListener('click', () => {
        excludeInput.value = '';
        analyzeBoard();
    });
    
    document.getElementById('clearInclude').addEventListener('click', () => {
        includeInput.value = '';
        analyzeBoard();
    });
    
    // Per-position inputs are rebuilt when word length changes, so use event delegation.
    const perPositionInputs = document.getElementById('perPositionInputs');
    if (perPositionInputs) {
        perPositionInputs.addEventListener('input', (e) => {
            if (e.target && (e.target.classList.contains('position-input') || e.target.classList.contains('position-include-input'))) {
                analyzeBoard();
            }
        });
    }
    
    // Add clear buttons for per-position mode
    document.getElementById('clearPositionExclude').addEventListener('click', () => {
        document.querySelectorAll('.position-input').forEach(input => {
            input.value = '';
        });
        analyzeBoard();
    });
    
    document.getElementById('clearPositionInclude').addEventListener('click', () => {
        document.querySelectorAll('.position-include-input').forEach(input => {
            input.value = '';
        });
        analyzeBoard();
    });

    // Add clear filters button for frequency widget
    document.getElementById('clearFrequencyFilters').addEventListener('click', () => {
        document.querySelectorAll('.position-input').forEach(input => {
            input.value = '';
        });
        document.querySelectorAll('.position-include-input').forEach(input => {
            input.value = '';
        });
        document.getElementById('excludeLetters').value = '';
        document.getElementById('includeLetters').value = '';
        const globalExclude = document.getElementById('globalExcludeLetters');
        if (globalExclude) globalExclude.value = '';
        analyzeBoard();
    });

    // Add handlers for exclude green/yellow toggles
    document.getElementById('excludeGreenToggle').addEventListener('change', () => {
        analyzeBoard();
    });
    
    document.getElementById('excludeYellowToggle').addEventListener('change', () => {
        analyzeBoard();
    });
    
    // Add handler for per-position toggle
    document.getElementById('perPositionToggle').addEventListener('change', (e) => {
        const perPositionMode = e.target.checked;
        document.getElementById('wholeWordInputs').style.display = perPositionMode ? 'none' : 'block';
        document.getElementById('perPositionInputs').style.display = perPositionMode ? 'grid' : 'none';
        analyzeBoard();
    });
    
    // Add handler for probe toggle
    document.getElementById('allowProbeToggle').addEventListener('change', (e) => {
        if (solveMode === 'hard') return;
        allowProbeGuesses = e.target.checked;
        analyzeBoard(); // Re-filter words based on new toggle state
    });
    
    // Add answer helper handlers
    const correctWordInput = document.getElementById('correctWord');
    
    // Automatically apply colors when typing the correct answer
    correctWordInput.addEventListener('input', () => {
        const correctWord = correctWordInput.value.toLowerCase().trim();

        if (!correctWord || correctWord.length !== 5) {
            // If answer is deleted or invalid, revert to manual colors
            revertToManualColors();
            updateArtPlanner();
        } else {
            // Apply colors based on the new answer
            applyAnswerToGrid();
            updateArtPlanner();
        }

        // Debounce pattern library update while typing
        clearTimeout(patternLibraryDebounceTimer);
        patternLibraryDebounceTimer = setTimeout(renderPatternLibrary, 200);
    });
    
    document.getElementById('clearAnswer').addEventListener('click', () => {
        correctWordInput.value = '';
        // Revert to manual colors when clearing the answer
        revertToManualColors();
        analyzeBoard();
        updateArtPlanner();
        renderPatternLibrary();
    });
    
    // Add tooltips to score buttons
    const scoreTooltips = {
        'positional-frequency': 'Positional Frequency (RECOMMENDED): Scores based on how often letters appear at each specific position. Best for finding greens quickly. Select 2 methods to blend them.',
        'language-frequency': 'Common Usage: Score based on how common words are in everyday language. Prioritizes natural, frequently-used words.',
        'positional-entropy': 'Positional Entropy: Maximum information gain using position-aware feedback patterns. Best for systematic solving.',
        'frequency': '[ARCHIVED] Letter Frequency: Score based on overall letter frequency (ignores position). Superseded by Positional Frequency.',
        'presence': '[ARCHIVED] Presence: Score based on how many different words contain each letter. Non-positional approach.',
        'contingency': '[ARCHIVED] Contingency: Score based on letter co-occurrence patterns. Non-positional approach.',
        'probe': '[ARCHIVED] Probe: Prioritizes information gain over being a potential answer. Non-positional approach.',
        'entropy': '[ARCHIVED] Entropy: Information gain using non-positional patterns. Superseded by Positional Entropy.',
        'expected': '[ARCHIVED] Expected Value: Minimize expected remaining candidates. Non-positional approach.',
        'minimax': '[ARCHIVED] Minimax: Minimize worst-case remaining words. Non-positional approach.',
        'positional-entropy-heuristic': 'Positional Entropy+: Enhanced positional entropy with heuristics for common patterns.',
        'positional-pattern': 'Positional Pattern: Score based on common letter patterns and bigrams at each position. Finds natural word structures.',
        'positional-weight': 'Positional Weight: Weighted scoring that considers position-specific letter distributions. Balanced positional strategy.'
    };

    // Add score button handlers - multi-select with blend slider
    document.querySelectorAll('.score-btn').forEach(btn => {
        // Add tooltip
        const scoreMode = btn.dataset.score;
        if (scoreTooltips[scoreMode]) {
            btn.title = scoreTooltips[scoreMode];
        }

        btn.addEventListener('click', () => {
            const method = btn.dataset.score;

            // Toggle selection
            if (btn.classList.contains('active')) {
                // Deselect if more than one is selected
                if (selectedScoreMethods.length > 1) {
                    btn.classList.remove('active');
                    selectedScoreMethods = selectedScoreMethods.filter(m => m !== method);
                }
                // Don't allow deselecting the last one
            } else {
                // Select - but limit to 2 methods
                if (selectedScoreMethods.length < 2) {
                    btn.classList.add('active');
                    selectedScoreMethods.push(method);
                } else {
                    // Replace the first selected method
                    const firstMethod = selectedScoreMethods[0];
                    document.querySelector(`[data-score="${firstMethod}"]`).classList.remove('active');
                    selectedScoreMethods[0] = method;
                    btn.classList.add('active');
                }
            }

            // Invalidate blend cache when methods change
            blendScoresCache.filteredWordsVersion = -1;

            // Update blend slider visibility
            updateBlendSlider();

            // Update current score mode
            currentScoreMode = selectedScoreMethods.join('+');

            // Force recalculate
            if (filteredWords.length > 0) {
                updateWordDisplay(true);
            }
        });
    });

    // Update blend slider visibility and labels
    function updateBlendSlider() {
        const blendSliderContainer = document.getElementById('blendSlider');
        const label1 = document.getElementById('blendLabel1');
        const label2 = document.getElementById('blendLabel2');

        if (selectedScoreMethods.length === 2) {
            // Show slider
            blendSliderContainer.style.display = 'block';

            // Update labels
            const method1Name = SCORE_MODE_LABELS[selectedScoreMethods[0]] || selectedScoreMethods[0];
            const method2Name = SCORE_MODE_LABELS[selectedScoreMethods[1]] || selectedScoreMethods[1];
            label1.textContent = method1Name;
            label2.textContent = method2Name;
        } else {
            // Hide slider
            blendSliderContainer.style.display = 'none';
        }
    }

    // Add blend slider and number input handlers
    const blendSliderInput = document.getElementById('blendSliderInput');
    const blendNumberInput = document.getElementById('blendNumberInput');

    function syncBlendInputs(value) {
        // Sync slider and number input visually (no recalculation)
        if (blendSliderInput) blendSliderInput.value = value;
        if (blendNumberInput) blendNumberInput.value = value;
    }

    function updateBlendFromValue(value) {
        // Convert 1-100 value to blend weight (1 = 100% method1, 100 = 100% method2)
        blendWeight = (value - 1) / 99; // 1->0, 100->1

        // Sync inputs
        syncBlendInputs(value);

        // Just re-blend and display cached scores, don't recalculate
        if (blendScoresCache.method1 && blendScoresCache.method2 && blendScoresCache.filteredWordsVersion === filteredWordsVersion) {
            // Re-blend the cached scores
            const blended = blendScoresCache.method1.map((item, index) => {
                const score1 = item.score;
                const score2 = blendScoresCache.method2[index].score;

                // Calculate weights: 1 = 100% method1, 100 = 100% method2
                const weight1 = 1 - blendWeight;
                const weight2 = blendWeight;

                const blendedScore = (weight1 * score1) + (weight2 * score2);

                return { word: item.word, score: blendedScore };
            });

            scoredWordsCache = blended;
            lastScoredVersion = filteredWordsVersion;
            lastScoredMode = selectedScoreMethods.join('+');
            displayWords(scoredWordsCache);
        } else {
            // Cache not valid, trigger full recalculation
            updateWordDisplay(true);
        }
    }

    function shouldUpdateLive() {
        // Only update live if word count is manageable (≤1800)
        return filteredWords.length <= 1800;
    }

    if (blendSliderInput) {
        blendSliderInput.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            syncBlendInputs(value);
            // Update live only if word count is small enough
            if (shouldUpdateLive()) {
                updateBlendFromValue(value);
            }
        });
        // Always recalculate when slider is released
        blendSliderInput.addEventListener('change', (e) => {
            updateBlendFromValue(parseInt(e.target.value));
        });
    }

    if (blendNumberInput) {
        blendNumberInput.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            if (value >= 1 && value <= 100) {
                updateBlendFromValue(value);
            }
        });
    }

    // Initialize blend slider on load
    updateBlendSlider();

    // Add sort button handlers
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active button
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update sort mode and redisplay
            currentSortMode = btn.dataset.sort;
            if (scoredWordsCache.length > 0) {
                displayWords(scoredWordsCache);
            }
        });
    });

    // Add advanced mode toggle handler
    const advancedModeToggle = document.getElementById('advancedModeToggle');
    const scoreControls = document.getElementById('scoreControls');
    if (advancedModeToggle && scoreControls) {
        // Function to show/hide score controls
        const updateScoringControlsVisibility = () => {
            const isAdvanced = advancedModeToggle.checked;
            scoreControls.style.display = isAdvanced ? 'flex' : 'none';
        };

        // Initial visibility - hidden by default
        updateScoringControlsVisibility();

        // Listen for changes
        advancedModeToggle.addEventListener('change', () => {
            updateScoringControlsVisibility();
            // Save preference
            localStorage.setItem('advancedScoringMode', advancedModeToggle.checked.toString());
        });

        // Restore saved preference
        const savedAdvancedMode = localStorage.getItem('advancedScoringMode');
        if (savedAdvancedMode === 'true') {
            advancedModeToggle.checked = true;
            updateScoringControlsVisibility();
        }
    }

    // Add hide double letters toggle handler
    const hideDoubleLettersToggle = document.getElementById('hideDoubleLettersToggle');
    if (hideDoubleLettersToggle) {
        hideDoubleLettersToggle.addEventListener('change', (e) => {
            hideDoubleLetters = e.target.checked;
            // Re-display words with the filter applied
            if (scoredWordsCache.length > 0) {
                displayWords(scoredWordsCache);
            } else {
                // If no cache, trigger full update
                updateWordDisplay(true);
            }
            updateProbeSuggestions(true);
        });
    }

    const addBlendBtn = document.getElementById('addBlendMethod');
    if (addBlendBtn) {
        addBlendBtn.addEventListener('click', () => {
            addBlendRow();
            if (typeof renderBlendControls === 'function') {
                renderBlendControls();
            }
            if (currentScoreMode === 'blend') {
                updateWordDisplay(true);
            }
        });
    }

    const cancelScoringBtn = document.getElementById('cancelScoringBtn');
    if (cancelScoringBtn) {
        cancelScoringBtn.addEventListener('click', () => {
            cancelActiveScoring();
            hideScoringStatus();
        });
    }
});

// Initialize Art Planner after DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    createArtPlannerGrid();
    updateArtPlanner();
    renderPatternLibrary();
});
