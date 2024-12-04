// parser_redirect.ts

import { Engine } from 'php-parser';

export interface RedirectInfo {
  type: 'redirect';
  methods: string[] | null;
  arguments: any[];
  target: string | null;
  line: number;
}

// リダイレクトの解析に関する関数を定義

// メソッドチェーンを取得する関数
export function getMethodChain(node: any): { methods: string[]; arguments: any[][] } {
  let methods: string[] = [];
  let argumentsList: any[][] = [];

  function collect(node: any) {
    if (!node) return;

    if (node.kind === 'call') {
      let args = node.arguments;

      if (node.what.kind === 'propertylookup' || node.what.kind === 'staticlookup') {
        // メソッドチェーン ($obj->method()) を処理
        let methodName = '';
        if (node.what.offset.kind === 'identifier') {
          methodName = node.what.offset.name;
        } else if (node.what.offset.kind === 'constref') {
          methodName = node.what.offset.name;
        } else if (node.what.offset.kind === 'string') {
          methodName = node.what.offset.value;
        }
        methods.push(methodName);
        argumentsList.push(args);

        collect(node.what.what);
      } else if (node.what.kind === 'call') {
        // ネストされた呼び出し (foo()->bar()) を処理
        collect(node.what);
      } else if (node.what.kind === 'name' || node.what.kind === 'identifier') {
        let methodName = node.what.name;
        methods.push(methodName);
        argumentsList.push(args);
      }
    } else if (node.kind === 'propertylookup' || node.kind === 'staticlookup') {
      collect(node.what);
    }
  }

  collect(node);

  return { methods: methods.reverse(), arguments: argumentsList.reverse() };
}

// リダイレクトのターゲットを抽出する関数
export function extractRedirectTarget(node: any): string | null {
  let target: string = null;

  function processNode(node: any) {
    if (node.kind === 'call' && node.what) {
      let methodName = getMethodName(node.what);

      if (methodName === 'route') {
        // 'route' メソッドの引数を処理
        if (node.arguments && node.arguments.length > 0) {
          const firstArg = node.arguments[0];
          if (firstArg.kind === 'string') {
            target = firstArg.value;
          }
        }
      }

      // 引数を再帰的に処理
      if (node.arguments && Array.isArray(node.arguments)) {
        node.arguments.forEach((arg: any) => {
          processNode(arg);
        });
      }

      // node.what を再帰的に処理
      processNode(node.what);
    } else if (node.kind === 'string') {
      // 'string' ノードからターゲットを抽出
      if (!target) {
        target = node.value;
      }
    } else if (node.kind === 'propertylookup' || node.kind === 'staticlookup') {
      if (node.what) {
        processNode(node.what);
      }
      if (node.offset) {
        processNode(node.offset);
      }
    } else if (node.kind === 'array' && node.items) {
      node.items.forEach((item: any) => {
        processNode(item);
      });
    } else if (node.kind === 'expressionstatement' && node.expression) {
      processNode(node.expression);
    } else if (node.kind === 'assign' && node.right) {
      processNode(node.right);
    } else if (node.kind === 'return' && node.expr) {
      processNode(node.expr);
    } else if (node.kind === 'bin') {
      processNode(node.left);
      processNode(node.right);
    } else if (node.kind === 'retif') {
      processNode(node.test);
      processNode(node.trueExpr);
      processNode(node.falseExpr);
    } else if (node.kind === 'if') {
      processNode(node.test);
      if (node.body && node.body.children) {
        node.body.children.forEach((child: any) => {
          processNode(child);
        });
      }
      if (node.alternate) {
        processNode(node.alternate);
      }
    } else if (node.kind === 'method' && node.body && node.body.children) {
      node.body.children.forEach((child: any) => {
        processNode(child);
      });
    } else if (node.kind === 'new' && node.what) {
      processNode(node.what);
    } else if (node.kind === 'class' && node.body && node.body.children) {
      node.body.children.forEach((child: any) => {
        processNode(child);
      });
    }
  }

  function getMethodName(node: any): string | null {
    if (node.kind === 'propertylookup' || node.kind === 'staticlookup') {
      if (node.offset) {
        if (node.offset.kind === 'identifier') {
          return node.offset.name;
        } else if (node.offset.kind === 'string') {
          return node.offset.value;
        }
      }
      return getMethodName(node.what);
    } else if (node.kind === 'call') {
      return getMethodName(node.what);
    } else if (node.kind === 'name') {
      return node.name;
    }
    return null;
  }

  processNode(node);

  return target;
}

// リダイレクト情報を抽出する関数
export function extractRedirectInfo(
  node: any,
  parser: Engine
): RedirectInfo | null {
  if (!node) return null;

  if (node.kind === 'call') {
    let chain = getMethodChain(node);

    if (chain.methods[0] && chain.methods[0].toLowerCase() === 'redirect') {
      // リダイレクト呼び出しを検出
      const redirectInfo: RedirectInfo = {
        type: 'redirect',
        methods: chain.methods.slice(1),
        arguments: chain.arguments.slice(1),
        target: null,
        line: node.loc ? node.loc.start.line : null,
      };

      // ターゲットを抽出
      redirectInfo.target = extractRedirectTarget(node);

      // methodsが空の場合はnullに設定
      if (redirectInfo.methods.length === 0) {
        redirectInfo.methods = null;
      }

      // targetもmethodsも存在しない場合、nullを返す
      if (redirectInfo.target !== null || redirectInfo.methods !== null) {
        return redirectInfo;
      }
    }
  }
  return null;
}
