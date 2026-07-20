import * as path from 'path';
import * as vscode from 'vscode';
import {
  ExecuteCommandRequest,
  LanguageClient,
  LanguageClientOptions,
  LogMessageNotification,
  LogMessageParams,
  MessageType,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import { parseSynthError, ParsedSynthError } from './synthErrorParser';

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

// Recent window/logMessage payloads from the server. When synth fails with a
// runtime error, the server discards the real error text from diagnostics and
// only logs it here — so we buffer the logs to recover file/line info later.
// サーバーから届いた直近の window/logMessage の内容。synth が実行時エラーで
// 失敗すると、サーバーは本当のエラーメッセージを診断には載せずログにしか
// 流さないため、後からファイル・行を復元できるようにバッファしておく。
const MAX_BUFFERED_LOGS = 50;
let recentLogs: string[] = [];

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

  const applicationDir = workspaceFolder.uri.fsPath;

  // Collection for our own remapped synth-error diagnostics. The server cannot
  // attach runtime synth errors to the source line, so the client publishes them here.
  // クライアント側で publish し直す synth エラー診断用のコレクション。
  // サーバーは実行時の synth エラーをソース行に紐付けられないため、ここで補完する。
  const synthDiagnostics = vscode.languages.createDiagnosticCollection('cdk-synth');
  context.subscriptions.push(synthDiagnostics);

  // When synth fails with a runtime error the server publishes a single generic
  // diagnostic ("... Subprocess exited with error 1") pinned to cdk.json line 1.
  // We use that as the trigger to remap the buffered stderr to the real location.
  // 実行時エラーで synth が失敗すると、サーバーは cdk.json の1行目に汎用メッセージ
  // ("... Subprocess exited with error 1") の診断を1つだけ置く。これを合図に、
  // バッファ済み stderr から本来のエラー位置へマッピングし直す。
  const cdkJsonPath = path.join(applicationDir, 'cdk.json');

  // --- 1. How to start the server / サーバーの起動方法 ---
  // Launch `npx cdk lsp` as a child process for the LSP server.
  // transport: stdio exchanges JSON-RPC messages over standard input/output,
  // which is the most common LSP transport.
  // LSP サーバーとして `npx cdk lsp` を子プロセスで起動する。
  // transport: stdio は、標準入出力を通じて JSON-RPC メッセージを
  // やり取りする最も一般的な LSP の通信方式。
  //
  // Do not swap `npx` for `pnpm` here: `pnpm <script>` prints its own banner
  // ("> pkg@1.0.0 cdk ...") to stdout, which lands in front of the JSON-RPC
  // stream and corrupts the Content-Length framing.
  // ここを `pnpm` に変えてはいけない。`pnpm <script>` は独自のバナー
  // ("> pkg@1.0.0 cdk ...") を stdout に出すため、それが JSON-RPC ストリームの
  // 先頭に混ざり Content-Length のフレーミングを壊す。
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
      applicationDir,
    },
    middleware: {
      // Intercepts textDocument/publishDiagnostics before the library stores it.
      // Only what is passed to next() reaches the Problems panel.
      // ライブラリが診断を反映する前に textDocument/publishDiagnostics に割り込む。
      // next() に渡した内容だけが Problems パネルに反映される。
      handleDiagnostics: (uri, diagnostics, next) => {
        if (uri.scheme !== 'file' || uri.fsPath !== cdkJsonPath) {
          next(uri, diagnostics);
          return;
        }

        // An empty publish for cdk.json means synth succeeded again
        // (the server clears every previously published URI on recovery).
        // cdk.json への空の publish は synth の成功 (回復) を意味する
        // (サーバーは成功時に過去へ publish した全 URI をクリアする)。
        if (diagnostics.length === 0) {
          synthDiagnostics.clear();
          recentLogs = [];
          next(uri, diagnostics);
          return;
        }

        const fallback = diagnostics.find(
          (diagnostic) =>
            diagnostic.source === 'cdk synth' && diagnostic.message.includes('Subprocess exited with error')
        );

        if (!fallback) {
          next(uri, diagnostics);
          return;
        }

        // The real stderr arrived earlier as logMessage notifications, one
        // (indentation-stripped) line per message, so parse the joined buffer.
        // 本当の stderr は先に logMessage として「1行=1通知(インデント除去済み)」
        // で届いているため、バッファ全体を結合してからパースする。
        const parsed: ParsedSynthError | undefined = parseSynthError(recentLogs.join('\n'), applicationDir);
        recentLogs = [];

        // Unknown stderr shape: keep the server's fallback diagnostic
        // so the user still sees that synth failed.
        // stderr の形式が想定外の場合はサーバーのフォールバック診断を
        // 残し、synth の失敗自体は見えるようにする。
        if (!parsed) {
          next(uri, diagnostics);
          return;
        }

        const position = new vscode.Position(parsed.line, parsed.character);
        const remapped = new vscode.Diagnostic(
          new vscode.Range(position, position),
          parsed.message,
          vscode.DiagnosticSeverity.Error
        );

        remapped.source = 'cdk synth';

        if (parsed.code) {
          remapped.code = parsed.code;
        }

        synthDiagnostics.clear();
        synthDiagnostics.set(vscode.Uri.file(parsed.file), [remapped]);

        // Drop the useless cdk.json:1:1 entry now that the real location is shown.
        // 本来の位置に診断を出せたので、無意味な cdk.json:1:1 の診断は取り除く。
        next(
          uri,
          diagnostics.filter((diagnostic) => diagnostic !== fallback)
        );
      },
    },
  };

  client = new LanguageClient('cdkLsp', 'CDK Language Server', serverOptions, clientOptions);
  const currentClient = client;

  // Buffer server logs (which carry the raw synth stderr) for the middleware above.
  // Registering our own handler REPLACES the library's built-in one (vscode-jsonrpc
  // keeps a single handler per method), so we also re-emit each message to the
  // Output channel exactly the way the built-in handler would have.
  // サーバーログ (synth の生 stderr を含む) を上記ミドルウェア用にバッファする。
  // 自前のハンドラを登録するとライブラリ組み込みのハンドラは「置き換え」になる
  // (vscode-jsonrpc はメソッドごとに単一ハンドラ) ため、Output チャンネルへの
  // 出力も組み込みハンドラと同じ形で自前で再現する。
  client.onNotification(LogMessageNotification.type, (params: LogMessageParams) => {
    recentLogs.push(params.message);

    if (recentLogs.length > MAX_BUFFERED_LOGS) {
      recentLogs.shift();
    }

    switch (params.type) {
      case MessageType.Error:
        currentClient.error(params.message, undefined, false);
        break;
      case MessageType.Warning:
        currentClient.warn(params.message, undefined, false);
        break;
      case MessageType.Info:
        currentClient.info(params.message, undefined, false);
        break;
      case MessageType.Debug:
        currentClient.debug(params.message, undefined, false);
        break;
      default:
        currentClient.outputChannel.appendLine(params.message);
    }
  });

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

  // The server starts with auto-synth DISABLED, so saving a file alone runs
  // nothing and no diagnostics ever appear. It does expose an "Enable auto-synth"
  // CodeLens, but CodeLenses are only served once a synth has succeeded — so an
  // app that currently fails to synth shows no lens to click, and there is no way
  // out of that deadlock from the editor. Enable it over executeCommand instead,
  // then run one synth immediately for feedback without waiting for a save.
  // サーバーは auto-synth が「無効」の状態で起動するため、ファイルを保存しただけでは
  // 何も走らず診断が出ない。「Enable auto-synth」CodeLens も用意されているが、
  // CodeLens は synth が成功して初めて返るため、synth が失敗するアプリでは
  // 押すべき CodeLens 自体が表示されず、エディタ側から抜け出せない。
  // そこで executeCommand で直接有効化し、保存を待たずに初回 synth も走らせる。
  for (const command of ['cdk.explorer.enableAutoSynth', 'cdk.explorer.synthNow']) {
    try {
      await client.sendRequest(ExecuteCommandRequest.type, { command, arguments: [] });
    } catch (error) {
      // Older servers may not provide these commands. Losing auto-synth is not
      // worth failing activation over, so just record it and carry on.
      // 古いサーバーではこれらのコマンドが存在しない可能性がある。auto-synth が
      // 使えないだけで activate 全体を失敗させる必要はないので、記録して続行する。
      client.warn(`Failed to execute ${command}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
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
