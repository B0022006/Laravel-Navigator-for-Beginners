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

interface Controller {
    models: string[];
    views: string[];
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

    // 各種類ごとにノードをサブグラフでグループ化
    mermaidCode += '    subgraph "Routes"\n';
    for (let routeName in data.routes) {
        const route = data.routes[routeName];
        // const method = route.method.toUpperCase();
        // mermaidCode += `        ${sanitize('route_' + routeName)}["${method} ${routeName}"]\n`;
        mermaidCode += `        ${sanitize('route_' + routeName)}["${routeName}"]\n`;
        const nodeId = sanitize('route_' + routeName);
        // 行番号を含めてclickHandlerに渡す
        mermaidCode += `        click ${nodeId} call clickHandler("${route.file}", ${route.line})\n`;
    }
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

    // 関係性を定義
    // RoutesからControllersまたはViewsへ
    for (let routeName in data.routes) {
        const route = data.routes[routeName];
        const controllerAction = route.controller;
        const routeNode = sanitize('route_' + routeName);

        if (controllerAction) {
            const controllerName = controllerAction.split('@')[0];
            mermaidCode += `    ${routeNode} --> ${sanitize('controller_' + controllerName)}\n`;
        } else if (route.views) {
            // ルートから直接ビューに飛んでいる場合
            route.views.forEach(viewName => {
                mermaidCode += `    ${routeNode} --> ${sanitize('view_' + viewName)}\n`;
            });
        }
    }

    // ControllersからModelsおよびViewsへ
    for (let controllerName in data.controllers) {
        const controller = data.controllers[controllerName];

        // Modelsへのリンク
        controller.models.forEach(modelName => {
            mermaidCode += `    ${sanitize('controller_' + controllerName)} --> ${sanitize('model_' + modelName)}\n`;
        });

        // Viewsへのリンク
        controller.views.forEach(viewName => {
            mermaidCode += `    ${sanitize('controller_' + controllerName)} --> ${sanitize('view_' + viewName)}\n`;
        });
    }

    return mermaidCode;
}

// 使用例
const jsonData: Data = JSON.parse(fs.readFileSync(path.join(__dirname, 'output.json'), 'utf-8'));
const mermaidCode = generateMermaidCode(jsonData);
return mermaidCode;
// export default mermaidCode;

}
