// 全般
import * as path from "path";
import * as vscode from "vscode";
import { workspace, ExtensionContext, commands, window, Uri, Position, Selection } from "vscode";
import * as fs from "fs";
import * as fsPromises from "fs/promises";

// ビジュアル化
import { parse } from "./parser9";
import { transMermaid } from "./transMermaid4";

// 昔の整合性チェック
import { parse_CroRef } from "./parser7_CroRef";
import { compareVariables, readAnalysisResult, VariableDifferences } from "./croRef3";

// 整合性チェック
import { parseViews } from "./viewParser";
import { parseControllers } from "./controllerParser";
import { checkInconsistencies, findUnusedViewFiles } from "./inconsistencyChecker";
import { convertJsonToJapanese } from "./transVariables";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  const composerPath = path.join(vscode.workspace.rootPath, 'composer.json');

  fs.readFile(composerPath, 'utf-8', (err, data) => {
    if (err) {
      return;
    }

    try {
      const composerJson = JSON.parse(data);
      const requiredPackages = composerJson.require || {};
      if ("laravel/framework" in requiredPackages) {
        vscode.commands.executeCommand('setContext', 'isLaravelProject', true);
        hoge(context);
      } else {
        vscode.commands.executeCommand('setContext', 'isLaravelProject', false);
        return;
      }
    } catch (e) {
      // console.error(e);
    }
  });
}

function hoge(context: ExtensionContext) {
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
      vscode.window.showInformationMessage(`Typo check is now ${enableTypoCheck ? 'enabled' : 'disabled'}`);
      if (enableTypoCheck) {
        typeCheck();
      } else {
        client.stop();
      }
    }
  });

  // コマンド登録: checkVariables
  context.subscriptions.push(
    commands.registerCommand("extension.checkVariables", async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      const outputChannel = vscode.window.createOutputChannel('Laravel Navigator for Beginners');

      if (workspaceFolders) {
        const projectRoot = workspaceFolders[0].uri.fsPath;
        const viewsDir = path.join(projectRoot, 'resources', 'views');
        const controllersDir = path.join(projectRoot, 'app', 'Http', 'Controllers');

        try {
          // ビューで使用されている変数を取得
          const viewVariables = await parseViews(viewsDir, projectRoot);

          // コントローラーから渡されている変数を取得
          const controllerVariables = await parseControllers(controllersDir);

          // 矛盾をチェック
          const inconsistencies = checkInconsistencies(viewVariables, controllerVariables);
          // 未使用のビューファイルを取得
          const unusedViewFiles = findUnusedViewFiles(viewVariables, controllerVariables);

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
          outputChannel.appendLine('=== checkVariables リザルト ===');
          outputChannel.appendLine(localeDateString);

          if (inconsistencies.length > 0) {
            // 結果をファイルに出力
            const outputPath = path.join(__dirname, 'inconsistencies.json');
            const outputPath2 = path.join(__dirname, 'inconsistencies2.json');
            const outputPath3 = path.join(__dirname, 'inconsistencies3.json');
            fs.writeFileSync(outputPath, JSON.stringify(inconsistencies, null, 2));
            fs.writeFileSync(outputPath2, JSON.stringify(viewVariables, null, 2));
            fs.writeFileSync(outputPath3, JSON.stringify(controllerVariables, null, 2));

            vscode.window.showWarningMessage(`問題点が見つかりました。詳細は出力を参照してください。`);

            // 出力
            outputChannel.appendLine(convertJsonToJapanese(inconsistencies));
          } else {
            vscode.window.showInformationMessage('問題点は見つかりませんでした。');

            // 出力
            outputChannel.appendLine('問題点は見つかりませんでした。');
          }
          // 出力の表示
          outputChannel.appendLine('==============================');
          outputChannel.appendLine('未使用のビューｆｒじふぉえじょファイル:');
          outputChannel.appendLine(JSON.stringify(unusedViewFiles, null, 2));
          outputChannel.appendLine('==============================');
          outputChannel.show();
        } catch (error) {
          vscode.window.showErrorMessage(`エラーが発生しました: ${error.message}`);
        }
      }
    })
  );


  
  // コマンド登録: crossRef
  // クロスリファレンスのテスト
  context.subscriptions.push(
    commands.registerCommand("extension.crossReference", () => {
      const workspacePath = workspace.workspaceFolders[0]?.uri.fsPath;

      if (!workspacePath) {
        window.showErrorMessage('Error: Workspace path is not defined');
        return;
      }

      parse_CroRef(workspacePath);
    })
  );

  // フォルダ内のファイル構造をJSONで出力
  function getFileTree(dir: string): any {
    const stats = fs.statSync(dir);
    const info: any = {
        path: dir,
        name: path.basename(dir)
    };

    if (stats.isDirectory()) {
        info.type = "directory";
        info.children = fs.readdirSync(dir).map(function (child) {
            return getFileTree(path.join(dir, child));
        });
    } else {
        info.type = "file";
    }

    return info;
  }

  // コマンド登録: showWorkspaceFolders
  // ワークスペースフォルダの情報をJSONで保存
  context.subscriptions.push(
    commands.registerCommand("extension.showWorkspaceFolders", () => {
      const folders = workspace.workspaceFolders;

      if (folders) {
        const fileTree = getFileTree(folders[0].uri.fsPath);

        window.showInformationMessage(JSON.stringify(folders, null, 2));
        const outputPath = path.join(context.extensionPath, 'file_structure.json');
        fs.writeFileSync(outputPath, JSON.stringify(fileTree, null, 2), 'utf8');
      } else {
        window.showInformationMessage("No workspace folders");
      }
    })
  );

  // コマンド登録: hogehoge
  // parser_modelのテスト用
  context.subscriptions.push(
    commands.registerCommand("extension.hogehoge", () => {
      const workspacePath = workspace.workspaceFolders[0]?.uri.fsPath;

      if (!workspacePath) {
        window.showErrorMessage('Error: Workspace path is not defined');
        return;
      }

    })
  );


  // コマンド登録: hoge
  // 変数クロスリファレンスのテスト用
  context.subscriptions.push(
    commands.registerCommand("extension.hoge", () => {
      const jsonFilePath = path.join(__dirname, 'output_CroRef.json');

      const analysisResult = readAnalysisResult(jsonFilePath);

      const differences: VariableDifferences[] = compareVariables(analysisResult);

      // 結果を出力
      for (const diff of differences) {
        console.log(`ビュー名: ${diff.view}`);
        if (diff.variablesSentNotUsed.length > 0) {
            console.log(`  送信されたが使用されていない変数: ${diff.variablesSentNotUsed.join(', ')}`);
        } else {
            console.log(`  送信された変数はすべて使用されています。`);
        }
        if (diff.variablesUsedNotSent.length > 0) {
            console.log(`  使用されたが送信されていない変数: ${diff.variablesUsedNotSent.join(', ')}`);
        } else {
            console.log(`  使用された変数はすべて送信されています。`);
        }
        console.log(''); // 区切りのための空行
      }
    })
  );

  // コマンド登録: transMermaid
  context.subscriptions.push(
    commands.registerCommand("extension.transMermaid", async () => {
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

        // Mermaid変換の実行が完了するまで待機
        const mermaidCode = transMermaid();
        if (!mermaidCode) {
          throw new Error('Mermaid code is empty');
        }

        // Webviewを開く処理を関数化
        openMermaidPreview(context, mermaidCode);

      } catch (e) {
        // エラーメッセージの改善
        console.error(`An error occurred: ${e.message}`);
        window.showErrorMessage(`Error occurred: ${e.message}`);
      }
    })
  );

  // Webviewを開く処理を関数として分離
  function openMermaidPreview(context: ExtensionContext, mermaidCode: string) {
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
    sendMessage(panel, mermaidCode);

    // Mermaidのセルをクリックされたとき、そのファイルパスを受信
    panel.webview.onDidReceiveMessage(
      async message => {
        if (message.command === 'update') {
          try {
            const workspacePath = workspace.workspaceFolders[0]?.uri.fsPath;

            if (!workspacePath) {
              window.showErrorMessage('Error: Workspace path is not defined');
              return;
            }

            await parse(workspacePath);

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
              const editorCount = vscode.window.visibleTextEditors.length;
              // 行番号もある場合、そのファイルの行にフォーカスする
              if (message.line) {
                const position = new Position(message.line - 1, 0); // 行番号は0始まりなので-1する
                const selection = new Selection(position, position);
                if (editorCount > 1) {
                  window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, selection });
                } else {
                  window.showTextDocument(doc, { selection });
                }
              } else {
                if (editorCount > 1) {
                  window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
                } else {
                  window.showTextDocument(doc);
                } 
              }
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
      }
    };

    // Create the language client and start the client.
    client = new LanguageClient(
      "REPLACE_ME language-server-id",
      "REPLACE_ME language server name",
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