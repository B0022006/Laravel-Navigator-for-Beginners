export function convertJsonToJapanese_variable(data: any[]): string {
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

export function convertJsonToJapanese_unUsed(data: any[]): string {
    // 結果を格納する文字列
    let result = '';

    if (data.length === 0) {
        return '未使用のビューはありません。';
    }

    // 各項目を日本語の箇条書き形式で作成
    data.forEach((item) => {
        result += `\n`;
        result += `- ビュー名: ${item.viewName}\n`;

        // 未使用のビューファイル
        result += `  - ファイルパス: ${item.viewFilePath}\n`;
    });

    // 結果を返す
    return result.trim();
}

export function convertJsonToJapanese_nonexistentViews(data: any[]): string {
    // 結果を格納する文字列
    let result = '';

    if (data.length === 0) {
        return '存在しないビューを呼び出しているものはありません。';
    }

    // 各項目を日本語の箇条書き形式で作成
    data.forEach((item) => {
        result += `\n`;
        result += `- ビュー名: ${item.viewName}\n`;

        if (item.callingFiles && item.callingFiles.length > 0) {
            result += `  呼び出し元:\n`;
            item.callingFiles.forEach((callingFile: any) => {
                const typeJp = callingFile.type === 'controller' ? 'コントローラー' : 'ルート';
                result += `    - 種類: ${typeJp}\n`;
                if (callingFile.name) {
                    result += `      - 名称: ${callingFile.name}\n`;
                }
                result += `      - ファイルパス: ${callingFile.file}\n`;
                if (callingFile.line) {
                    result += `      - 行番号: ${callingFile.line}\n`;
                }
            });
        } else {
            result += `  呼び出し元: 不明\n`;
        }
    });

    // 結果を返す
    return result.trim();
}
