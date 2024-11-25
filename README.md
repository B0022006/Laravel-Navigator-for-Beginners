# Laravel Navigator for Beginners

Laravel Navigator for Beginnersのプロトタイプです。
開発中のため一部機能に制限があります。

## 構文チェック機能
blade.phpファイルのチェックを行います。

### チェック対象
1. `@if`等、bladeディレクティブ
2. `<x-○○>`、`<from>`等、タグ
3. tailwind css

自作classはクイックフィックスの、ホワイトリストに追加を行うことで波線を消すことができます。

現在プロトタイプのため、必要以上に波線が表示される可能性があります。

## Laravelプロジェクトの「見える化」
LaravelプロジェクトをMermaidに変換してわかりやすく整理します。

コマンドから`transMermaid`を実行することで起動します。

各ノードをクリックすることでそのファイルに遷移することも可能です。