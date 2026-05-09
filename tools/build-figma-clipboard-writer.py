#!/usr/bin/env python3
"""
Generate extension/figma-clipboard-writer.js from
extension/figma-clipboard-writer.template.js by splicing in the
captured schema chunk + scene fixture base64 blobs.

Run from repo root:
    ./tools/build-figma-clipboard-writer.py

Reads:
    tools/schema-chunk.b64
    tools/scene-fixture.b64
    extension/figma-clipboard-writer.template.js

Writes:
    extension/figma-clipboard-writer.js
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def read(p):
    with open(os.path.join(ROOT, p)) as f:
        return f.read()

template = read("extension/figma-clipboard-writer.template.js")
schema_b64 = read("tools/schema-chunk.b64").strip()
scene_b64 = read("tools/scene-fixture.b64").strip()

out = (
    template
    .replace("__SCHEMA_CHUNK_B64__", schema_b64)
    .replace("__SCENE_FIXTURE_B64__", scene_b64)
)

target = os.path.join(ROOT, "extension/figma-clipboard-writer.js")
with open(target, "w") as f:
    f.write(out)

print(f"wrote {target} ({len(out):,} chars, schema {len(schema_b64):,} b64, scene {len(scene_b64):,} b64)")
