# Generator Profile Rules

Generator Profileは曲全体の感情方向を決めるSong Profileや、セクションの機能を決めるSection Roleとは別の軸です。  
同じコード・Section・Song Profileでも、旋律を組み立てる順序と、候補選抜で守る音楽的性格を切り替えます。

実行時の正本は `src/melody-engine/generatorProfile.ts` の `GENERATOR_PROFILE_RULES` です。

| Profile | 設計優先 | 主な音程・音域 | 主なリズム・休符 | 終止 |
| --- | --- | --- | --- | --- |
| Standard | Pitch-led | コードトーン主体、中央音域、歌唱的な順次進行 | balanced、強弱拍を明確にする | Sectionの緊張度に従う |
| Minimal | Cycle-led | 狭い音域、共通音、低い跳躍率 | 長音と多い余白 | open / suspendedを許可 |
| Leaping | Pitch-led | 構造跳躍と反行回収、広い輪郭 | 跳躍を知覚できる間隔 | 終止前は歌唱的接続へ戻す |
| Rhythmic | Rhythm-led | 反復音・小さな音程セル | 弱起、裏拍、拍またぎ | rhythmic peak / carry-forward |
| Chromatic | Target-tone-led | 倚音、半音接近、掛留と解決先 | 準備と解決が聞こえる音価 | 意味のある未解決だけを許可 |
| Cinematic | Pitch-led | 低〜中音域から長期的に展開 | 長音、頂点前の構造的な間 | open / carry-forwardを許可 |
| Elegiac Cantabile | Target-tone-led | Motif変形と2〜4小節単位のtarget tone | ためらい、弱起、breath | 4種類のEndingを候補間で分ける |
| Speech-Rhythmic | Rhythm-led | 狭い音域、同音反復 | Accent Map、不均等Phrase、句読点の間 | 発話の継続感を残す |
| Incantatory | Cycle-led | 2〜5音の核と限定的変異 | 反復周期とアクセント周期 | 反復可能性を残す |

## 共通処理との境界

- Opening Intent / Opening PlanはProfile固有候補から選ぶ。
- Candidate DNAは同一Profile内の3案を分けるが、Profileの中核値を逆転させない。
- planned resolutionを持つ非和声音は、共通の和声補正でコードトーン化しない。
- 候補選抜は最低品質を維持したうえで、Profile適合度を`selectionFitWeight`の範囲だけ反映する。
- Profile固有の専用生成器またはExpression Planで作ったMotif、Accent、Climax、Endingを、共通補正で単一型へ戻さない。

## 回帰方針

固定seedを複数回集計し、Profileの性格を単一候補の偶然ではなく分布として検証します。  
各Profileは`identityComparison`で、最も混同しやすい参照Profileに対して、音域・跳躍・休符・シンコペーション・テンション・反復などの主特徴が優位になる必要があります。
