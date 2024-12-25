import * as fs from 'fs/promises'; // fsのpromisesを使う
import * as path from 'path';
const pluralize = require('pluralize'); // pluralizeライブラリを正しくインポート

// Laravelプロジェクト内のモデルディレクトリを解析し、モデル名と複数形を取得してテキストファイルに出力する関数
export async function extractModelNames(projectPath: string, dictionaryPath: string): Promise<void> {
    const modelDir: string = path.join(projectPath, 'app/Models'); // モデルディレクトリのパス

    // ディレクトリ内のPHPファイルを再帰的に読み込む関数
    async function readDirectory(directory: string): Promise<{ singular: string; plural: string }[]> {
        let modelNames: { singular: string; plural: string }[] = [];
        try {
            const files = await fs.readdir(directory); // ディレクトリ内のファイル一覧を取得
            for (const file of files) {
                const filePath: string = path.join(directory, file);
                const stats = await fs.stat(filePath); // ファイル情報を取得
                if (stats.isDirectory()) {
                    // ディレクトリの場合は再帰処理WA
                    const subDirModels = await readDirectory(filePath);
                    modelNames = modelNames.concat(subDirModels);
                } else if (file.endsWith('.php')) {
                    // ファイル名から拡張子を除いた部分をモデル名として追加
                    const modelName = path.basename(file, '.php');
                    // singularは元のモデル名、pluralは複数形に変換したもの
                    modelNames.push({ singular: modelName, plural: pluralize(modelName) });
                }
            }
        } catch (err) {
            // console.error(`ディレクトリ読み込み中にエラーが発生しました: ${(err as Error).message}`);
            // const outputErrorFilePath = path.join(dictionaryPath, 'parseError2.txt');
            // await fs.writeFile(outputErrorFilePath, (err as Error).message, 'utf-8');
        }
        return modelNames;
    }

    // モデル名とその複数形を取得
    const modelNames = await readDirectory(modelDir);

    // モデル名と複数形を改行区切りでテキストに変換
    const outputContent = modelNames.map(model => `${model.singular}\n${model.plural}`).join('\n');

    // 結果をテキストファイルに改行区切りで保存
    const outputFilePath = path.join(dictionaryPath, 'auto_create/models.txt');
    await fs.writeFile(outputFilePath, outputContent, 'utf-8');
    console.log(`モデル名と複数形一覧を ${outputFilePath} に保存しました`);
}
