#!/usr/bin/env python3
"""
Rebuilds `app/src/wordlist.js` by unioning:
  - the existing WORD_LIST entries
  - all 5-letter alphabetic entries from /usr/share/dict/words (lowercased, deduped)

This intentionally includes words that appear capitalized in the system dictionary
once lowercased (e.g. "Hydra" -> "hydra").
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


RE_ALPHA_5 = re.compile(r"^[A-Za-z]{5}$")
RE_WORD_5 = re.compile(r"^[a-z]{5}$")


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


def read_dict_words(path: Path) -> set[str]:
    out: set[str] = set()
    with path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            raw = line.strip()
            if not RE_ALPHA_5.match(raw):
                continue
            w = raw.lower()
            if not RE_WORD_5.match(w):
                continue
            out.add(w)
    return out


def write_wordlist_js(path: Path, words: list[str]) -> None:
    lines: list[str] = []
    lines.append("const WORD_LIST = [")
    for i, w in enumerate(words):
        suffix = "," if i < (len(words) - 1) else ""
        lines.append(f"  {json.dumps(w)}{suffix}")
    lines.append("];")
    lines.append("")
    lines.append("// Provide a consistent multi-length hook for the UI (3/4/5/6/7).")
    lines.append("// Extra lists can be added by defining `window.WORD_LISTS[length] = [...]` in additional scripts.")
    lines.append("if (typeof window !== 'undefined') {")
    lines.append("  window.WORD_LISTS = window.WORD_LISTS || {};")
    lines.append("  window.GUESS_LISTS = window.GUESS_LISTS || {};")
    lines.append("  window.WORD_LISTS[5] = WORD_LIST;")
    lines.append("  // Default guess pool: answers only (can be overridden by separate guess lists).")
    lines.append("  if (!Array.isArray(window.GUESS_LISTS[5])) {")
    lines.append("    window.GUESS_LISTS[5] = WORD_LIST;")
    lines.append("  }")
    lines.append("}")
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dict",
        type=Path,
        default=Path("/usr/share/dict/words"),
        help="Dictionary path to merge (default: /usr/share/dict/words)",
    )
    parser.add_argument(
        "--in",
        dest="in_path",
        type=Path,
        default=None,
        help="Input wordlist.js (default: app/src/wordlist.js)",
    )
    parser.add_argument(
        "--out",
        dest="out_path",
        type=Path,
        default=None,
        help="Output wordlist.js (default: overwrite input)",
    )
    args = parser.parse_args()

    app_dir = Path(__file__).resolve().parents[1]
    in_path = args.in_path or (app_dir / "src" / "wordlist.js")
    out_path = args.out_path or in_path

    base = set(parse_wordlist_js(in_path))
    merged = set(base)
    if args.dict.exists():
        merged |= read_dict_words(args.dict)

    words = sorted(merged)
    write_wordlist_js(out_path, words)
    print(json.dumps({"out": str(out_path), "count": len(words)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
