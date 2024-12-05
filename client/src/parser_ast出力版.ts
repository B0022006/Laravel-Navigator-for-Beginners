import * as fs from 'fs/promises'; // fsのpromisesを使う
import * as path from 'path';
import { Engine } from 'php-parser';

// メインのパース関数
export async function parse(projectPath: string): Promise<void> {
    const parser = new Engine({
        parser: {
            extractDoc: true,
            php7: true,
        },
        ast: {
            withPositions: true,
        },
    });

    const controllerDir: string = path.join(projectPath, 'app/Http/Controllers');
    const modelDir: string = path.join(projectPath, 'app/Models');
    const viewDir: string = path.join(projectPath, 'resources/views');
    const routesDir: string = path.join(projectPath, 'routes');

    interface AnalysisResult {
        models: string[];
        views: string[];
        redirects: RedirectInfo[];
    }

    interface RedirectInfo {
        type: 'redirect';
        methods: string[];
        arguments: any[];
        target?: string;
        line: number;
    }

    interface ControllerInfo {
        file: string;
        models: string[];
        views: string[];
        redirects: RedirectInfo[];
    }

    let controllers: { [key: string]: ControllerInfo } = {};
    let models: { [key: string]: string } = {};
    let views: { [key: string]: string } = {};

    async function readDirectory(directory: string, callback: (filePath: string, content: string) => void): Promise<void> {
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
    }

    async function saveAST(filePath: string, ast: any): Promise<void> {
        const astDir = path.join(__dirname, 'ast例');
        await fs.mkdir(astDir, { recursive: true });
        const astFilePath = path.join(astDir, `${path.basename(filePath, '.php')}.json`);
        await fs.writeFile(astFilePath, JSON.stringify(ast, null, 2), 'utf-8');
        console.log(`ASTを ${astFilePath} に保存しました`);
    }

    // // 親ノードへの参照を設定する関数
    // function setParentReferences(node: any, parent: any = null) {
    //     if (!node || typeof node !== 'object') return;

    //     node.parent = parent;

    //     for (const key in node) {
    //     if (key === 'parent') continue; // 'parent' プロパティをスキップ
    //     if (node.hasOwnProperty(key)) {
    //         const child = node[key];
    //         if (Array.isArray(child)) {
    //         child.forEach((c) => {
    //             setParentReferences(c, node);
    //         });
    //         } else if (child && typeof child === 'object' && child.kind) {
    //         setParentReferences(child, node);
    //         }
    //     }
    //     }
    // }

    function analyzePHP(content: string, filePath: string): AnalysisResult {
        const ast = parser.parseCode(content, filePath);
        // setParentReferences(ast);
        saveAST(filePath, ast).catch((err) => console.error(`ASTの保存中にエラーが発生しました: ${err.message}`));

        let result: AnalysisResult = {
            models: [],
            views: [],
            redirects: [],
        };

        function traverse(node: any): void {
            if (!node) return;

            if (node.kind === 'call') {
                if (node.what.name === 'view') {
                    if (node.arguments && node.arguments[0] && node.arguments[0].kind === 'string') {
                        result.views.push(node.arguments[0].value);
                    }
                }
            }
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

        traverse(ast);
        return result;
    }

    await Promise.all([
        readDirectory(modelDir, (filePath, content) => {
            const modelName = path.basename(filePath, '.php');
            models[modelName] = filePath;
        }),
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
        readDirectory(viewDir, (filePath) => {
            const relativePath = path.relative(viewDir, filePath).replace(/\\/g, '/');
            if (!relativePath.startsWith('components')) {
                const viewName = relativePath.replace('.blade.php', '');
                views[viewName] = filePath;
            }
        }),
    ]);

    const result = { controllers, models, views };
    const outputFilePath: string = path.join(__dirname, 'output.json');
    await fs.writeFile(outputFilePath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`解析結果を ${outputFilePath} に保存しました`);
}
