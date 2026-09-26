"""
OpenEWLD(https://github.com/00sapo/OpenEWLD 、パブリックドメインの歌のリードシート502曲)から
主旋律を取り出して JSON Lines にする(ポップスの「予想しやすさ」の物差しの学習用)。
リポジトリにはコミットせず、学習した統計(音程の出やすさ)だけを src/melody-engine/reference/ に残す。

使い方:
  git clone --depth 1 https://github.com/00sapo/OpenEWLD.git
  python3 tools/melody-reference/extract_openewld.py <OpenEWLDのフォルダ> reference-data/melody-corpus/openewld.jsonl
"""
import glob
import json
import os
import sys
from multiprocessing import Pool

from music21 import converter, note

NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


def extract(path):
    try:
        score = converter.parse(path)
    except Exception:
        return None
    part = score.parts[0] if score.parts else score
    notes = []
    for element in part.flatten().notes:
        if isinstance(element, note.Note) and element.duration.quarterLength > 0:
            notes.append([float(element.offset), float(element.duration.quarterLength), int(element.pitch.midi)])
    if len(notes) < 16:
        return None
    try:
        key = part.analyze("key")
    except Exception:
        return None
    name = NAMES[key.tonic.pitchClass] + ("m" if key.mode == "minor" else "")
    return {"corpus": "openewld", "piece": os.path.relpath(path).split("dataset/")[-1], "key": name, "notes": notes}


def main():
    root, out = sys.argv[1], sys.argv[2]
    paths = sorted(glob.glob(os.path.join(root, "dataset", "**", "*.mxl"), recursive=True))
    with Pool() as pool:
        rows = [row for row in pool.map(extract, paths) if row]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as handle:
        for row in rows:
            handle.write(json.dumps(row) + "\n")
    print(len(paths), "files ->", len(rows), "melodies")


if __name__ == "__main__":
    main()
