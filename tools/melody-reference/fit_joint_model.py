"""
古典らしさの「組み合わせ」の物差し(同時分布)を作る。

melodyReference.calibration.test.ts が書き出した features.jsonl(古典の旋律ごとの10個の物差し)から、
物差しの組み合わせの分布をガウス混合モデルで表し、src/melody-engine/reference/classicalJointModel.json に書き出す。
1つずつの物差しでは「ふつう」でも、組み合わせとして古典にはまず無い旋律を見分けるためのもの。

  pip install scikit-learn numpy
  python3 tools/melody-reference/fit_joint_model.py reference-data/melody-corpus/features.jsonl src/melody-engine/reference/classicalJointModel.json

- 4つの群(コラール・歌曲・ロマン派〜近代のピアノ曲・古典派)は同じ重みになるよう、群ごとに同じ数を抜き出して学ぶ
- 曲ごとに5つに1つは学習に使わず(同じ曲の単位は同じ組)、その旋律の「分布の高さ」の並びで目盛りを付ける
  (学習に使っていない古典の旋律の真ん中 = 100)
"""
import json
import sys

import numpy as np
from sklearn.mixture import GaussianMixture

FEATURES = [
    "stepwise", "leapRate", "meanAbsInterval", "repeatedPitch", "leapRecovery",
    "top3Share", "directionChangeRate", "skeletonSmoothness", "strongBeatChordTone", "parallelPerfectRate",
]


def piece_hash(piece: str) -> int:
    value = 7
    for char in piece:
        value = (value * 31 + ord(char)) & 0xFFFFFFFF
    return value


def main():
    source, target = sys.argv[1], sys.argv[2]
    rows = [json.loads(line) for line in open(source) if line.strip()]
    rng = np.random.default_rng(0)
    groups = sorted({row["group"] for row in rows})
    holdout = [row for row in rows if piece_hash(row["piece"]) % 5 == 0]
    fit = [row for row in rows if piece_hash(row["piece"]) % 5 != 0]
    per_group = min(sum(1 for row in fit if row["group"] == group) for group in groups)
    sample = []
    for group in groups:
        members = [row for row in fit if row["group"] == group]
        chosen = rng.choice(len(members), size=per_group, replace=False)
        sample += [members[index] for index in chosen]
    X = np.array([[row["features"][name] for name in FEATURES] for row in sample], float)
    mean = X.mean(axis=0)
    scale = X.std(axis=0) + 1e-9
    Z = (X - mean) / scale
    best = None
    for components in (4, 6, 8, 10, 12, 16):
        model = GaussianMixture(n_components=components, covariance_type="full", reg_covar=1e-3, random_state=0, n_init=2).fit(Z)
        bic = model.bic(Z)
        if best is None or bic < best[0]:
            best = (bic, model)
    model = best[1]
    # 目盛り: 学習に使っていない古典の旋律の対数密度の分布(群ごとに同じ重み)
    holdout_scores = []
    weights = []
    for group in groups:
        members = [row for row in holdout if row["group"] == group]
        Zh = (np.array([[row["features"][name] for name in FEATURES] for row in members], float) - mean) / scale
        holdout_scores += list(model.score_samples(Zh))
        weights += [1.0 / len(members)] * len(members)
    order = np.argsort(holdout_scores)
    sorted_scores = np.array(holdout_scores)[order]
    cumulative = np.cumsum(np.array(weights)[order])
    cumulative /= cumulative[-1]
    quantiles = [float(np.interp(q, cumulative, sorted_scores)) for q in np.linspace(0, 1, 101)]
    out = {
        "features": FEATURES,
        "mean": mean.round(6).tolist(),
        "scale": scale.round(6).tolist(),
        "components": [
            {
                "weight": round(float(weight), 6),
                "mean": means.round(6).tolist(),
                # 精度行列のコレスキー因子(上三角)。対数密度の計算に使う
                "precisionCholesky": np.round(chol, 6).tolist(),
            }
            for weight, means, chol in zip(model.weights_, model.means_, model.precisions_cholesky_)
        ],
        "holdoutLogDensityQuantiles": [round(value, 5) for value in quantiles],
        "fit": {"perGroup": per_group, "groups": groups, "components": int(model.n_components)},
        "holdout": {"units": len(holdout)},
    }
    json.dump(out, open(target, "w"))
    print("components", model.n_components, "per group", per_group, "holdout", len(holdout), "median logdensity", quantiles[50])


if __name__ == "__main__":
    main()
