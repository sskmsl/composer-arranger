"""
公開されている研究用の楽譜コーパスから、旋律と拍ごとの和音を取り出して JSON Lines にする(古典らしさの較正用)。

使うコーパス(どれも git で取得。reference-data/ と同じくリポジトリにはコミットしない):
  - DCML コーパス(https://github.com/DCMLab 、CC BY-NC-SA 4.0): 各曲の notes/*.notes.tsv
    例: git clone --depth 1 --filter=blob:none --sparse https://github.com/DCMLab/grieg_lyric_pieces
        git -C grieg_lyric_pieces sparse-checkout set notes
  - OpenScore Lieder(https://github.com/OpenScore/Lieder 、CC0): 各曲の *.mxl
    例: git clone --depth 1 --filter=blob:none --no-checkout https://github.com/OpenScore/Lieder
        git -C Lieder sparse-checkout set --no-cone '*.mxl' && git -C Lieder checkout

使い方:
  python3 tools/melody-reference/extract_public_corpora.py <DCMLの親フォルダ> <Liederのフォルダ> reference-data/melody-corpus

出力: lied.jsonl(歌曲の歌の旋律)、romantic.jsonl(ロマン派〜近代のピアノ曲の最上声部)、
      classical_era.jsonl(古典派のソナタ・四重奏の最上声部)。
旋律はピアノなら右手(1段目)の各発音の最も高い音、歌曲・四重奏なら1段目(歌・第1ヴァイオリン)。
和音は全声部から拍ごとに求める(extract_corpus.py と同じ方法)。4/4・2/4・2/2・6/8・12/8 の曲だけを使う。
"""
import csv
import json
import os
import sys
from fractions import Fraction
from multiprocessing import Pool

from music21 import chord, converter, stream

sys.path.insert(0, os.path.dirname(__file__))
from extract_corpus import UNIT_BEATS, chord_symbol, melody_events, pickup_shift, units  # noqa: E402

# 拍子 → アプリの物差しに渡す「1小節の拍数」(強拍の判定に使う。2/4 は2小節を1つにまとめて4/4と同じに扱う)
BEATS_PER_BAR = {"4/4": 4, "C": 4, "2/2": 4, "C|": 4, "2/4": 4, "6/8": 3, "12/8": 6}
MAX_UNITS_PER_PIECE = 12

DCML_GROUPS = {
    "lied": ["schumann_liederkreis", "c_schumann_lieder", "schubert_winterreise", "mahler_kindertotenlieder"],
    "romantic": [
        "grieg_lyric_pieces", "tchaikovsky_seasons", "chopin_mazurkas", "schumann_kinderszenen", "liszt_pelerinage",
        "medtner_tales", "dvorak_silhouettes", "rachmaninoff_piano", "debussy_suite_bergamasque", "ravel_piano",
        "poulenc_mouvements_perpetuels",
    ],
    "classical_era": ["mozart_piano_sonatas", "beethoven_piano_sonatas", "ABC", "pleyel_quartets", "mendelssohn_quartets"],
}

MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


def estimate_key(notes) -> str:
    """音の長さで重み付けした音高の分布から調を推定する(Krumhansl-Schmuckler)"""
    histogram = [0.0] * 12
    for start, duration, pitch in notes:
        histogram[pitch % 12] += duration
    def correlation(profile, tonic):
        rotated = [profile[(pc - tonic) % 12] for pc in range(12)]
        mean_h = sum(histogram) / 12
        mean_p = sum(rotated) / 12
        num = sum((h - mean_h) * (p - mean_p) for h, p in zip(histogram, rotated))
        den = (sum((h - mean_h) ** 2 for h in histogram) * sum((p - mean_p) ** 2 for p in rotated)) ** 0.5
        return num / den if den else 0
    best = max(((correlation(MAJOR_PROFILE, t), NAMES[t]) for t in range(12)), key=lambda x: x[0])
    best_minor = max(((correlation(MINOR_PROFILE, t), NAMES[t] + "m") for t in range(12)), key=lambda x: x[0])
    return best[1] if best[0] >= best_minor[0] else best_minor[1]


def read_dcml_notes(path):
    """notes.tsv を読み、タイでつながった音は1つにまとめる。装飾音と、1つ目の拍子と違う所から先は使わない"""
    rows = []
    with open(path, newline="") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            if row.get("gracenote") or not row.get("quarterbeats"):
                continue
            rows.append(row)
    if not rows:
        return None, None, None
    meter = rows[0]["timesig"]
    pickup = min((Fraction(r["quarterbeats"]) for r in rows if r["mn"] not in ("0", "")), default=Fraction(0))
    has_pickup = any(r["mn"] == "0" for r in rows)
    shift = pickup if has_pickup else Fraction(0)
    notes = []
    open_ties = {}
    for row in sorted(rows, key=lambda r: Fraction(r["quarterbeats"])):
        if row["timesig"] != meter:
            break
        start = Fraction(row["quarterbeats"]) - shift
        duration = Fraction(row["duration_qb"]) if "/" in row["duration_qb"] else Fraction(row["duration_qb"]).limit_denominator(96)
        staff = int(row["staff"])
        midi = int(row["midi"])
        tied = row.get("tied", "")
        if tied in ("0", "-1"):
            key = (staff, midi)
            if key in open_ties:
                open_ties[key][1] += duration
                if tied == "-1":
                    del open_ties[key]
            continue
        note = [start, duration, midi, staff]
        notes.append(note)
        if tied == "1":
            open_ties[(staff, midi)] = note
    return meter, [n for n in notes if n[0] >= 0], None


def skyline(notes, staff):
    """指定した段の、各発音で最も高い音を並べ、次の発音で切る"""
    onsets = {}
    for start, duration, midi, note_staff in notes:
        if note_staff != staff:
            continue
        if start not in onsets or midi > onsets[start][1]:
            onsets[start] = (duration, midi)
    starts = sorted(onsets)
    melody = []
    for index, start in enumerate(starts):
        duration, midi = onsets[start]
        if index + 1 < len(starts):
            duration = min(duration, starts[index + 1] - start)
        melody.append([round(float(start), 4), round(float(duration), 4), midi])
    return melody


def dcml_harmony(notes, total):
    events = []
    beat = 0
    while beat < total - 1e-6:
        sounding = [midi for start, duration, midi, _ in notes if start <= beat < start + duration]
        symbol = chord_symbol(chord.Chord(sorted(set(sounding)))) if len(set(sounding)) >= 2 else None
        if symbol is not None:
            if events and events[-1][2] == symbol[0] and events[-1][3] == symbol[1] and abs(events[-1][0] + events[-1][1] - beat) < 1e-6:
                events[-1][1] += 1.0
            else:
                events.append([float(beat), 1.0, symbol[0], symbol[1]])
        beat += 1
    return events


def extract_dcml(job):
    group, corpus_name, path = job
    try:
        meter, notes, _ = read_dcml_notes(path)
    except Exception:
        return []
    if not notes or meter not in BEATS_PER_BAR:
        return []
    melody = skyline(notes, 1)
    if len(melody) < 8:
        return []
    limit = MAX_UNITS_PER_PIECE * UNIT_BEATS
    total = min(max(s + d for s, d, _ in melody), limit)
    key = estimate_key([(float(s), float(d), m) for s, d, m, _ in notes])
    piece = f"{corpus_name}/{os.path.basename(path).replace('.notes.tsv', '')}"
    rows = units(piece, group, key, melody, dcml_harmony(notes, total), limit_beats=limit, final_at_end=True)
    for row in rows:
        row["beatsPerBar"] = BEATS_PER_BAR[meter]
    return rows


def extract_lieder(path):
    try:
        return extract_lieder_unsafe(path)
    except Exception:
        # 読めない・想定外の書き方の楽譜は飛ばす
        return []


def extract_lieder_unsafe(path):
    try:
        score = converter.parse(path)
    except Exception:
        return []
    if not isinstance(score, stream.Score) or len(score.parts) < 2:
        return []
    # 歌のパート: 歌詞の付いた最初のパート
    voice = next((part for part in score.parts if any(n.lyrics for n in part.recurse().notes)), None)
    if voice is None:
        return []
    signatures = list(voice.recurse().getElementsByClass("TimeSignature"))
    meter = signatures[0].ratioString if signatures else None
    if meter not in BEATS_PER_BAR:
        return []
    shift = pickup_shift(voice)
    limit = MAX_UNITS_PER_PIECE * UNIT_BEATS
    # 途中で拍子が変わる歌は、変わる所まで
    changes = [float(sig.getOffsetInHierarchy(voice)) - shift for sig in signatures if sig.ratioString != meter]
    if changes:
        limit = min(limit, min(changes))
    melody = [event for event in melody_events(voice, shift) if event[0] < limit]
    if len(melody) < 8:
        return []
    total = min(max(s + d for s, d, _ in melody), limit)
    key = estimate_key(melody)
    # 和音は全パートから(extract_corpus.harmony_events と同じ方法)
    from extract_corpus import harmony_events
    parts = path.split("/scores/")[-1]
    rows = units(parts, "lied", key, melody, harmony_events(score, shift, total), limit_beats=limit, final_at_end=True)
    for row in rows:
        row["beatsPerBar"] = BEATS_PER_BAR[meter]
    return rows


def main():
    dcml_root, lieder_root, out = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out, exist_ok=True)
    jobs = []
    for group, corpora in DCML_GROUPS.items():
        for corpus_name in corpora:
            folder = os.path.join(dcml_root, corpus_name, "notes")
            if not os.path.isdir(folder):
                continue
            jobs += [(group, corpus_name, os.path.join(folder, name)) for name in sorted(os.listdir(folder)) if name.endswith(".notes.tsv")]
    songs = {}
    for directory, _, files in os.walk(os.path.join(lieder_root, "scores")):
        mxl = sorted(name for name in files if name.endswith(".mxl"))
        if mxl:
            songs[directory] = os.path.join(directory, mxl[0])
    with Pool(4) as pool:
        rows = [row for chunk in pool.map(extract_dcml, jobs, chunksize=2) for row in chunk]
        print("dcml", len(jobs), "files ->", len(rows), "units", flush=True)
        lieder_rows = [row for chunk in pool.map(extract_lieder, sorted(songs.values()), chunksize=2) for row in chunk]
        print("openscore lieder", len(songs), "songs ->", len(lieder_rows), "units", flush=True)
    by_group = {}
    for row in rows + lieder_rows:
        by_group.setdefault(row["corpus"], []).append(row)
    for group, group_rows in by_group.items():
        with open(os.path.join(out, f"{group}.jsonl"), "w") as handle:
            for row in group_rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(group, len(group_rows), "units", len({row["piece"] for row in group_rows}), "pieces", flush=True)


if __name__ == "__main__":
    main()
