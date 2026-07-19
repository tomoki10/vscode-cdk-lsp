# CDK LSP 用の VS Code クライアント

[English version](./README.md)

AWS CDK Language Server (`cdk lsp`) を試して学ぶための最小構成の VS Code 拡張機能です。
`pnpm cdk lsp` を言語サーバーとして起動し、[`vscode-languageclient`](https://www.npmjs.com/package/vscode-languageclient) 経由で VS Code に接続します。

## 機能

- **CodeLens** — コンストラクトの行に `Creates AWS::S3::Bucket` などを表示。クリックすると `cdk.out` 内の合成済み CloudFormation テンプレートの該当リソースへジャンプします。1つのコンストラクトから複数リソースが生成される場合は QuickPick で選択できます。
- **診断 (Diagnostics)** — synth エラーやバリデーション結果をエディタの診断として表示します。
- **Synth 操作** — ファイル先頭の CodeLens から手動 synth の実行や auto-synth の切り替えができます。

## 前提条件

- VS Code 1.100 以上
- ワークスペースに CDK アプリがあり、`cdk lsp` に対応した `aws-cdk` がローカルインストールされていること（サーバーはワークスペースルートから `pnpm` で解決されます）

## ソースの構造

```md
.
├── examples
│   └── cdk-lsp-test # LSP を試すためのサンプル CDK アプリ
├── src
│   └── extension.ts # cdk lsp 用の VS Code Client 実装
...
```

`src/extension.ts` には LSP クライアントの仕組みを学べるよう、英語・日本語併記で詳しくコメントを付けています。

## 使い方

```sh
pnpm install
pnpm run compile
```

その後 VS Code で **F5**（"Run CDK LSP Client"）を押すと、`examples/cdk-lsp-test` を開いた拡張開発ホストが起動します。`lib/cdk-lsp-test-stack.ts` で CodeLens や診断を試せます。

サンプル CDK アプリの依存もインストールします。

```sh
cd examples/cdk-lsp-test
pnpm install   # または npm install
pnpm cdk synth # テンプレート生成が先に必要
pnpm cdk lsp
```

上記を実行すると、コード上部に起動オプションが出るので`▶︎ Enable auto-synth`で起動します。

![cdk-lsp-enable-synth](./images/cdk-lsp-enable-synth.png)

起動すると以下のように、CDKのソースがどんなCfnのリソースを生成するのか見れます。また表示を押下すると、Cfnテンプレートの実際の定義までジャンプできます。

![lsp-move](./images/lsp-move.gif)

またSynth実行時にエラーになるコードを早期発見できます。例えば、S3の`publicReadAccess: true`はSynth時にエラーになるので、それがVS Code上でも確認できます。

![lsp-move-error](./images/lsp-move-error.gif)
