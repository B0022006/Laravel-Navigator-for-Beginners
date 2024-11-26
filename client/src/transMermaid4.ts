import * as fs from 'fs';
import * as path from 'path';

export function transMermaid(): string {

interface Route {
    method: string;
    controller?: string;
    views?: string[];
    file: string;
    line: number; // 行番号を追加
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
    redirects?: Redirect[];
    file: string;
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

    // 全てのルート名を収集
    const routeNamesSet = new Set<string>();

    // データからルート名を収集
    for (let routeName in data.routes) {
        routeNamesSet.add(routeName);
    }

    // リダイレクトからルート名を収集
    for (let controllerName in data.controllers) {
        const controller = data.controllers[controllerName];
        if (controller.redirects) {
            controller.redirects.forEach(redirect => {
                const routeNames = extractRouteNamesFromRedirect(redirect);
                routeNames.forEach(routeName => {
                    routeNamesSet.add(routeName);
                });
            });
        }
    }

    // 各種類ごとにノードをサブグラフでグループ化
    mermaidCode += '    subgraph "Routes"\n';
    routeNamesSet.forEach(routeName => {
        let route = data.routes[routeName];
        if (route) {
            mermaidCode += `        ${sanitize('route_' + routeName)}["${routeName}"]\n`;
            const nodeId = sanitize('route_' + routeName);
            mermaidCode += `        click ${nodeId} call clickHandler("${route.file}", ${route.line})\n`;
        } else {
            // データがないルートの場合
            mermaidCode += `        ${sanitize('route_' + routeName)}["${routeName}"]\n`;
        }
    });
    mermaidCode += '    end\n\n';

    mermaidCode += '    subgraph "Controllers"\n';
    for (let controllerName in data.controllers) {
        mermaidCode += `        ${sanitize('controller_' + controllerName)}["${controllerName}"]\n`;
        const nodeId = sanitize('controller_' + controllerName);
        mermaidCode += `        click ${nodeId} call clickHandler("${data.controllers[controllerName].file}")\n`;
    }
    mermaidCode += '    end\n\n';

    mermaidCode += '    subgraph "Models"\n';
    for (let modelName in data.models) {
        mermaidCode += `        ${sanitize('model_' + modelName)}["${modelName}"]\n`;
        const nodeId = sanitize('model_' + modelName);
        mermaidCode += `        click ${nodeId} call clickHandler("${data.models[modelName]}")\n`;
    }
    mermaidCode += '    end\n\n';

    mermaidCode += '    subgraph "Views"\n';
    for (let viewName in data.views) {
        mermaidCode += `        ${sanitize('view_' + viewName)}["${viewName}"]\n`;
        const nodeId = sanitize('view_' + viewName);
        mermaidCode += `        click ${nodeId} call clickHandler("${data.views[viewName]}")\n`;
    }
    mermaidCode += '    end\n\n';

    // エッジを管理するSetを作成
    const edges = new Set<string>();

    // RoutesからControllersまたはViewsへ
    for (let routeName in data.routes) {
        const route = data.routes[routeName];
        const controllerAction = route.controller;
        const routeNode = sanitize('route_' + routeName);

        if (controllerAction) {
            const controllerName = controllerAction.split('@')[0];
            const edge = `    ${routeNode} --> ${sanitize('controller_' + controllerName)}`;
            edges.add(edge);
        } else if (route.views) {
            // ルートから直接ビューに飛んでいる場合
            route.views.forEach(viewName => {
                const edge = `    ${routeNode} --> ${sanitize('view_' + viewName)}`;
                edges.add(edge);
            });
        }
    }

    // ControllersからModelsおよびViewsへ
    for (let controllerName in data.controllers) {
        const controller = data.controllers[controllerName];

        // Modelsへのリンク
        controller.models.forEach(modelName => {
            const edge = `    ${sanitize('controller_' + controllerName)} --> ${sanitize('model_' + modelName)}`;
            edges.add(edge);
        });

        // Viewsへのリンク（左向き矢印に変更）
        controller.views.forEach(viewName => {
            const edge = `    ${sanitize('view_' + viewName)} <-- ${sanitize('controller_' + controllerName)}`;
            edges.add(edge);
        });

        // Redirectsへのリンク
        if (controller.redirects) {
            controller.redirects.forEach(redirect => {
                const routeNames = extractRouteNamesFromRedirect(redirect);
                routeNames.forEach(routeName => {
                    const edge = `    ${sanitize('controller_' + controllerName)} --> ${sanitize('route_' + routeName)}`;
                    edges.add(edge);
                });
            });
        }
    }

    // エッジをmermaidCodeに追加
    mermaidCode += '\n';
    edges.forEach(edge => {
        mermaidCode += edge + '\n';
    });

    return mermaidCode;
}

// リダイレクトからルート名を抽出する関数
function extractRouteNamesFromRedirect(redirect: Redirect): string[] {
    const routeNames: string[] = [];

    function traverseNode(node: any) {
        if (node === null || node === undefined) {
            return;
        } else if (Array.isArray(node)) {
            node.forEach(child => traverseNode(child));
        } else if (typeof node === 'object') {
            if (node.kind === 'call' && node.what && node.what.kind === 'name' && node.what.name === 'route') {
                // route() 関数の呼び出しを検出
                if (node.arguments && node.arguments[0] && node.arguments[0].kind === 'string') {
                    routeNames.push(node.arguments[0].value);
                }
            } else {
                // すべてのプロパティを再帰的に探索
                for (let key in node) {
                    traverseNode(node[key]);
                }
            }
        }
    }

    traverseNode(redirect.arguments);

    return routeNames;
}

// 使用例
const jsonData: Data = JSON.parse(fs.readFileSync(path.join(__dirname, 'output.json'), 'utf-8'));
const mermaidCode = generateMermaidCode(jsonData);
return mermaidCode;
// export default mermaidCode;

}
