import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    return;
  }

  const serverOptions: ServerOptions = {
    command: 'npx',
    args: ['cdk', 'lsp'],
    options: {
      cwd: workspaceFolder.uri.fsPath,
    },
    transport: TransportKind.stdio,
  };

  const clientOptions: LanguageClientOptions = {
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
    initializationOptions: {
      applicationDir: workspaceFolder.uri.fsPath,
    },
  };

  client = new LanguageClient('cdkLsp', 'CDK Language Server', serverOptions, clientOptions);

  context.subscriptions.push(
    vscode.commands.registerCommand('cdkExplorer.openResource', async (choices: ResourceChoice[]) => {
      if (!choices || choices.length === 0) {
        return;
      }

      const selected =
        choices.length === 1
          ? choices[0]
          : await vscode.window.showQuickPick(choices, {
              placeHolder: 'Open generated CloudFormation resource',
            });

      if (!selected) {
        return;
      }

      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(selected.target.uri));

      const editor = await vscode.window.showTextDocument(document);

      const position = new vscode.Position(selected.target.range.start.line, selected.target.range.start.character);

      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    })
  );

  await client.start();
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}

interface ResourceChoice extends vscode.QuickPickItem {
  target: {
    uri: string;
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
