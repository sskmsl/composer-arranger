# Issue #220: mainの検証とPagesを一度にする

mainへのpushで、従来CIとPagesがそれぞれ行っていたnpm ci/build/testを、CIのcheck一度にまとめる。check成功後に同じrunのdistをupload-pages-artifact@v3で保存し、needs:checkのdeployから公開する。ビルド・テストコマンド、Node22、Actionバージョンは維持。手動Pages workflow_dispatchは従来の全検証つき経路を残す。

| イベント | 検証 | Pages artifact / deploy |
|---|---|---|
| pull_request（fork含む） | 従来どおりcheck | 条件式で両方skip |
| main push成功 | checkでci/build/testを一度 | 同runでupload、needs後deploy |
| main check失敗/キャンセル | その時点まで | 後続へ進まない |
| 手動Pages | 従来どおりci/test/build | 従来どおりupload/deploy |

CI workflow既定権限contents:read、deploy jobのみpages:write/id-token:write。github-pages environmentを維持。PR artifactを別runから取得するworkflow_run方式は使わない。main CIと手動Pagesは既存pages concurrency groupを共有し検証から直列化、PRはrun_idごとの別groupで相互キャンセルしない。従来同様pendingの置換はあり得るため、すべてのpushを順に公開する保証は追加していない。

## 検証と限界

公式actionlint1.7.12 Darwin arm64を公式releaseから取得、公式checksumsとSHA256照合。`actionlint -shellcheck='' .github/workflows/ci.yml .github/workflows/deploy-pages.yml`はexit0。結果・バイナリ照合記録を同-evidenceへ保存。アプリ/テストの変更はなし。

PRで実check成功とdeploy skipを確認する。実main pushからの公開はマージ後の検証が必要であり、未確認。手動公開は実行していない。CI構成の変更を理由にテストを省略していない。

公式資料: [custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。
