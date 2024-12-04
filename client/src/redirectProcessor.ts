// redirectProcessor.ts

import { Data, sanitize, groupNodesByFolder } from './transMermaid4'; // 必要な型をインポート

// Redirect インターフェースをエクスポート
export interface Redirect {
  type: string;
  methods: string[];
  arguments: any[];
  target: any;
  line: number;
}

// リダイレクトの処理結果を保持するインターフェース
export interface RedirectProcessingResult {
  edges: string[];
  nodes: { [key: string]: { type: 'route' | 'method' | 'url'; file?: string; line?: number } };
}

// ルート名を抽出する関数
export function extractRouteNamesFromRedirect(redirect: Redirect): string[] {
  let routeNames: string[] = [];

  function processNode(node: any) {
    if (node.kind === 'call' && node.what && node.what.kind === 'name') {
      const methodName = node.what.name;

      if (methodName === 'route') {
        // 'route' メソッドの引数を処理
        if (node.arguments && node.arguments.length > 0) {
          const firstArg = node.arguments[0];
          if (firstArg.kind === 'string') {
            routeNames.push(firstArg.value);
          }
        }
      }
      // 引数を再帰的に探索してネストされた 'route' 呼び出しを検出
      if (node.arguments && Array.isArray(node.arguments)) {
        node.arguments.forEach((arg: any) => {
          processNode(arg);
        });
      }
    } else if (node.kind === 'array' && node.items) {
      // 配列の要素を再帰的に処理
      node.items.forEach((item: any) => {
        processNode(item);
      });
    } else if (node.kind === 'propertylookup' || node.kind === 'staticlookup') {
      // オブジェクトプロパティのアクセスを処理
      if (node.what) {
        processNode(node.what);
      }
      if (node.offset) {
        processNode(node.offset);
      }
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
    } else if (node.kind === 'call') {
      // 呼び出し式を処理
      if (node.what) {
        processNode(node.what);
      }
      if (node.arguments) {
        node.arguments.forEach((arg: any) => {
          processNode(arg);
        });
      }
    } else if (node.kind === 'new' && node.what) {
      processNode(node.what);
    } else if (node.kind === 'class' && node.body && node.body.children) {
      node.body.children.forEach((child: any) => {
        processNode(child);
      });
    }
    // 必要に応じて他のノードタイプを追加
  }

  redirect.arguments.forEach((argArray: any[]) => {
    argArray.forEach((astNode: any) => {
      processNode(astNode);
    });
  });

  return routeNames;
}

// メソッド名を抽出する関数
export function extractMethodNameFromRedirect(redirect: Redirect): string | null {
  if (redirect.target && typeof redirect.target === 'string') {
    return redirect.target;
  }
  return null;
}

// リダイレクトを処理する関数
export function processRedirects(
  data: Data,
  controllerName: string,
  redirects: Redirect[],
  controllerFile: string,
  sanitize: (name: string) => string
): RedirectProcessingResult {
  let edges: string[] = [];
  let nodes: { [key: string]: { type: 'route' | 'method' | 'url'; file?: string; line?: number } } = {};

  const controllerNode = sanitize('controller_' + controllerName);

  redirects.forEach(redirect => {
    const routeNames = extractRouteNamesFromRedirect(redirect);
    const methodName = extractMethodNameFromRedirect(redirect);

    let connected = false;

    // 1. ルート名が存在し、ファイルがわかる場合の処理を変更
    routeNames.forEach(routeName => {
      const targetNode = sanitize('redirect_route_' + routeName);
      edges.push(`    ${controllerNode} --> ${targetNode}\n`);

      // ルート名の先頭が"/"かどうかを判定
      const nodeType = routeName.startsWith('/') ? 'url' : 'route';

      // ルートが data.routes に存在する場合、ファイル情報を取得
      if (data.routes[routeName]) {
        nodes[routeName] = {
          type: nodeType,
          file: data.routes[routeName].file,
          line: data.routes[routeName].line
        };
      } else {
        // data.routes に存在しない場合でもノードを作成（ファイル情報なし）
        nodes[routeName] = {
          type: nodeType,
          file: null,
          line: null
        };
      }
      connected = true;
    });

    // 2. ルートに接続できない場合のみメソッドを追加
    if (!connected && methodName) {
      const targetNode = sanitize('redirect_route_' + methodName);
      edges.push(`    ${controllerNode} --> ${targetNode}\n`);

      // クリックイベント用にコントローラのファイルと行番号を保存
      nodes[methodName] = { type: 'method', file: controllerFile, line: redirect.line };
    }
  });

  return { edges, nodes };
}

// Redirected Routesのサブグラフを生成する関数
export function generateRedirectedRoutesSubgraph(
  graphName: string,
  nodes: { [key: string]: { type: 'route' | 'method' | 'url'; file?: string; line?: number } },
  nodePrefix: string,
  baseDir: string
): string {
  let code = '';
  code += `    subgraph "${graphName}"\n`;
  code += `        direction LR\n`;

  // ノードをタイプで分ける
  let routes: string[] = [];
  let methods: string[] = [];
  let urls: string[] = [];

  for (let nodeName in nodes) {
    if (nodes[nodeName].type === 'route') {
      routes.push(nodeName);
    } else if (nodes[nodeName].type === 'method') {
      methods.push(nodeName);
    } else if (nodes[nodeName].type === 'url') {
      urls.push(nodeName);
    }
  }

  // URLsサブグラフの処理
  if (urls.length > 0) {
    code += `        subgraph "urls"\n`;
    code += `            direction LR\n`;
    urls.forEach(nodeName => {
      const nodeId = sanitize(nodePrefix + nodeName);
      const displayName = nodeName;
      code += `            ${nodeId}["${displayName}"]\n`;
      const filePath = nodes[nodeName].file;
      const lineNumber = nodes[nodeName].line;
      // クリックイベントを設定
      if (filePath && lineNumber !== undefined) {
        code += `            click ${nodeId} call clickHandler("${filePath}", ${lineNumber})\n`;
      } else if (filePath) {
        code += `            click ${nodeId} call clickHandler("${filePath}")\n`;
      } else {
        code += `            click ${nodeId} call clickHandler("")\n`;
      }
    });
    code += '        end\n';
  }

  // Redirect Routesサブグラフの処理
  if (routes.length > 0) {
    code += `        subgraph "redirect_routes"\n`;
    code += `            direction LR\n`;
    routes.forEach(nodeName => {
      const nodeId = sanitize(nodePrefix + nodeName);
      const displayName = nodeName;
      code += `            ${nodeId}["${displayName}"]\n`;
      const filePath = nodes[nodeName].file;
      const lineNumber = nodes[nodeName].line;
      // クリックイベントを設定
      if (filePath && lineNumber !== undefined) {
        code += `            click ${nodeId} call clickHandler("${filePath}", ${lineNumber})\n`;
      } else if (filePath) {
        code += `            click ${nodeId} call clickHandler("${filePath}")\n`;
      } else {
        code += `            click ${nodeId} call clickHandler("")\n`;
      }
    });
    code += '        end\n';
  }

  // Methodsサブグラフの処理
  if (methods.length > 0) {
    code += `        subgraph "Methods"\n`;
    code += `            direction LR\n`;
    methods.forEach(nodeName => {
      const nodeId = sanitize(nodePrefix + nodeName);
      const displayName = nodeName + '()';
      code += `            ${nodeId}["${displayName}"]\n`;
      const filePath = nodes[nodeName].file;
      const lineNumber = nodes[nodeName].line;
      // クリックイベントを設定
      if (filePath && lineNumber !== undefined) {
        code += `            click ${nodeId} call clickHandler("${filePath}", ${lineNumber})\n`;
      } else if (filePath) {
        code += `            click ${nodeId} call clickHandler("${filePath}")\n`;
      } else {
        code += `            click ${nodeId} call clickHandler("")\n`;
      }
    });
    code += '        end\n';
  }

  code += '    end\n\n';
  return code;
}