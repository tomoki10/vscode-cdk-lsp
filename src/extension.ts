import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

/**
 * This extension is a minimal VS Code client for the CDK LSP (`cdk lsp`).
 * This code is intended for learning cdk lsp, so both English and Japanese are provided.
 * この拡張機能は CDK LSP (`cdk lsp`) を VS Code から使うための最小構成のクライアントです。
 * cdk lsp 学習用のコードのため英語と日本語を併記しています
 *
 * LSP (Language Server Protocol) is a protocol where an editor (client) and a
 * language server talk to each other over JSON-RPC. In this extension the
 * `vscode-languageclient` library handles the whole protocol layer, so the
 * client only has three jobs:
 *   1. Tell VS Code how to start the server (ServerOptions)
 *   2. Tell it which documents to target (LanguageClientOptions)
 *   3. Implement the editor operations (commands) the server asks for
 *
 * LSP (Language Server Protocol) はエディタ (クライアント) と言語サーバーが
 * JSON-RPC でやり取りするプロトコルで、この拡張機能では
 * `vscode-languageclient` ライブラリがプロトコル部分を全て肩代わりしてくれます。
 * そのためクライアント側の仕事は、
 *   1. サーバーの起動方法 (ServerOptions) を教える
 *   2. どのドキュメントを対象にするか (LanguageClientOptions) を教える
 *   3. サーバーが要求するエディタ操作 (コマンド) を実装する
 * の3つだけです。
 */

// The single LSP client instance for the whole extension, kept so deactivate() can stop it.
// 拡張機能全体で1つだけ保持する LSP クライアント。deactivate 時の停止用に持っておく。
let client: LanguageClient | undefined;

// Called by VS Code when the extension is activated (when a TypeScript / Python
// file is opened, as declared in activationEvents in package.json).
// 拡張機能の有効化時 (package.json の activationEvents で指定した
// TypeScript / Python ファイルを開いたとき) に VS Code から呼ばれる。
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  // The CDK LSP expects to run inside a CDK app directory,
  // so do nothing when no workspace is open.
  // CDK LSP は CDK アプリのディレクトリを前提に動くため、
  // ワークスペースを開いていない場合は何もしない。
  if (!workspaceFolder) {
    return;
  }

  // --- 1. How to start the server / サーバーの起動方法 ---
  // Launch `npx cdk lsp` as a child process for the LSP server.
  // transport: stdio exchanges JSON-RPC messages over standard input/output,
  // which is the most common LSP transport.
  // LSP サーバーとして `npx cdk lsp` を子プロセスで起動する。
  // transport: stdio は、標準入出力を通じて JSON-RPC メッセージを
  // やり取りする最も一般的な LSP の通信方式。
  const serverOptions: ServerOptions = {
    command: 'npx',
    args: ['cdk', 'lsp'],
    options: {
      // Use the workspace root as the working directory so that npx can
      // resolve the locally installed aws-cdk (and cdk.json).
      // npx がワークスペース直下の aws-cdk (と cdk.json) を解決できるよう、
      // カレントディレクトリをワークスペースルートにする。
      cwd: workspaceFolder.uri.fsPath,
    },
    transport: TransportKind.stdio,
  };

  // --- 2. Client configuration / クライアントの設定 ---
  const clientOptions: LanguageClientOptions = {
    // Which languages should be reported to the server when opened.
    // CDK apps are written in TypeScript / Python, so target those two.
    // どの言語のファイルを開いたときにサーバーへ通知するか。
    // CDK アプリは TypeScript / Python で書かれるため、この2つを対象にする。
    documentSelector: [
      {
        scheme: 'file',
        language: 'typescript',
      },
      {
        scheme: 'file',
        language: 'python',
      },
    ],
    // Custom options sent to the server in the initialize request.
    // The CDK LSP synthesizes the directory received here as a CDK app.
    // initialize リクエストでサーバーへ渡す独自オプション。
    // CDK LSP はここで受け取ったディレクトリを CDK アプリとして synth する。
    initializationOptions: {
      applicationDir: workspaceFolder.uri.fsPath,
    },
  };

  client = new LanguageClient('cdkLsp', 'CDK Language Server', serverOptions, clientOptions);

  // --- 3. Commands requested by the server / サーバーが要求するコマンドの実装 ---
  // The CDK LSP shows a CodeLens on construct lines (e.g. "Creates AWS::SQS::Queue")
  // whose command is `cdkExplorer.openResource`. Executing a command (= an editor
  // operation) is something the server cannot do, so the client implements it here.
  // CDK LSP はコンストラクトの行に CodeLens (例: "Creates AWS::SQS::Queue") を表示し、
  // その command として `cdkExplorer.openResource` を指定してくる。
  // コマンドの実行 (= エディタ操作) はサーバーにはできないので、
  // クライアント側でここに実装する。
  //
  // The `choices` argument lists the CloudFormation resources generated from the
  // constructs on that line; each element's target.uri points at the resource's
  // location inside the synthesized template (JSON) under cdk.out.
  // 引数 choices は、その行のコンストラクトから生成される CloudFormation リソースの
  // 一覧で、各要素の target.uri は cdk.out 内の合成済みテンプレート (JSON) の
  // 該当リソース位置を指している。
  context.subscriptions.push(
    vscode.commands.registerCommand('cdkExplorer.openResource', async (choices: ResourceChoice[]) => {
      if (!choices || choices.length === 0) {
        return;
      }

      // When one construct generates multiple resources
      // (e.g. s3.Bucket → AWS::S3::Bucket + AWS::S3::BucketPolicy),
      // let the user pick which resource to open via QuickPick.
      // 1つのコンストラクトから複数リソースが生成される場合
      // (例: s3.Bucket → AWS::S3::Bucket + AWS::S3::BucketPolicy) は
      // QuickPick でどのリソースを開くか選ばせる。
      const selected =
        choices.length === 1
          ? choices[0]
          : await vscode.window.showQuickPick(choices, {
              placeHolder: 'Open generated CloudFormation resource',
            });

      if (!selected) {
        return;
      }

      // target.uri is a `file://` URL string, so convert it with Uri.parse
      // (Uri.file is for file system paths and must not be used here).
      // target.uri は `file://` 形式の URL 文字列なので Uri.parse で変換する
      // (Uri.file はファイルパス用なのでここでは使わない)。
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(selected.target.uri));

      const editor = await vscode.window.showTextDocument(document);

      // Move the cursor to the start of the resource in the template
      // and reveal it in the center of the editor.
      // テンプレート内の該当リソースの先頭へカーソルを移動し、画面中央に表示する。
      const position = new vscode.Position(selected.target.range.start.line, selected.target.range.start.character);

      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    })
  );

  // Start the server and perform the initialize handshake. From here on the
  // library automatically handles document sync, CodeLens, and diagnostics.
  // サーバーを起動して initialize ハンドシェイクを行う。
  // 以降のドキュメント同期・CodeLens・診断のやり取りはライブラリが自動で行う。
  await client.start();
}

// Called when the extension is deactivated. Stops the server process.
// 拡張機能の無効化時に呼ばれる。サーバープロセスを停止する。
export async function deactivate(): Promise<void> {
  await client?.stop();
}

// The type of each element the server passes to the `cdkExplorer.openResource`
// CodeLens command. It extends QuickPickItem so it can be passed straight to
// showQuickPick, displaying label (resource type) and description (construct path).
// CodeLens の `cdkExplorer.openResource` コマンドでサーバーから渡される要素の型。
// QuickPickItem を継承しているのは、そのまま showQuickPick に渡して
// label (リソースタイプ) と description (コンストラクトパス) を表示させるため。
interface ResourceChoice extends vscode.QuickPickItem {
  // Jump destination: the resource's location inside the synthesized CloudFormation template.
  // ジャンプ先: 合成済み CloudFormation テンプレート内のリソース位置
  target: {
    uri: string;
    // The range the resource definition occupies in the Cfn template (0-based line/character)
    // Cfn テンプレート内でリソース定義が占める範囲 (0始まりの行・桁)
    range: {
      start: {
        line: number;
        character: number;
      };
      end: {
        line: number;
        character: number;
      };
    };
  };
}
