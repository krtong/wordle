#!/usr/bin/env node
/**
 * Strategy Benchmark - Compare Wordle solving strategies
 * 
 * Tests each strategy by simulating games for every possible answer,
 * always picking the #1 recommended word according to that strategy.
 * 
 * Usage: node strategy-benchmark.js [--fast] [--strategy=name]
 *   --fast: Only test 100 random words (for quick iteration)
 *   --strategy=name: Only test specific strategy
 */

const fs = require('fs');
const path = require('path');

// Load word list by extracting JSON array
const wordlistPath = path.join(__dirname, '../src/wordlist.js');
const wordlistContent = fs.readFileSync(wordlistPath, 'utf-8');
// Find the array: starts with [ and ends with ]; on its own line
const arrayStart = wordlistContent.indexOf('[');
// Find the ]; that ends the array (before any additional code)
const arrayEndMatch = wordlistContent.match(/\n\];\n/);
const arrayEnd = arrayEndMatch ? wordlistContent.indexOf(arrayEndMatch[0]) + 2 : wordlistContent.lastIndexOf(']') + 1;
let wordArrayStr = wordlistContent.slice(arrayStart, arrayEnd);
// Remove trailing commas before ] that break JSON
wordArrayStr = wordArrayStr.replace(/,(\s*)\]/g, '$1]');
const WORD_LIST = JSON.parse(wordArrayStr);

// Load language frequency by extracting JSON object
const freqPath = path.join(__dirname, '../src/modern_word_frequency.js');
const freqContent = fs.readFileSync(freqPath, 'utf-8');
const objStart = freqContent.indexOf('{');
// Find }; that ends the object
const objEndMatch = freqContent.match(/\n\};\n/);
const objEnd = objEndMatch ? freqContent.indexOf(objEndMatch[0]) + 2 : freqContent.lastIndexOf('}') + 1;
let freqObjStr = freqContent.slice(objStart, objEnd);
// Remove trailing commas before } that break JSON
freqObjStr = freqObjStr.replace(/,(\s*)\}/g, '$1}');
const MODERN_WORD_FREQUENCY = JSON.parse(freqObjStr);

// Normalize language frequency (log scale, 0-1)
const NORMALIZED_FREQ = (() => {
    const normalized = {};
    let minVal = Infinity, maxVal = -Infinity;
    const temp = [];
    for (const [word, freq] of Object.entries(MODERN_WORD_FREQUENCY)) {
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

// ============ WORDLE GAME LOGIC ============

function getPattern(guess, answer) {
    // Returns pattern as array of 0=gray, 1=yellow, 2=green
    const result = [0, 0, 0, 0, 0];
    const answerCounts = {};
    
    // First pass: mark greens
    for (let i = 0; i < 5; i++) {
        if (guess[i] === answer[i]) {
            result[i] = 2;
        } else {
            answerCounts[answer[i]] = (answerCounts[answer[i]] || 0) + 1;
        }
    }
    
    // Second pass: mark yellows
    for (let i = 0; i < 5; i++) {
        if (result[i] !== 2 && answerCounts[guess[i]] > 0) {
            result[i] = 1;
            answerCounts[guess[i]]--;
        }
    }
    
    return result.join('');
}

function filterByPattern(candidates, guess, pattern) {
    return candidates.filter(word => getPattern(guess, word) === pattern);
}

// ============ SCORING STRATEGIES ============

function buildPositionalFrequencyTable(candidates) {
    const table = [{}, {}, {}, {}, {}];
    for (const word of candidates) {
        for (let i = 0; i < 5; i++) {
            table[i][word[i]] = (table[i][word[i]] || 0) + 1;
        }
    }
    return table;
}

function scorePositionalFrequency(word, candidates, posTable) {
    if (!posTable) posTable = buildPositionalFrequencyTable(candidates);
    let score = 0;
    const seen = new Set();
    for (let i = 0; i < 5; i++) {
        const key = `${i}-${word[i]}`;
        if (!seen.has(key)) {
            score += posTable[i][word[i]] || 0;
            seen.add(key);
        }
    }
    // Bonus for unique letters
    const unique = new Set(word.split(''));
    score *= (1 + unique.size * 0.1);
    return score;
}

function scoreLanguageFrequency(word) {
    return (NORMALIZED_FREQ[word] || 0) * 4.961; // Scale to match positional
}

// Precomputed best first words by entropy (calculated offline)
const ENTROPY_FIRST_GUESSES = ['salet', 'reast', 'crate', 'trace', 'slate'];

function scoreEntropy(guess, candidates) {
    const buckets = {};
    for (const candidate of candidates) {
        const pattern = getPattern(guess, candidate);
        buckets[pattern] = (buckets[pattern] || 0) + 1;
    }
    
    let entropy = 0;
    const n = candidates.length;
    for (const count of Object.values(buckets)) {
        const p = count / n;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

function scoreBlended(word, candidates, posTable, weight = 0.5) {
    const posScore = scorePositionalFrequency(word, candidates, posTable);
    const langScore = scoreLanguageFrequency(word);
    
    // Normalize both to similar ranges before blending
    return posScore * weight + langScore * (1 - weight) * 300; // Scale lang up
}

// ============ STRATEGY PICKER ============

function pickBestWord(candidates, guessPool, strategy, posTable) {
    let bestWord = null;
    let bestScore = -Infinity;
    
    // For entropy, use a smaller pool for speed
    let pool = candidates;
    if (strategy === 'entropy') {
        // First guess: use precomputed optimal
        if (candidates.length === guessPool.length) {
            for (const word of ENTROPY_FIRST_GUESSES) {
                if (guessPool.includes(word)) {
                    return word;
                }
            }
        }
        // If many candidates, sample top by positional frequency
        if (candidates.length > 100) {
            const posScores = candidates.map(w => ({ w, s: scorePositionalFrequency(w, candidates, posTable) }));
            posScores.sort((a, b) => b.s - a.s);
            pool = posScores.slice(0, 100).map(x => x.w);
        }
    }
    
    for (const word of pool) {
        let score;
        switch (strategy) {
            case 'positional-frequency':
                score = scorePositionalFrequency(word, candidates, posTable);
                break;
            case 'language-frequency':
                score = scoreLanguageFrequency(word);
                break;
            case 'entropy':
                score = scoreEntropy(word, candidates);
                break;
            case 'blend-50':
                score = scoreBlended(word, candidates, posTable, 0.5);
                break;
            case 'blend-70-pos':
                score = scoreBlended(word, candidates, posTable, 0.7);
                break;
            case 'blend-30-pos':
                score = scoreBlended(word, candidates, posTable, 0.3);
                break;
            default:
                score = scorePositionalFrequency(word, candidates, posTable);
        }
        
        if (score > bestScore) {
            bestScore = score;
            bestWord = word;
        }
    }
    
    return bestWord;
}

// ============ GAME SIMULATION ============

function playGame(answer, strategy, guessPool) {
    let candidates = [...guessPool];
    let guesses = 0;
    const maxGuesses = 6;
    
    while (guesses < maxGuesses) {
        guesses++;
        const posTable = buildPositionalFrequencyTable(candidates);
        const guess = pickBestWord(candidates, guessPool, strategy, posTable);
        
        if (!guess) {
            return { guesses: maxGuesses + 1, solved: false }; // Failed
        }
        
        if (guess === answer) {
            return { guesses, solved: true };
        }
        
        const pattern = getPattern(guess, answer);
        candidates = filterByPattern(candidates, guess, pattern);
        
        if (candidates.length === 0) {
            return { guesses: maxGuesses + 1, solved: false }; // Bug - shouldn't happen
        }
    }
    
    return { guesses: maxGuesses + 1, solved: false };
}

// ============ BENCHMARK ============

function runBenchmark(strategy, answers, guessPool, verbose = false) {
    const results = {
        strategy,
        total: answers.length,
        solved: 0,
        failed: 0,
        totalGuesses: 0,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, fail: 0 },
        worstWords: []
    };
    
    const startTime = Date.now();
    
    for (let i = 0; i < answers.length; i++) {
        const answer = answers[i];
        const { guesses, solved } = playGame(answer, strategy, guessPool);
        
        if (solved) {
            results.solved++;
            results.totalGuesses += guesses;
            results.distribution[guesses] = (results.distribution[guesses] || 0) + 1;
        } else {
            results.failed++;
            results.distribution.fail++;
            results.worstWords.push({ word: answer, guesses: 7 });
        }
        
        if (guesses >= 5 && solved) {
            results.worstWords.push({ word: answer, guesses });
        }
        
        // Progress update
        if (verbose && (i + 1) % 100 === 0) {
            const pct = ((i + 1) / answers.length * 100).toFixed(1);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            process.stdout.write(`\r  ${strategy}: ${pct}% (${elapsed}s)`);
        }
    }
    
    if (verbose) {
        process.stdout.write('\r' + ' '.repeat(60) + '\r');
    }
    
    results.average = results.solved > 0 ? (results.totalGuesses / results.solved).toFixed(3) : 'N/A';
    results.elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    results.worstWords = results.worstWords
        .sort((a, b) => b.guesses - a.guesses)
        .slice(0, 10);
    
    return results;
}

function formatResults(allResults) {
    console.log('\n' + '='.repeat(90));
    console.log('STRATEGY BENCHMARK RESULTS');
    console.log('='.repeat(90));
    
    // Header
    console.log('\nStrategy               | Avg   | 1s  | 2s  | 3s   | 4s   | 5s  | 6s  | Fail | Time');
    console.log('-'.repeat(90));
    
    for (const r of allResults) {
        const name = r.strategy.padEnd(22);
        const avg = r.average.toString().padStart(5);
        const d = r.distribution;
        console.log(
            `${name} | ${avg} | ${String(d[1] || 0).padStart(3)} | ` +
            `${String(d[2] || 0).padStart(3)} | ${String(d[3] || 0).padStart(4)} | ` +
            `${String(d[4] || 0).padStart(4)} | ${String(d[5] || 0).padStart(3)} | ` +
            `${String(d[6] || 0).padStart(3)} | ${String(d.fail || 0).padStart(4)} | ${r.elapsed}s`
        );
    }
    
    console.log('\n' + '='.repeat(90));
    console.log('WORST CASES (5+ guesses)');
    console.log('='.repeat(90));
    
    for (const r of allResults) {
        if (r.worstWords.length > 0) {
            console.log(`\n${r.strategy}:`);
            console.log('  ' + r.worstWords.map(w => `${w.word}(${w.guesses})`).join(', '));
        }
    }
}

// ============ MAIN ============

async function main() {
    const args = process.argv.slice(2);
    const fast = args.includes('--fast');
    const tiny = args.includes('--tiny');
    const strategyArg = args.find(a => a.startsWith('--strategy='));
    const specificStrategy = strategyArg ? strategyArg.split('=')[1] : null;
    
    console.log('Wordle Strategy Benchmark');
    console.log('========================\n');
    console.log(`Word list: ${WORD_LIST.length} words`);
    
    let answers = [...WORD_LIST];
    if (tiny) {
        // Shuffle and take 20 for quick testing
        answers = answers.sort(() => Math.random() - 0.5).slice(0, 20);
        console.log(`Tiny mode: testing ${answers.length} random words`);
    } else if (fast) {
        // Shuffle and take 100
        answers = answers.sort(() => Math.random() - 0.5).slice(0, 100);
        console.log(`Fast mode: testing ${answers.length} random words`);
    }
    
    const strategies = [
        'positional-frequency',
        'language-frequency',
        'entropy',
        'blend-50',
        'blend-70-pos',
        'blend-30-pos'
    ];
    
    const toRun = specificStrategy 
        ? strategies.filter(s => s === specificStrategy)
        : strategies;
    
    if (toRun.length === 0) {
        console.error(`Unknown strategy: ${specificStrategy}`);
        console.error(`Available: ${strategies.join(', ')}`);
        process.exit(1);
    }
    
    console.log(`Strategies: ${toRun.join(', ')}`);
    console.log(`Testing ${answers.length} answers...\n`);
    
    const allResults = [];
    
    for (const strategy of toRun) {
        console.log(`Running: ${strategy}...`);
        const result = runBenchmark(strategy, answers, WORD_LIST, true);
        allResults.push(result);
        console.log(`  Done: avg=${result.average}, failed=${result.failed}`);
    }
    
    formatResults(allResults);
}

main().catch(console.error);
