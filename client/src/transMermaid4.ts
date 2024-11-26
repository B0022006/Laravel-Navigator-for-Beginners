import * as fs from 'fs';
import * as path from 'path';

export function transMermaid(): string {

interface Route {
    method: string;
    controller?: string;
    views?: string[];
    file: string;
    line: number;
}

interface Redirect {
    type: string;
    methods: string[];
    arguments: any[];
    target: any;
    line: number;
}

interface Controller {
    models: string[];
    views: string[];
    file: string;
    redirects?: Redirect[];
}

interface Data {
    routes: { [key: string]: Route };
    controllers: { [key: string]: Controller };
    models: { [key: string]: string };
    views: { [key: string]: string };
}

function generateMermaidCode(data: Data): string {
    let mermaidCode = 'flowchart LR\n\n';

    // サニタイズ関数：MermaidのノードIDとして有効な文字列を生成
    function sanitize(name: string): string {
        return name.replace(/[^a-zA-Z0-9]/g, '_');
    }

    // 全ファイルパスを収集して共通のベースディレクトリを見つける
    let allFilePaths: string[] = [];

    // Collect all file paths
    for (let controllerName in data.controllers) {
        allFilePaths.push(data.controllers[controllerName].file);
    }
    for (let modelName in data.models) {
        allFilePaths.push(data.models[modelName]);
    }
    for (let viewName in data.views) {
        allFilePaths.push(data.views[viewName]);
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
    let edges = new Set<string>();

    // ノードをフォルダごとにグループ化する関数
    function groupNodesByFolder<T extends { file?: string }>(nodes: { [key: string]: T }): { [folder: string]: string[] } {
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

    // サブグラフを生成する関数
    function generateSubgraph(
        graphName: string,
        nodes: { [key: string]: { file?: string; line?: number } },
        nodePrefix: string,
        folders: { [folder: string]: string[] }
    ): string {
        let code = '';
        code += `    subgraph "${graphName}"\n`;
        code += `        direction LR\n`; // ここに direction LR を追加
        for (let folder in folders) {
            code += `        subgraph "${folder}"\n`;
            code += `            direction LR\n`; // ここに direction LR を追加
            folders[folder].forEach(nodeName => {
                const nodeId = sanitize(nodePrefix + nodeName);
                code += `            ${nodeId}["${nodeName}"]\n`;
                const filePath = nodes[nodeName].file;
                const lineNumber = nodes[nodeName].line;
                if (lineNumber !== undefined) {
                    code += `            click ${nodeId} call clickHandler("${filePath}", ${lineNumber})\n`;
                } else if (filePath) {
                    code += `            click ${nodeId} call clickHandler("${filePath}")\n`;
                }
            });
            code += '        end\n';
        }
        code += '    end\n\n';
        return code;
    }

    // Routesのサブグラフを生成
    const routeFolders = groupNodesByFolder(data.routes);
    mermaidCode += generateSubgraph("Routes", data.routes, 'route_', routeFolders);

    // Controllersのサブグラフを生成
    const controllerFolders = groupNodesByFolder(data.controllers);
    mermaidCode += generateSubgraph("Controllers", data.controllers, 'controller_', controllerFolders);

    // Modelsのデータを調整してサブグラフを生成
    let modelsData: { [key: string]: { file?: string } } = {};
    for (let modelName in data.models) {
        modelsData[modelName] = { file: data.models[modelName] };
    }
    const modelFolders = groupNodesByFolder(modelsData);
    mermaidCode += generateSubgraph("Models", modelsData, 'model_', modelFolders);

    // Viewsのデータを調整してサブグラフを生成
    let viewsData: { [key: string]: { file?: string } } = {};
    for (let viewName in data.views) {
        viewsData[viewName] = { file: data.views[viewName] };
    }
    const viewFolders = groupNodesByFolder(viewsData);
    mermaidCode += generateSubgraph("Views", viewsData, 'view_', viewFolders);

    // 新しいサブグラフ "Redirected Routes"
    let redirectedRoutesData: { [key: string]: { file?: string; line?: number } } = {};

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
            if (!edges.has(edgeKey)) {
                edges.add(edgeKey);
                mermaidCode += `    ${routeNode} --> ${targetNode}\n`;
            }
        } else if (route.views) {
            // ルートから直接ビューに飛んでいる場合
            route.views.forEach(viewName => {
                const targetNode = sanitize('view_' + viewName);
                const edgeKey = `${routeNode}->${targetNode}`;
                if (!edges.has(edgeKey)) {
                    edges.add(edgeKey);
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
            if (!edges.has(edgeKey)) {
                edges.add(edgeKey);
                mermaidCode += `    ${controllerNode} --> ${targetNode}\n`;
            }
        });

        // Viewsへのリンク
        controller.views.forEach(viewName => {
            const targetNode = sanitize('view_' + viewName);
            const edgeKey = `${controllerNode}->${targetNode}`;
            if (!edges.has(edgeKey)) {
                edges.add(edgeKey);
                mermaidCode += `    ${controllerNode} --> ${targetNode}\n`;
            }
        });

        // Redirectsへのリンク
        if (controller.redirects) {
            controller.redirects.forEach(redirect => {
                const routeNames = extractRouteNamesFromRedirect(redirect);

                routeNames.forEach(routeName => {
                    const targetNode = sanitize('redirect_route_' + routeName);
                    const edgeKey = `${controllerNode}->${targetNode}`;
                    if (!edges.has(edgeKey)) {
                        edges.add(edgeKey);
                        mermaidCode += `    ${controllerNode} --> ${targetNode}\n`;
                    }

                    // Collect route data
                    if (data.routes[routeName]) {
                        const route = data.routes[routeName];
                        redirectedRoutesData[routeName] = { file: route.file, line: route.line };
                    } else {
                        // If route data not available, we can at least add the routeName
                        redirectedRoutesData[routeName] = {};
                    }
                });
            });
        }
    }

    // Redirected Routesサブグラフの作成
    const redirectedRouteFolders = groupNodesByFolder(redirectedRoutesData);
    mermaidCode += generateSubgraph("Redirected Routes", redirectedRoutesData, 'redirect_route_', redirectedRouteFolders);

    return mermaidCode;
}

// Redirectオブジェクトからルート名を抽出する関数
function extractRouteNamesFromRedirect(redirect: Redirect): string[] {
    let routeNames: string[] = [];

    function processNode(node: any) {
        if (node.kind === 'call' && node.what && node.what.kind === 'name' && node.what.name === 'route') {
            // Process arguments
            if (node.arguments && node.arguments.length > 0) {
                const firstArg = node.arguments[0];
                if (firstArg.kind === 'string') {
                    routeNames.push(firstArg.value);
                }
            }
        } else if (node.arguments && Array.isArray(node.arguments)) {
            node.arguments.forEach((arg: any) => {
                processNode(arg);
            });
        } else if (node.kind === 'string') {
            // In some cases, the node itself might be a string
            routeNames.push(node.value);
        }
    }

    redirect.arguments.forEach((argArray: any[]) => {
        argArray.forEach((astNode: any) => {
            processNode(astNode);
        });
    });

    return routeNames;
}

// 使用例
const jsonData: Data = JSON.parse(fs.readFileSync(path.join(__dirname, 'output.json'), 'utf-8'));
const mermaidCode = generateMermaidCode(jsonData);
return mermaidCode;

}
