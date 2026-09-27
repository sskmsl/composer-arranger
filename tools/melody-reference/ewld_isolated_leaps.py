"""
記録用: OpenEWLD(https://github.com/00sapo/OpenEWLD 、パブリックドメインの歌のリードシート502曲)で、
「1音だけ飛び出す音」(src/melody-engine/melodyCraftMetrics.ts の isIsolatedLeap と同じ定義)を数える。
docs/isolated-leap-refinement.md の実在曲の目安の作り方。旋律はリポジトリに残さない。

前処理と集計の条件:
  - 各曲の最初のパートの音符(タイはつなげて1音にする。和音は最高音、休符は音の間の空きとして扱う)
  - 拍子は見ず、四分音符=1拍として、最初の音から32拍ずつの窓に分ける(4/4 なら8小節)。曲の終わり(最後に鳴り終わる音の終わり)まで
    32拍そろう窓だけを使い、12音未満の窓は捨てる
  - 窓の端をまたぐ3音は数えない(窓の中だけで前後の音を見る)
  - 1拍以下の音が、前後の音から同じ向きに7半音以上離れていれば数える。前後どちらかに1.5拍より長い休みがあれば数えない
  - 窓は同じ曲から複数取るので独立ではない。曲ごとの合計で割合を出し、曲を単位に作り直した(ブートストラップ)幅も出す
  - OpenEWLD にはAメロ・サビの区別がないので、生成のAメロ・サビとは直接対応しない(参考値)

使い方:
  git clone --depth 1 https://github.com/00sapo/OpenEWLD.git
  python3 tools/melody-reference/ewld_isolated_leaps.py <OpenEWLDのフォルダ>
"""
import glob
import random
import sys
from multiprocessing import Pool

from music21 import converter, note

WINDOW_BEATS = 32
ISOLATED_LEAP = 7
ISOLATED_NOTE_BEATS = 1
PHRASE_BREAK_REST_BEATS = 1.5


def melody(path):
    try:
        score = converter.parse(path).stripTies()
    except Exception:
        return None
    part = score.parts[0] if score.parts else score
    by_start = {}
    for element in part.flatten().notes:
        if element.duration.quarterLength <= 0:
            continue
        pitch = element.pitch.midi if isinstance(element, note.Note) else max(p.midi for p in element.pitches)
        start = float(element.offset)
        if start not in by_start or pitch > by_start[start][2]:
            by_start[start] = (start, float(element.duration.quarterLength), pitch)
    return sorted(by_start.values())


def isolated(notes, i):
    if i == 0 or i == len(notes) - 1:
        return False
    (ps, pd, pp), (s, d, p), (ns, nd, np) = notes[i - 1], notes[i], notes[i + 1]
    if d > ISOLATED_NOTE_BEATS + 1e-6:
        return False
    if s - (ps + pd) > PHRASE_BREAK_REST_BEATS or ns - (s + d) > PHRASE_BREAK_REST_BEATS:
        return False
    a, b = p - pp, p - np
    return a * b > 0 and abs(a) >= ISOLATED_LEAP and abs(b) >= ISOLATED_LEAP


def count(path):
    notes = melody(path)
    if not notes or len(notes) < 16:
        return None
    total_notes = total_isolated = windows = 0
    start = notes[0][0]
    # 曲の終わりは、最後に鳴り終わる音の終わり(最後の音の長さも含める)
    end = max(s + d for s, d, _ in notes)
    while start + WINDOW_BEATS <= end + 1e-6:
        window = [n for n in notes if start <= n[0] < start + WINDOW_BEATS]
        if len(window) >= 12:
            windows += 1
            total_notes += len(window)
            total_isolated += sum(isolated(window, i) for i in range(len(window)))
        start += WINDOW_BEATS
    return (windows, total_notes, total_isolated) if windows else None


if __name__ == "__main__":
    paths = sorted(glob.glob(sys.argv[1] + "/**/*.mxl", recursive=True))
    with Pool(8) as pool:
        pieces = [row for row in pool.map(count, paths) if row]
    windows = sum(row[0] for row in pieces)
    notes = sum(row[1] for row in pieces)
    hits = sum(row[2] for row in pieces)
    rng = random.Random(0)
    boot = []
    for _ in range(2000):
        sample = [rng.choice(pieces) for _ in pieces]
        boot.append(100 * sum(row[2] for row in sample) / sum(row[1] for row in sample))
    boot.sort()
    print(f"曲 {len(pieces)}、窓 {windows}、音 {notes}")
    print(f"1音だけ飛び出す音 {100 * hits / notes:.2f} / 100音(曲を単位にした95%の幅 {boot[50]:.2f}〜{boot[1949]:.2f})")
