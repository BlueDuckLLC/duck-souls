#!/usr/bin/env python3
"""make_gifs.py — encode the typography-dynamics frames into looping GIFs.

Node owns the simulation (sandtype.js, 125 certified assertions); this file only owns the palette
and the encoder. Frames arrive as raw species ids so the colour decision lives in exactly one place.

Loop honesty: a scene that reported a settle point is trimmed to it and loops seamlessly. A scene
that never settles (worms never stop eating; crabs never stop walking) is emitted at full length
and simply loops — we do NOT fake a seam by cross-fading, we say so in the manifest.
"""
import json, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
EMPTY, SAND, WATER, STONE, MOSS, WORM, CRAB, VOID = range(8)

# THE REDUCTION's palette: four cold near-blacks and one warm bone (see ATMOSPHERE.md)
PAL = {
    EMPTY: (5, 6, 10), SAND: (185, 180, 168), WATER: (43, 47, 66), STONE: (30, 34, 48),
    MOSS: (96, 128, 88), WORM: (150, 90, 84), CRAB: (198, 132, 74), VOID: (2, 2, 4),
}
SCALE = 6

data = json.load(open(os.path.join(HERE, "frames.json")))
manifest = {}
for name, sc in data.items():
    w, h, frames = sc["w"], sc["h"], sc["frames"]
    end = sc["settledAt"] + 1 if sc["settledAt"] is not None else len(frames)
    imgs = []
    for cells in frames[:end]:
        im = Image.new("RGB", (w, h))
        im.putdata([PAL[c] for c in cells])
        imgs.append(im.resize((w * SCALE, h * SCALE), Image.NEAREST))
    out = os.path.join(HERE, name + ".gif")
    imgs[0].save(out, save_all=True, append_images=imgs[1:], duration=60, loop=0, optimize=True)
    manifest[name] = {
        "text": sc["text"], "frames": len(imgs), "px": [w * SCALE, h * SCALE],
        "seamless": sc["settledAt"] is not None,
        "kb": round(os.path.getsize(out) / 1024),
    }
    seam = "seamless (trimmed to settle)" if sc["settledAt"] is not None else "continuous (never settles)"
    print(f"  {name:<9} {len(imgs):>3} frames · {manifest[name]['kb']:>4} KB · {seam}")

json.dump(manifest, open(os.path.join(HERE, "manifest.json"), "w"), indent=2)
print("-> art/typo/*.gif + manifest.json")
