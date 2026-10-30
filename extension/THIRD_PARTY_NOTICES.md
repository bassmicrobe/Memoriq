# Third-party notices

Memoriq本体はMIT Licenseです。全文は同梱の[LICENSE](LICENSE)を参照してください。

## コードを取り込んだOSS

### Drowzy

- プロジェクト: https://github.com/ml3dev/drowzy
- 参照コミット: e76a5e230478253d8418a320b4f7c40b14b90ac8
- 元のファイル: https://github.com/ml3dev/drowzy/blob/e76a5e230478253d8418a320b4f7c40b14b90ac8/formcheck.js
- 著作権表示: Copyright (c) 2026 ml3dev
- ライセンス: MIT
- ライセンス全文: [vendor/drowzy-LICENSE.txt](vendor/drowzy-LICENSE.txt)
- 元のライセンス: https://github.com/ml3dev/drowzy/blob/e76a5e230478253d8418a320b4f7c40b14b90ac8/LICENSE
- Memoriqでの利用: フォームの現在値・初期値とチェック状態の比較を改変し、[page-safety.mjs](page-safety.mjs)に取り込みました。選択肢・ファイル入力・メディア・フレーム数の検査と、確認不能時に保護する処理を追加しています。

元の著作権表示とMITライセンス全文を保持し、Chrome拡張とMacアプリの配布物に同梱します。

## 方式を参考にしたOSS

以下のプロジェクトからソースコードや配布物は取り込んでいません。参考にした範囲と元のライセンスを記録しています。

| プロジェクト | 元のライセンス | 参考にした範囲 |
|:--|:--|:--|
| [Auto Tab Discard](https://github.com/rNeomy/auto-tab-discard/tree/e5cf6124180425d99e40e24828d10169d0d13f59) | [MPL-2.0](https://github.com/rNeomy/auto-tab-discard/blob/e5cf6124180425d99e40e24828d10169d0d13f59/LICENSE) | Chrome標準のタブ休止APIと未使用タブの選別方式 |
| [Tab Stash](https://github.com/josh-berry/tab-stash) | [MPL-2.0](https://github.com/josh-berry/tab-stash/blob/master/LICENSE) | タブを保存して閉じ、必要なページを選んで戻す構成 |

Memoriqの退避・復元はローカルストレージを使った独自実装です。Boostは調査のみで、コード・配布物・メモリ圧迫やプロセス停止の方式を採用していません。

## 開発・実行環境

MacアプリはAppleのシステムフレームワークとSwift標準ライブラリ、拡張はChrome標準APIを使用します。Swift Packageの外部依存や、拡張に組み込むnpm依存はありません。実ブラウザ試験で使うPlaywrightとChrome for Testingは開発用で、Memoriqの配布物には同梱しません。
