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
