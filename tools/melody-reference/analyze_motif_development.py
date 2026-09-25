"""Schumann / Brahms の公開楽譜から「動機の扱い方」を一般化した統計だけを取り出す。

  python tools/melody-reference/analyze_motif_development.py \
      --lieder /path/to/OpenScore/Lieder/scores --quartets /path/to/OpenScore/StringQuartets/scores \
      --out src/melody-engine/reference/motifDevelopmentStats.json

使う楽譜(いずれも CC0 = 権利放棄):
- OpenScore Lieder: Robert Schumann(Dichterliebe, Liederkreis Op.39, Frauenliebe, Myrthen など)、Johannes Brahms の歌曲
- OpenScore String Quartets: Schumann Op.41 No.1〜3、Brahms Op.51 No.1〜2・Op.67

分析の途中でだけ具体的な音を見る。出力は割合・中央値などの数値だけで、旋律・音型・伴奏型は残さない。

測ること(フレーズの頭の動機 M と、その後 8 小節の各小節窓 W の関係):
- exact / sequence / register : 同じ音程とリズム(移高なし / 移高 / オクターブ移動)
- tail      : 頭(前半)は同じで、語尾だけ違う(Schumann 的な小変形)
- rhythm    : リズムは同じで音程が違う
- interval  : 音程は同じでリズムが違う
- shifted   : 同じ形が小節頭からずれた位置に現れる(拍節のずらし)
- truncated / extended : 頭の一部だけ / 後ろに足した形
- deletion  : 1音を抜いた形
- small     : 上のどれでもないが、変化が 1〜2 か所だけ
- other     : 関係の薄い素材
さらに、動機が内声・低音へ移る頻度、主旋律の休みや長い音で他のパートが動く割合、全パートが同時に動く割合、
フレーズ末の弱い終止(主音以外・弱拍・休符へ抜ける)の割合を測る。
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import statistics
import sys
from collections import Counter, defaultdict

from music21 import converter, note as m21note, chord as m21chord, stream

MAX_FOLLOW_BARS = 8


def events_of(part: stream.Part) -> list[tuple[float, int, float]]:
    """(開始拍, 音高, 長さ)。和音は最高音(内声・低音のパートでは最低音も別に見る)"""
    out = []
    for element in part.recurse().notes:
        if element.duration.quarterLength <= 0:
            continue
        if isinstance(element, m21chord.Chord):
            pitches = [p.midi for p in element.pitches]
            if not pitches:
                continue
            pitch = max(pitches)
        else:
            pitch = element.pitch.midi
        tie = element.tie.type if element.tie else None
        start = float(element.getOffsetInHierarchy(part))
        if tie in ("stop", "continue") and out and out[-1][1] == pitch:
            s, p, d = out[-1]
            out[-1] = (s, p, d + float(element.duration.quarterLength))
            continue
        out.append((start, pitch, float(element.duration.quarterLength)))
    out.sort()
    # 同時発音は最高音だけ
    dedup = []
    for e in out:
        if dedup and abs(dedup[-1][0] - e[0]) < 1e-6:
            if e[1] > dedup[-1][1]:
                dedup[-1] = e
            continue
        dedup.append(e)
    return dedup


def low_events_of(part: stream.Part) -> list[tuple[float, int, float]]:
    out = []
    for element in part.recurse().notes:
        if element.duration.quarterLength <= 0:
            continue
        pitches = [p.midi for p in element.pitches] if isinstance(element, m21chord.Chord) else [element.pitch.midi]
        if not pitches:
            continue
        out.append((float(element.getOffsetInHierarchy(part)), min(pitches), float(element.duration.quarterLength)))
    out.sort()
    dedup = []
    for e in out:
        if dedup and abs(dedup[-1][0] - e[0]) < 1e-6:
            if e[1] < dedup[-1][1]:
                dedup[-1] = e
            continue
        dedup.append(e)
    return dedup


def window(events, start, length):
    return [e for e in events if start - 1e-6 <= e[0] < start + length - 1e-6]


def shape(win, start):
    """音程列と、窓の頭からの開始位置列(移高とは無関係な形)"""
    intervals = tuple(b[1] - a[1] for a, b in zip(win, win[1:]))
    onsets = tuple(round(e[0] - start, 3) for e in win)
    return intervals, onsets


def edit_distance(a, b):
    dp = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, len(b) + 1):
            cur = dp[j]
            dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = cur
    return dp[-1]


def tokens(win, start):
    """(音程, 直前からの間隔) の列。移高に依らない"""
    out = []
    for i, e in enumerate(win):
        interval = e[1] - win[i - 1][1] if i else None
        gap = round(e[0] - (win[i - 1][0] if i else start), 3)
        out.append((interval, gap))
    return out


def same_interval(a, b):
    """調の中での移高(ゼクエンツ)では音程が半音ずれるので、同じ向きで±1半音以内なら同じとみなす"""
    if a is None or b is None:
        return a is None and b is None
    return (a == 0 and b == 0) or (a * b > 0 and abs(a - b) <= 1)


def same_token(a, b):
    return same_interval(a[0], b[0]) and abs(a[1] - b[1]) < 0.02


def fuzzy_distance(a, b):
    dp = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, len(b) + 1):
            cur = dp[j]
            dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + (0 if same_token(a[i - 1], b[j - 1]) else 1))
            prev = cur
    return dp[-1] / max(len(a), len(b))


def classify(motif, m_start, candidate, c_start, bar_length):
    """動機 M と窓 W の関係を1つに決める(上から優先)"""
    if len(candidate) < 2 or len(motif) < 3:
        return "other", 1.0
    mi, mo = shape(motif, m_start)
    ci, co = shape(candidate, c_start)
    transposition = candidate[0][1] - motif[0][1]
    rhythm_same = len(mo) == len(co) and all(abs(a - b) < 0.02 for a, b in zip(mo, co))
    interval_same = len(mi) == len(ci) and all(same_interval(a, b) for a, b in zip(mi, ci))
    if rhythm_same and interval_same:
        if transposition == 0 and mi == ci:
            return "exact", 0.0
        if transposition % 12 == 0 and mi == ci:
            return "register", 0.0
        return "sequence", 0.0
    mt, ct = tokens(motif, m_start), tokens(candidate, c_start)
    distance = fuzzy_distance(mt, ct)
    head = max(2, (len(mt) + 1) // 2)
    if len(ct) >= head and all(same_token(a, b) for a, b in zip(mt[:head], ct[:head])):
        if len(ct) < len(mt) and all(same_token(a, b) for a, b in zip(mt, ct)):
            return "truncated", distance
        if len(ct) > len(mt) and all(same_token(a, b) for a, b in zip(mt, ct[:len(mt)])):
            return "extended", distance
        return "tail", distance
    if rhythm_same:
        return "rhythm", distance
    if interval_same:
        return "interval", distance
    if len(ct) == len(mt) - 1:
        for k in range(1, len(motif)):
            reduced = motif[:k] + motif[k + 1:]
            rt = tokens(reduced, m_start)
            if all(same_interval(a[0], b[0]) for a, b in zip(rt, ct)):
                return "deletion", distance
    return ("small", distance) if distance <= 0.34 else ("other", distance)


def shifted_match(motif, m_start, events, start, length, step):
    mi, mo = shape(motif, m_start)
    offset = step
    while offset < length - 1e-6:
        w = window(events, start + offset, length)
        if len(w) == len(motif):
            wi, wo = shape(w, start + offset)
            if all(same_interval(a, b) for a, b in zip(wi, mi)) and all(abs(a - b) < 0.02 for a, b in zip(wo, mo)):
                return True
        offset += step
    return False


def related_in(motif, m_start, events, start, length):
    """別パートに動機が現れるか(音程かリズムのどちらかを保って)"""
    for offset in (0.0, length / 2):
        w = window(events, start + offset, length)
        if len(w) < 3:
            continue
        kind, _ = classify(motif, m_start, w, start + offset, length)
        if kind in ("exact", "sequence", "register", "tail", "rhythm", "interval", "truncated", "extended"):
            return kind
    return None


def bar_length_of(score) -> float:
    ts = score.recurse().getElementsByClass("TimeSignature")
    return float(ts[0].barDuration.quarterLength) if ts else 4.0


def analyze_piece(path: str, kind: str):
    score = converter.parse(path)
    parts = list(score.parts)
    if len(parts) < 2:
        return None
    bar = bar_length_of(score)
    melody = events_of(parts[0])
    others = [low_events_of(p) if i == len(parts) - 1 else events_of(p) for i, p in enumerate(parts[1:], 1)]
    if kind == "lied" and len(parts) >= 3:
        # 歌 / ピアノ右手 / ピアノ左手
        inner, bass = events_of(parts[1]), low_events_of(parts[-1])
    else:
        inner = others[0] if len(others) >= 2 else []
        if len(others) >= 3:
            inner = sorted(others[0] + others[1])
        bass = others[-1]
    if len(melody) < 16:
        return None
    end = max(e[0] + e[2] for e in melody)
    result = {
        "traces": [], "migration": Counter(), "migrationWhileMelodyRests": [0, 0],
        "responseInRests": [0, 0], "responseWhileMoving": [0, 0], "allMoving": [0, 0],
        "endings": Counter(), "coreNotes": [], "newPitchShare": [],
    }
    # フレーズの頭: 直前に休み(1拍以上)がある、または 4 小節ごとの小節頭
    # フレーズの頭: 直前に1拍以上の休みがある音(弱起を含む実際の歌い出し)
    starts = set()
    for i, e in enumerate(melody):
        prev_end = melody[i - 1][0] + melody[i - 1][2] if i else -99
        if e[0] - prev_end >= 1.0 - 1e-6:
            starts.add(e[0])
    for m_start in sorted(starts):
        for length_bars in (1, 2):
            length = bar * length_bars
            motif = window(melody, m_start, length)
            if not (3 <= len(motif) <= 10):
                continue
            trace = []
            motif_pcs = {p % 12 for _, p, _ in motif}
            new_pc = []
            for k in range(1, MAX_FOLLOW_BARS // length_bars + 1):
                c_start = m_start + k * length
                if c_start + length > end:
                    break
                candidate = window(melody, c_start, length)
                if not candidate:
                    trace.append(("rest", 1.0))
                    continue
                kind, distance = classify(motif, m_start, candidate, c_start, bar)
                if kind == "other" and shifted_match(motif, m_start, melody, c_start - length / 2, length, bar / 4 if bar <= 4 else 1.0):
                    kind = "shifted"
                trace.append((kind, round(distance, 3)))
                new_pc.append(len({p % 12 for _, p, _ in candidate} - motif_pcs) / max(1, len({p % 12 for _, p, _ in candidate})))
                moved = related_in(motif, m_start, bass, c_start, length) or related_in(motif, m_start, inner, c_start, length)
                if moved and kind in ("other", "rest", "small"):
                    result["migration"][("bass" if related_in(motif, m_start, bass, c_start, length) else "inner")] += 1
                    melody_notes = len(candidate)
                    result["migrationWhileMelodyRests"][0] += int(melody_notes < len(motif))
                    result["migrationWhileMelodyRests"][1] += 1
            if len(trace) >= 3:
                result["traces"].append({"lengthBars": length_bars, "trace": trace})
                result["coreNotes"].append(len(motif))
                if new_pc:
                    result["newPitchShare"].append(statistics.mean(new_pc))
    # 主旋律が休む・伸ばす所で他のパートが動くか(8分音符の格子)
    grid = 0.5
    t = 0.0
    melody_onsets = {round(e[0] / grid) for e in melody}
    sounding = [(e[0], e[0] + e[2]) for e in melody]
    other_onsets = [{round(e[0] / grid) for e in part} for part in (inner, bass) if part]
    si = 0
    while t < end:
        slot = round(t / grid)
        while si < len(sounding) and sounding[si][1] <= t:
            si += 1
        melody_moving = slot in melody_onsets
        melody_resting = not (si < len(sounding) and sounding[si][0] <= t < sounding[si][1])
        others_moving = any(slot in onsets for onsets in other_onsets)
        if melody_moving:
            result["responseWhileMoving"][0] += int(others_moving)
            result["responseWhileMoving"][1] += 1
        else:
            key = "responseInRests" if melody_resting else "responseInRests"
            result[key][0] += int(others_moving)
            result[key][1] += 1
        if melody_moving or others_moving:
            result["allMoving"][0] += int(melody_moving and all(slot in onsets for onsets in other_onsets))
            result["allMoving"][1] += 1
        t += grid
    # フレーズ末(次に1拍以上の休み)の終わり方
    key_obj = score.analyze("key")
    tonic = key_obj.tonic.pitchClass
    for i, e in enumerate(melody[:-1]):
        gap = melody[i + 1][0] - (e[0] + e[2])
        if gap >= 1.0 - 1e-6:
            strong = abs((e[0] % bar)) < 1e-6
            result["endings"]["tonic" if e[1] % 12 == tonic else "nonTonic"] += 1
            result["endings"]["strongBeat" if strong else "weakBeat"] += 1
            result["endings"]["total"] += 1
    return result


def summarize(pieces):
    by_position = defaultdict(Counter)
    kinds = Counter()
    distances = defaultdict(list)
    head_kept = [0, 0]
    returns_late = [0, 0]
    only_repeat = [0, 0]
    for piece in pieces:
        for item in piece["traces"]:
            trace = item["trace"]
            if item["lengthBars"] != 1:
                continue
            for position, (kind, distance) in enumerate(trace[:7], 1):
                by_position[position][kind] += 1
                kinds[kind] += 1
                if kind not in ("rest", "other"):
                    distances[kind].append(distance)
                if kind not in ("rest",):
                    head_kept[0] += int(kind in ("exact", "sequence", "register", "tail", "truncated", "extended"))
                    head_kept[1] += 1
            related = [k for k, _ in trace if k not in ("other", "rest")]
            returns_late[0] += int(any(k not in ("other", "rest") for k, _ in trace[-3:]))
            returns_late[1] += 1
            only_repeat[0] += int(bool(related) and all(k in ("exact", "sequence", "register") for k in related))
            only_repeat[1] += 1
    ratio = lambda pair: round(pair[0] / max(1, pair[1]), 3)
    total = sum(kinds.values()) or 1
    related_kinds = Counter({k: v for k, v in kinds.items() if k not in ("other", "rest")})
    related_total = sum(related_kinds.values()) or 1
    # 8小節のうちに使う変形の種類の数(関係のある再登場が2回以上あるフレーズだけ)
    variety = []
    first_related = Counter()
    literal_first = [0, 0]
    for piece in pieces:
        for item in piece["traces"]:
            if item["lengthBars"] != 1:
                continue
            related = [k for k, _ in item["trace"] if k not in ("other", "rest")]
            if len(related) >= 2:
                variety.append(len({k for k in related if k not in ("exact", "register")}))
            if related:
                first_related[related[0]] += 1
                literal_first[0] += int(related[0] in ("exact", "sequence", "register"))
                literal_first[1] += 1
    share = lambda c: {k: round(v / max(1, sum(c.values())), 3) for k, v in sorted(c.items())}
    agg = lambda key: [sum(p[key][0] for p in pieces), sum(p[key][1] for p in pieces)]
    ratio = lambda pair: round(pair[0] / max(1, pair[1]), 3)
    migration = Counter()
    for p in pieces:
        migration.update(p["migration"])
    endings = Counter()
    for p in pieces:
        endings.update(p["endings"])
    phrases = sum(len(p["traces"]) for p in pieces) or 1
    return {
        "pieces": len(pieces),
        "phrases": sum(len(p["traces"]) for p in pieces),
        "relationShare": {k: round(v / total, 3) for k, v in sorted(kinds.items())},
        "relatedShare": {k: round(v / related_total, 3) for k, v in sorted(related_kinds.items())},
        "relatedPerPhrase": round(related_total / max(1, sum(1 for p in pieces for t in p["traces"] if t["lengthBars"] == 1)), 3),
        "firstReturnShare": {k: round(v / max(1, sum(first_related.values())), 3) for k, v in sorted(first_related.items())},
        "firstReturnIsLiteral": ratio(literal_first),
        "transformKindsPerPhraseMedian": statistics.median(variety) if variety else 0,
        "transformKindsPerPhraseP75": sorted(variety)[int(len(variety) * .75)] if variety else 0,
        "relationByBarAfterStatement": {str(k): share(v) for k, v in sorted(by_position.items())},
        "changeAmountMedian": {k: round(statistics.median(v), 3) for k, v in distances.items() if v},
        "changeAmountP75": {k: round(sorted(v)[int(len(v) * .75)], 3) for k, v in distances.items() if len(v) >= 4},
        "headKeptShareOfRelated": ratio(head_kept),
        "motifReturnsInLastThreeBars": ratio(returns_late),
        "onlyLiteralRepetition": ratio(only_repeat),
        "migrationPerPhrase": {k: round(v / phrases, 3) for k, v in migration.items()},
        "migrationWhileMelodyThin": ratio(agg("migrationWhileMelodyRests")),
        "otherPartsMoveWhenMelodyHolds": ratio(agg("responseInRests")),
        "otherPartsMoveWhenMelodyMoves": ratio(agg("responseWhileMoving")),
        "allPartsMoveTogether": ratio(agg("allMoving")),
        "phraseEndNonTonic": round(endings["nonTonic"] / max(1, endings["total"]), 3),
        "phraseEndWeakBeat": round(endings["weakBeat"] / max(1, endings["total"]), 3),
        "coreNotesMedian": statistics.median([n for p in pieces for n in p["coreNotes"]]) if pieces else 0,
        "newPitchClassShareMedian": round(statistics.median([n for p in pieces for n in p["newPitchShare"]]), 3) if pieces else 0,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lieder", required=True)
    parser.add_argument("--quartets", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    groups = {
        "schumann": [(p, "lied") for p in glob.glob(os.path.join(args.lieder, "Schumann,_Robert", "**", "*.mxl"), recursive=True)]
        + [(p, "quartet") for p in glob.glob(os.path.join(args.quartets, "Schumann,_Robert", "**", "*.mxl"), recursive=True)],
        "brahms": [(p, "lied") for p in glob.glob(os.path.join(args.lieder, "Brahms,_Johannes", "**", "*.mxl"), recursive=True)]
        + [(p, "quartet") for p in glob.glob(os.path.join(args.quartets, "Brahms,_Johannes", "**", "*.mxl"), recursive=True)],
    }
    out = {"sources": {
        "OpenScore Lieder (CC0)": "https://github.com/OpenScore/Lieder",
        "OpenScore String Quartets (CC0)": "https://github.com/OpenScore/StringQuartets",
    }, "composers": {}}
    for composer, files in groups.items():
        files = sorted(files)[: args.limit or None]
        results = {"lied": [], "quartet": []}
        for path, kind in files:
            try:
                piece = analyze_piece(path, kind)
            except Exception as error:  # 壊れた楽譜は飛ばす
                print(f"skip {path}: {error}", file=sys.stderr)
                continue
            if piece:
                results[kind].append(piece)
            print(f"{composer} {kind} {os.path.basename(os.path.dirname(path))}", file=sys.stderr)
        out["composers"][composer] = {
            "all": summarize(results["lied"] + results["quartet"]),
            "lied": summarize(results["lied"]),
            "quartet": summarize(results["quartet"]),
        }
    with open(args.out, "w") as handle:
        json.dump(out, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
