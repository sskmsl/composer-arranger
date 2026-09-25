"""
music21 に同梱されたパブリックドメインの楽譜から、旋律(と和音)を取り出して JSON にする。
アプリの物差し(src/melody-engine/melodyCraftMetrics.ts)で実在曲を測り、生成した旋律と比べるための下準備。

使い方:
  pip install music21
  python3 tools/melody-reference/extract_corpus.py reference-data/melody-corpus
  python3 tools/melody-reference/extract_corpus.py reference-data/melody-corpus classical   # 一部だけ作り直す

出力(1行1単位の JSON Lines。reference-data/ はコミットしない):
  bach.jsonl      Bach のコラール: ソプラノ + 全声部から求めた拍ごとの和音(ベース付き)
  essen.jsonl     Essen 民謡集(4/4・2/4): 旋律のみ
  classical.jsonl 古典派・ロマン派(Mozart・Haydn・Beethoven・Schumann ほか、4/4・2/4・2/2): 最上声部 + 和音。
                  1曲が偏って効かないよう、1曲あたり最初の12単位(96小節)まで

単位は 32拍(4/4 で8小節)ずつに区切る。曲の最後の単位には final=true を付ける(終わり方の物差しに使う)。
弱起(最初の不完全小節)は除き、1小節目の頭を0拍とする。繰り返し記号は展開しない。
"""
import json
import os
import sys
from multiprocessing import Pool

from music21 import chord, converter, corpus, stream

UNIT_BEATS = 32
MIN_UNIT_BEATS = 16
ACCEPTED_METERS = {"4/4": 4, "2/4": 2, "2/2": 4, "C": 4}


def note_name(pitch) -> str:
    return pitch.name.replace("-", "b")


def key_string(score) -> str | None:
    try:
        k = score.analyze("key")
    except Exception:
        return None
    tonic = k.tonic.name.replace("-", "b")
    return tonic + ("m" if k.mode == "minor" else "")


def chord_symbol(c: chord.Chord) -> tuple[str, str | None] | None:
    """拍の縦の響きをコード記号にする(三和音・七の和音のみ。判定できない響きは None)"""
    if len(c.pitches) == 0:
        return None
    try:
        root = c.root()
    except Exception:
        return None
    pcs = {p.pitchClass for p in c.pitches}
    r = root.pitchClass
    rel = {(pc - r) % 12 for pc in pcs}
    third = "m" if 3 in rel and 4 not in rel else "M" if 4 in rel else None
    fifth = "dim" if 6 in rel and 7 not in rel else "aug" if 8 in rel and 7 not in rel and third == "M" else "P"
    seventh = "maj7" if 11 in rel else "7" if 10 in rel else "dim7" if 9 in rel and fifth == "dim" and third == "m" else None
    name = note_name(root)
    if third is None:
        # 3度のない響き(空5度・単音)は、根音の長三和音として扱わず判定しない
        return None
    if third == "m" and fifth == "dim":
        quality = "dim7" if seventh == "dim7" else "m7b5" if seventh == "7" else "dim"
    elif third == "M" and fifth == "aug":
        quality = "aug"
    elif third == "m":
        quality = "m7" if seventh == "7" else "mM7" if seventh == "maj7" else "m"
    else:
        quality = "7" if seventh == "7" else "maj7" if seventh == "maj7" else ""
    if quality == "mM7":
        quality = "m"
    bass = note_name(c.bass())
    return name + quality, (bass if c.bass().pitchClass != r else None)


def melody_events(part, shift: float):
    events = []
    for n in part.flatten().notes:
        start = float(n.offset) - shift
        if start < -1e-6:
            continue
        if n.isChord and len(n.pitches) == 0:
            continue
        pitch = max(n.pitches, key=lambda p: p.midi) if n.isChord else n.pitch
        dur = float(n.duration.quarterLength)
        if dur <= 0:
            continue
        events.append([round(start, 4), round(dur, 4), int(pitch.midi)])
    return events


def pickup_shift(part) -> float:
    measures = list(part.getElementsByClass(stream.Measure))
    if not measures:
        return 0.0
    first = measures[0]
    ts = first.timeSignature or (part.recurse().getElementsByClass("TimeSignature") or [None])[0]
    if ts is None:
        return 0.0
    bar = float(ts.barDuration.quarterLength)
    length = float(first.duration.quarterLength)
    return length if 0 < length < bar - 1e-6 else 0.0


def harmony_events(score, shift: float, total: float):
    """拍ごとの縦の響き(全声部)をコード記号にし、同じものが続けばまとめる"""
    chords = score.chordify().flatten().getElementsByClass(chord.Chord)
    timeline = [(float(c.offset) - shift, float(c.duration.quarterLength), c) for c in chords]
    events = []
    beat = 0.0
    index = 0
    while beat < total - 1e-6:
        while index + 1 < len(timeline) and timeline[index + 1][0] <= beat + 1e-6:
            index += 1
        symbol = None
        if timeline and timeline[index][0] <= beat + 1e-6 < timeline[index][0] + timeline[index][1] + 1e-6:
            symbol = chord_symbol(timeline[index][2])
        if symbol is not None:
            if events and events[-1][2] == symbol[0] and events[-1][3] == symbol[1] and abs(events[-1][0] + events[-1][1] - beat) < 1e-6:
                events[-1][1] += 1.0
            else:
                events.append([beat, 1.0, symbol[0], symbol[1]])
        beat += 1.0
    return events


def meter_of(part) -> str | None:
    ts = list(part.recurse().getElementsByClass("TimeSignature"))
    return ts[0].ratioString if ts else None


def units(piece_id: str, corpus_name: str, key: str, melody, harmony, limit_beats: float | None = None, final_at_end: bool = False):
    full_end = max((s + d for s, d, _ in melody), default=0)
    end = full_end
    if limit_beats is not None:
        end = min(end, limit_beats)
    result = []
    start = 0.0
    index = 0
    while start < end - 1e-6:
        stop = min(start + UNIT_BEATS, end)
        if stop - start >= MIN_UNIT_BEATS:
            notes = [[round(s - start, 4), round(min(d, stop - s), 4), p] for s, d, p in melody if start - 1e-6 <= s < stop - 1e-6]
            chords = [[round(max(s, start) - start, 4), round(min(s + d, stop) - max(s, start), 4), sym, bass]
                      for s, d, sym, bass in harmony if s < stop - 1e-6 and s + d > start + 1e-6]
            if len(notes) >= 8:
                result.append({
                    "corpus": corpus_name, "piece": piece_id, "unit": index, "key": key,
                    "final": stop >= full_end - 1e-6 and (limit_beats is None or final_at_end),
                    "totalBeats": round(stop - start, 4), "notes": notes, "chords": chords,
                })
        start += UNIT_BEATS
        index += 1
    return result


def extract_bach(path: str):
    try:
        score = converter.parse(path)
    except Exception:
        return []
    if not isinstance(score, stream.Score) or len(score.parts) < 4:
        return []
    soprano = score.parts[0]
    if ACCEPTED_METERS.get(meter_of(soprano) or "") != 4:
        return []
    key = key_string(score)
    if not key:
        return []
    shift = pickup_shift(soprano)
    melody = melody_events(soprano, shift)
    total = max((s + d for s, d, _ in melody), default=0)
    return units(os.path.basename(path), "bach", key, melody, harmony_events(score, shift, total))


def extract_essen(path: str):
    try:
        opus = converter.parse(path)
    except Exception:
        return []
    scores = opus.scores if hasattr(opus, "scores") else [opus]
    result = []
    for number, score in enumerate(scores):
        part = score.parts[0] if hasattr(score, "parts") and len(score.parts) else score
        if meter_of(part) not in ("4/4", "2/4"):
            continue
        key = key_string(score)
        if not key:
            continue
        shift = pickup_shift(part)
        melody = melody_events(part, shift)
        result += units(f"{os.path.basename(path)}#{number}", "essen", key, melody, [])
    return result


def extract_classical(path: str):
    try:
        score = converter.parse(path)
    except Exception:
        return []
    if not isinstance(score, stream.Score) or len(score.parts) < 2:
        return []
    top = score.parts[0]
    if meter_of(top) not in ("4/4", "2/4", "2/2"):
        return []
    key = key_string(score)
    if not key:
        return []
    shift = pickup_shift(top)
    # 1曲あたり最初の12単位(4/4で96小節)まで
    limit = 12.0 * UNIT_BEATS
    melody = [event for event in melody_events(top, shift) if event[0] < limit]
    total = max((s + d for s, d, _ in melody), default=0)
    name = os.path.relpath(path, os.path.dirname(os.path.dirname(os.path.dirname(path))))
    return units(name, "classical", key, melody, harmony_events(score, shift, total), limit_beats=limit, final_at_end=True)


def corpus_paths(folder: str, suffixes=(".mxl", ".xml", ".krn", ".abc", ".musicxml")):
    paths = sorted(str(p) for p in corpus.getPaths() if f"/{folder}/" in str(p) and str(p).endswith(suffixes))
    # 同じ曲が複数の形式で入っている場合(movement1.krn と movement1.mxl など)は1つだけ使う
    chosen: dict[str, str] = {}
    for path in paths:
        stem = os.path.splitext(path)[0]
        if stem not in chosen or path.endswith(".mxl"):
            chosen[stem] = path
    return sorted(chosen.values())


CLASSICAL_FOLDERS = (
    "mozart", "haydn", "beethoven", "schumann_robert", "schumann_clara", "schubert",
    "chopin", "corelli", "cpebach", "handel", "verdi", "weber",
)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "reference-data/melody-corpus"
    only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
    os.makedirs(out, exist_ok=True)
    jobs = [
        ("bach", extract_bach, [p for p in corpus_paths("bach", (".mxl", ".xml", ".musicxml")) if "bwv" in os.path.basename(p)]),
        ("classical", extract_classical, [p for folder in CLASSICAL_FOLDERS for p in corpus_paths(folder, (".mxl", ".xml", ".musicxml", ".krn"))]),
        ("essen", extract_essen, corpus_paths("essenFolksong", (".abc",))),
    ]
    with Pool(4) as pool:
        for name, function, paths in jobs:
            if only and name not in only:
                continue
            rows = [row for chunk in pool.map(function, paths, chunksize=1) for row in chunk]
            with open(os.path.join(out, f"{name}.jsonl"), "w") as handle:
                for row in rows:
                    handle.write(json.dumps(row, ensure_ascii=False) + "\n")
            print(name, len(paths), "files ->", len(rows), "units", flush=True)


if __name__ == "__main__":
    main()
