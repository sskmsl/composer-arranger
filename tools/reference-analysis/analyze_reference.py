"""参考曲(音声)から Reference Profile(数値だけ)を作る。

  python tools/reference-analysis/analyze_reference.py song.mp3 --label "参考A" > reference.json

目的は参考曲を模倣することではなく、「なぜ魅力的か」を一般化された特徴として取り出すこと。
- 解析の途中で耳コピ(basic-pitch)した音・推定したコードは、この関数の中だけで使い、出力には一切残さない。
- 出力は 0〜1 の特徴値と、8点の緊張の弧(形だけ)と、確からしさだけ。
- 旋律側の定義は src/melody-engine/referenceFit.ts と同じ物差しにそろえてある。

必要なもの: librosa, numpy, basic-pitch[onnx]
"""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import json
import sys
import uuid

import numpy as np


def clamp01(value: float) -> float:
    if not np.isfinite(value):
        return 0.5
    return float(max(0.0, min(1.0, value)))


# ---- referenceFit.ts と同じ物差し ---------------------------------------------------------
def note_density_scale(notes_per_beat: float) -> float:
    return clamp01((notes_per_beat - 0.25) / 2.75)


def rest_density_scale(rest_ratio: float) -> float:
    return clamp01(rest_ratio / 0.6)


def motif_length_scale(beats: float) -> float:
    return clamp01((beats - 1) / 7)


def interval_class(interval: int) -> int:
    """音程を(向き × 同音/順次/3度/4〜5度/それ以上)にまとめる。耳コピの細かな誤差で反復を見落とさないため"""
    size = abs(interval)
    step = 0 if size == 0 else 1 if size <= 2 else 2 if size <= 4 else 3 if size <= 7 else 4
    return step if interval >= 0 else -step


def melody_features(line: list[tuple[float, int, float]], total_beats: float) -> dict[str, float]:
    """line: (開始拍, 音高, 長さ拍)。referenceFit.measureMelodyReferenceFeatures と同じ定義"""
    beats = max(1.0, total_beats)
    if not line:
        return {"repetition": 0, "noteDensity": 0, "restDensity": 1, "rhythmicIdentity": 0, "registerExpansion": 0.5, "climaxTiming": 0.5}
    line = sorted(line)
    sounding = sum(max(0.0, min(d, (line[i + 1][0] if i + 1 < len(line) else beats) - s)) for i, (s, _, d) in enumerate(line))
    offbeat = sum(1 for s, _, _ in line if abs(s - round(s)) > 0.05) / len(line)
    gaps = {round((line[i + 1][0] - line[i][0]) * 4) / 4 for i in range(len(line) - 1)}
    gap_types = len({g for g in gaps if g > 0})
    rhythmic_identity = clamp01(offbeat / 0.6 * 0.6 + clamp01((gap_types - 1) / 4) * 0.4)
    intervals = [interval_class(line[i + 1][1] - line[i][1]) for i in range(len(line) - 1)]
    grams = [tuple(intervals[i:i + 3]) for i in range(len(intervals) - 2)]
    counts: dict[tuple, int] = {}
    for gram in grams:
        counts[gram] = counts.get(gram, 0) + 1
    repetition = clamp01(sum(1 for g in grams if counts[g] > 1) / len(grams)) if len(intervals) >= 4 else 0.0
    half = beats / 2
    first = [p for s, p, _ in line if s < half]
    second = [p for s, p, _ in line if s >= half]
    span = lambda part: (max(part) - min(part)) if part else 0
    peak = max(p for _, p, _ in line)
    peak_start = next(s for s, p, _ in line if p == peak)
    return {
        "repetition": repetition,
        "noteDensity": note_density_scale(len(line) / beats),
        "restDensity": rest_density_scale(1 - sounding / beats),
        "rhythmicIdentity": rhythmic_identity,
        "registerExpansion": clamp01(0.5 + (span(second) - span(first)) / 12),
        "climaxTiming": clamp01(peak_start / beats),
    }


# ---- 音声の解析 -------------------------------------------------------------------------
CHORD_TEMPLATES = {
    "maj": [0, 4, 7], "min": [0, 3, 7], "sus4": [0, 5, 7], "7": [0, 4, 7, 10], "m7": [0, 3, 7, 10],
}


def beat_chroma_chords(chroma: np.ndarray) -> list[tuple[int, str]]:
    """拍ごとのクロマから(根音, 種類)を推定する。出力には残さず、変化の頻度・種類の割合だけに使う"""
    chords = []
    for column in chroma.T:
        best, best_score = (0, "maj"), -1.0
        for root in range(12):
            for kind, tones in CHORD_TEMPLATES.items():
                mask = np.zeros(12)
                mask[[(root + t) % 12 for t in tones]] = 1
                # 付加音・sus は三和音より少し不利にして、はっきり鳴っているときだけ選ぶ
                penalty = 0.08 if len(tones) == 4 else 0.04 if kind == "sus4" else 0.0
                score = float(column @ mask) / len(tones) - float(column @ (1 - mask)) / (12 - len(tones)) - penalty
                if score > best_score:
                    best, best_score = (root, kind), score
        chords.append(best)
    return chords


def skyline(notes: list[tuple[float, float, int, float]], beat_of, total_beats: float) -> list[tuple[float, int, float]]:
    """16分グリッドごとに最も高い音(55以上)をつないだ上声。解析の中だけで使う"""
    grid = int(np.ceil(total_beats * 4))
    top = [-1] * grid
    for start, end, pitch, _ in notes:
        if pitch < 55:
            continue
        a, b = int(round(beat_of(start) * 4)), int(round(beat_of(end) * 4))
        for index in range(max(0, a), min(grid, max(a + 1, b))):
            top[index] = max(top[index], pitch)
    line, index = [], 0
    while index < grid:
        if top[index] < 0:
            index += 1
            continue
        start, pitch = index, top[index]
        while index < grid and top[index] == pitch:
            index += 1
        line.append((start / 4, pitch, (index - start) / 4))
    return line


def motif_length_beats(line: list[tuple[float, int, float]], total_beats: float) -> float:
    """上声が何拍ごとに似た形で戻ってくるか(自己相関)。最も短いはっきりした周期を動機の長さとみなす"""
    grid = int(np.ceil(total_beats * 4))
    onsets = np.zeros(grid)
    contour = np.zeros(grid)
    for start, pitch, _ in line:
        index = int(round(start * 4))
        if index < grid:
            onsets[index] = 1
            contour[index] = pitch
    scores = {}
    for lag_beats in (1, 2, 3, 4, 6, 8):
        lag = lag_beats * 4
        both = (onsets[:-lag] > 0) & (onsets[lag:] > 0)
        if both.sum() < 8:
            continue
        rhythm = both.sum() / max(1, onsets[:-lag].sum())
        same = (np.diff(contour[:-lag][both]) == np.diff(contour[lag:][both])).mean() if both.sum() > 1 else 0
        scores[lag_beats] = rhythm * 0.6 + same * 0.4
    if not scores:
        return 4.0
    best = max(scores.values())
    return float(min(lag for lag, score in scores.items() if score >= best * 0.9))


def analyze(path: str, label: str) -> dict:
    import librosa
    from basic_pitch.inference import predict

    stereo, sr = librosa.load(path, sr=22050, mono=False)
    stereo = stereo if stereo.ndim == 2 else np.vstack([stereo, stereo])
    mono = stereo.mean(axis=0)
    duration = len(mono) / sr
    tempo, beat_frames = librosa.beat.beat_track(y=mono, sr=sr)
    tempo = float(np.atleast_1d(tempo)[0])
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    seconds_per_beat = 60.0 / tempo
    beat_of = lambda seconds: seconds / seconds_per_beat
    total_beats = duration / seconds_per_beat

    # 耳コピ(この関数の外へは出さない)
    with contextlib.redirect_stdout(sys.stderr):
        _, _, events = predict(path)
    notes = [(float(s), float(e), int(p), float(a)) for s, e, p, a, *_ in events]

    # 旋律: 8小節ごとに測って中央値。頂点の位置と音域の広がりは曲全体で測る
    line = skyline(notes, beat_of, total_beats)
    window = 32.0
    windows = []
    for start in np.arange(0, total_beats - window / 2, window):
        part = [(s - start, p, d) for s, p, d in line if start <= s < start + window]
        if len(part) >= 6:
            windows.append(melody_features(part, window))
    whole = melody_features(line, total_beats)
    melody = {key: float(np.median([w[key] for w in windows])) if windows else whole[key] for key in whole}
    melody["registerExpansion"] = whole["registerExpansion"]
    # 頂点: 耳コピの外れ値に引っぱられないよう、4小節ごとの上声の高い側(90%点)が最も高い区間
    blocks = []
    for start in np.arange(0, total_beats, 16.0):
        pitches = [p for s, p, _ in line if start <= s < start + 16]
        if len(pitches) >= 4:
            blocks.append((float(np.percentile(pitches, 90)), start + 8))
    if blocks:
        top = max(v for v, _ in blocks)
        melody["climaxTiming"] = clamp01(next(c for v, c in blocks if v == top) / total_beats)
    else:
        melody["climaxTiming"] = whole["climaxTiming"]
    melody["motifLength"] = motif_length_scale(motif_length_beats(line, total_beats))

    # 和声: 拍ごとのクロマ → 変化の頻度・緊張・解決・旋法的な行き来の割合(コード名は残さない)
    chroma = librosa.feature.chroma_cqt(y=mono, sr=sr)
    # 拍単位だと経過音に引っぱられるので、半小節(2拍)ごとにまとめてから推定する
    half_bar_frames = beat_frames[::2]
    beat_chroma = librosa.util.sync(chroma, half_bar_frames, aggregate=np.mean)
    beat_chroma = beat_chroma / (beat_chroma.max(axis=0, keepdims=True) + 1e-9)
    raw = beat_chroma_chords(beat_chroma)
    # 前後と比べて一瞬だけ違うものは経過音とみなしてならす
    chords = [raw[i] if 0 < i < len(raw) - 1 and raw[i - 1] != raw[i + 1] or i in (0, len(raw) - 1) else raw[i - 1]
              for i in range(len(raw))]
    changes = [(a, b) for a, b in zip(chords, chords[1:]) if a != b]
    bars = max(1.0, len(chords) / 2)
    root_moves = [(b[0] - a[0]) % 12 for a, b in changes if a[0] != b[0]]
    harmony = {
        # 2小節に1回で0、1小節に2回で1
        "harmonicRhythm": clamp01((len(changes) / bars - 0.5) / 1.5),
        "tension": clamp01(sum(1 for _, kind in chords if kind in ("sus4", "7", "m7")) / max(1, len(chords)) / 0.5),
        "resolutionStrength": clamp01(sum(1 for m in root_moves if m == 5) / max(1, len(root_moves)) / 0.5),
        "modalTendency": clamp01(
            (sum(1 for m in root_moves if m in (2, 10)) / max(1, len(root_moves))) * 1.2
            + sum(1 for _, kind in chords if kind == "sus4") / max(1, len(chords)) * 0.6
        ),
    }
    # ベース: 拍ごとの最低音が変わる割合と、1拍あたりの打鍵数
    low = [(beat_of(s), p) for s, _, p, _ in notes if p < 52]
    per_beat: dict[int, list[int]] = {}
    for beat, pitch in low:
        per_beat.setdefault(int(beat), []).append(pitch)
    lows = [min(per_beat[b]) for b in sorted(per_beat)]
    bass_changes = sum(1 for a, b in zip(lows, lows[1:]) if a != b) / max(1, len(lows) - 1)
    bass_rate = len(low) / max(1.0, total_beats)
    harmony["bassMovement"] = clamp01(bass_changes * 0.6 + clamp01(bass_rate / 2) * 0.4)

    # リズム: 打点の密度・拍の裏の割合・1小節周期のはっきりさ
    onset_env = librosa.onset.onset_strength(y=mono, sr=sr)
    onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr)
    onset_beats = beat_of(librosa.frames_to_time(onset_frames, sr=sr))
    offbeat = np.mean(np.abs(onset_beats - np.round(onset_beats)) > 0.15) if len(onset_beats) else 0
    frames_per_beat = seconds_per_beat * sr / 512
    ac = librosa.autocorrelate(onset_env - onset_env.mean())
    bar_lag = int(round(frames_per_beat * 4))
    # 拍・2拍・1小節の周期での自己相関の平均(周期がはっきりしているほど高い)
    lags = [int(round(frames_per_beat * k)) for k in (1, 2, 4)]
    groove = float(np.mean([ac[lag] for lag in lags if lag < len(ac)])) / (ac[0] + 1e-9) if bar_lag < len(ac) else 0
    rhythm = {
        "density": clamp01((len(onset_beats) / max(1.0, total_beats) - 0.5) / 3.5),
        "syncopation": clamp01(offbeat / 0.8),
        "grooveTendency": clamp01(groove / 0.4),
    }

    # アレンジ: 前景の密度・後景の持続・フレーズの頻度・セクションの対比・音域の重心
    long_time = sum(e - s for s, e, p, _ in notes if (e - s) >= seconds_per_beat and p < 72)
    all_time = sum(e - s for s, e, _, _ in notes) or 1.0
    phrase_starts = sum(1 for a, b in zip(line, line[1:]) if b[0] - (a[0] + a[2]) >= 1.0)
    rms = librosa.feature.rms(y=mono)[0]
    rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr)
    window_seconds = 8 * 4 * seconds_per_beat
    window_rms = [float(rms[(rms_times >= t) & (rms_times < t + window_seconds)].mean())
                  for t in np.arange(0, duration - window_seconds / 2, window_seconds)]
    contrast = np.std(window_rms) / (np.mean(window_rms) + 1e-9) if window_rms else 0
    mean_pitch = np.average([p for _, _, p, _ in notes], weights=[e - s for s, e, _, _ in notes]) if notes else 60
    arrangement = {
        "foregroundDensity": melody["noteDensity"],
        "backgroundSustain": clamp01(long_time / all_time / 0.5),
        "phraseFrequency": clamp01(phrase_starts / max(1.0, total_beats / 32) / 6),
        "sectionContrast": clamp01(contrast / 0.6),
        "registerBalance": clamp01((mean_pitch - 45) / 36),
    }

    # 音像: 奥行き・余韻・立ち上がり・広がり・明るさ・密度
    centroid = float(np.median(librosa.feature.spectral_centroid(y=mono, sr=sr)))
    mid = (stereo[0] + stereo[1]) / 2
    side = (stereo[0] - stereo[1]) / 2
    side_ratio = float(np.sqrt(np.mean(side ** 2)) / (np.sqrt(np.mean(mid ** 2)) + 1e-9))
    flux_peak = float(np.percentile(onset_env, 95) / (np.median(onset_env) + 1e-9))
    # 余韻: 打点の後、音量が半分まで落ちるまでの時間(拍)
    decays = []
    for frame in onset_frames:
        peak = rms[frame]
        after = np.where(rms[frame:frame + int(frames_per_beat * 4)] < peak * 0.5)[0]
        decays.append((after[0] if len(after) else frames_per_beat * 4) / frames_per_beat)
    decay_beats = float(np.median(decays)) if decays else 1.0
    key_profile_major = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    key_profile_minor = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    total_chroma = chroma.mean(axis=1)
    major = max(np.corrcoef(np.roll(key_profile_major, k), total_chroma)[0, 1] for k in range(12))
    minor = max(np.corrcoef(np.roll(key_profile_minor, k), total_chroma)[0, 1] for k in range(12))
    polyphony = []
    for t in np.arange(0, duration, seconds_per_beat):
        polyphony.append(sum(1 for s, e, _, _ in notes if s <= t < e))
    aesthetic = {
        "depth": clamp01((decay_beats - 0.25) / 1.75 * 0.6 + clamp01(side_ratio / 0.5) * 0.4),
        "decay": clamp01((decay_beats - 0.25) / 1.75),
        "transientSoftness": clamp01(1 - (flux_peak - 2) / 6),
        "stereoDiffusion": clamp01(side_ratio / 0.7),
        "darkLuminousBalance": clamp01((centroid - 1000) / 3000 * 0.6 + (0.5 + (major - minor) * 2) * 0.4),
        "textureDensity": clamp01(float(np.mean(polyphony)) / 6),
    }

    # 感情の弧: 8区間の音量(形だけ、0〜1に正規化)
    segments = np.array_split(rms, 8)
    curve = np.array([float(np.mean(s)) for s in segments])
    curve = (curve - curve.min()) / (curve.max() - curve.min() + 1e-9)
    smooth = np.convolve(rms, np.ones(200) / 200, mode="same")
    climax_index = int(np.argmax(smooth))
    climax = climax_index / max(1, len(smooth) - 1)
    peak = smooth[climax_index]
    before = smooth[:climax_index] if climax_index > 0 else smooth[:1]
    after = smooth[climax_index:]
    tail = after[after < peak * 0.4]
    emotion = {
        "restraint": clamp01(1 - float(np.mean(before)) / (peak + 1e-9)),
        "tensionCurve": [clamp01(v) for v in curve],
        "climaxTiming": clamp01(climax),
        "release": clamp01((peak - float(np.mean(after))) / (peak + 1e-9) / 0.6),
        "afterglow": clamp01(len(tail) * 512 / sr / 20),
    }

    return {
        "version": 1,
        "id": f"ref-{uuid.uuid4().hex[:10]}",
        "label": label,
        "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": {"kind": "audio", "durationSeconds": round(duration, 1), "tempoBpm": round(tempo, 1)},
        "melody": {k: round(v, 3) for k, v in melody.items()},
        "harmony": {k: round(v, 3) for k, v in harmony.items()},
        "rhythm": {k: round(v, 3) for k, v in rhythm.items()},
        "arrangement": {k: round(v, 3) for k, v in arrangement.items()},
        "aesthetic": {k: round(v, 3) for k, v in aesthetic.items()},
        "emotion": {k: ([round(x, 3) for x in v] if isinstance(v, list) else round(v, 3)) for k, v in emotion.items()},
        # 混ざった音からの耳コピ・コード推定は外れやすいので、旋律・和声・ベースは控えめに効かせる
        "confidence": {
            "melody": 0.6, "harmony": 0.6, "bass": 0.6, "rhythm": 0.85,
            "arrangement": 0.7, "aesthetic": 0.75, "emotionalArc": 0.85,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("audio")
    parser.add_argument("--label", default="参考曲")
    args = parser.parse_args()
    json.dump(analyze(args.audio, args.label), sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
