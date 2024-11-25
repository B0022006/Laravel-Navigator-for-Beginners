// parser6_CroRef.ts

import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';

export interface VariableInfo {
    name: string;
    sentFrom: string;
    lineNumber: number;
    startOffset: number;
    endOffset: number;
    sentTo: string;
}

export interface ControllerAnalysis {
    file: string;
    variablesSent: VariableInfo[];
}

export interface ViewVariableInfo {
    name: string;
    lineNumber: number;
    startOffset: number;
    endOffset: number;
}

export interface ViewAnalysis {
    file: string;
    variablesUsed: ViewVariableInfo[];
}

export interface AnalysisResult {
    controllers: { [key: string]: ControllerAnalysis };
    views: { [key: string]: ViewAnalysis };
}

/**
 * Laravelプロジェクトを解析し、ControllerとView間の変数の受け渡しを抽出する関数
 * @param workspacePath - プロジェクトのワークスペースパス
 */
export async function parse_CroRef(workspacePath: string): Promise<void> {
    console.log('Parsing Laravel project...');
    const controllersDir = path.join(workspacePath, 'app', 'Http', 'Controllers');
    const viewsDir = path.join(workspacePath, 'resources', 'views');

    const controllerFiles = glob.sync('**/*.php', { cwd: controllersDir });
    const viewFiles = glob.sync('**/*.blade.php', { cwd: viewsDir });

    const controllers: { [key: string]: ControllerAnalysis } = {};
    const views: { [key: string]: ViewAnalysis } = {};

    console.log('Analyzing controllers and views...');
    // コントローラーの解析
    for (const file of controllerFiles) {
        const filePath = path.join(controllersDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const variablesSent: VariableInfo[] = [];

        const lines = content.split('\n');
        for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
            const line = lines[lineNumber];

            // viewへの変数送信の検出 (例: return view('view.name', ['var' => $value]);)
            const viewMatch = line.match(/return\s+view\(['"]([^'"]+)['"]\s*,\s*(\[[^\]]+\])\)/);
            if (viewMatch) {
                const viewName = viewMatch[1];
                const variablesArray = eval(viewMatch[2]); // evalは危険なので、本番環境では適切なパーサーを使用してください

                for (const varName in variablesArray) {
                    const variable: VariableInfo = {
                        name: varName,
                        sentFrom: filePath,
                        lineNumber: lineNumber + 1,
                        startOffset: line.indexOf(varName),
                        endOffset: line.indexOf(varName) + varName.length,
                        sentTo: viewName,
                    };
                    variablesSent.push(variable);
                }
            }
        }

        controllers[file] = {
            file: filePath,
            variablesSent,
        };
    }
    console.log('Controllers and views analyzed.');

    // ビューの解析
    for (const file of viewFiles) {
        const filePath = path.join(viewsDir, file);
        const variablesUsed: ViewVariableInfo[] = [];

        parseView(filePath, new Set<string>(), variablesUsed);

        views[file.replace(/\.blade\.php$/, '')] = {
            file: filePath,
            variablesUsed,
        };
    }

    const analysisResult: AnalysisResult = {
        controllers,
        views,
    };

    // 結果をJSONファイルに保存
    const outputPath = path.join(__dirname, 'output_CroRef.json');
    fs.writeFileSync(outputPath, JSON.stringify(analysisResult, null, 2), 'utf-8');
}

/**
 * ビューを解析し、使用されている変数とコンポーネントを抽出する関数
 * @param filePath - ビューのファイルパス
 * @param parentVariables - 親から渡された変数のセット
 * @param variablesUsed - 変数使用情報の蓄積配列
 */
function parseView(filePath: string, parentVariables: Set<string>, variablesUsed: ViewVariableInfo[]): void {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
        const line = lines[lineNumber];

        // 変数使用の検出
        const variableMatches = line.match(/\$[a-zA-Z_][a-zA-Z0-9_]*/g);
        if (variableMatches) {
            for (const varName of variableMatches) {
                const variable: ViewVariableInfo = {
                    name: varName,
                    lineNumber: lineNumber + 1,
                    startOffset: line.indexOf(varName),
                    endOffset: line.indexOf(varName) + varName.length,
                };
                variablesUsed.push(variable);
            }
        }

        // @includeディレクティブの検出
        const includeMatches = line.match(/@include\(['"]([^'"]+)['"]\)/);
        if (includeMatches) {
            const includedView = includeMatches[1];
            const includedViewPath = resolveViewPath(includedView, filePath);
            if (includedViewPath) {
                parseView(includedViewPath, parentVariables, variablesUsed);
            }
        }

        // コンポーネントの検出
        const componentMatches = line.match(/<x-([a-zA-Z0-9\-_:]+)([^>]*)>/);
        if (componentMatches) {
            const componentName = componentMatches[1];
            const attributes = componentMatches[2];
            const componentPath = resolveComponentPath(componentName, filePath);
            if (componentPath) {
                const componentVariables = parseComponentAttributes(attributes, parentVariables);
                parseView(componentPath, componentVariables, variablesUsed);
            }
        }
    }
}

/**
 * ビューのパスを解決する関数
 * @param viewName - ビュー名（ドット表記）
 * @param currentFilePath - 現在のファイルパス
 * @returns ビューのファイルパス
 */
function resolveViewPath(viewName: string, currentFilePath: string): string | null {
    // ビューのパス解決ロジック
    const workspacePath = path.resolve(currentFilePath, '../../../../');
    const possiblePath = path.join(workspacePath, 'resources', 'views', viewName.replace('.', '/')) + '.blade.php';
    if (fs.existsSync(possiblePath)) {
        return possiblePath;
    }
    return null;
}

/**
 * コンポーネントのパスを解決する関数
 * @param componentName - コンポーネント名（ケバブケース）
 * @param currentFilePath - 現在のファイルパス
 * @returns コンポーネントのファイルパス
 */
function resolveComponentPath(componentName: string, currentFilePath: string): string | null {
// コンポーネントのパス解決ロジック
const workspacePath = path.resolve(currentFilePath, '../../../../');
const possiblePath = path.join(workspacePath, 'resources', 'views', 'components', componentName.replace('.', '/')) + '.blade.php';
if (fs.existsSync(possiblePath)) {
    return possiblePath;
}
return null;
}

/**
 * コンポーネントに渡される変数を解析する関数
 * @param attributes - コンポーネントの属性文字列
 * @param parentVariables - 親ビューからの変数セット
 * @returns 子コンポーネントに渡される変数のセット
 */
function parseComponentAttributes(attributes: string, parentVariables: Set<string>): Set<string> {
    const componentVariables = new Set<string>();

    // 属性から変数を抽出
    const attributeMatches = attributes.match(/:([a-zA-Z_][a-zA-Z0-9_]*)="([^"]+)"/g);
    if (attributeMatches) {
        for (const attribute of attributeMatches) {
            const [, varName, varValue] = attribute.match(/:([a-zA-Z_][a-zA-Z0-9_]*)="([^"]+)"/);
            // 親のスコープに存在する変数を子に渡す
            if (parentVariables.has(varValue)) {
                componentVariables.add(varName);
            }
        }
    }

    return componentVariables;
}
