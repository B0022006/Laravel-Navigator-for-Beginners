// parser.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { Engine } from 'php-parser';
import {
  RedirectInfo,
  extractRedirectInfo,
} from './parser_redirect'; // リダイレクト解析用の関数をインポート

// メインのパース関数
export async function parse(projectPath: string): Promise<void> {
  // PHPパーサーの設定
  const parser = new Engine({
    parser: {
      extractDoc: true,
      php7: true,
    },
    ast: {
      withPositions: true,
    },
  });

  // Laravelプロジェクト内の各ディレクトリパスを定義
  const controllerDir: string = path.join(projectPath, 'app/Http/Controllers');
  const modelDir: string = path.join(projectPath, 'app/Models');
  const viewDir: string = path.join(projectPath, 'resources/views');
  const routesDir: string = path.join(projectPath, 'routes');

  // 解析結果を格納するインターフェース定義
  interface AnalysisResult {
    models: string[];
    views: string[];
    redirects: RedirectInfo[];
  }

  interface Route {
    method: string;
    path: string;
    controller?: string;
    views?: string[];
    file: string;
    line: number;
  }

  interface ControllerInfo {
    file: string;
    models: string[];
    views: string[];
    redirects: RedirectInfo[];
  }

  // 結果を格納するオブジェクト
  let controllers: { [key: string]: ControllerInfo } = {};
  let models: { [key: string]: string } = {};
  let views: { [key: string]: string } = {};
  let routes: { [key: string]: Route } = {};

  // ディレクトリ内のPHPファイルを再帰的に読み込み、コールバックで処理
  async function readDirectory(
    directory: string,
    callback: (filePath: string, content: string) => void
  ): Promise<void> {
    try {
      const files = await fs.readdir(directory);
      for (const file of files) {
        const filePath: string = path.join(directory, file);
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) {
          await readDirectory(filePath, callback);
        } else if (file.endsWith('.php')) {
          const content: string = await fs.readFile(filePath, 'utf-8');
          callback(filePath, content);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  // PHPコードを解析し、使用されているモデルやビュー、リダイレクトを抽出
  function analyzePHP(content: string, filePath: string): AnalysisResult {
    let ast = parser.parseCode(content, filePath);
    let result: AnalysisResult = {
      models: [],
      views: [],
      redirects: [],
    };
  
    // メソッド名を再帰的に取得する関数
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
  
    // ASTをトラバース（巡回）して、モデルやビューの呼び出しを抽出
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
            result.views.push(node.arguments[0].value);
          }
        }
  
        // リダイレクトの使用を検出
        const redirectInfo = extractRedirectInfo(node, parser);
        if (redirectInfo) {
          result.redirects.push(redirectInfo);
        }
      }
  
      // 子ノードもトラバース
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
  

  // ルート定義を解析し、ルートとコントローラーのマッピングを抽出
  function analyzeRoutes(filePath: string, content: string): Route[] {
    let ast = parser.parseCode(content, filePath);
    let result: Route[] = [];

    // ASTをトラバースして、ルート定義を解析
    function traverse(node: any): void {
      if (node.kind === 'call') {
        let methodName = '';
        let route: Route = {
          method: '',
          path: '',
          file: filePath,
          line: node.loc ? node.loc.start.line : null,
        };

        if (node.what.kind === 'staticlookup') {
          if (node.what.offset && node.what.offset.kind === 'identifier') {
            methodName = node.what.offset.name;
          }
        } else if (node.what.kind === 'propertylookup') {
          if (node.what.offset && node.what.offset.kind === 'identifier') {
            methodName = node.what.offset.name;
          }
        }

        if (
          methodName &&
          ['get', 'post', 'put', 'delete', 'patch', 'options', 'match', 'any'].includes(
            methodName
          )
        ) {
          route.method = methodName;
          if (node.arguments && node.arguments.length > 0) {
            if (node.arguments[0].kind === 'string') {
              route.path = node.arguments[0].value;
            }

            // コントローラの呼び出しを解析
            if (node.arguments[1]) {
              if (
                node.arguments[1].kind === 'string' ||
                node.arguments[1].kind === 'array'
              ) {
                if (node.arguments[1].kind === 'string') {
                  route.controller = node.arguments[1].value;
                } else if (node.arguments[1].kind === 'array') {
                  let controllerAndAction = extractControllerAndAction(node.arguments[1]);
                  if (controllerAndAction.controller && controllerAndAction.action) {
                    route.controller = `${controllerAndAction.controller}@${controllerAndAction.action}`;
                  }
                }
              } else if (node.arguments[1].kind === 'closure') {
                // クロージャの場合はビューを抽出
                const closureNode = node.arguments[1];
                const views = extractViewsFromClosure(closureNode);
                if (views.length > 0) {
                  route.views = views;
                }
              }
            }
          }
          result.push(route);
        }
      }

      // 子ノードもトラバース
      for (let key in node) {
        if (node[key] && typeof node[key] === 'object') {
          traverse(node[key]);
        }
      }
    }

    // コントローラー名とアクション名を抽出する関数
    function extractControllerAndAction(node: any): { controller: string; action: string } {
      let controllerName = '';
      let actionName = '';

      if (node.kind === 'array') {
        if (
          node.items.length > 0 &&
          node.items[0].value.kind === 'staticlookup' &&
          node.items[0].value.what.kind === 'name' &&
          node.items[0].value.what.name &&
          node.items[0].value.offset.kind === 'identifier' &&
          node.items[0].value.offset.name === 'class'
        ) {
          controllerName = node.items[0].value.what.name;
        } else if (node.items[0].value.kind === 'string') {
          controllerName = node.items[0].value.value;
        }
        if (node.items.length > 1 && node.items[1].value.kind === 'string') {
          actionName = node.items[1].value.value;
        }
      }

      return { controller: controllerName, action: actionName };
    }

    // クロージャ内のビューを抽出する関数
    function extractViewsFromClosure(closureNode: any): string[] {
      let views: string[] = [];

      function traverse(node: any): void {
        if (!node) return;

        if (node.kind === 'return') {
          if (
            node.expr &&
            node.expr.kind === 'call' &&
            node.expr.what.name === 'view'
          ) {
            if (
              node.expr.arguments &&
              node.expr.arguments[0] &&
              node.expr.arguments[0].kind === 'string'
            ) {
              views.push(node.expr.arguments[0].value);
            }
          }
        }

        // 子ノードもトラバース
        if (Array.isArray(node.children)) {
          for (let child of node.children) {
            traverse(child);
          }
        } else {
          for (let key in node) {
            if (node[key] && typeof node[key] === 'object') {
              traverse(node[key]);
            }
          }
        }
      }

      traverse(closureNode.body);
      return views;
    }

    traverse(ast);
    return result;
  }

  // 各ディレクトリを非同期で解析
  await Promise.all([
    // モデルディレクトリを解析
    readDirectory(modelDir, (filePath, content) => {
      const modelName = path.basename(filePath, '.php');
      models[modelName] = filePath;
    }),
    // コントローラーディレクトリを解析
    readDirectory(controllerDir, (filePath, content) => {
      const controllerName = path.basename(filePath, '.php');
      const analysis = analyzePHP(content, filePath);
      controllers[controllerName] = {
        file: filePath,
        models: analysis.models,
        views: analysis.views,
        redirects: analysis.redirects,
      };
    }),
    // ビューディレクトリを解析
    readDirectory(viewDir, (filePath) => {
      const relativePath = path.relative(viewDir, filePath).replace(/\\/g, '/');
      if (!relativePath.startsWith('components')) {
        const viewName = relativePath.replace('.blade.php', '');
        views[viewName] = filePath;
      }
    }),
    // ルートディレクトリを解析
    readDirectory(routesDir, (filePath, content) => {
      const routeMappings = analyzeRoutes(filePath, content);
      routeMappings.forEach((route) => {
        const key = `${route.method.toUpperCase()} ${route.path}`;
        if (!routes[key]) {
          routes[key] = route;
        }
      });
    }),
  ]);

  // 解析結果をJSONファイルに保存
  const result = {
    controllers,
    models,
    views,
    routes,
  };
  const outputFilePath: string = path.join(__dirname, 'output.json');
  await fs.writeFile(outputFilePath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`解析結果を ${outputFilePath} に保存しました`);
}
