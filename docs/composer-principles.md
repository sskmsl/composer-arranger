# 5人の作曲家から取り出した原理と、既存ロジックへの組み込み

目的は作曲家の模倣ではなく、短く覚えやすい Hook を、魅力を失わずに 8〜16 小節の曲へ育てることです。
新しい Generator やプリセットは作っていません。既存の Hook-first・Emotional Arc・候補評価・Arrangement 判断・Aesthetic Context の重みと判断だけを動かします。
最後は必ず Boutonnat 的なフィルタを通します：メロディ優先、短い動機、反復、余白、足すより削る。

## 役割の整理

| 作曲家 | 役割 | どこに入れたか |
|---|---|---|
| Janáček | 核の棘（1か所だけ耳に残る所） | 発展フレーズで1か所だけ音程を広げる（`developHook`）。核の棘の数は `hookFirst.judgeThorn` で測って記録する。核の選抜に使うと、覚えやすさと部分的な作り直しやすさが下がったため、選抜には使っていない |
| Schumann | 小さな反復と小変形 | `hookPhraseRole` の answer（頭を保ち語尾だけ変える）と、`restoreHookHeads`（仕上げで動いた頭を戻す。頂点のフレーズとその直前には触れず、頂点の高さも超えない） |
| Brahms | 動機を保った発展 | develop（リズムと輪郭を保ち、1か所の音程だけ広げる）。8 小節で使う |
| Sibelius | 時間（小さな素材を長い弧へ） | rise / climax（同じ核を一段ずつ高い位置で再提示し、音数を増やさずに景色を広げる）。頂点はセクションの感情の目標位置に置く。16 小節以上で使い、`measureGradualGrowth` で評価する |
| Delius | 空間（和声・持続・距離） | 伴奏パッドと低音の判断：`harmonicHaze`（付加音の色・半音の声部・共通音の保持・静かな Verse の保続低音） |

Brahms と Sibelius の重なりは、時間の尺度で分けました。

- Brahms：フレーズ単位の変形。リズムを保ったまま音程だけを変える。
- Sibelius：セクション単位の時間設計。同じ核を一段ずつ高く再提示し、頂点へ向かう。

頭の断片化（Sibelius の「断片化と再結合」）も試しました。ただ、音数が増えて余白と頂点の時機が悪化したため、Boutonnat の基準で採用していません。

1セクションで使う変形は2種類までです。分析した Schumann と Brahms は、どちらも8小節で使う変形の種類の中央値が2でした。

## 分析に使った資料と権利

`src/melody-engine/reference/composerPrinciples.json` に、割合と中央値だけを残しています。旋律・音型・伴奏型・和音の並びは残していません。

使った資料は次のとおりです。

- [OpenScore Lieder](https://github.com/OpenScore/Lieder)（CC0）
  - Schumann 歌曲 72曲
  - Brahms 歌曲 111曲
  - Delius 歌曲 6曲
- [OpenScore String Quartets](https://github.com/OpenScore/StringQuartets)（CC0）
  - Schumann Op.41 全3曲
  - Brahms Op.51-1、Op.51-2、Op.67
  - Janáček 第1番・第2番
  - Delius ホ短調

権利は次のように判断しました。

- 転写はいずれも CC0 です。
- 作品は、Schumann（1856年没）・Brahms（1897年没）・Delius（1934年没）が日本・EU・米国でパブリックドメインです。
- Janáček（1928年没）は日本・EU でパブリックドメインです。ただし弦楽四重奏曲第2番は1938年出版のため、米国では保護期間中の可能性があります。
- Sibelius は、権利が明確な機械可読の楽譜を取得できませんでした。
  - 確認したのは OpenScore、Mutopia（GitHub ミラー）、When-in-Rome、PDMX です。IMSLP と Zenodo はこの環境から接続できませんでした。
  - そのため統計は無く、原理（断片化・再提示・段階的な音域の拡大）は研究書で一般的な記述に基づいています。数値は生成結果で調整しました。

分析スクリプト：

- `tools/melody-reference/analyze_motif_development.py`：動機の再登場の種類
- `tools/melody-reference/analyze_composer_traits.py`：旋律セルの特徴と、和声・空間の特徴

## 分析結果（抜粋）

- 再登場の種類：関係のある再登場のうちの割合。
  - Schumann：語尾だけ変える 25%、リズムを保つ 27%、1音を抜く 11%、ゼクエンツ 12%。
  - Brahms：リズムを保つ 42%、語尾だけ変える 24%。
  - 字義どおりの反復だけのフレーズは、両者とも 6〜8% しかありません。
- 動機が低音へ移る頻度：フレーズあたり Schumann 0.30 回、Brahms 0.35 回。
  - そのうち約6割は、主旋律が薄い所で起きていました。
- Janáček の旋律：Schumann / Brahms（室内楽）と比べました。
  - 割り切れない音価：33%（他は 0.3〜10%）
  - 急な跳躍：15%（他は 11〜14%）
  - 休符：22%（他は 13〜14%）
  - アクセント：3.8%（他は 0.7〜2.2%）
- Delius の響き：
  - 付加音・7度：82%（他は 50〜55%）
  - 4度・5度の根音進行：25%（他は 34〜37%）
  - 長い持続：40%（他は 20〜31%）
  - 同じ最低音が2小節以上続く時間：11%。Janáček も同じく11%で、Schumann / Brahms の3〜5倍です。

## 検証

`developmentPrinciples.comparison.test.ts`（主旋律）と `arrangementPrinciples.comparison.test.ts`（アレンジ）で、同じコード・テンポ・セクション・seed の変更前後を比べています。
