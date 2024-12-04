import * as fs from 'fs/promises'; // fsのpromisesを使う
import * as path from 'path';
import { Engine } from 'php-parser';

// メインのパース関数
export async function parse(projectPath: string): Promise<void> {

    // PHPパーサーの設定
    const parser = new Engine({
        parser: {
            extractDoc: true, // ドキュメントコメントを抽出
            php7: true        // PHP7構文のサポートを有効化
        },
        ast: {
            withPositions: true // 位置情報を含める
        }
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

    interface RedirectInfo {
        type: 'redirect';
        methods: string[];
        arguments: any[]; // すべての引数を含める
        target: string | null; // targetを必須フィールドに変更
        line: number;
    }

    interface Route {
        method: string;
        path: string;
        controller?: string;
        views?: string[];
        file: string;
        line: number; // 行番号を追加
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
    async function readDirectory(directory: string, callback: (filePath: string, content: string) => void): Promise<void> {
        try {
            const files = await fs.readdir(directory); // ディレクトリのファイル一覧を取得
            for (const file of files) {
                const filePath: string = path.join(directory, file);
                const stats = await fs.stat(filePath); // ファイル情報を取得
                if (stats.isDirectory()) {
                    await readDirectory(filePath, callback); // ディレクトリの場合は再帰処理
                } else if (file.endsWith('.php')) {
                    const content: string = await fs.readFile(filePath, 'utf-8'); // PHPファイルの内容を読み込み
                    callback(filePath, content); // コールバックでファイル内容を渡す
                }
            }
        } catch (err) {
            console.error(err); // エラーハンドリング
        }
    }

    // PHPコードを解析し、使用されているモデルやビュー、リダイレクトを抽出
    function analyzePHP(content: string, filePath: string): AnalysisResult {
        let ast = parser.parseCode(content, filePath); // PHPコードをAST（抽象構文木）に変換
        let result: AnalysisResult = {
            models: [],
            views: [],
            redirects: []
        };

        // ASTをトラバース（巡回）して、モデルやビューの呼び出しを抽出
        function traverse(node: any): void {
            if (!node) return;

            if (node.kind === 'call') { // 関数呼び出しのノードをチェック
                // モデルの使用を検出
                if (models[node.what.name]) {
                    result.models.push(node.what.name); // モデルが使われている場合にリストに追加
                }

                // ビューの使用を検出
                if (node.what.name === 'view') {
                    if (node.arguments && node.arguments[0] && node.arguments[0].kind === 'string') {
                        result.views.push(node.arguments[0].value); // ビューが呼び出されている場合にリストに追加
                    }
                }

                // リダイレクトの使用を検出
                let chain = getMethodChain(node);

                if (chain.methods[0].toLowerCase() === 'redirect') { // 'redirect' または 'Redirect' を小文字に変換して比較
                    // リダイレクト呼び出しを検出
                    const redirectInfo: RedirectInfo = {
                        type: 'redirect',
                        methods: chain.methods.slice(1), // 'redirect'を除いたメソッドチェーン
                        arguments: chain.arguments.slice(1), // 'redirect'の引数を除く
                        target: null,
                        line: node.loc ? node.loc.start.line : null
                    };

                    // リダイレクト先を抽出
                    for (let i = 0; i < chain.methods.length; i++) {
                        const method = chain.methods[i];
                        const args = chain.arguments[i];

                        if (['route', 'to', 'action', 'away', 'back', 'intended'].includes(method)) {
                            if (args && args.length > 0) {
                                const firstArg = args[0];
                                if (firstArg.kind === 'string') {
                                    redirectInfo.target = firstArg.value;
                                    break;
                                } else if (firstArg.kind === 'call' && firstArg.what.name === 'route') {
                                    // route関数の呼び出しからターゲットを抽出
                                    if (firstArg.arguments && firstArg.arguments.length > 0 && firstArg.arguments[0].kind === 'string') {
                                        redirectInfo.target = firstArg.arguments[0].value;
                                        break;
                                    }
                                } else if (method === 'back') {
                                    redirectInfo.target = 'back';
                                    break;
                                }
                            }
                        }
                    }

                    // メソッドチェーンの中でネストされた呼び出しからターゲットを抽出
                    if (redirectInfo.target === null) {
                        for (let i = 1; i < chain.methods.length; i++) {
                            const args = chain.arguments[i];
                            if (args && args.length > 0) {
                                const firstArg = args[0];
                                if (firstArg.kind === 'call') {
                                    const innerCall = firstArg;
                                    if (innerCall.what.name === 'route' && innerCall.arguments.length > 0 && innerCall.arguments[0].kind === 'string') {
                                        redirectInfo.target = innerCall.arguments[0].value;
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // 単独のredirect呼び出しの場合、最初の引数をtargetとして設定
                    if (redirectInfo.target === null && chain.arguments.length > 0) {
                        const firstArg = chain.arguments[0][0];
                        if (firstArg && firstArg.kind === 'string') {
                            redirectInfo.target = firstArg.value;
                        }
                    }

                    // さらにネストされた引数も処理
                    redirectInfo.arguments = chain.arguments.slice(1).map((args, index) => {
                        return args.map((arg: any) => {
                            if (arg.kind === 'call') {
                                return extractCallArguments(arg);
                            }
                            return arg;
                        });
                    });

                    result.redirects.push(redirectInfo);
                }
            } else if (node.kind === 'new') { // newキーワードでクラスをインスタンス化しているかチェック
                if (node.what.kind === 'identifier' && models[node.what.name]) {
                    result.models.push(node.what.name); // モデルのインスタンス化を検出
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

        // メソッドチェーンを取得する関数
        function getMethodChain(node: any): { methods: string[], arguments: any[] } {
            let methods = [];
            let argumentsList = [];

            function collect(node: any) {
                if (!node) return;

                if (node.kind === 'call') {
                    let args = node.arguments;

                    if (node.what.kind === 'propertylookup') {
                        // メソッドチェーン ($obj->method()) を処理
                        let methodName = '';
                        if (node.what.offset.kind === 'identifier') {
                            methodName = node.what.offset.name;
                        } else if (node.what.offset.kind === 'constref') {
                            methodName = node.what.offset.name;
                        }
                        methods.push(methodName);
                        argumentsList.push(args);

                        collect(node.what.what);
                    } else if (node.what.kind === 'staticlookup') {
                        // 静的メソッド呼び出し (Class::method()) を処理
                        let methodName = '';
                        if (node.what.offset.kind === 'identifier') {
                            methodName = node.what.offset.name;
                        } else if (node.what.offset.kind === 'constref') {
                            methodName = node.what.offset.name;
                        }

                        let className = '';
                        if (node.what.what.kind === 'name') {
                            className = node.what.what.name;
                        }

                        methods.push(methodName);
                        methods.push(className);
                        argumentsList.push(args);
                        argumentsList.push([]);

                        // 静的メソッド呼び出しのため、これ以上のチェーンはなし
                    } else if (node.what.kind === 'call') {
                        // ネストされた呼び出し (foo()->bar()) を処理
                        collect(node.what);
                    } else if (node.what.kind === 'identifier' || node.what.kind === 'name') {
                        let methodName = node.what.name;
                        methods.push(methodName);
                        argumentsList.push(args);
                    }
                }
            }

            collect(node);

            return { methods: methods.reverse(), arguments: argumentsList.reverse() };
        }

        // callノードから引数を抽出する関数
        function extractCallArguments(callNode: any): any {
            if (!callNode || callNode.kind !== 'call') return null;

            let callInfo: any = {
                name: callNode.what.name,
                arguments: callNode.arguments.map((arg: any) => {
                    if (arg.kind === 'call') {
                        return extractCallArguments(arg);
                    }
                    return arg;
                })
            };
            return callInfo;
        }

        traverse(ast); // トラバース開始
        return result;
    }

    // ルート定義を解析し、ルートとコントローラーのマッピングを抽出
    function analyzeRoutes(filePath: string, content: string): Route[] {
        let ast = parser.parseCode(content, filePath); // PHPコードをASTに変換
        let result: Route[] = [];

        // ASTをトラバースして、ルート定義を解析
        function traverse(node: any): void {
            if (node.kind === 'call') { // 関数呼び出しをチェック
                let methodName = ''; // ルートメソッド名
                let route: Route = {
                    method: '',
                    path: '',
                    file: filePath,
                    line: node.loc ? node.loc.start.line : null // 行番号を取得
                };

                // ルートメソッドがstaticlookupやpropertylookupで定義されているかチェック
                if (node.what.kind === 'staticlookup') {
                    if (node.what.offset && node.what.offset.kind === 'identifier') {
                        methodName = node.what.offset.name;
                    }
                } else if (node.what.kind === 'propertylookup') {
                    if (node.what.offset && node.what.offset.kind === 'identifier') {
                        methodName = node.what.offset.name;
                    }
                }

                // GET, POST, PUTなどのHTTPメソッドを持つ関数呼び出しを解析
                if (methodName && ['get', 'post', 'put', 'delete', 'patch', 'options', 'match', 'any'].includes(methodName)) {
                    route.method = methodName; // HTTPメソッドを保存
                    if (node.arguments && node.arguments.length > 0) {
                        if (node.arguments[0].kind === 'string') {
                            route.path = node.arguments[0].value; // ルートパスを保存
                        }

                        // コントローラの呼び出しを解析
                        if (node.arguments[1]) {
                            if (node.arguments[1].kind === 'string' || node.arguments[1].kind === 'array') {
                                if (node.arguments[1].kind === 'string') {
                                    route.controller = node.arguments[1].value; // コントローラ名を保存
                                } else if (node.arguments[1].kind === 'array') {
                                    let controllerAndAction = extractControllerAndAction(node.arguments[1]);
                                    if (controllerAndAction.controller && controllerAndAction.action) {
                                        route.controller = `${controllerAndAction.controller}@${controllerAndAction.action}`; // コントローラ@アクション形式で保存
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
                    result.push(route); // ルート定義を結果に追加
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
                if (node.items.length > 0 && node.items[0].value.kind === 'staticlookup') {
                    controllerName = node.items[0].value.what.name.replace(/::class$/, ''); // コントローラー名を抽出
                }
                if (node.items.length > 1 && node.items[1].value.kind === 'string') {
                    actionName = node.items[1].value.value; // アクション名を抽出
                }
            }

            return { controller: controllerName, action: actionName }; // 抽出した値を返す
        }

        // クロージャ内のビューを抽出する関数
        function extractViewsFromClosure(closureNode: any): string[] {
            let views: string[] = [];

            function traverse(node: any): void {
                if (!node) return;

                if (node.kind === 'return') {
                    if (node.expr && node.expr.kind === 'call' && node.expr.what.name === 'view') {
                        if (node.expr.arguments && node.expr.arguments[0] && node.expr.arguments[0].kind === 'string') {
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

        traverse(ast); // トラバース開始
        return result;
    }

    // 各ディレクトリを非同期で解析
    await Promise.all([
        // モデルディレクトリを解析
        readDirectory(modelDir, (filePath, content) => {
            const modelName = path.basename(filePath, '.php');
            models[modelName] = filePath; // モデル名を格納
        }),
        // コントローラーディレクトリを解析
        readDirectory(controllerDir, (filePath, content) => {
            const controllerName = path.basename(filePath, '.php');
            const analysis = analyzePHP(content, filePath); // コントローラーのPHPコードを解析
            controllers[controllerName] = {
                file: filePath,
                models: analysis.models,
                views: analysis.views,
                redirects: analysis.redirects // リダイレクト情報を追加
            }; // コントローラーの情報を格納
        }),
        // ビューディレクトリを解析
        readDirectory(viewDir, (filePath) => {
            const relativePath = path.relative(viewDir, filePath).replace(/\\/g, '/');
            if (!relativePath.startsWith('components')) { // コンポーネントは除外
                const viewName = relativePath.replace('.blade.php', '');
                views[viewName] = filePath; // ビュー名を格納
            }
        }),
        // ルートディレクトリを解析
        readDirectory(routesDir, (filePath, content) => {
            const routeMappings = analyzeRoutes(filePath, content); // ルートの解析
            routeMappings.forEach(route => {
                const key = `${route.method.toUpperCase()} ${route.path}`; // メソッドとパスを組み合わせてキーを作成
                if (!routes[key]) {
                    routes[key] = route; // ルートを格納
                }
            });
        })
    ]);

    // 解析結果をJSONファイルに保存
    const result = {
        controllers,
        models,
        views,
        routes,
    };
    const outputFilePath: string = path.join(__dirname, 'output.json');
    await fs.writeFile(outputFilePath, JSON.stringify(result, null, 2), 'utf-8'); // 結果をファイルに書き込む
    console.log(`解析結果を ${outputFilePath} に保存しました`); // 結果の保存を通知
}
