# 開発と検証

[READMEへ戻る](../README.md)

## 開発環境

- macOS 13以降
- Swift 6対応ツールチェーンとmacOS SDK
- Python 3
- Node.js 20以降
- 画面の検証時はPlaywrightと対応するChrome for Testing
- 休止・復帰の実ブラウザ検証時はNode.js 22以降とChrome for Testing

Macアプリと拡張本体に外部ライブラリのインストールは不要です。Playwrightはブラウザ検証にのみ使用します。

## ディレクトリ

```text
Sources/
  CMemoryProbe/       macOSのメモリ・プロセス統計
  MemoryCore/         集計・保護判定・Native Messaging検証
  MemoryHarbor/       MemoriqのUIと実行入口
Tests/                Swiftテスト
extension/            Manifest V3拡張とNode.jsテスト
scripts/              ビルド・インストール・実行検証
docs/                 利用者・開発者向け資料
```

## ビルド

リポジトリのルートから実行します。

```sh
python3 scripts/build-app.py
```

成果物は`dist/Memoriq.app`です。現在のMacのアーキテクチャ向けにビルドし、ad-hoc署名します。公証・Developer IDによる署名・Universal Binaryの生成は行いません。

ビルドは一時ディレクトリで実行します。完成したアプリバンドルの拡張属性を除去して署名を検証し、ソースや他のアプリの属性は変更しません。

```sh
python3 scripts/install.py
```

標準のインストール先は`~/Applications/Memoriq.app`です。スクリプトのオプションは`--help`で確認できます。Chromeへの拡張読み込みは[READMEの手順](../README.md#2-chrome拡張を読み込む)に従って別途行います。

## 最小のチェック

```sh
swift test --scratch-path /tmp/memoriq-tests
node --test extension/tests/*.test.mjs
python3 scripts/build-app.py
python3 scripts/test-native-host.py
python3 scripts/test-install.py
```

| チェック | 確認する振る舞い |
|:--|:--|
| Swift | アプリ集計、保護判定、メモリ圧迫の解釈、フレーム境界、許可された要求、実Macからの読み取り |
| Node.js | 初期状態、許可・除外判定、実行直前の状態変化、送信元の拒否、不正設定で操作しないこと、タイマー、連携失敗時の動作 |
| Native Messaging | パッケージ化した実行ファイルの計測、不正要求、不正送信元、切れたフレーム・過大フレームの拒否 |
| インストール | 一時フォルダへの導入と実計測、別アプリ・別ホストの上書き拒否、既存ファイルの保持 |

保護されたタブや許可されていない送信元については、成功件数だけでなく、破棄や設定書き込みが起きないことを確認します。

カバレッジが必要な場合は次を使用します。

```sh
swift test --enable-code-coverage --scratch-path /tmp/memoriq-coverage
node --experimental-test-coverage --test extension/tests/*.test.mjs
```

カバレッジの評価対象は測定コアと拡張ロジックです。SwiftUIの実画面、Chromeの実際の休止動作、対応OSすべての動作を、ユニットテストのカバレッジだけで証明するものではありません。

## 実ブラウザでの確認

両スクリプトとも専用の一時プロファイルを作り、通常のChromeの設定やタブを変更しません。実行前に`dist/Memoriq.app`をビルドしてください。別のアプリバンドルを指定する場合は`APP_PATH`を使います。

`scripts/browser-smoke.mjs`はPlaywrightで設定画面の保存、タブ一覧、Native Messagingの実往復、画面描画を確認します。既定ではタブを休止しません。

```sh
node scripts/browser-smoke.mjs
```

Playwrightを別の場所にインストールしている場合は`PLAYWRIGHT_MODULE`、Chrome for Testingの実行パスを指定する場合は`CHROMIUM_EXECUTABLE_PATH`を使用できます。

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chromium \
node scripts/browser-smoke.mjs
```

結果とスクリーンショットは`test-results/browser-smoke-ui/`へ出力します。

休止・復帰まで確認する場合は、Node.js 22以降で次を実行します。Node.js標準のWebSocketを使うため、こちらにはPlaywrightのインストールは不要です。

```sh
CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chrome-for-testing \
SMOKE_HEADED=1 \
node scripts/browser-discard-probe.mjs
```

この検証は次の一連の処理を確認します。

- 一時のlocalhostページを作り、休止対象にはデバッガーを接続しないことを確認
- 拡張の公開メッセージ経由で、localhost許可・5分・自動OFFを保存
- テスト中の拡張workerだけ時計を6分進め、選択中・固定タブが候補にならないことを確認
- popupに候補を描画し、実際の休止ボタンからcontrollerを通して実行
- Chromeの`discarded: true`を確認し、再選択で状態が戻り、HTTPリクエストが増えることを確認
- 実Native Messagingとアプリ全体のメモリ計測を確認

結果・画像・ブラウザログは`test-results/browser-discard-probe/`へ出力します。時計の変更は隔離したテストworker内だけで、アプリや拡張の配布コードは変更しません。実時間5分の経過による候補化と保護判定は先行検証で確認済みです。アプリ全体のメモリ差には他の処理や共有ページの変動が混ざるため、測定値をタブ1件の削減量として扱わないでください。

このMacではPlaywrightが対象ページにもCDP接続した状態で、Chrome for Testing 147/151の休止時にブラウザがSIGSEGVで終了しました。拡張ページとworkerだけにCDP接続する上記の方式では、Chrome for Testing 151.0.7922.34で休止・復帰が成功しています。起動条件も異なるため、デバッガー接続だけが原因とは断定していません。通常の検証には既定のUI確認と上記の休止・復帰確認を使い、Playwrightで対象に接続したまま破棄する方法は推奨しません。

Mac側は、ダッシュボードの表示、メニューバーからの再表示、終了確認のキャンセル、アプリ側の保存確認などを別途確認します。ユーザーが作業中のアプリを検証目的で終了しないでください。

### 一括整理・退避の検証

```sh
BULK_PROBE=1 BULK_ACTION=archive SMOKE_HEADED=1 \
CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chrome-for-testing \
node scripts/browser-discard-probe.mjs
```

`BULK_ACTION=archive`を省くと通常の一括休止を検証します。6枚の別サイトのローカルページへ各64 MiBを確保し、7枚目には入力途中のフォームを置きます。一時プロファイルだけでテスト用ドメインの名前解決とサイトアクセス権限を設定します。通常のプロファイルや配布するManifestに全サイトの必須権限を追加しません。

実UIから候補表示・選択・休止または退避を行い、入力の保持、実Native Messagingによる前後各5回の計測、復元を検証します。結果は`test-results/bulk-probe/`または`test-results/bulk-archive-probe/`です。測定対象のブラウザバンドルを共有する別テストとは同時実行しないでください。
