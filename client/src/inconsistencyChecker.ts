interface Route {
  method: string;
  path: string;
  controller?: string;
  views?: string[];
  file: string;
  line: number;
}

interface ParsedData {
  controllers: {
    [controllerName: string]: {
      file: string;
      models: string[];
      views: string[];
      redirects: {
        type: string;
        methods: string[];
        target: string;
        line: number;
      }[];
      viewVariables: { [viewName: string]: string[] };
    };
  };
  models: { [modelName: string]: string };
  views: {
    [viewName: string]: {
      file: string;
      variables: string[];
      componentVariables: { [componentName: string]: string[] };
    };
  };
  routes: {
    [routeSignature: string]: Route;
  };
}

interface VariablesMap {
  [viewName: string]: {
    filePath: string;
    variables: string[];
    componentVariables?: { [component: string]: string[] };
  };
}

type PassedVariableMap = { [viewName: string]: string[] };

interface Inconsistency {
  viewName: string;
  viewFilePath: string;
  undefinedVariables: string[]; // ビューで使用されているが、渡されていない変数
  unusedVariables: string[];    // 渡されているが、ビューで使用されていない変数
}

interface NonexistentViewReference {
  viewName: string;
  callingFiles: {
    type: 'controller' | 'route';
    file: string;
    line?: number;
    name?: string; 
  }[];
}

/**
 * 新しいJSONデータから、ビュー名をキーとするビュー変数マップ(VariablesMap)を構築
 * @param parsedData 
 * @returns VariablesMap
 */
function buildViewVariablesMap(parsedData: ParsedData): VariablesMap {
  const viewVariables: VariablesMap = {};

  for (const [viewName, viewData] of Object.entries(parsedData.views)) {
    viewVariables[viewName] = {
      filePath: viewData.file,
      variables: viewData.variables,
      componentVariables: viewData.componentVariables
    };
  }

  return viewVariables;
}

/**
 * コントローラとルートから参照されるビューに対して、渡されている変数をまとめるマップを構築
 * コントローラ経由：controller.viewVariablesから取得
 * ルート経由：viewsプロパティから取得。ただし直接ビューの場合は変数なし
 * @param parsedData 
 * @returns PassedVariableMap
 */
function buildPassedVariablesMap(parsedData: ParsedData): PassedVariableMap {
  const passedVariables: PassedVariableMap = {};

  // コントローラから参照されるビューとそれに対応する変数をマッピング
  for (const [controllerName, controllerData] of Object.entries(parsedData.controllers)) {
    const controllerViews = controllerData.views || [];
    const cViewVariables = controllerData.viewVariables || {};
    for (const viewName of controllerViews) {
      const normalizedViewName = viewName.replace(/\//g, '.');
      const vars = cViewVariables[viewName] || [];
      if (!passedVariables[normalizedViewName]) {
        passedVariables[normalizedViewName] = [];
      }
      passedVariables[normalizedViewName].push(...vars);
    }
  }

  // ルートから直接参照されるビューをマッピング
  for (const [routeSignature, routeData] of Object.entries(parsedData.routes)) {
    if (routeData.views && routeData.views.length > 0) {
      for (const viewName of routeData.views) {
        const normalizedViewName = viewName.replace(/\//g, '.');
        // コントローラを経由しない場合は変数が無いので空配列
        if (!passedVariables[normalizedViewName]) {
          passedVariables[normalizedViewName] = [];
        }
      }
    }
  }

  return passedVariables;
}

/**
 * ビューで使用されている変数と、コントローラー/ルートから渡されている変数の間の矛盾を検出します。
 * @param parsedData 新しいJSON形式のデータ
 * @returns 矛盾のリスト
 */
export function checkInconsistencies(parsedData: ParsedData): Inconsistency[] {
  const viewVariables = buildViewVariablesMap(parsedData);
  const passedVariablesMap = buildPassedVariablesMap(parsedData);

  const inconsistencies: Inconsistency[] = [];

  for (const [viewName, viewVarData] of Object.entries(viewVariables)) {
    const usedVariables = new Set<string>();
    const viewFilePath = viewVarData.filePath;

    // ビューで使用している変数を追加
    viewVarData.variables.forEach((variable) => usedVariables.add(variable));

    // コンポーネントで使用されている変数を追加
    if (viewVarData.componentVariables) {
      for (const variables of Object.values(viewVarData.componentVariables)) {
        variables.forEach((variable) => usedVariables.add(variable));
      }
    }

    const passedVariables = new Set<string>(passedVariablesMap[viewName] || []);

    // ビューで使用されているが、渡されていない変数
    const undefinedVariables = Array.from(usedVariables).filter((variable) => !passedVariables.has(variable));

    // 渡されているが、ビューで使用されていない変数
    const unusedVariables = Array.from(passedVariables).filter((variable) => !usedVariables.has(variable));

    if (undefinedVariables.length > 0 || unusedVariables.length > 0) {
      inconsistencies.push({
        viewName,
        viewFilePath,
        undefinedVariables,
        unusedVariables,
      });
    }
  }

  return inconsistencies;
}

/**
 * 使われていないビュー（View）ファイルを検出します。
 * コントローラやルートから参照されていないビューが対象。
 * @param parsedData 新しいJSON形式のデータ
 * @returns 使われていないビューのリスト
 */
export function findUnusedViewFiles(parsedData: ParsedData): { viewName: string; viewFilePath: string }[] {
  const viewVariables = buildViewVariablesMap(parsedData);

  // コントローラで使用されているビュー名（正規化後）
  const usedViewNames = new Set<string>();
  for (const controllerData of Object.values(parsedData.controllers)) {
    const controllerViews = controllerData.views || [];
    for (const viewName of controllerViews) {
      const normalized = viewName.replace(/\//g, '.');
      usedViewNames.add(normalized);
    }
  }

  // ルートで使用されているビューも追加
  for (const routeData of Object.values(parsedData.routes)) {
    const routeViews = routeData.views || [];
    for (const viewName of routeViews) {
      const normalized = viewName.replace(/\//g, '.');
      usedViewNames.add(normalized);
    }
  }

  const unusedViews: { viewName: string; viewFilePath: string }[] = [];

  // viewVariablesにあるが、コントローラ・ルートいずれからも参照されていないビュー
  for (const [viewName, viewVarData] of Object.entries(viewVariables)) {
    if (!usedViewNames.has(viewName)) {
      unusedViews.push({
        viewName,
        viewFilePath: viewVarData.filePath,
      });
    }
  }

  return unusedViews;
}

/**
 * コントローラーまたはルートから呼び出されているが、存在しないビューを検出します。
 * 存在しないビューと、それを呼び出しているコントローラおよびルートのファイル名・ファイルパス・(ルートなら行番号) を出力します。
 * @param parsedData 新しいJSON形式のデータ
 * @returns NonexistentViewReference のリスト
 */
export function findNonexistentViewFiles(parsedData: ParsedData): NonexistentViewReference[] {
  const nonexistentViews: NonexistentViewReference[] = [];

  // 実際存在するビュー名のセット
  const existingViewNames = new Set(Object.keys(parsedData.views));

  // コントローラで存在しないビューを検索
  const controllerViewMap: { [viewName: string]: NonexistentViewReference["callingFiles"] } = {};
  for (const [controllerName, controllerData] of Object.entries(parsedData.controllers)) {
    const controllerViews = controllerData.views || [];
    for (const viewName of controllerViews) {
      const normalizedViewName = viewName.replace(/\//g, '.');
      if (!existingViewNames.has(normalizedViewName)) {
        if (!controllerViewMap[normalizedViewName]) {
          controllerViewMap[normalizedViewName] = [];
        }
        controllerViewMap[normalizedViewName].push({
          type: 'controller',
          file: controllerData.file,
          name: controllerName
        });
      }
    }
  }

  // ルートで存在しないビューを検索
  const routeViewMap: { [viewName: string]: NonexistentViewReference["callingFiles"] } = {};
  for (const [routeSignature, routeData] of Object.entries(parsedData.routes)) {
    const routeViews = routeData.views || [];
    for (const viewName of routeViews) {
      const normalizedViewName = viewName.replace(/\//g, '.');
      if (!existingViewNames.has(normalizedViewName)) {
        if (!routeViewMap[normalizedViewName]) {
          routeViewMap[normalizedViewName] = [];
        }
        routeViewMap[normalizedViewName].push({
          type: 'route',
          file: routeData.file,
          line: routeData.line,
          name: routeSignature
        });
      }
    }
  }

  // コントローラとルート両方を統合
  const allNonexistentViewNames = new Set([
    ...Object.keys(controllerViewMap),
    ...Object.keys(routeViewMap)
  ]);

  for (const viewName of allNonexistentViewNames) {
    const callingFiles = [
      ...(controllerViewMap[viewName] || []),
      ...(routeViewMap[viewName] || [])
    ];

    nonexistentViews.push({
      viewName,
      callingFiles
    });
  }

  return nonexistentViews;
}
