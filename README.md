# Wordle Helper (static)

Open `app/index.html` directly in your browser (no server required).

## Solver modes

- **Normal**: “Next Guess” may suggest non-candidate probe words (to test more letters). Probe filters can exclude known green/yellow letters.
- **Hard**: Enforces revealed constraints when you click “Next Guess” chips to fill a row; probe-only options are disabled and suggestions are candidate-only.

## Word lengths (3–7)

The UI supports 3–7 letters.

- 5-letter **answers** (and default guess pool) come from `src/wordlist.js`.
- 3/4/6/7 **answers + guess pools** come from `src/wordlists-curated.js` (generated).

## Regenerating wordlists

- Optional curated inputs live in `wordlists/` (see `wordlists/README.md`).
- Build:

```sh
cd app
python3 tools/rebuild_wordlist_5.py
python3 tools/rebuild_modern_word_frequency.py
python3 tools/build_wordlists.py
node tools/selftest_wordlists.js
```
