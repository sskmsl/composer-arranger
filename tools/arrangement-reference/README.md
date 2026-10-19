# アレンジの感情の仕組みの参照解析

参照録音(個人の制作物)から、小節ごとの強さの曲線を取り出し、感情を動かす仕組みが観察できた本数を数える。
結果は `src/melody-engine/reference/arrangementEmotionPrinciples.json` に、本数と中央値だけを残す。
音源・小節ごとの曲線・曲名はGitに入れない。

```sh
# 録音を 22.05kHz のステレオWAV (st4.wav ...) に変換しておく。
ffmpeg -i recording.mp3 -ar 22050 st4.wav

python3 extract_bar_features.py 4 5 6 7 8     # → feats.json(小節ごとの帯域強度・RMS・キック/高域の発音数・広がり)
python3 count_mechanism_evidence.py            # → evidence.json(手段ごとの観察本数)
python3 export_emotion_curves.py               # → curves.json(src/melody-engine/arrangementEmotion.ts の入力)
```

`curves.json` を `measureEmotionFromCurves` へ渡すと、録音も生成物と同じ採点関数で採点できる。
依存は numpy のみ。テンポと小節の格子は信号から推定した値で、楽器の判別やコードの推定はしない。
