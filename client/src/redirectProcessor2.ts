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
    if (redirect.target && typeof redirect.target === 'string') {
      // target が存在する場合、それをルート名として使用
      const routeName = redirect.target;
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
    // } else if (redirect.methods && redirect.methods.length > 0) {
      // methods が存在する場合、それをメソッドとして扱う
      // const methodName = redirect.methods[0]; // 最初のメソッドを使用
      // const targetNode = sanitize('redirect_route_' + methodName);
      // edges.push(`    ${controllerNode} --> ${targetNode}\n`);

      // クリックイベント用にコントローラのファイルと行番号を保存
      // nodes[methodName] = { type: 'method', file: controllerFile, line: redirect.line };
    } else {
      // target も methods も存在しない場合、無視
      // 何もしない
    }
  });

  return { edges, nodes };
}

// Redirected Routesのサブグラフを生成する関数（変更なし）
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
      // methods.push(nodeName);
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
  // if (methods.length > 0) {
    // code += `        subgraph "Methods"\n`;
    // code += `            direction LR\n`;
    // methods.forEach(nodeName => {
    //   const nodeId = sanitize(nodePrefix + nodeName);
    //   const displayName = nodeName + '()';
    //   code += `            ${nodeId}["${displayName}"]\n`;
    //   const filePath = nodes[nodeName].file;
    //   const lineNumber = nodes[nodeName].line;
    //   // クリックイベントを設定
    //   if (filePath && lineNumber !== undefined) {
    //     code += `            click ${nodeId} call clickHandler("${filePath}", ${lineNumber})\n`;
    //   } else if (filePath) {
    //     code += `            click ${nodeId} call clickHandler("${filePath}")\n`;
    //   } else {
    //     code += `            click ${nodeId} call clickHandler("")\n`;
    //   }
    // });
    // code += '        end\n';
  // }

  code += '    end\n\n';
  return code;
}
