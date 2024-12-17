// server.ts
import {
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  DocumentDiagnosticReportKind,
  DocumentDiagnosticReport,
  DidChangeConfigurationNotification,
  CodeAction,
  CodeActionKind,
  CodeActionParams,
} from 'vscode-languageserver/node';

import * as fs from 'fs';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { fileURLToPath } from 'url';

import { validateTailwindClasses } from './validate_tailwind';
import { extractModelNames } from './parser_model';
import { extractBladeComponentNamesAndFolders } from './parser_component';
import { getDefaultSettings, mergeSettings, validateText, ValidationIssue } from 'cspell-lib';

// サーバー接続を作成（ProposedFeaturesをすべて有効化）
const connection = createConnection(ProposedFeatures.all);

// テキストドキュメントマネージャーを作成
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

let workspacePath: string;
let extensionPath: string;

// ホワイトリストのパスと単語セット
let whitelistFilePath: string | undefined;
let whitelist: Set<string> = new Set();

// 辞書ファイルのパスを定義
let DICTIONARY_PATH: string;
let HTML_TAG_DICTIONARY_PATH: string;
let BLADE_DIRECTIVE_DICTIONARY_PATH: string;
let BLADE_COMPONENT_DICTIONARY_PATH: string;
let MODEL_DICTIONARY_PATH: string;
let SVG_TAG_DICTIONARY_PATH: string;
let TAILWIND_DIRECTIVE_DICTIONARY_PATH: string;


// PHPファイル用の辞書パス（コメントアウト）
/*
const LARAVEL_DICTIONARY_PATH = path.resolve(__dirname, 'dict/laravel11.txt');
const CUSTOM_LARAVEL_DICTIONARY_PATH = path.resolve(__dirname, 'dict/laravelAppend.txt');
*/

// 無視する正規表現の定義（PHPファイル用）（コメントアウト）
/*
const PHP_IGNORE_REGEXP_LIST = [
  /\/\/.*$/gm,                // 行コメント
  /\/\*[\s\S]*?\*\//gm,       // ブロックコメント
  /^use\s+[\w\\]+;/gm,        // useステートメント
  /^namespace\s+[\w\\]+;/gm,  // namespaceステートメント
];
*/

// HTMLタグ名を抽出する正規表現
const TAG_NAME_REGEXP = /<\/?([^\s>\/]+)/g;


// 設定のインターフェースを定義
interface ExtensionSettings {
  diagnosticsLevel_tailwind: string;
  diagnosticsLevel_pastTailwind: string;
  diagnosticsLevel_directive: string;
  diagnosticsLevel_htmlTag: string;
}

// デフォルト設定を定義
const defaultSettings: ExtensionSettings = { 
  diagnosticsLevel_tailwind: 'Information',
  diagnosticsLevel_pastTailwind: 'Hint',
  diagnosticsLevel_directive: 'Information',
  diagnosticsLevel_htmlTag: 'Information'
};

// グローバル設定とドキュメントごとの設定を保持するマップを初期化
let globalSettings: ExtensionSettings = defaultSettings;
let documentSettings: Map<string, Thenable<ExtensionSettings>> = new Map();

// 設定名を定義（実際の拡張機能の名前に置き換えてください）
const SETTINGS_SECTION = 'laravel-navigator-for-beginners';

// サーバーの初期化処理
connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  // ワークスペースのパスを取得
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    workspacePath = fileURLToPath(params.workspaceFolders[0].uri);
  }

  // 拡張機能のパスを取得
  if (params.initializationOptions.extensionPath) {
    extensionPath = params.initializationOptions.extensionPath;
    // 辞書ファイルのパスを設定
    DICTIONARY_PATH = path.resolve(extensionPath, 'dict');
    HTML_TAG_DICTIONARY_PATH = path.resolve(DICTIONARY_PATH, 'htmlTag.txt');
    BLADE_DIRECTIVE_DICTIONARY_PATH = path.resolve(DICTIONARY_PATH, 'bladeDirective.txt');
    BLADE_COMPONENT_DICTIONARY_PATH = path.resolve(DICTIONARY_PATH, 'bladeComponent.txt');
    MODEL_DICTIONARY_PATH = path.resolve(DICTIONARY_PATH, 'models.txt');
    SVG_TAG_DICTIONARY_PATH = path.resolve(DICTIONARY_PATH, 'svgTag.txt');
    TAILWIND_DIRECTIVE_DICTIONARY_PATH = path.resolve(DICTIONARY_PATH, 'tailwindDirective.txt');
  }

  // クライアントの機能を確認
  hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration);
  hasWorkspaceFolderCapability = !!(capabilities.workspace && !!capabilities.workspace.workspaceFolders);

  // クライアントから storageUri を取得
  const initializationOptions = params.initializationOptions || {};
  const storageUri = initializationOptions.storageUri;
  if (storageUri) {
    const storagePath = fileURLToPath(storageUri);
    whitelistFilePath = path.join(storagePath, 'whitelist.txt');
  } else {
    connection.console.log('storageUri が提供されていません。');
  }

  // サーバーが提供する機能を設定
  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      diagnosticProvider: {
        interFileDependencies: false,
        workspaceDiagnostics: false
      },
      codeActionProvider: true,
      executeCommandProvider: {
        commands: ['addToWhiteList']
      }
    }
  };

  // ワークスペースフォルダのサポートを設定
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true
      }
    };
  }
  return result;
});

// サーバーが初期化された後の処理
connection.onInitialized(async () => {
  if (hasConfigurationCapability) {
    // 設定変更の通知を登録
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }
  if (hasWorkspaceFolderCapability) {
    // ワークスペースフォルダの変更を監視
    connection.workspace.onDidChangeWorkspaceFolders(_event => {
      connection.console.log('ワークスペースフォルダの変更イベントを受信しました。');
      initializeWorkspaceData();
    });
  }
  // ワークスペース関連のデータを初期化
  await initializeWorkspaceData();
});

// ワークスペースのデータを初期化する関数
function initializeWorkspaceData() {
  loadWhitelist();
  extractModelNames(workspacePath, DICTIONARY_PATH);
  extractBladeComponentNamesAndFolders(workspacePath, DICTIONARY_PATH);
  // 診断を更新
  connection.languages.diagnostics.refresh();
}

// ホワイトリストを読み込む関数
async function loadWhitelist() {
  whitelist = new Set();
  if (!whitelistFilePath) {
    connection.console.log('whitelistFilePath が設定されていません。');
    return;
  }
  try {
    const data = await fs.promises.readFile(whitelistFilePath, 'utf-8');
    const words = data.split(/\r?\n/).map(word => word.trim()).filter(word => word !== '');
    whitelist = new Set(words);
  } catch (error) {
    // ファイルが存在しない場合は空のセットを作成
    connection.console.log('ホワイトリストファイルが見つかりません。新しく作成します。');
    await fs.promises.mkdir(path.dirname(whitelistFilePath), { recursive: true });
    await fs.promises.writeFile(whitelistFilePath, '');
  }
}

// 設定が変更されたときの処理
connection.onDidChangeConfiguration(change => {
  if (hasConfigurationCapability) {
    // キャッシュされた設定をクリア
    documentSettings.clear();
  } else {
    globalSettings = <ExtensionSettings>(
      (change.settings[SETTINGS_SECTION] || defaultSettings)
    );
  }
  // 診断を更新
  connection.languages.diagnostics.refresh();
});

// ドキュメントごとの設定を取得する関数
function getDocumentSettings(resource: string): Thenable<ExtensionSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: SETTINGS_SECTION // 設定のセクション名を指定
    });
    documentSettings.set(resource, result);
  }
  return result;
}

// 診断の重大度を取得する関数
function getDiagnosticSeverity(level: string): DiagnosticSeverity | undefined {
  switch (level.toLowerCase()) {
    case 'error':
      return DiagnosticSeverity.Error;
    case 'warning':
      return DiagnosticSeverity.Warning;
    case 'information':
      return DiagnosticSeverity.Information;
    case 'hint':
      return DiagnosticSeverity.Hint;
    case 'none':
      return undefined;
    default:
      return DiagnosticSeverity.Information;
  }
}

// 診断リクエストを処理するハンドラ
connection.languages.diagnostics.on(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (document !== undefined) {
    return {
      kind: DocumentDiagnosticReportKind.Full,
      items: await validateTextDocument(document)
    } satisfies DocumentDiagnosticReport;
  } else {
    return {
      kind: DocumentDiagnosticReportKind.Full,
      items: []
    } satisfies DocumentDiagnosticReport;
  }
});

// ドキュメントが開かれたときの処理
documents.onDidOpen(() => {
  // 診断を更新
  connection.languages.diagnostics.refresh();
});

// テキストドキュメントを検証する関数
async function validateTextDocument(textDocument: TextDocument): Promise<Diagnostic[]> {
  let languageId = textDocument.languageId;
  const uri = textDocument.uri;
  const filePath = fileURLToPath(uri);

  // ファイル名が .blade.php で終わっている場合、languageId を 'blade' に設定
  if (languageId === 'php' && filePath.endsWith('.blade.php')) {
    languageId = 'blade';
  }

  // 対象の言語が 'blade' でなければ処理をスキップ
  if (languageId !== 'blade' /* && languageId !== 'php' */) {
    return [];
  }

  const text = textDocument.getText();
  const defaultCSpellSettings = getDefaultSettings();
  // デフォルトのホワイトリストを無効化
  defaultCSpellSettings.allowCompoundWords = false;
  // defaultCSpellSettings.dictionaryDefinitions = [];
  defaultCSpellSettings.dictionaries = [];

  // ドキュメントごとの設定を取得
  const settings = await getDocumentSettings(textDocument.uri);
  const severity_tailwind = getDiagnosticSeverity(settings?.diagnosticsLevel_tailwind || globalSettings.diagnosticsLevel_tailwind);
  const severity_pastTailwind = getDiagnosticSeverity(settings?.diagnosticsLevel_pastTailwind || globalSettings.diagnosticsLevel_pastTailwind);
  const severity_directive = getDiagnosticSeverity(settings?.diagnosticsLevel_directive || globalSettings.diagnosticsLevel_directive);
  const severity_htmlTag = getDiagnosticSeverity(settings?.diagnosticsLevel_htmlTag || globalSettings.diagnosticsLevel_htmlTag);

  let cspellSettings;
  if (languageId === 'blade') {
    // Bladeファイル用の設定を取得
    cspellSettings = getBladeSettings(defaultCSpellSettings);
  }
  /*
  else if (languageId === 'php') {
    // PHPファイル用の設定を取得
    cspellSettings = getPhpSettings(defaultCSpellSettings, languageId);
  }
  */

  // ホワイトリストをユーザー辞書として設定
  cspellSettings.userWords = Array.from(whitelist);

  let diagnostics: Diagnostic[] = [];
  if (severity_directive !== undefined) {
    // テキストを検証（Bladeディレクティブのみ）
    const issues = await validateText(text, cspellSettings);
    // 検証結果を診断情報に変換
    diagnostics = issuesToDiagnostics(issues, textDocument, '{text}は辞書に存在しません', severity_directive);
  }

  if (languageId === 'blade') {
    let tailwindDiagnostics: Diagnostic[] = []
    // Tailwindクラスの検証
    tailwindDiagnostics = await validateTailwindClasses(textDocument, whitelist, severity_tailwind, severity_pastTailwind, DICTIONARY_PATH);

    // HTMLタグ名の検証設定を取得
    let htmlTagDiagnostics: Diagnostic[] = []; 
    if (severity_htmlTag !== undefined) {
      const htmlTagSettings = getHtmlTagSettings();
      const htmlTagIssues = await validateText(text, htmlTagSettings);
      // HTMLタグ名の検証結果を診断情報に変換
      htmlTagDiagnostics = issuesToDiagnostics(htmlTagIssues, textDocument, '{text}はHTMLの標準のタグではありません', severity_htmlTag);
    }

    // 診断結果を結合して返す
    return diagnostics.concat(tailwindDiagnostics, htmlTagDiagnostics);
  } else {
    return diagnostics;
  }
}

// Bladeファイル用の設定を取得する関数
// ディレクティブの検証
function getBladeSettings(defaultSettings: any): any {
  return mergeSettings(defaultSettings, {
    // languageId: 'html',  // BladeファイルをHTMLとして処理
    dictionaryDefinitions: [
      { name: 'modelDictionary', path: MODEL_DICTIONARY_PATH },
      { name: 'bladeDirectiveDictionary', path: BLADE_DIRECTIVE_DICTIONARY_PATH },
      { name: 'tailwindDirectiveDictionary', path: TAILWIND_DIRECTIVE_DICTIONARY_PATH }
    ],
    dictionaries: ['customBladeDictionary', 'modelDictionary', 'bladeDirectiveDictionary', 'whitelist', 'tailwindDirectiveDictionary'],
    // Bladeディレクティブのみを検証対象とする
    includeRegExpList: [
      /@\w+/g // Bladeディレクティブ（例：@if, @foreach）
    ],
  });
}

// PHPファイル用の設定を取得する関数（コメントアウト）
/*
function getPhpSettings(defaultSettings: any, languageId: string): any {
  return mergeSettings(defaultSettings, {
    language: 'en',
    languageId: languageId,
    dictionaryDefinitions: [
      { name: 'laravel11', path: LARAVEL_DICTIONARY_PATH },
      { name: 'customLaravelDictionary', path: CUSTOM_LARAVEL_DICTIONARY_PATH },
      { name: 'modelDictionary', path: MODEL_DICTIONARY_PATH }
    ],
    dictionaries: ['php', 'laravel11', 'customLaravelDictionary', 'modelDictionary'],
    ignoreRegExpList: PHP_IGNORE_REGEXP_LIST,
  });
}
*/

// HTMLタグ名の検証設定を取得する関数
function getHtmlTagSettings(): any {
  return {
    language: 'en',
    languageId: 'html',
    dictionaryDefinitions: [
      { name: 'htmlTagDictionary', path: HTML_TAG_DICTIONARY_PATH },
      { name: 'bladeComponentDictionary', path: BLADE_COMPONENT_DICTIONARY_PATH },
      { name: 'svgTagDictionary', path: SVG_TAG_DICTIONARY_PATH },
    ],
    dictionaries: ['htmlTagDictionary', 'bladeComponentDictionary', 'svgTagDictionary', 'whitelist'],
    includeRegExpList: [TAG_NAME_REGEXP],
    minWordLength: 1,
  };
}

// 検証結果をDiagnostic形式に変換する関数
function issuesToDiagnostics(issues: ValidationIssue[], textDocument: TextDocument, messageTemplate: string, severity: DiagnosticSeverity): Diagnostic[] {
  return issues.map((issue: ValidationIssue) => ({
    severity: severity,
    range: {
      start: textDocument.positionAt(issue.offset),
      end: textDocument.positionAt(issue.offset + issue.text.length)
    },
    message: messageTemplate.replace('{text}', issue.text),
    source: 'Laravel Navigator for Beginners'
  }));
}

// コードアクションの提供（ドキュメントURIを引数に追加）
connection.onCodeAction((params: CodeActionParams) => {
  const diagnostics = params.context.diagnostics;
  const actions: CodeAction[] = [];

  for (const diagnostic of diagnostics) {
    const document = documents.get(params.textDocument.uri);
    if (!document) continue;

    const range = diagnostic.range;
    const wordToAdd = document.getText(range);

    // ホワイトリストに単語を追加するコードアクションを作成
    const fix = CodeAction.create(
      'ホワイトリストに追加',
      {
        title: 'ホワイトリストに追加',
        command: 'addToWhiteList',
        arguments: [wordToAdd, params.textDocument.uri]
      },
      CodeActionKind.QuickFix
    );
    fix.diagnostics = [diagnostic];
    actions.push(fix);
  }
  return actions;
});

// コマンドの実行時の処理
connection.onExecuteCommand(async (params) => {
  if (params.command === 'addToWhiteList' && params.arguments) {
    const word = params.arguments[0] as string;
    if (!whitelistFilePath) {
      connection.window.showErrorMessage('ホワイトリストのパスが設定されていません');
      return;
    }
    try {
      await fs.promises.appendFile(whitelistFilePath, word + '\n');
      await loadWhitelist();
      connection.window.showInformationMessage(word + 'をホワイトリストに追加しました');
    } catch (error) {
      connection.window.showErrorMessage(word + 'の追加に失敗しました');
    }
    // 診断を更新
    connection.languages.diagnostics.refresh();
  }
});

// 監視ファイルが変更されたときの処理
connection.onDidChangeWatchedFiles(async (_change) => {
  connection.console.log('ファイル変更イベントを受信しました');
  for (const change of _change.changes) {
    const filePath = fileURLToPath(change.uri);
    if (whitelistFilePath && filePath === whitelistFilePath) {
      // ホワイトリストファイルが変更された場合、再読み込み
      await loadWhitelist();
      connection.languages.diagnostics.refresh();
    } else if (change.type === 1 || change.type === 3) {
      // ファイルが追加または変更された場合、モデル名とコンポーネント名を再抽出
      extractModelNames(workspacePath, DICTIONARY_PATH);
      extractBladeComponentNamesAndFolders(workspacePath, DICTIONARY_PATH);
      connection.languages.diagnostics.refresh();
    }
  }
});

// ドキュメントのリスナーを開始
documents.listen(connection);

// LSPサーバーのリスナーを開始
connection.listen();
