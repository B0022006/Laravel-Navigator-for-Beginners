// 全般
import * as path from "path";
import * as vscode from "vscode";
import { workspace, ExtensionContext, commands, window, Uri, Position, Selection } from "vscode";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

// ビジュアル化
import { parse } from "./parser/parser";
import { transMermaid } from "./transMermaid";

// 整合性チェック
import { checkInconsistencies, findUnusedViewFiles, findNonexistentViewFiles } from "./inconsistencyChecker";
import { convertJsonToJapanese_variable, convertJsonToJapanese_unUsed, convertJsonToJapanese_nonexistentViews } from "./transVariables";

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  try {
    const composerPath = path.join(vscode.workspace.rootPath, 'composer.json');

    fs.readFile(composerPath, 'utf-8', (err, data) => {
      if (err) {
        return;
      }

      const composerJson = JSON.parse(data);
      const requiredPackages = composerJson.require || {};
      if ("laravel/framework" in requiredPackages) {
        vscode.commands.executeCommand('setContext', 'isLaravelProject', true);
        extensionBody(context);
      } else {
        vscode.commands.executeCommand('setContext', 'isLaravelProject', false);
        return;
      }
    });
  } catch (e) {
    // console.error(e);
  }
}

function extensionBody(context: ExtensionContext) {
  let config = vscode.workspace.getConfiguration('laravel-navigator-for-beginners');
  let enableTypoCheck = config.get<boolean>('enableTypoCheck');
  let startUpMermaid = config.get<boolean>('startUpMermaid');
  if (enableTypoCheck) {
    typeCheck();
  }
  if (startUpMermaid) {
    vscode.commands.executeCommand('extension.transMermaid');
  }

  vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('laravel-navigator-for-beginners.enableTypoCheck')) {
      // 設定が変更された場合、再取得
      config = vscode.workspace.getConfiguration('laravel-navigator-for-beginners');
      enableTypoCheck = config.get<boolean>('enableTypoCheck');
      // vscode.window.showInformationMessage(`Typo check is now ${enableTypoCheck ? 'enabled' : 'disabled'}`);
      if (enableTypoCheck) {
        typeCheck();
      } else {
        client.stop();
      }
    }
  });

  async function execParse() {
    const workspacePath = workspace.workspaceFolders[0]?.uri.fsPath;
    const outputFilePath = path.join(__dirname, 'logTest.txt');
    await fsPromises.writeFile(outputFilePath, workspacePath, 'utf-8');

    if (!workspacePath) {
      window.showErrorMessage('Error: Workspace path is not defined');
      return;
    }

    try {
      // 進捗メッセージの表示
      window.showInformationMessage('Starting parser...');

      // parserの実行が完了するまで待機
      await parse(workspacePath); // 直接awaitで待機

      console.log('Parser done');
      window.showInformationMessage('Parser finished successfully.');
    } catch (e) {
      // エラーメッセージの改善
      console.error(`An error occurred: ${e.message}`);
      window.showErrorMessage(`Error occurred: ${e.message}`);
    }
  }

  // コマンド登録: checkVariables
  context.subscriptions.push(
    commands.registerCommand("extension.checkVariables", async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      const outputChannel = vscode.window.createOutputChannel('Laravel Navigator for Beginners');

      if (workspaceFolders) {
        const projectRoot = workspaceFolders[0].uri.fsPath;
        // const viewsDir = path.join(projectRoot, 'resources', 'views');
        // const controllersDir = path.join(projectRoot, 'app', 'Http', 'Controllers');

        try {
          // parserの実行
          await execParse();

          const jsonData = JSON.parse(fs.readFileSync(path.join(__dirname, 'parser', 'output.json'), 'utf-8'));
          // 矛盾をチェック
          const inconsistencies = checkInconsistencies(jsonData);
          // 存在しないビューファイルを取得
          const nonexistentViewFiles = findNonexistentViewFiles(jsonData);
          // 未使用のビューファイルを取得
          const unusedViewFiles = findUnusedViewFiles(jsonData);

          // タイムスタンプ取得
          const now = new Date();
          const options: Intl.DateTimeFormatOptions = {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
          };
          const localeDateString = now.toLocaleDateString('ja-JP', options);

          // 出力の前置き
          outputChannel.clear();
          outputChannel.appendLine('=== checkVariables リザルト(プロジェクト全体) ===');
          outputChannel.appendLine(localeDateString);

          if (inconsistencies.length > 0) {
            // 結果をファイルに出力
            const outputPath = path.join(__dirname, 'inconsistencies.json');
            const outputPath2 = path.join(__dirname, 'inconsistencies2.json');
            const outputPath3 = path.join(__dirname, 'inconsistencies3.json');
            fs.writeFileSync(outputPath, JSON.stringify(inconsistencies, null, 2));
            // fs.writeFileSync(outputPath2, JSON.stringify(viewVariables, null, 2));
            // fs.writeFileSync(outputPath3, JSON.stringify(controllerVariables, null, 2));

            vscode.window.showWarningMessage(`問題点が見つかりました。詳細は出力を参照してください。`);

            // 出力
            outputChannel.appendLine(convertJsonToJapanese_variable(inconsistencies));
          } else {
            vscode.window.showInformationMessage('問題点は見つかりませんでした。');

            // 出力
            outputChannel.appendLine('問題点は見つかりませんでした。');
          }
          // 出力の表示
          outputChannel.appendLine('==============================');
          outputChannel.appendLine('使用しているが存在しないビューファイル:');
          outputChannel.appendLine(convertJsonToJapanese_nonexistentViews(nonexistentViewFiles));
          outputChannel.appendLine('==============================');
          outputChannel.appendLine('未使用のビューファイル:');
          outputChannel.appendLine(convertJsonToJapanese_unUsed(unusedViewFiles));
          outputChannel.appendLine('==============================');
          
          outputChannel.show();
        } catch (error) {
          vscode.window.showErrorMessage(`エラーが発生しました: ${error.message}`);
        }
      }
    })
  );

  // コマンド登録: transMermaid
  context.subscriptions.push(
    commands.registerCommand("extension.transMermaid", async () => {

      try {
        // await execParse();

        // Mermaid変換の実行が完了するまで待機
        // const mermaidCode = transMermaid();
        // if (!mermaidCode) {
        //   throw new Error('Mermaid code is empty');
        // }

        // Webviewを開く処理を関数化
        openMermaidPreview(context);

      } catch (e) {
        console.error(`An error occurred: ${e.message}`);
        window.showErrorMessage(`Error occurred: ${e.message}`);
      }
    })
  );

  // Webviewを開く処理を関数として分離
  function openMermaidPreview(context: ExtensionContext) {
    const panel = window.createWebviewPanel(
      'mermaidPreview', // 識別子
      'Mermaid Preview',  // タイトル
      vscode.ViewColumn.Active,  // 表示位置
      {
        enableScripts: true,  // スクリプトを有効化
        retainContextWhenHidden: true,  // 非表示時も状態を保持
        enableFindWidget: true, // 検索ウィジェットを有効化
      }
    );

    // HTMLをWebviewにロード
    const htmlPath = Uri.file(path.join(context.extensionPath, 'mermaid.html'));
    panel.webview.html = getHtmlContent(htmlPath);

    // 拡張機能からメッセージを送信
    // sendMessage(panel, mermaidCode);

    // HTMLから受信
    panel.webview.onDidReceiveMessage(
      async message => {
        // 初回起動・更新ボタンが押されたとき
        if (message.command === 'update') {
          console.log('update button clicked');
          try {
            await execParse();

            const newMermaidCode = transMermaid();
            if (!newMermaidCode) {
              throw new Error('Mermaid code is empty');
            }

            sendMessage(panel, newMermaidCode);
          } catch (e) {
            console.error(`An error occurred: ${e.message}`);
            window.showErrorMessage(`Error occurred: ${e.message}`);
          }
        } else if (message?.file) {
          // Mermaidのセルをクリックされたとき、ファイルパスを受信し、ファイルを開く
          console.log('message received');
          console.log(message.file);
          const uri = Uri.file(message.file);
          if (fs.existsSync(uri.fsPath)) {
            workspace.openTextDocument(uri).then(doc => {
              console.log(doc);
              // const editorCount = vscode.window.visibleTextEditors.length;
              const tagGroup = vscode.window.tabGroups;
              const activeGroup = tagGroup.activeTabGroup.viewColumn;
              const isRightMostEditor = tagGroup.all.length === activeGroup;

              const panelSetting = {};
              if (isRightMostEditor) {
                panelSetting['viewColumn'] = vscode.ViewColumn.One;
              } else {
                panelSetting['viewColumn'] = vscode.ViewColumn.Beside;
              }
              if (message.line) {
                panelSetting['selection'] = new vscode.Range(message.line - 1, 0, message.line - 1, 0);
              }

              vscode.window.showTextDocument(doc, panelSetting);
            });
          } else {
            vscode.window.showErrorMessage('File not found: ' + message.file);
          }
        } else {
          console.error('Invalid message received');
        }
      },
      undefined,
      context.subscriptions
    );

    // panel.onDidChangeViewState(e => {
    //   if (e.webviewPanel.visible) {
    //     console.log('Webview is visible');
    //     sendMessage(panel, mermaidCode);
    //   }
    // });
  }


  // 拡張機能からメッセージを送信
  function sendMessage(panel, message) {
    console.log('send message!!!!');
    try {
      panel.webview.postMessage(
        { command: 'message',
          text: message
        }
      );
    } catch (e) {
      console.error(e);
    }
  }

  // 設定からの値の取得
  // const config = vscode.workspace.getConfiguration('laravel-navigator-for-beginners');
  // const mode = config.get<string>('mode');
  // const enableFeature = config.get<boolean>('enableFeature');

  // console.log(`mode: ${mode}`);
  // console.log(`enableFeature: ${enableFeature}`);


  // 以下、LSPによるスペルチェック機能
  function typeCheck() {
    // The server is implemented in node
    const serverModule = context.asAbsolutePath(
      path.join("server", "out", "server.js")
    );

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
      run: { module: serverModule, transport: TransportKind.ipc },
      debug: {
        module: serverModule,
        transport: TransportKind.ipc,
      },
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
      // Register the server for all documents by default
      documentSelector: [{ scheme: "file", language: "*" }],
      synchronize: {
        // Notify the server about file changes to '.clientrc files contained in the workspace
        fileEvents: [workspace.createFileSystemWatcher("**/.clientrc"),
          workspace.createFileSystemWatcher("**/*.php"),
          workspace.createFileSystemWatcher("**/*.blade.php"),
        ],
      },
      workspaceFolder: vscode.workspace.workspaceFolders[0],
      initializationOptions: {
        storageUri: context.storageUri?.toString(),
        extensionPath: context.extensionPath,
      }
    };

    // Create the language client and start the client.
    client = new LanguageClient(
      "Laravel-Navigator-for-Beginners-language-server-id",
      "Laravel Navigator for Beginners language server name",
      serverOptions,
      clientOptions
    );

    // Start the client. This will also launch the server
    if (enableTypoCheck) {
      client.start();
    }
  }
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

function getHtmlContent(htmlPath: Uri): string {
  const fs = require('fs');
  const htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf-8');
  return htmlContent;
}