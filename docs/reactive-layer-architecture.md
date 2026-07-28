# Counter / Decoration共通基盤（Issue #42）

Reactive LayerはActive Melodyを直接変更せず、CounterとDecorationを独立候補・独立MIDIトラックとして管理する。

## 共通保護

- Active MelodyからGap、最高音、ロングトーン、跳躍着地点、非和声音解決を解析する。
- 同音、長時間短2度、Protected Moment、Voice Crossing、同時Attackを検出する。
- 意図的な`tension-hold`を除く非和声音は`plannedResolution`を持ち、指定Pitch Class・Beat・最大遅延内に実音の解決先が存在することを検証する。
- CounterとDecorationを同時採用するときは、両レイヤー間の同音・短2度とSection全体の総Note Densityを再評価する。
- Blocking Collision、未解決非和声音、総密度超過がある組み合わせはSet Activeしない。

## 独立性

- Counterは`targetMelodyVariantId`を持ち、Active Melody変更時にstaleとなる。
- Decorationは`structureFingerprint`を持ち、Section Role、前後Section、コード、長さが変わるとstaleとなる。
- CounterとDecorationは別々の採用枠を持つため同時利用できるが、採用前に共通Compatibility評価を通る。
- Favorite、Reject、再生成、Preview、MIDIはMelody Variantを上書きしない。

候補カードにはRole、対象Melody、使用音域、Note Density、Collision状態を表示する。

## 音楽的品質

- CounterはGap直前のActive Melodyから輪郭と音価を取り出し、反行する段階進行またはMotif変形として応答する。完全な休符だけでなく、通常音のAttack後に音域分離して展開できる低活動区間と、最高音ではないLong Tone後半をCounter Windowとして利用する。候補は最低3音・1拍以上の独立した旋律線とし、単音AccentはCounter候補として返さない。
- DecorationのRhythmは音価を等分せず、弱起、シンコペーション、余白を含む認識可能なRhythm Cellから作る。
- `rising`、`falling`、`sequence`、`repeated-sequence`はラベルだけでなく、実音でも隣接Scale Toneによる段階進行にする。
- 候補選抜ではOverall Quality、Melody Respect、Harmonic Fit、Collision Safetyの下限を維持する。多様性だけを理由に下限未満の候補を採用しない。

## 短縮試聴

Counter / Decoration候補の試聴は、最初の候補音の1拍前から始まり、最終音の0.5拍後に終了する。コードとActive Melodyも同じ範囲に切り詰めるため、音楽的な前後関係を残しながらSection終端まで待たずに比較できる。
