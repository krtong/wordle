# Wordlists

This folder is optional. If present, `tools/build_wordlists.py` will use these files to generate `src/wordlists-curated.js`.

## Files

- `answers-3.txt`, `answers-4.txt`, `answers-6.txt`, `answers-7.txt`  
  Curated answer lists (one word per line, lowercase `a-z`, exact length).

- `guesses-3.txt`, `guesses-4.txt`, `guesses-5.txt`, `guesses-6.txt`, `guesses-7.txt`  
  Optional curated guess pools. If missing, we fall back to `/usr/share/dict/words`.

## Build

Run from the `app/` directory:

```sh
python3 tools/build_wordlists.py
```

Then open `index.html` directly (no server required).

