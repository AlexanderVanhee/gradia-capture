#!/usr/bin/env python3
"""Minimal .po → .mo compiler.

Used as a fallback when the GNU gettext tools (msgfmt) are not installed.
Only supports the subset of PO features used by this project
(simple msgid/msgstr pairs, no plural forms, no msgctxt).

Usage:
    compile_mo.py input.po output.mo
"""

import struct
import sys


def unescape(s):
    """Decode C-style escapes used in PO quoted strings."""
    result = []
    i = 0
    n = len(s)
    simple = {
        'n': '\n', 't': '\t', 'r': '\r', '\\': '\\',
        '"': '"', "'": "'", 'a': '\a', 'b': '\b', 'f': '\f', 'v': '\v',
    }
    while i < n:
        c = s[i]
        if c == '\\' and i + 1 < n:
            nxt = s[i + 1]
            if nxt in simple:
                result.append(simple[nxt])
                i += 2
                continue
            if nxt == 'x':
                hexs = ''
                j = i + 2
                while j < n and len(hexs) < 2 and s[j] in '0123456789abcdefABCDEF':
                    hexs += s[j]
                    j += 1
                if hexs:
                    result.append(chr(int(hexs, 16)))
                    i = j
                    continue
            if nxt in '01234567':
                octs = ''
                j = i + 1
                while j < n and len(octs) < 3 and s[j] in '01234567':
                    octs += s[j]
                    j += 1
                result.append(chr(int(octs, 8)))
                i = j
                continue
            # Unknown escape: keep the character literally
            result.append(nxt)
            i += 2
            continue
        result.append(c)
        i += 1
    return ''.join(result)


def decode_quoted(parts):
    """Decode a list of raw quoted strings (each may span lines)."""
    out = []
    for p in parts:
        s = p.strip()
        if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
            s = s[1:-1]
        out.append(unescape(s))
    return ''.join(out)


def parse_po(path):
    """Parse a .po file into a list of (msgid, msgstr) pairs.

    The header entry (empty msgid) is preserved as the first element,
    matching the standard GNU .mo layout.
    """
    with open(path, encoding='utf-8') as f:
        lines = f.read().splitlines()

    entries = []
    cur_id = None
    cur_str = []

    def flush():
        if cur_id is not None or cur_str:
            mid = decode_quoted(cur_id or [])
            mstr = decode_quoted(cur_str or [])
            entries.append((mid, mstr))

    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line or line.startswith('#'):
            i += 1
            continue
        if line.startswith('msgid '):
            flush()
            cur_id = [line[len('msgid '):]]
            cur_str = []
            i += 1
            while i < len(lines) and lines[i].strip().startswith('"'):
                cur_id.append(lines[i].strip())
                i += 1
            continue
        if line.startswith('msgstr '):
            cur_str = [line[len('msgstr '):]]
            i += 1
            while i < len(lines) and lines[i].strip().startswith('"'):
                cur_str.append(lines[i].strip())
                i += 1
            continue
        # Ignore other keywords (msgctxt, msgid_plural, etc.)
        i += 1

    flush()
    return entries


def write_mo(path, entries):
    """Write a GNU gettext .mo file (little-endian, no hash table).

    Original strings are sorted by byte order (the empty header msgid sorts
    first), as required for binary-search lookup by GNU gettext.
    """
    entries = sorted(entries, key=lambda e: e[0].encode('utf-8'))

    orig = [mid.encode('utf-8') for mid, _ in entries]
    trans = [mstr.encode('utf-8') for _, mstr in entries]

    n = len(orig)
    o_offset = 28
    t_offset = o_offset + n * 8
    str_offset = t_offset + n * 8

    with open(path, 'wb') as f:
        # magic, revision, count, orig-table, trans-table, hash-size, hash-offset
        f.write(struct.pack('<Iiiiiii', 0x950412DE, 0, n, o_offset, t_offset, 0, 0))

        cur = str_offset
        for s in orig:
            f.write(struct.pack('<II', len(s), cur))
            cur += len(s) + 1

        for s in trans:
            f.write(struct.pack('<II', len(s), cur))
            cur += len(s) + 1

        for s in orig:
            f.write(s + b'\x00')
        for s in trans:
            f.write(s + b'\x00')


def main(argv):
    if len(argv) != 3:
        print(f'Usage: {argv[0]} input.po output.mo', file=sys.stderr)
        return 1
    _, po_path, mo_path = argv
    entries = parse_po(po_path)
    write_mo(mo_path, entries)
    print(f'compiled {len(entries)} messages: {po_path} -> {mo_path}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
