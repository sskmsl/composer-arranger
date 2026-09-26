"""
歌の旋律の「予想しやすさ」の物差し(IDyOM を簡単にしたもの)を作る。

聴き手は、聴き慣れた歌から「次はこう動くだろう」という予想を無意識に持っている(Huron 2006 の図式的な予想)。
予想どおりすぎると退屈で、外れすぎると覚えられない。好まれるのは中くらい(Gold et al. 2019)。
覚えやすい部分・耳に残る曲は、音の動きが「よくある形」に近い(Van Balen et al. 2015、Jakubowski et al. 2017)。

学習に使うのは OpenEWLD(パブリックドメインの歌のリードシート502曲、extract_openewld.py で取り出したもの)だけ。
旋律そのものは残さず、「この音階の段から、直前の動きのあとで、何半音動くか」の回数だけを残す。

各音の情報量(驚き、ビット) = -log2 P(次の音程 | 直前の音の音階の段, 直前の音程の大きさ・向き)
  長期の予想(コーパスの回数)を、段・音程の3段階でならし(PPM 風)、
  その曲の中でくり返された動きは予想しやすくなる(短期の予想)。
校正: 5分割の交差検証で、曲を8小節ずつに分けた平均情報量の分布(長調・短調別)を残す。

使い方:
  python3 tools/melody-reference/build_expectation_model.py reference-data/melody-corpus/openewld.jsonl \
    src/melody-engine/reference/songExpectation.json
"""
import json
import math
import random
import sys

NAMES = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7,
         "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11, "Cb": 11}
BINS = 27  # 音程 -13..+13(13 はそれを超える跳躍をまとめる)
PREVIOUS_CLASSES = 7
BETA = 5.0
BETA_SHORT = 2.0
UNIT_BEATS = 32


def parse_key(key):
    minor = key.endswith("m")
    return NAMES[key[:-1] if minor else key], int(minor)


def interval_bin(interval):
    return max(-13, min(13, interval)) + 13


def previous_class(interval):
    if interval <= -5: return 0
    if interval <= -3: return 1
    if interval < 0: return 2
    if interval == 0: return 3
    if interval <= 2: return 4
    if interval <= 4: return 5
    return 6


class Counts:
    def __init__(self):
        self.c3 = [[[[0] * BINS for _ in range(PREVIOUS_CLASSES)] for _ in range(12)] for _ in range(2)]
        self.c2 = [[[0] * BINS for _ in range(12)] for _ in range(2)]
        self.c1 = [[0] * BINS for _ in range(2)]

    def train(self, notes, key):
        tonic, mode = parse_key(key)
        for index in range(1, len(notes)):
            degree = (notes[index - 1][2] - tonic) % 12
            prev = previous_class(notes[index - 1][2] - notes[index - 2][2]) if index >= 2 else 3
            x = interval_bin(notes[index][2] - notes[index - 1][2])
            self.c3[mode][degree][prev][x] += 1
            self.c2[mode][degree][x] += 1
            self.c1[mode][x] += 1

    def information(self, notes, key):
        """各音の情報量。アプリ側(expectation.ts)と同じ計算"""
        tonic, mode = parse_key(key)
        total1 = sum(self.c1[mode])
        short = {}
        values = []
        for index in range(1, len(notes)):
            degree = (notes[index - 1][2] - tonic) % 12
            prev = previous_class(notes[index - 1][2] - notes[index - 2][2]) if index >= 2 else 3
            x = interval_bin(notes[index][2] - notes[index - 1][2])
            p1 = (self.c1[mode][x] + 1) / (total1 + BINS)
            c2 = self.c2[mode][degree]
            p2 = (c2[x] + BETA * p1) / (sum(c2) + BETA)
            c3 = self.c3[mode][degree][prev]
            p3 = (c3[x] + BETA * p2) / (sum(c3) + BETA)
            seen = short.setdefault((degree, prev), [0] * BINS)
            p = (seen[x] + BETA_SHORT * p3) / (sum(seen) + BETA_SHORT)
            seen[x] += 1
            values.append(-math.log2(p))
        return values


def units(notes):
    notes = sorted(tuple(note) for note in notes)
    out = []
    start = notes[0][0]
    while start < notes[-1][0]:
        unit = [note for note in notes if start <= note[0] < start + UNIT_BEATS]
        if len(unit) >= 8:
            out.append(unit)
        start += UNIT_BEATS
    return out


def percentile(values, q):
    values = sorted(values)
    position = (len(values) - 1) * q / 100
    low = int(math.floor(position))
    high = min(len(values) - 1, low + 1)
    return values[low] + (values[high] - values[low]) * (position - low)


def main():
    source, out = sys.argv[1], sys.argv[2]
    songs = [json.loads(line) for line in open(source)]
    songs = [song for song in songs if song["key"][:-1 if song["key"].endswith("m") else None] in NAMES]
    for song in songs:
        song["notes"] = sorted(tuple(note) for note in song["notes"])
    random.seed(7)
    random.shuffle(songs)
    folds = 5
    means = {0: [], 1: []}
    for fold in range(folds):
        model = Counts()
        for index, song in enumerate(songs):
            if index % folds != fold:
                model.train(song["notes"], song["key"])
        for index, song in enumerate(songs):
            if index % folds == fold:
                mode = parse_key(song["key"])[1]
                for unit in units(song["notes"]):
                    values = model.information(unit, song["key"])
                    means[mode].append(sum(values) / len(values))
    model = Counts()
    for song in songs:
        model.train(song["notes"], song["key"])
    calibration = {
        ("minor" if mode else "major"): {f"p{q}": round(percentile(values, q), 3) for q in (5, 10, 25, 50, 75, 90, 95)}
        for mode, values in means.items()
    }
    check_notes = [(0, 1, 60), (1, 1, 62), (2, 1, 64), (3, 1, 65), (4, 2, 67), (6, 1, 64), (7, 1, 60), (8, 2, 62), (10, 2, 60)]
    check = model.information(check_notes, "C")
    result = {
        "source": "OpenEWLD (public-domain song lead sheets, https://github.com/00sapo/OpenEWLD), counts only",
        "songs": len(songs),
        "bins": BINS,
        "beta": BETA,
        "betaShort": BETA_SHORT,
        "unitBeats": UNIT_BEATS,
        "calibration": calibration,
        "counts3": model.c3,
        "counts2": model.c2,
        "counts1": model.c1,
        "selfCheck": {"notes": check_notes, "key": "C", "meanInformation": round(sum(check) / len(check), 6)},
    }
    with open(out, "w") as handle:
        json.dump(result, handle, separators=(",", ":"))
    print(len(songs), "songs", {mode: len(values) for mode, values in means.items()}, "units", calibration)


if __name__ == "__main__":
    main()
