// parser_controller.ts

import { Engine } from 'php-parser';
import { RedirectInfo, extractRedirectInfo } from './parser_redirect';

export interface AnalysisResult {
  models: string[];
  views: string[];
  redirects: RedirectInfo[];
  viewVariables: { [viewName: string]: string[] }; // ビューごとの変数マップを追加
}

export interface ControllerInfo {
  file: string;
  models: string[];
  views: string[];
  redirects: RedirectInfo[];
  viewVariables: { [viewName: string]: string[] }; // ビューごとの変数マップを追加
}

export function analyzeControllerPHP(
  content: string,
  filePath: string,
  parser: Engine,
  models: { [key: string]: string }
): AnalysisResult {
  let ast = parser.parseCode(content, filePath);
  let result: AnalysisResult = {
    models: [],
    views: [],
    redirects: [],
    viewVariables: {}, 
  };

  function getMethodName(node: any): string | null {
    if (!node) return null;
    if (node.kind === 'identifier' || node.kind === 'name') {
      return node.name;
    } else if (node.kind === 'propertylookup') {
      return getMethodName(node.offset);
    } else if (node.kind === 'call') {
      return getMethodName(node.what);
    }
    return null;
  }

  // viewで使われている変数を抽出する関数
  function extractVariablesFromArg(arg: any): string[] {
    const variables: string[] = [];

    if (!arg) return variables;

    if (arg.kind === 'array') {
      // 連想配列による渡し方: view('name', ['varName' => $value])
      arg.items.forEach((item: any) => {
        if (item.kind === 'entry') {
          const key = item.key;
          if (!key) return;
          if (key.kind === 'string') {
            variables.push(key.value);
          } else if (key.kind === 'variable') {
            variables.push(key.name);
          }
        }
      });
    } else if (arg.kind === 'variable') {
      // 変数そのものを渡す: view('name', $array)
      variables.push(arg.name);
    } else if (arg.kind === 'call' && arg.what && arg.what.kind === 'identifier' && arg.what.name === 'compact') {
      // compact('var1', 'var2', ...)
      arg.arguments.forEach((argItem: any) => {
        if (argItem.kind === 'string') {
          variables.push(argItem.value);
        }
      });
    }

    return variables;
  }

  function traverse(node: any): void {
    if (!node) return;

    if (node.kind === 'call') {
      const methodName = getMethodName(node.what);

      // モデルの使用を検出
      if (methodName && models[methodName]) {
        result.models.push(methodName);
      }

      // ビューの使用を検出
      if (methodName === 'view') {
        if (
          node.arguments &&
          node.arguments[0] &&
          node.arguments[0].kind === 'string'
        ) {
          const viewName = node.arguments[0].value;
          result.views.push(viewName);

          // 第二引数がある場合は、変数を抽出
          if (node.arguments[1]) {
            const vars = extractVariablesFromArg(node.arguments[1]);
            if (!result.viewVariables[viewName]) {
              result.viewVariables[viewName] = [];
            }
            // 重複排除
            const mergedVars = Array.from(new Set([...result.viewVariables[viewName], ...vars]));
            result.viewVariables[viewName] = mergedVars;
          }
        }
      }

      // リダイレクトの使用を検出
      const redirectInfo = extractRedirectInfo(node, parser);
      if (redirectInfo) {
        result.redirects.push(redirectInfo);
      }
    }

    for (let key in node) {
      if (node.hasOwnProperty(key)) {
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach((c) => {
            if (typeof c === 'object' && c !== null && c.kind) {
              traverse(c);
            }
          });
        } else if (typeof child === 'object' && child !== null && child.kind) {
          traverse(child);
        }
      }
    }
  }

  traverse(ast);
  return result;
}
