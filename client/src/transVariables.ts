export function convertJsonToJapanese(data: any[]): string {
    // 結果を格納する文字列
    let result = '';

    // 各項目を日本語の箇条書き形式で作成
    data.forEach((item) => {
        result += `\n`;
        result += `- ビュー名: ${item.viewName}\n`;

        // 未定義の変数
        if (item.undefinedVariables && item.undefinedVariables.length > 0) {
            result += `  - 未定義の変数: ${item.undefinedVariables.join(', ')}\n`;
        } else {
            result += `  - 未定義の変数: なし\n`;
        }

        // 未使用の変数
        if (item.unusedVariables && item.unusedVariables.length > 0) {
            result += `  - 未使用の変数: ${item.unusedVariables.join(', ')}\n`;
        } else {
            result += `  - 未使用の変数: なし\n`;
        }

        result += `  - ファイルパス: ${item.viewFilePath}\n`;
    });

    // 結果を返す
    return result.trim();
}
