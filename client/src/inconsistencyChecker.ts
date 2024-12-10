import { VariablesMap } from './viewParser';
import { ViewVariableMap } from './controllerParser';

interface Inconsistency {
  viewName: string;
  viewFilePath: string;
  undefinedVariables: string[]; // ビューで使用されているが、コントローラーから渡されていない変数
  unusedVariables: string[]; // コントローラーから渡されているが、ビューで使用されていない変数
}

/**
 * ビューで使用されている変数と、コントローラーから渡されている変数の間の矛盾を検出します。
 * @param viewVariables ビューで使用されている変数
 * @param controllerVariables コントローラーから渡されている変数
 * @returns 矛盾のリスト
 */
export function checkInconsistencies(
  viewVariables: VariablesMap,
  controllerVariables: ViewVariableMap
): Inconsistency[] {
  const inconsistencies: Inconsistency[] = [];

  // コントローラーのビュー名を正規化（スラッシュをドットに置換）
  const normalizedControllerVariables: ViewVariableMap = {};
  for (const [viewName, varDataList] of Object.entries(controllerVariables)) {
    const normalizedViewName = viewName.replace(/\//g, '.');
    normalizedControllerVariables[normalizedViewName] = varDataList;
  }

  // ビューごとにチェック
  for (const [viewName, viewVarData] of Object.entries(viewVariables)) {
    const usedVariables = new Set<string>();
    const viewFilePath = viewVarData.filePath;

    // ビューで使用されている変数を追加
    viewVarData.variables.forEach((variable) => usedVariables.add(variable));

    // コンポーネントで使用されている変数も追加
    if (viewVarData.componentVariables) {
      for (const variables of Object.values(viewVarData.componentVariables)) {
        variables.forEach((variable) => usedVariables.add(variable));
      }
    }

    // コントローラーから渡されている変数
    const controllerVarDataList = normalizedControllerVariables[viewName];

    const passedVariables = new Set<string>();

    if (controllerVarDataList) {
      for (const controllerVarData of controllerVarDataList) {
        controllerVarData.variables.forEach((variable) => passedVariables.add(variable));
      }
    }

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
 * @param viewVariables ビューで使用されている変数
 * @param controllerVariables コントローラーから渡されている変数
 * @returns 使われていないビューのリスト
 */
export function findUnusedViewFiles(
  viewVariables: VariablesMap,
  controllerVariables: ViewVariableMap
): { viewName: string; viewFilePath: string }[] {
  const unusedViews: { viewName: string; viewFilePath: string }[] = [];

  // コントローラーのビュー名を正規化（スラッシュをドットに置換）
  const normalizedControllerViewNames = new Set<string>();
  for (const viewName of Object.keys(controllerVariables)) {
    normalizedControllerViewNames.add(viewName.replace(/\//g, '.'));
  }

  // ビューごとにチェック
  for (const [viewName, viewVarData] of Object.entries(viewVariables)) {
    if (!normalizedControllerViewNames.has(viewName)) {
      unusedViews.push({
        viewName,
        viewFilePath: viewVarData.filePath,
      });
    }
  }

  return unusedViews;
}

/**
 * コントローラーから呼び出されているが、存在しないビューを検出します。
 * @param viewVariables ビューで使用されている変数（解析結果）
 * @param controllerVariables コントローラーから渡されている変数（解析結果）
 * @returns 存在しないビューのリスト
 */
export function findNonexistentViewFiles(
  viewVariables: VariablesMap,
  controllerVariables: ViewVariableMap
): { viewName: string }[] {
  const nonexistentViews: { viewName: string }[] = [];

  // viewVariables 内のキーをセット化
  const existingViewNames = new Set(Object.keys(viewVariables));

  // コントローラーのビュー名を正規化（スラッシュをドットに置換）
  for (const viewName of Object.keys(controllerVariables)) {
    const normalizedViewName = viewName.replace(/\//g, '.');
    if (!existingViewNames.has(normalizedViewName)) {
      // 該当のビューが存在しない
      nonexistentViews.push({ viewName: normalizedViewName });
    }
  }

  return nonexistentViews;
}