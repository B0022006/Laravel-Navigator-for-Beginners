// parser_view.ts
import * as path from 'path';
import * as fs from 'fs';

export interface VariablesMap {
    [viewName: string]: {
      file: string;
      variables: string[];
      componentVariables?: {
        [componentName: string]: string[];
      };
    };
  }

/**
 * 指定されたディレクトリ内のBladeテンプレートを解析し、コントローラーから渡されるべき変数を抽出します。
 * @param viewsDir Bladeテンプレートのディレクトリパス
 * @param projectRoot プロジェクトのルートディレクトリパス
 * @returns ビュー名をキーとする変数のマップ
 */
export async function parseViews(viewsDir: string, projectRoot: string): Promise<VariablesMap> {
  const variables: VariablesMap = {};

  // コンポーネントクラスのマッピングを構築
  const componentClassMap = buildComponentClassMapping(projectRoot);

  const includedFiles = new Set<string>(); // インクルードファイルのセットを追加

  await scanDirectory(viewsDir, variables, projectRoot, componentClassMap, includedFiles); // includedFiles を渡す

  return variables;
}

/**
 * コンポーネントクラスのマッピングを構築します。
 * @param projectRoot プロジェクトのルートディレクトリパス
 * @returns コンポーネント名をキー、クラスファイルパスを値とするマップ
 */
function buildComponentClassMapping(projectRoot: string): Map<string, string> {
  const componentClassMap = new Map<string, string>();
  const componentsDir = path.join(projectRoot, 'app', 'View', 'Components');

  function scanComponentsDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        scanComponentsDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.php')) {
        // コンポーネントクラスファイルを読み込む
        const content = fs.readFileSync(fullPath, 'utf-8');
        // renderメソッドからビュー名を取得
        const viewName = extractViewNameFromComponentClass(content);

        if (viewName) {
          // ビュー名からコンポーネント名を導出
          let componentName = viewName;
          if (componentName.startsWith('components.')) {
            componentName = componentName.substring('components.'.length);
          }
          // マッピングに追加
          componentClassMap.set(componentName, fullPath);
        }
      }
    }
  }

  if (fs.existsSync(componentsDir)) {
    scanComponentsDir(componentsDir);
  }

  return componentClassMap;
}

/**
 * コンポーネントクラスファイルの内容からビュー名を抽出します。
 * @param content コンポーネントクラスファイルの内容
 * @returns renderメソッドで使用されているビュー名
 */
function extractViewNameFromComponentClass(content: string): string | null {
  // renderメソッドを探す
  const renderMethodPattern = /public\s+function\s+render\s*\([^)]*\)\s*\{([\s\S]*?)\}/;
  const match = renderMethodPattern.exec(content);

  if (match) {
    const methodBody = match[1];
    // return文からビュー名を抽出
    const returnPattern = /return\s+(?:view\(|['"`])([^)'"`]+)/;
    const returnMatch = returnPattern.exec(methodBody);

    if (returnMatch) {
      const viewName = returnMatch[1];
      return viewName.replace(/['"`]/g, '').trim();
    }
  }

  return null;
}

/**
 * ディレクトリを再帰的に走査し、Bladeファイルを解析します。
 * @param dir 現在のディレクトリ
 * @param variables 変数のマップ
 * @param projectRoot プロジェクトのルートディレクトリパス
 * @param componentClassMap コンポーネント名とクラスファイルパスのマップ
 * @param includedFiles インクルードされたファイルのセット
 */
async function scanDirectory(
  dir: string,
  variables: VariablesMap,
  projectRoot: string,
  componentClassMap: Map<string, string>,
  includedFiles: Set<string> // includedFiles を追加
) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.resolve(path.join(dir, entry.name)); // パスを絶対パスに解決

    if (entry.isDirectory()) {
      // ディレクトリの場合、再帰的に探索
      await scanDirectory(fullPath, variables, projectRoot, componentClassMap, includedFiles);
    } else if (entry.isFile() && entry.name.endsWith('.blade.php')) {
      // Bladeファイルの場合、内容を解析
      const content = fs.readFileSync(fullPath, 'utf-8');
      const processedFiles = new Set<string>();
      const { usedVariables, componentVariables } = extractVariables(
        content,
        fullPath,
        projectRoot,
        componentClassMap,
        processedFiles,
        includedFiles // includedFiles を渡す
      );

      // ビュー名を取得
      const viewName = getViewNameFromPath(fullPath, projectRoot);

      // 'layouts' または 'components' ディレクトリ内のファイルを除外
      const isInLayoutsOrComponents = viewName.startsWith('layouts.') || viewName.startsWith('components.');

      // インクルードファイルに含まれる場合も除外
      const isIncludedFile = includedFiles.has(fullPath);

      if (!isInLayoutsOrComponents && !isIncludedFile) {
        if (!variables[viewName]) {
          variables[viewName] = {
            file: fullPath,
            variables: [],
          };
        }

        variables[viewName].variables.push(...Array.from(usedVariables));

        // コンポーネントの変数を別途保存
        if (Object.keys(componentVariables).length > 0) {
          variables[viewName].componentVariables = componentVariables;
        }
      }
    }
  }
}

/**
 * Bladeテンプレートの内容からコントローラーから渡されるべき変数を抽出します。
 * @param content Bladeテンプレートの内容
 * @param filePath ファイルのパス
 * @param projectRoot プロジェクトのルートディレクトリパス
 * @param componentClassMap コンポーネント名とクラスファイルパスのマップ
 * @param processedFiles 処理済みファイルのセット
 * @param includedFiles インクルードされたファイルのセット
 * @returns コントローラーから渡されるべき変数のセットとコンポーネント変数のマップ
 */
function extractVariables(
  content: string,
  filePath: string,
  projectRoot: string,
  componentClassMap: Map<string, string>,
  processedFiles: Set<string>,
  includedFiles: Set<string> // includedFiles を追加
): { usedVariables: Set<string>; componentVariables: { [componentName: string]: string[] } } {
  const usedVariables = new Set<string>();
  const definedVariables = new Set<string>();
  const collectionToLoopVariablesMap: Map<string, string[]> = new Map();

  const componentVariablesMap: { [componentName: string]: string[] } = {};

  // 処理済みファイルに追加
  processedFiles.add(filePath);

  // コメントをマスク
  content = content.replace(/<!--[\s\S]*?-->/g, (match) => {
    return match.replace(/./g, ' '); // マッチ部分をスペースに置き換える
  });

  // blade.phpのコメントをマスク
  content = content.replace(/{{--[\s\S]*?--}}/g, (match) => {
    return match.replace(/./g, ' '); // マッチ部分をスペースに置き換える
  });

  // @{{ }}内の変数をマスク
  content = content.replace(/@{{(.*?)}}/g, (match, content) => {
    return `@{{${content.replace(/./g, ' ')}}}`; // マッチ部分をスペースに置き換える
  });

  // @verbatimディレクティブと@endverbatim間の{{ }}内の変数をマスク
  content = content.replace(/@verbatim([\s\S]*?)@endverbatim/g, (match, content) => {
    return match.replace(/{{(.*?)}}/g, (match, content) => {
      return `{{${content.replace(/./g, ' ')}}}`; // マッチ部分をスペースに置き換える
    });
  });

  // @sessionディレクティブと@endsession間の$valueをマスク
  content = content.replace(/@session([\s\S]*?)@endsession/g, (match, content) => {
    return content.replace(/\$value(?!\w)/g, ' '); // $valueをマスク
  });
//   console.log(content);

  // 以下、{{ }}内の' 'や" "をマスクする処理をステップごとに分けて実行
  const maskedStrings: string[] = [];
  
  // ステップ 1: マスク処理（@includeの中はマスクしない）
  function maskQuotes(text: string): string {
    return text.replace(/(['"])(.*?)(?<!\\)\1/g, (match, quote, content, offset) => {
      // @include内かどうかチェック
      const beforeInclude = text.slice(0, offset).lastIndexOf('@include(');
      const insideInclude = beforeInclude !== -1 && text.slice(beforeInclude, offset).includes(')') === false;
      if (insideInclude) return match; // @includeの中ならマスクせずそのまま返す

      // それ以外ならマスクしてリストに追加
      maskedStrings.push(match);
      return `__MASK_${maskedStrings.length - 1}__`; // プレースホルダーで置換
    });
  }

  let maskedText = maskQuotes(content);
  // console.log(maskedText);

  // ステップ 2: マスクしたワードの中に{{}}があるかチェックし、{{}}内の''や""の中身を消去
  function processMaskedContent(maskedStrings: string[]): string[] {
    return maskedStrings.map((str) => {
      return str.replace(/{{(.*?)}}/g, (match, content) => {
        // {{}} 内の内容から '' や "" を削除
        return `{{${content.replace(/(['"]).*?\1/g, '$1$1')}}`;
      });
    });
  }

  const processedMaskedStrings = processMaskedContent(maskedStrings);
  // console.log(maskedText);

  // ステップ 3: マスクした内容を復元。{{}}の中はそのまま、それ以外は空に
  function unmaskQuotes(text: string): string {
    return text.replace(/__MASK_(\d+)__/g, (_, index) => {
      const originalContent = processedMaskedStrings[parseInt(index, 10)];
      // {{}} 内はそのまま復元、それ以外は空に
      return originalContent.includes('{{') ? originalContent : '';
    });
  }
//   console.log(unmaskQuotes(maskedText));
  content = unmaskQuotes(maskedText);

  // 使用されている変数のパターン
  const variablePatterns = [
    /\{\{\s*(\$[a-zA-Z_][\w]*)\s*\}\}/g, // {{ $variable }}
    /\@isset\s*\((\$[a-zA-Z_][\w]*)\)/g, // @isset ($variable)
    /\@empty\s*\((\$[a-zA-Z_][\w]*)\)/g, // @empty ($variable)
    /\{\{\s*([^}]+)\s*\}\}/g, // {{ expression }}
    /\@if\s*\(\s*([^)]*)\)/g, // @if ($variable)
    /\@elseif\s*\(\s*([^)]*)\)/g, // @elseif ($variable)
    /\@unless\s*\(\s*([^)]*)\)/g, // @unless ($variable)
    /\@auth\s*\(\s*([^)]*)\)/g, // @auth ($variable)
    /\@guest\s*\(\s*([^)]*)\)/g, // @guest ($variable)
    /\@env\s*\(\s*([^)]*)\)/g, // @env ($variable)
    /\@hasSection\s*\(\s*([^)]*)\)/g, // @hasSection ($variable)
    /\@sectionMissing\s*\(\s*([^)]*)\)/g, // @sectionMissing ($variable)
    /\@yield\s*\(\s*([^)]*)\)/g, // @yield ($variable)
    /\@switch\s*\(\s*([^)]*)\)/g, // @switch ($variable)
    /\@case\s*\(\s*([^)]*)\)/g, // @case ($variable)
    /\@break\s*\(\s*([^)]*)\)/g, // @break ($variable)
    /\@foreach\s*\(\s*([^\)]*)\)/g, // @foreach ($variable as $key => $value)
    /\@selected\s*\(\s*([^)]*)\)/g, // @selected ($variable)
    /\@session\s*\(\s*([^)]*)\)/g, // @session ($variable)
    /\@[a-zA-Z_]+\s*\(\s*((?:[^()]+|\([^()]*\))*)\s*\)/g, // @function ($variable)
    /\@include\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\[[^\]]*\]|\{[^\}]*\}))?\s*\)/g, // @include('view.name', [...])
  ];

  // 使用されている変数を収集
  for (const pattern of variablePatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (pattern === variablePatterns[variablePatterns.length - 1]) {
        // @includeディレクティブの処理
        const includeViewName = match[1];
        // ビューのファイルパスを解決
        const includeFilePath = resolveViewPath(includeViewName, projectRoot);
        if (includeFilePath) {
          const resolvedIncludeFilePath = path.resolve(includeFilePath);
          includedFiles.add(resolvedIncludeFilePath); // includedFiles に追加

          if (!processedFiles.has(resolvedIncludeFilePath)) {
            if (fs.existsSync(resolvedIncludeFilePath)) {
              const includeContent = fs.readFileSync(resolvedIncludeFilePath, 'utf-8');
              // 再帰的に解析
              const { usedVariables: includeUsedVariables } = extractVariables(
                includeContent,
                resolvedIncludeFilePath,
                projectRoot,
                componentClassMap,
                processedFiles,
                includedFiles // includedFiles を渡す
              );
              includeUsedVariables.forEach((varName) => usedVariables.add(varName));
            }
          }
        }
        // @includeの引数に含まれる変数を抽出
        if (match[2]) {
          const variables = extractVariablesFromExpression(match[2]);
          variables.forEach((varName) => usedVariables.add(varName));
        }
      } else {
        const varMatch = match[1];
        const variables = extractVariablesFromExpression(varMatch);
        variables.forEach((varName) => usedVariables.add(varName));
      }
    }
  }

  // 定義された変数のパターンと抽出ロジック
  const definedVariablePatterns = [
    // 変数の代入（PHPコード）
    {
      pattern: /\$[a-zA-Z_][\w]*\s*=.*;/g,
      extractor: (match: RegExpExecArray) => {
        const varNameMatch = /\$([a-zA-Z_][\w]*)\s*=/.exec(match[0]);
        return varNameMatch ? [varNameMatch[1]] : [];
      },
    },
    // Bladeディレクティブでの変数定義（例：@foreach、@for、@while）
    {
      pattern: /\@(foreach|for|while)\s*\(\s*([^\)]*)\)/g,
      extractor: (match: RegExpExecArray) => {
        const directive = match[1];
        const expression = match[2];
        const variables = [];

        if (directive === 'foreach') {
          const foreachPattern = /^\s*(\$.+?)\s+as\s+(.+)$/;
          const foreachMatch = foreachPattern.exec(expression);
          if (foreachMatch) {
            const iterable = foreachMatch[1]; // イテレートする変数
            const asPart = foreachMatch[2]; // ループ変数部分

            // イテレートする変数から変数名を抽出して、usedVariablesに追加
            const iterableVariables = extractVariablesFromExpression(iterable);
            iterableVariables.forEach((varName) => usedVariables.add(varName));

            // ループ変数を抽出して、definedVariablesに追加
            const loopVariables: string[] = [];
            const varParts = asPart.split('=>').map((s) => s.trim());
            varParts.forEach((varStr) => {
              const varNameMatch = /^\$([a-zA-Z_][\w]*)$/.exec(varStr);
              if (varNameMatch) {
                const varName = varNameMatch[1];
                variables.push(varName);
                loopVariables.push(varName);
              }
            });

            // コレクション変数とループ変数が同じ場合を記録
            iterableVariables.forEach((colVar) => {
              if (loopVariables.includes(colVar)) {
                // 同じ変数名がコレクションとループ変数で使われている場合
                // 除外処理を行わないために、記録しておく
                collectionToLoopVariablesMap.set(colVar, loopVariables);
              }
            });
          }
        } else if (directive === 'for' || directive === 'while') {
          const assignmentPattern = /\$([a-zA-Z_][\w]*)\s*=/g;
          let assignmentMatch;
          while ((assignmentMatch = assignmentPattern.exec(expression)) !== null) {
            variables.push(assignmentMatch[1]);
          }
        }

        return variables;
      },
    },
    // @phpブロック内の変数定義
    {
      pattern: /\@php\s*(.*?)\s*\@endphp/gs,
      extractor: (match: RegExpExecArray) => {
        const phpCode = match[1];
        const varPattern = /\$[a-zA-Z_][\w]*\s*=.*?;/g;
        const variables = [];
        let varMatch;
        while ((varMatch = varPattern.exec(phpCode)) !== null) {
          const varNameMatch = /\$([a-zA-Z_][\w]*)\s*=/.exec(varMatch[0]);
          if (varNameMatch) {
            variables.push(varNameMatch[1]);
          }
        }
        return variables;
      },
    },
  ];

  // 定義された変数を収集
  for (const { pattern, extractor } of definedVariablePatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const variables = extractor(match);
      variables.forEach((varName) => definedVariables.add(varName));
    }
  }

  // 定義された変数を使用されている変数から除外
  definedVariables.forEach((varName) => {
    // コレクションとループ変数が同じ場合は除外しない
    if (!collectionToLoopVariablesMap.has(varName)) {
      usedVariables.delete(varName);
    }
  });

  // コンポーネントの処理
  const componentPattern = /<x-([a-zA-Z0-9\-_.:]+)(.*?)\/?>/gs;
  let componentMatch;

  while ((componentMatch = componentPattern.exec(content)) !== null) {
    const componentName = componentMatch[1].replace(/\./g, '/'); // '.'を'/'に変換
    const attributes = componentMatch[2];
    const attributeVariables = extractVariablesFromAttributes(attributes);
    // コンポーネントの属性で使用されている変数を追加
    attributeVariables.forEach((varName) => usedVariables.add(varName));

    // コンポーネント内の変数を別途取得
    const componentVariables = processComponent(
      componentName,
      projectRoot,
      componentClassMap,
      processedFiles,
      includedFiles // includedFiles を渡す
    );
    componentVariablesMap[componentName] = Array.from(componentVariables);

    // コンポーネントの変数を本体に統合しない
    // componentVariables.forEach(varName => usedVariables.add(varName));
  }

  return { usedVariables, componentVariables: componentVariablesMap };
}

/**
 * 式から変数を抽出します。
 * @param expression 式の文字列
 * @returns 抽出された変数名のセット
 */
function extractVariablesFromExpression(expression: string): Set<string> {
  const variables = new Set<string>();
  const variablePattern = /\$[a-zA-Z_][\w]*/g;
  let match;

  while ((match = variablePattern.exec(expression)) !== null) {
    const varName = match[0].substring(1); // $を除去

    // 特別な変数を除外
    const specialVariables = [
      'app',
      'slot',
      'attributes',
      'loop',
      'errors',
      '__env',
      '__data',
      '__path',
    ];
    if (!specialVariables.includes(varName)) {
      variables.add(varName);
    }
  }

  return variables;
}

/**
 * コンポーネントの属性から変数を抽出します。
 * @param attributes コンポーネントの属性文字列
 * @returns 抽出された変数名のセット
 */
function extractVariablesFromAttributes(attributes: string): Set<string> {
  const variables = new Set<string>();
  const attributePattern = /(?:\s|^):?([\$a-zA-Z_:][\w\-.:]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;

  while ((match = attributePattern.exec(attributes)) !== null) {
    const attrName = match[1];
    const attrValue = match[2] || match[3] || match[4];

    // 属性値から変数を抽出
    if (attrValue) {
      const exprVariables = extractVariablesFromExpression(attrValue);
      exprVariables.forEach((varName) => variables.add(varName));
    }

    // 属性名が '$' から始まる場合、変数として扱う（Bladeのショートハンド）
    if (attrName.startsWith('$')) {
      const exprVariables = extractVariablesFromExpression(attrName);
      exprVariables.forEach((varName) => variables.add(varName));
    }
  }

  return variables;
}

/**
 * コンポーネントを処理し、使用されている変数を抽出します。
 * @param componentName コンポーネント名
 * @param projectRoot プロジェクトのルートディレクトリパス
 * @param componentClassMap コンポーネント名とクラスファイルパスのマップ
 * @param processedFiles 処理済みファイルのセット
 * @param includedFiles インクルードされたファイルのセット
 * @returns 使用されている変数名のセット
 */
function processComponent(
  componentName: string,
  projectRoot: string,
  componentClassMap: Map<string, string>,
  processedFiles: Set<string>,
  includedFiles: Set<string> // includedFiles を追加
): Set<string> {
  const componentVariables = new Set<string>();

  // マッピングからコンポーネントクラスファイルを取得
  const componentClassFile = componentClassMap.get(componentName.replace(/\//g, '.'));

  if (componentClassFile && fs.existsSync(componentClassFile)) {
    // コンポーネントクラスファイルを読み込む
    const classContent = fs.readFileSync(componentClassFile, 'utf-8');

    // クラスからビュー名を取得
    const viewName = extractViewNameFromComponentClass(classContent);

    // コンポーネントクラスのパブリックプロパティを取得
    const classProperties = getComponentClassPropertiesFromContent(classContent);

    if (viewName) {
      // ビュー名からビューのパスを取得
      const componentViewPath = resolveViewPath(viewName, projectRoot);

      if (
        componentViewPath &&
        fs.existsSync(componentViewPath) &&
        !processedFiles.has(componentViewPath)
      ) {
        const content = fs.readFileSync(componentViewPath, 'utf-8');
        // 再帰的に解析
        const { usedVariables } = extractVariables(
          content,
          componentViewPath,
          projectRoot,
          componentClassMap,
          processedFiles,
          includedFiles // includedFiles を渡す
        );

        // コンポーネントクラスのパブリックプロパティを使用されている変数から除外
        classProperties.forEach((prop) => usedVariables.delete(prop));

        // 特別な変数を除外
        const specialVariables = [
          'slot',
          'attributes',
          'component',
          'loop',
          'errors',
          'message',
          'status',
          '__env',
          '__data',
          '__path',
          'data',
          'parent',
        ];
        specialVariables.forEach((varName) => usedVariables.delete(varName));

        // コンポーネントに渡された変数を定義された変数とみなさない
        usedVariables.forEach((varName) => componentVariables.add(varName));
      }
    }
  }

  return componentVariables;
}

/**
 * ビュー名からビューのファイルパスを解決します。
 * @param viewName ビュー名（例：'components.alert'）
 * @param projectRoot プロジェクトのルートディレクトリパス
 * @returns ビューファイルのパスまたはnull
 */
function resolveViewPath(viewName: string, projectRoot: string): string | null {
  const viewPathParts = viewName.split('.');
  const viewFileName = viewPathParts.join('/') + '.blade.php';

  const viewFilePath = path.join(projectRoot, 'resources', 'views', viewFileName);

  if (fs.existsSync(viewFilePath)) {
    return viewFilePath;
  } else {
    return null;
  }
}

/**
 * コンポーネントクラスの内容からパブリックプロパティを取得します。
 * @param classContent コンポーネントクラスファイルの内容
 * @returns パブリックプロパティ名のセット
 */
function getComponentClassPropertiesFromContent(classContent: string): Set<string> {
  const properties = new Set<string>();

  // PHPのパブリックプロパティを正規表現で抽出
  const propertyPattern = /public\s+\$([a-zA-Z_][\w]*)/g;
  let match;
  while ((match = propertyPattern.exec(classContent)) !== null) {
    properties.add(match[1]);
  }

  return properties;
}

/**
 * ファイルパスからビュー名を取得します。
 * @param filePath ファイルのパス
 * @param projectRoot プロジェクトのルートディレクトリパス
 * @returns ビュー名
 */
function getViewNameFromPath(filePath: string, projectRoot: string): string {
  const viewsPath = path.join(projectRoot, 'resources', 'views');
  let relativePath = path.relative(viewsPath, filePath);
  relativePath = relativePath.replace(/\.blade\.php$/, '');
  return relativePath.split(path.sep).join('.');
}
