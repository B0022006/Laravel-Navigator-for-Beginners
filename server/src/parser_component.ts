import * as fs from 'fs/promises';
import * as path from 'path';

// Laravelプロジェクト内のbladeコンポーネントファイル名およびフォルダ名を取得してテキストファイルに出力する関数
export async function extractBladeComponentNamesAndFolders(projectPath: string): Promise<void> {
    const componentsDir = path.join(projectPath, 'resources/views/components'); // 無名コンポーネントディレクトリ
    const classComponentsDir = path.join(projectPath, 'app/View/Components'); // クラスベースコンポーネントディレクトリ

    // ハイフンを削除し、改行に置き換える関数
    function replaceHyphenWithNewline(name: string): string {
        return name.split('-').join('\n'); // ハイフンを改行に置換
    }

    // クラス名を単語ごとに区切る関数
    function splitClassNameIntoWords(className: string): string[] {
        return className.split(/(?=[A-Z])/).filter(word => word.length > 0); // 大文字の前で分割し、空文字を除外
    }

    // ディレクトリ内のbladeファイルとフォルダを再帰的に読み込む関数（無名コンポーネント用）
    async function readAnonymousComponents(directory: string): Promise<string[]> {
        let bladeFilesAndFolders: string[] = [];
        try {
            const files = await fs.readdir(directory);
            for (const file of files) {
                const filePath = path.join(directory, file);
                const stats = await fs.stat(filePath);
                if (stats.isDirectory()) {
                    const folderName = replaceHyphenWithNewline(file);
                    bladeFilesAndFolders.push(folderName);
                    const subDirFiles = await readAnonymousComponents(filePath);
                    bladeFilesAndFolders = bladeFilesAndFolders.concat(subDirFiles);
                } else if (file.endsWith('.blade.php')) {
                    const fileName = replaceHyphenWithNewline(path.basename(file, '.blade.php'));
                    bladeFilesAndFolders.push(fileName);
                }
            }
        } catch (err) {
            console.error(`ディレクトリ読み込み中にエラーが発生しました: ${(err as Error).message}`);
            const outputErrorFilePath = path.join(__dirname, 'dict/parseError.txt');
            await fs.writeFile(outputErrorFilePath, (err as Error).message, 'utf-8');
        }
        return bladeFilesAndFolders;
    }

    // クラスベースコンポーネントのクラス名を取得し、単語に分割する関数
    async function readClassComponents(directory: string): Promise<string[]> {
        let classComponentWords: string[] = [];
        try {
            const files = await fs.readdir(directory);
            for (const file of files) {
                const filePath = path.join(directory, file);
                const stats = await fs.stat(filePath);
                if (stats.isDirectory()) {
                    const subDirWords = await readClassComponents(filePath);
                    classComponentWords = classComponentWords.concat(subDirWords);
                } else if (file.endsWith('.php')) {
                    const fileContent = await fs.readFile(filePath, 'utf-8');
                    const classNameMatch = fileContent.match(/class\s+(\w+)/);
                    if (classNameMatch) {
                        const className = classNameMatch[1];
                        const words = splitClassNameIntoWords(className);
                        const lowercaseWords = words.map(word => word.toLowerCase());
                        classComponentWords = classComponentWords.concat(words);
                        classComponentWords = classComponentWords.concat(lowercaseWords);
                    }
                }
            }
        } catch (err) {
            console.error(`クラスベースコンポーネントの読み込み中にエラーが発生しました: ${(err as Error).message}`);
            const outputErrorFilePath = path.join(__dirname, 'dict/parseError.txt');
            await fs.writeFile(outputErrorFilePath, (err as Error).message, 'utf-8');
        }
        return classComponentWords;
    }

    // 無名コンポーネントを取得
    const anonymousComponents = await readAnonymousComponents(componentsDir);

    // クラスベースコンポーネントを取得し、単語に分割
    const classComponentsWords = await readClassComponents(classComponentsDir);

    // コンポーネント名と単語を統合
    const allComponents = [...anonymousComponents, ...classComponentsWords];

    // コンポーネント名と単語を改行区切りでテキストに変換
    const outputContent = allComponents.join('\n');

    // 結果をテキストファイルに保存
    const outputFilePath = path.join(__dirname, 'dict/bladeComponent.txt');
    await fs.writeFile(outputFilePath, outputContent, 'utf-8');
    console.log(`コンポーネントファイル名およびフォルダ名一覧を ${outputFilePath} に保存しました`);
}
