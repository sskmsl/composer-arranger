"""Janáček(核の棘)と Delius(漂う和声・空間)の一般化した特徴を、公開楽譜から数値だけで取り出す。

  python tools/melody-reference/analyze_composer_traits.py --quartets .../StringQuartets/scores \
      --lieder .../Lieder/scores --out src/melody-engine/reference/composerTraitStats.json

比較のため同じ物差しで Schumann / Brahms も測る。
楽譜(OpenScore String Quartets / Lieder、CC0)は分析の途中でだけ使い、旋律・音型・和音の並びは出力しない。

旋律(第1ヴァイオリン / 歌)の「セル」: 休符か1拍以上の長い音で区切った 2〜6 音のまとまり。
- cellNotes          : セルの音数の中央値
- repeatedNote       : 同音の連続の割合
- obsessiveRepeat    : セルが直後にほぼ同じ形で繰り返される割合
- oneElementChange   : 繰り返されたセルのうち、違いが1か所だけのもの(小さな違和感)の割合
- rhythmIrregular    : 3連符などの割り切れない音価の割合
- suddenLeap         : 7半音以上の跳躍の割合
- cellsWithOneLeap   : 跳躍(5半音以上)がちょうど1つのセルの割合
- restShare          : 休符の時間の割合
- accentRate         : アクセント・スフォルツァンドのある音の割合

和声と空間(全パートを拍ごとにまとめた響き):
- semitoneVoiceMotion : 動いた声部のうち半音で動いたものの割合
- functionalRootMotion: 根音が4度・5度で動いた割合(低いほど機能があいまい)
- chromaticRootMotion : 根音が半音・3度で動いた割合
- seventhOrAdded      : 三和音以外(7度・9度・付加音)の響きの割合
- longSustain         : 2拍以上伸びる音の時間の割合(伴奏側)
- spanMedian          : 最低音から最高音までの幅(半音)
- bassGapMedian       : 最低音と次の音の間隔(半音、広いほど透明)
- pedalShare          : 同じ最低音が2小節以上続く時間の割合
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import statistics
import sys
from fractions import Fraction

from music21 import articulations, chord as m21chord, converter, expressions


def melody_notes(part):
    out = []
    for element in part.recurse().notesAndRests:
        ql = float(element.duration.quarterLength)
        if ql <= 0:
            continue
        start = float(element.getOffsetInHierarchy(part))
        if element.isRest:
            out.append((start, None, ql, False, False))
            continue
        pitch = max(p.midi for p in element.pitches) if isinstance(element, m21chord.Chord) else element.pitch.midi
        accent = any(isinstance(a, (articulations.Accent, articulations.StrongAccent)) for a in element.articulations) or any(
            isinstance(e, expressions.TextExpression) and "sf" in (e.content or "") for e in element.expressions)
        tuplet = bool(element.duration.tuplets)
        tie = element.tie.type if element.tie else None
        if tie in ("stop", "continue") and out and out[-1][1] == pitch:
            s, p, d, a, t = out[-1]
            out[-1] = (s, p, d + ql, a, t)
            continue
        out.append((start, pitch, ql, accent, tuplet))
    out.sort(key=lambda e: e[0])
    dedup = []
    for e in out:
        if dedup and abs(dedup[-1][0] - e[0]) < 1e-6:
            if e[1] is not None and (dedup[-1][1] is None or e[1] > dedup[-1][1]):
                dedup[-1] = e
            continue
        dedup.append(e)
    return dedup


def cells_of(notes):
    cells, current = [], []
    for e in notes:
        if e[1] is None:
            if len(current) >= 2:
                cells.append(current)
            current = []
            continue
        current.append(e)
        if e[2] >= 1.0:
            if len(current) >= 2:
                cells.append(current)
            current = []
    if len(current) >= 2:
        cells.append(current)
    return [c for c in cells if 2 <= len(c) <= 6]


def cell_shape(cell):
    return [(b[1] - a[1], round(b[0] - a[0], 3)) for a, b in zip(cell, cell[1:])]


def differences(a, b):
    if len(a) != len(b):
        return 99
    return sum(1 for x, y in zip(a, b) if x != y)


def melody_traits(notes, bar):
    sounding = [e for e in notes if e[1] is not None]
    if len(sounding) < 12:
        return None
    intervals = [b[1] - a[1] for a, b in zip(sounding, sounding[1:])]
    cells = cells_of(notes)
    repeats = [0, 0]
    one_change = [0, 0]
    for a, b in zip(cells, cells[1:]):
        d = differences(cell_shape(a), cell_shape(b))
        repeats[1] += 1
        if d <= 1:
            repeats[0] += 1
            one_change[1] += 1
            one_change[0] += int(d == 1)
    total_time = sum(e[2] for e in notes) or 1
    leaps_per_cell = [sum(1 for x, y in zip(c, c[1:]) if abs(y[1] - x[1]) >= 5) for c in cells]
    return {
        "cellNotes": statistics.median([len(c) for c in cells]) if cells else 0,
        "repeatedNote": sum(1 for i in intervals if i == 0) / len(intervals),
        "obsessiveRepeat": repeats[0] / max(1, repeats[1]),
        "oneElementChange": one_change[0] / max(1, one_change[1]),
        "rhythmIrregular": sum(1 for e in sounding if e[4]) / len(sounding),
        "suddenLeap": sum(1 for i in intervals if abs(i) >= 7) / len(intervals),
        "cellsWithOneLeap": sum(1 for n in leaps_per_cell if n == 1) / max(1, len(leaps_per_cell)),
        "restShare": sum(e[2] for e in notes if e[1] is None) / total_time,
        "accentRate": sum(1 for e in sounding if e[3]) / len(sounding),
    }


def root_of(pcs_bass):
    return pcs_bass


def harmony_traits(score, bar):
    parts = list(score.parts)
    # 拍ごとに各パートの鳴っている音
    events = []
    for index, part in enumerate(parts):
        for element in part.recurse().notes:
            ql = float(element.duration.quarterLength)
            if ql <= 0:
                continue
            start = float(element.getOffsetInHierarchy(part))
            for p in element.pitches:
                events.append((start, start + ql, p.midi, index, ql))
    if not events:
        return None
    end = max(e[1] for e in events)
    beat = 1.0
    frames = []
    t = 0.0
    events.sort()
    while t < end:
        active = [e for e in events if e[0] <= t < e[1]]
        frames.append(active)
        t += beat
    semitone = [0, 0]
    functional = [0, 0]
    chromatic_root = [0, 0]
    seventh = [0, 0]
    spans, gaps = [], []
    previous_voices = None
    previous_root = None
    pedal_time, pedal_run, last_bass = 0.0, 0.0, None
    for active in frames:
        if not active:
            previous_voices = None
            continue
        voices = {}
        for s, e, p, part, ql in active:
            voices[part] = max(voices.get(part, 0), p) if part == 0 else min(voices.get(part, 999), p)
        pitches = sorted({p for _, _, p, _, _ in active})
        spans.append(pitches[-1] - pitches[0])
        if len(pitches) >= 2:
            gaps.append(pitches[1] - pitches[0])
        pcs = sorted({p % 12 for p in pitches})
        if len(pcs) >= 3:
            c = m21chord.Chord(pitches)
            try:
                root = c.root().pitchClass
                seventh[0] += int(not c.isTriad())
                seventh[1] += 1
            except Exception:
                root = None
            if root is not None and previous_root is not None and root != previous_root:
                move = (root - previous_root) % 12
                functional[0] += int(move in (5, 7))
                functional[1] += 1
                chromatic_root[0] += int(move in (1, 11, 3, 4, 8, 9))
                chromatic_root[1] += 1
            previous_root = root if root is not None else previous_root
        if previous_voices:
            for part, p in voices.items():
                q = previous_voices.get(part)
                if q is not None and q != p:
                    semitone[0] += int(abs(p - q) == 1)
                    semitone[1] += 1
        previous_voices = voices
        bass = pitches[0]
        if bass == last_bass:
            pedal_run += beat
        else:
            if pedal_run >= 2 * bar:
                pedal_time += pedal_run
            pedal_run = beat
            last_bass = bass
    if pedal_run >= 2 * bar:
        pedal_time += pedal_run
    accompaniment = [e for e in events if e[3] != 0]
    sustain_time = sum(e[4] for e in accompaniment if e[4] >= 2.0)
    total_time = sum(e[4] for e in accompaniment) or 1
    return {
        "semitoneVoiceMotion": semitone[0] / max(1, semitone[1]),
        "functionalRootMotion": functional[0] / max(1, functional[1]),
        "chromaticRootMotion": chromatic_root[0] / max(1, chromatic_root[1]),
        "seventhOrAdded": seventh[0] / max(1, seventh[1]),
        "longSustain": sustain_time / total_time,
        "spanMedian": statistics.median(spans) if spans else 0,
        "bassGapMedian": statistics.median(gaps) if gaps else 0,
        "pedalShare": pedal_time / max(1.0, len(frames) * beat),
    }


def parse_score(path):
    """読み込めないテンポ記号(拍の単位が無いもの)だけを取り除いて読み直す"""
    try:
        return converter.parse(path)
    except Exception:
        import re
        import zipfile
        with zipfile.ZipFile(path) as archive:
            name = next(n for n in archive.namelist() if n.endswith((".xml", ".musicxml")) and not n.startswith("META-INF"))
            text = archive.read(name).decode("utf-8")
        text = re.sub(r"<metronome[^>]*>.*?</metronome>", "", text, flags=re.S)
        return converter.parse(text, format="musicxml")


def bar_length(score):
    ts = score.recurse().getElementsByClass("TimeSignature")
    return float(ts[0].barDuration.quarterLength) if ts else 4.0


def summarize(rows):
    if not rows:
        return {}
    keys = rows[0].keys()
    return {k: round(statistics.median([r[k] for r in rows]), 3) for k in keys}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--quartets", required=True)
    parser.add_argument("--lieder", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    groups = {
        "janacek": glob.glob(os.path.join(args.quartets, "Jan*", "**", "*.mxl"), recursive=True),
        "delius": glob.glob(os.path.join(args.quartets, "Delius*", "**", "*.mxl"), recursive=True)
        + glob.glob(os.path.join(args.lieder, "Delius*", "**", "*.mxl"), recursive=True),
        "schumann": glob.glob(os.path.join(args.quartets, "Schumann,_Robert", "**", "*.mxl"), recursive=True),
        "brahms": glob.glob(os.path.join(args.quartets, "Brahms*", "**", "*.mxl"), recursive=True),
    }
    out = {"sources": {
        "OpenScore String Quartets (CC0)": "https://github.com/OpenScore/StringQuartets",
        "OpenScore Lieder (CC0)": "https://github.com/OpenScore/Lieder",
    }, "unit": "楽章(歌曲は1曲)ごとの値の中央値", "composers": {}}
    for composer, files in groups.items():
        melody_rows, harmony_rows = [], []
        for path in sorted(files):
            try:
                score = parse_score(path)
            except Exception as error:
                print(f"skip {path}: {error}", file=sys.stderr)
                continue
            bar = bar_length(score)
            # 楽章ごとに分ける(四重奏は1ファイルに全楽章)。終止線のある小節で区切る
            measures = list(score.parts[0].getElementsByClass("Measure"))
            ends = [m.number for m in measures if m.rightBarline is not None and m.rightBarline.type in ("final", "light-heavy")]
            if not ends or ends[-1] != measures[-1].number:
                ends.append(measures[-1].number)
            movements, first = [], measures[0].number
            for last in ends:
                if last - first >= 7:
                    movements.append(score.measures(first, last))
                first = last + 1
            for movement in movements[:8]:
                try:
                    m = melody_traits(melody_notes(movement.parts[0]), bar)
                    h = harmony_traits(movement, bar)
                except Exception as error:
                    print(f"skip {path}: {error}", file=sys.stderr)
                    continue
                if m:
                    melody_rows.append(m)
                if h:
                    harmony_rows.append(h)
            print(composer, os.path.basename(os.path.dirname(path)), file=sys.stderr)
        out["composers"][composer] = {"works": len(files), "melody": summarize(melody_rows), "harmony": summarize(harmony_rows)}
    with open(args.out, "w") as handle:
        json.dump(out, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
