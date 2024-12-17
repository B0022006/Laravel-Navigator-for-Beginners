// transMermaid.ts

import * as fs from 'fs';
import * as path from 'path';

// 別のモジュールから関数をインポート
import { processRedirects, Redirect, generateRedirectedRoutesSubgraph } from './redirectProcessor';

export interface Route {
  method: string;
  controller?: string;
  views?: string[];
  file: string;
  line: number;
}

export interface Controller {
  models: string[];
  views: string[];
  file: string;
  redirects?: Redirect[];
  viewVariables: { [viewName: string]: string[] };
}

export interface View {
  file: string;
  variables: string[];
  componentVariables?: { [componentName: string]: string[] };
}

export interface Data {
  routes: { [key: string]: Route };
  controllers: { [key: string]: Controller };
  models: { [key: string]: string };
  views: { [key: string]: View };
}

// サニタイズ関数
export function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}

// ノードをフォルダごとにグループ化する関数
export function groupNodesByFolder<T extends { file?: string }>(
  nodes: { [key: string]: T },
  baseDir: string
): { [folder: string]: string[] } {
  let folders: { [folder: string]: string[] } = {};
  for (let nodeName in nodes) {
    const filePath = nodes[nodeName].file;
    let folderPath = 'unknown';
    if (filePath) {
      const relativePath = path.relative(baseDir, filePath);
      folderPath = path.dirname(relativePath);
    }
    if (!folders[folderPath]) {
      folders[folderPath] = [];
    }
    folders[folderPath].push(nodeName);
  }
  return folders;
}

export function groupNodesByFile<T extends { file?: string }>(
  nodes: { [key: string]: T },
  baseDir: string
): { [file: string]: string[] } {
  let files: { [file: string]: string[] } = {};
  for (let nodeName in nodes) {
    const filePath = nodes[nodeName].file;
    const relativePath = filePath ? path.relative(baseDir, filePath) : 'unknown';
    if (!files[relativePath]) {
      files[relativePath] = [];
    }
    files[relativePath].push(nodeName);
  }
  return files;
}

export function transMermaid(): string {
  function generateMermaidCode(data: Data): string {
    let mermaidCode = 'flowchart LR\n\n';

    // 全ファイルパスを収集して共通のベースディレクトリを見つける
    let allFilePaths: string[] = [];

    // ファイルパスの収集
    for (let controllerName in data.controllers) {
      allFilePaths.push(data.controllers[controllerName].file);
    }
    for (let modelName in data.models) {
      allFilePaths.push(data.models[modelName]);
    }
    for (let viewName in data.views) {
      allFilePaths.push(data.views[viewName].file);
    }
    for (let routeName in data.routes) {
      allFilePaths.push(data.routes[routeName].file);
    }
    // 共通のベースディレクトリを計算
    const baseDir = findCommonBasePath(allFilePaths);

    function findCommonBasePath(paths: string[]): string {
      if (paths.length === 0) return '';
      let commonPath = paths[0];
      for (let i = 1; i < paths.length; i++) {
        commonPath = getCommonPath(commonPath, paths[i]);
        if (commonPath === '') break;
      }
      return commonPath;
    }

    function getCommonPath(path1: string, path2: string): string {
      const dirs1 = path1.split(path.sep);
      const dirs2 = path2.split(path.sep);
      const length = Math.min(dirs1.length, dirs2.length);
      let commonDirs = [];
      for (let i = 0; i < length; i++) {
        if (dirs1[i] === dirs2[i]) {
          commonDirs.push(dirs1[i]);
        } else {
          break;
        }
      }
      return commonDirs.join(path.sep);
    }

    // ノード間の矢印を追跡して重複を防ぐ
    let edgesSet = new Set<string>();
    // サブグラフを生成する関数
    function generateSubgraph(
      graphName: string,
      nodes: { [key: string]: { file?: string; line?: number } },
      nodePrefix: string,
      folders: { [folder: string]: string[] }
    ): string {
      let code = '';
      code += `    subgraph "${graphName}"\n`;
      code += `        direction LR\n`;
      for (let folder in folders) {
        code += `        subgraph "${folder}"\n`;
        code += `            direction LR\n`;
        folders[folder].forEach(nodeName => {
          const nodeId = sanitize(nodePrefix + nodeName);
          const displayName = nodeName;
          code += `            ${nodeId}["${displayName}"]\n`;
          const filePath = nodes[nodeName].file;
          const lineNumber = nodes[nodeName].line;
          if (lineNumber !== undefined) {
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
    // Routesのサブグラフを生成
    const routeFolders = groupNodesByFile(data.routes, baseDir);
    mermaidCode += generateSubgraph("Routes", data.routes, 'route_', routeFolders);

    // Controllersのサブグラフを生成
    const controllerFolders = groupNodesByFolder(data.controllers, baseDir);
    mermaidCode += generateSubgraph("Controllers", data.controllers, 'controller_', controllerFolders);

    // Modelsのデータを調整してサブグラフを生成
    let modelsData: { [key: string]: { file?: string } } = {};
    for (let modelName in data.models) {
      modelsData[modelName] = { file: data.models[modelName] };
    }
    const modelFolders = groupNodesByFolder(modelsData, baseDir);
    mermaidCode += generateSubgraph("Models", modelsData, 'model_', modelFolders);

    // Viewsのデータを調整してサブグラフを生成
    // let viewsData: { [key: string]: { file?: string } } = {};
    // for (let viewName in data.views) {
    //   viewsData[viewName] = { file: data.views[viewName] };
    // }
    // const viewFolders = groupNodesByFolder(viewsData, baseDir);
    // mermaidCode += generateSubgraph("Views", viewsData, 'view_', viewFolders);
    const viewFolders = groupNodesByFolder(data.views, baseDir);
    mermaidCode += generateSubgraph("Views", data.views, 'view_', viewFolders);

    // 新しいサブグラフ "Redirected Routes" を作成
    let redirectedRoutesData: { [key: string]: { type: 'route' | 'method' | 'url'; file?: string; line?: number } } = {};

    // 関係性を定義
    // RoutesからControllersまたはViewsへ
    for (let routeName in data.routes) {
      const route = data.routes[routeName];
      const controllerAction = route.controller;
      const routeNode = sanitize('route_' + routeName);

      if (controllerAction) {
        const controllerName = controllerAction.split('@')[0];
        const targetNode = sanitize('controller_' + controllerName);
        const edgeKey = `${routeNode}->${targetNode}`;
        if (!edgesSet.has(edgeKey)) {
          edgesSet.add(edgeKey);
          mermaidCode += `    ${routeNode} --> ${targetNode}\n`;
        }
      } else if (route.views) {
        // ルートから直接ビューに飛んでいる場合
        route.views.forEach(viewName => {
          const targetNode = sanitize('view_' + viewName);
          const edgeKey = `${routeNode}->${targetNode}`;
          if (!edgesSet.has(edgeKey)) {
            edgesSet.add(edgeKey);
            mermaidCode += `    ${routeNode} --> ${targetNode}\n`;
          }
        });
      }
    }

    // ControllersからModelsおよびViews、Redirected Routesへ
    for (let controllerName in data.controllers) {
      const controller = data.controllers[controllerName];
      const controllerNode = sanitize('controller_' + controllerName);

      // Modelsへのリンク
      controller.models.forEach(modelName => {
        const targetNode = sanitize('model_' + modelName);
        const edgeKey = `${controllerNode}->${targetNode}`;
        if (!edgesSet.has(edgeKey)) {
          edgesSet.add(edgeKey);
          mermaidCode += `    ${controllerNode} --> ${targetNode}\n`;
        }
      });

      // Viewsへのリンク
      controller.views.forEach(viewName => {
        const targetNode = sanitize('view_' + viewName);
        const edgeKey = `${controllerNode}->${targetNode}`;
        if (!edgesSet.has(edgeKey)) {
          edgesSet.add(edgeKey);
          mermaidCode += `    ${controllerNode} --> ${targetNode}\n`;
        }
      });

      // Redirectsへのリンク
      if (controller.redirects) {
        const { edges, nodes } = processRedirects(
          data,
          controllerName,
          controller.redirects,
          controller.file,
          sanitize
        );

        // エッジを追加
        edges.forEach(edge => {
          if (!edgesSet.has(edge)) {
            edgesSet.add(edge);
            mermaidCode += edge;
          }
        });

        // ノードをマージ
        for (let key in nodes) {
          redirectedRoutesData[key] = nodes[key];
        }
      }
    }

    // Redirected Routesサブグラフの作成
    mermaidCode += generateRedirectedRoutesSubgraph("Redirected Routes", redirectedRoutesData, 'redirect_route_', baseDir);

    return mermaidCode;
  }

  // 使用例
  const jsonData: Data = JSON.parse(fs.readFileSync(path.join(__dirname, 'parser', 'output.json'), 'utf-8'));
  const mermaidCode = generateMermaidCode(jsonData);
  return mermaidCode;
}