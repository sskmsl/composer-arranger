# Composer Song Exchange 契約見本

`composer-song-exchange.v2.example.json` は、Chord Generator → Composer Arranger の受け渡し形式
(`format: "composer-os/song-exchange"`)の見本です。**両リポジトリに同じ内容で置きます。**

| リポジトリ | テスト | 確かめること |
|---|---|---|
| composer-os-chord-generator | `src/features/exchange/__tests__/composerSongExchange.contract.test.ts` | 固定の入力を書き出した結果が、この見本と完全に一致する |
| composer-arranger | `src/core/composerSongExchange.contract.test.ts` | この見本を読み込み、曲情報・セクション・転調・コードの拍位置を正しく引き継ぐ |

## 形式を変えるときの手順

1. Chord Generator の書き出し処理を変える(Generator 側の契約テストが落ちる)
2. Generator で見本を作り直す(`contractFixture.ts` の入力を `buildComposerSongExchange` に通して書き出す)
3. 同じファイルを Arranger の `contracts/` にコピーし、Arranger 側の読み込みを対応させてテストを通す
4. 形式に互換性のない変更をするときは `version` を上げ、Arranger を先に公開する

## 形式の要点(version 2)

- 拍子は 4/4。コードの位置と長さは `startBeat` / `durationBeats`(拍)。1小節に2コード入ることがある
- 各セクションの合計拍数は4の倍数(小節単位)
- `sections[].key` はセクションごとの調。曲の途中で転調する場合は値が変わる
- `sourceIntent.style` は Chord Generator のスタイルID(例: `kayokyoku`, `frenchPop`)
