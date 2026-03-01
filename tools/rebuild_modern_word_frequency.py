#!/usr/bin/env python3
"""
Regenerates `app/src/modern_word_frequency.js` from `app/src/wordlist.js` using wordfreq.

The output format matches existing usage: integer = zipf_frequency(word, "en") * 1000.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from wordfreq import zipf_frequency


def parse_wordlist_js(path: Path) -> list[str]:
    src = path.read_text(encoding="utf-8")
    m = re.search(r"const\s+WORD_LIST\s*=\s*\[(.*?)]\s*;", src, re.S)
    if not m:
        raise ValueError(f"Failed to find WORD_LIST array in {path}")
    body = m.group(1)
    arr_src = "[" + body + "]"
    # Allow trailing commas (valid in JS, invalid in JSON).
    arr_src = re.sub(r",\s*]", "]", arr_src)
    return json.loads(arr_src)


def write_modern_frequency_js(path: Path, words: list[str]) -> None:
    lines: list[str] = []
    lines.append("const MODERN_WORD_FREQUENCY = {")
    for w in words:
        val = int(zipf_frequency(w, "en") * 1000)
        lines.append(f'  {json.dumps(w)}: {val},')
    lines.append("};")
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--wordlist",
        type=Path,
        default=None,
        help="Path to wordlist.js (default: app/src/wordlist.js)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Path to modern_word_frequency.js (default: app/src/modern_word_frequency.js)",
    )
    args = parser.parse_args()

    app_dir = Path(__file__).resolve().parents[1]
    wordlist_path = args.wordlist or (app_dir / "src" / "wordlist.js")
    out_path = args.out or (app_dir / "src" / "modern_word_frequency.js")

    words = parse_wordlist_js(wordlist_path)
    write_modern_frequency_js(out_path, words)
    print(json.dumps({"out": str(out_path), "count": len(words)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
