#!/usr/bin/env python3
"""
Decode a Figma clipboard binary captured via the Replicode interceptor.

Usage:
    ./tools/decode-figma-clipboard.py <input.bin> [--out-dir DIR]

Input formats accepted:
    1. The raw `<!--(figma)…(/figma)-->` blob (already base64-decoded by
       the interceptor). Starts with the ASCII bytes "fig-kiwi".
    2. The full `text/html` clipboard payload — the script will extract
       and decode the figma block from `<!--(figma)…(/figma)-->`.

Outputs three files into <out-dir> (default: same directory as input):
    <name>.scene.kiwi.bin   - raw kiwi binary (header + chunks)
    <name>.schema.bin       - inflated kiwi schema (raw deflate)
    <name>.scene.bin        - inflated kiwi scene message (zstd)

Then prints:
    - the figmeta JSON metadata if present (paste ID, file key, etc.)
    - the magic / header bytes of the kiwi container
    - schema definition count + the first 25 definitions

This script encodes everything we know about Figma's clipboard format
as of the Phase 1 reconnaissance dump (see figma-clipboard-spec.md).
"""

import argparse
import base64
import json
import os
import re
import struct
import sys
import zlib

try:
    import zstandard as zstd
except ImportError:
    zstd = None


def extract_figma_blob(data: bytes) -> bytes:
    """If `data` looks like an HTML payload, find the (figma) block and
    base64-decode it. If it's already a raw kiwi blob (starts with
    "fig-kiwi"), return it as-is."""
    if data.startswith(b"fig-kiwi"):
        return data
    text = data.decode("utf-8", errors="replace")
    m_meta = re.search(r"<!--\(figmeta\)([A-Za-z0-9+/=]+)\(/figmeta\)-->", text)
    if m_meta:
        try:
            meta = json.loads(base64.b64decode(m_meta.group(1)))
            print("=== figmeta JSON ===")
            print(json.dumps(meta, indent=2))
            print()
        except Exception as exc:
            print(f"[warn] figmeta decode failed: {exc}")
    m_scene = re.search(r"<!--\(figma\)([A-Za-z0-9+/=]+)\(/figma\)-->", text)
    if not m_scene:
        raise ValueError("Couldn't find a (figma) base64 block in the input")
    return base64.b64decode(m_scene.group(1))


def split_kiwi_container(blob: bytes):
    """Split the kiwi container into its two chunks: schema (raw deflate)
    and scene (zstd). Layout:

        [0:8]   magic = b"fig-kiwi"
        [8:9]   format flag (b"j" for clipboard scene)
        [9:12]  reserved (zeros)
        [12:16] uint32 LE schema chunk length
        [16:..] raw deflate(schema)
        [..:..] uint32 LE scene chunk length
        [..:..] zstd(scene)
    """
    if not blob.startswith(b"fig-kiwi"):
        raise ValueError("Missing 'fig-kiwi' magic")
    flag = blob[8:9]
    reserved = blob[9:12]
    print(f"=== kiwi container ===")
    print(f"magic     : {blob[:8]!r}")
    print(f"flag byte : {flag!r} (likely the clipboard format type)")
    print(f"reserved  : {reserved.hex(' ')}")

    off = 12
    schema_len = struct.unpack("<I", blob[off:off + 4])[0]
    off += 4
    schema_compressed = blob[off:off + schema_len]
    off += schema_len
    scene_len = struct.unpack("<I", blob[off:off + 4])[0]
    off += 4
    scene_compressed = blob[off:off + scene_len]
    off += scene_len
    trailing = blob[off:]
    print(f"schema    : {schema_len} bytes compressed")
    print(f"scene     : {scene_len} bytes compressed")
    print(f"trailing  : {len(trailing)} bytes")
    if trailing:
        print(f"  trailing hex (first 32): {trailing[:32].hex(' ')}")
    return schema_compressed, scene_compressed


def inflate_schema(compressed: bytes) -> bytes:
    return zlib.decompress(compressed, -15)


def inflate_scene(compressed: bytes) -> bytes:
    if zstd is None:
        raise RuntimeError(
            "zstandard package not installed. Run `pip3 install zstandard`."
        )
    return zstd.ZstdDecompressor().decompress(compressed)


# ── Kiwi schema parser ──────────────────────────────────────────────

BUILTIN_TYPES = {
    -1: "bool", -2: "byte", -3: "int", -4: "uint",
    -5: "float", -6: "string", -7: "int64", -8: "uint64",
}

KIND_NAMES = {0: "ENUM", 1: "STRUCT", 2: "MESSAGE", 3: "SMALL_ENUM"}


def parse_schema(buf: bytes):
    pos = 0

    def read_varuint() -> int:
        nonlocal pos
        value = 0
        shift = 0
        while True:
            b = buf[pos]
            pos += 1
            value |= (b & 0x7f) << shift
            if not (b & 0x80):
                break
            shift += 7
        return value

    def read_varint() -> int:
        n = read_varuint()
        return (n >> 1) ^ -(n & 1)

    def read_byte() -> int:
        nonlocal pos
        b = buf[pos]
        pos += 1
        return b

    def read_string() -> str:
        nonlocal pos
        start = pos
        while buf[pos] != 0:
            pos += 1
        s = buf[start:pos].decode("utf-8", errors="replace")
        pos += 1
        return s

    def_count = read_varuint()
    defs = []
    for _ in range(def_count):
        name = read_string()
        kind = read_byte()
        field_count = read_varuint()
        fields = []
        for _ in range(field_count):
            fname = read_string()
            ftype = read_varint()
            is_array = bool(read_byte() & 1)
            value = read_varuint()
            fields.append((fname, ftype, is_array, value))
        defs.append((name, kind, fields))
    if pos != len(buf):
        print(f"[warn] {len(buf) - pos} unread bytes in schema")
    return defs


def type_repr(t: int, defs) -> str:
    if t < 0:
        return BUILTIN_TYPES.get(t, f"builtin({t})")
    if 0 <= t < len(defs):
        return defs[t][0]
    return f"<type {t}>"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Path to clipboard binary or text/html")
    parser.add_argument("--out-dir", default=None, help="Output directory")
    parser.add_argument(
        "--print-defs", type=int, default=25,
        help="How many schema definitions to print"
    )
    args = parser.parse_args()

    with open(args.input, "rb") as fp:
        raw = fp.read()

    blob = extract_figma_blob(raw)
    out_dir = args.out_dir or os.path.dirname(os.path.abspath(args.input))
    os.makedirs(out_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(args.input))[0]

    schema_compressed, scene_compressed = split_kiwi_container(blob)

    schema_path = os.path.join(out_dir, base + ".schema.bin")
    scene_path = os.path.join(out_dir, base + ".scene.bin")
    raw_path = os.path.join(out_dir, base + ".scene.kiwi.bin")
    with open(raw_path, "wb") as fp:
        fp.write(blob)

    schema_buf = inflate_schema(schema_compressed)
    with open(schema_path, "wb") as fp:
        fp.write(schema_buf)
    try:
        scene_buf = inflate_scene(scene_compressed)
        with open(scene_path, "wb") as fp:
            fp.write(scene_buf)
        print(f"saved scene  ({len(scene_buf)} bytes)  -> {scene_path}")
    except Exception as exc:
        print(f"[warn] scene inflate failed: {exc}")

    print(f"saved schema ({len(schema_buf)} bytes)  -> {schema_path}")
    print(f"saved raw    ({len(blob)} bytes)  -> {raw_path}")
    print()

    defs = parse_schema(schema_buf)
    print(f"=== schema: {len(defs)} definitions ===")
    for i, (name, kind, fields) in enumerate(defs[: args.print_defs]):
        print(f"  {i:4d}  {KIND_NAMES.get(kind, '?'):12s}  {name}  ({len(fields)} fields)")
    if len(defs) > args.print_defs:
        print(f"  ... and {len(defs) - args.print_defs} more (use --print-defs N)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
