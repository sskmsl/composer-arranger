# 参考曲の特徴ファイル(Reference Profile)を作る

```
python tools/reference-analysis/analyze_reference.py song.mp3 --label "参考A" > reference.json
```

作った `reference.json` を、旋律画面の「こだわり設定 → 参考曲の特徴を読み込む」から読み込みます。

- 出力は 0〜1 の特徴値・8点の緊張の弧(形だけ)・確からしさだけです。
- 解析の途中で耳コピした音や推定したコードは、出力に残しません(アプリ側も音列・コードを含むファイルは受け付けません)。
- 旋律の物差しは `src/melody-engine/referenceFit.ts` と同じ定義です。
- 必要なもの: `librosa`, `numpy`, `basic-pitch[onnx]`
