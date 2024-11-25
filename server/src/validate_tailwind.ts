import {
    Diagnostic,
    DiagnosticSeverity,
} from "vscode-languageserver/node";

import * as fs from "fs";
import * as path from "path";

import { TextDocument } from "vscode-languageserver-textdocument";

// 許可された Tailwind クラスを読み込む関数
async function loadAllowedTailwindClasses(): Promise<{ allowedClasses: Set<string>, allowedParts: Set<string>, pastClasses: Set<string> }> {
    const tailwindFilePath = path.resolve(__dirname, 'dict/tailwind.txt');
    const tailwindPartsFilePath = path.resolve(__dirname, 'dict/tailwind_parts.txt');
    const pastVersionsDirPath = path.resolve(__dirname, 'dict/past_versions');

    // メインのTailwindクラスとパーツを読み込む
    const [tailwindData, tailwindPartsData] = await Promise.all([
        fs.promises.readFile(tailwindFilePath, 'utf-8'),
        fs.promises.readFile(tailwindPartsFilePath, 'utf-8')
    ]);

    // 各ファイルから単語を抽出
    const tailwindWords = tailwindData.split(/\r?\n/).filter(word => word.trim() !== '');
    const tailwindPartsWords = tailwindPartsData.split(/\r?\n/).filter(word => word.trim() !== '');

    // 単語をセットに格納
    const allowedClasses = new Set(tailwindWords);
    const allowedParts = new Set(tailwindPartsWords);

    // 過去バージョンのクラスを読み込む
    let pastClasses = new Set<string>();

    try {
        const pastFiles = await fs.promises.readdir(pastVersionsDirPath);
        const pastClassPromises = pastFiles.map(fileName => {
            const filePath = path.join(pastVersionsDirPath, fileName);
            return fs.promises.readFile(filePath, 'utf-8');
        });

        const pastDataArray = await Promise.all(pastClassPromises);

        for (const data of pastDataArray) {
            const words = data.split(/\r?\n/).filter(word => word.trim() !== '');
            for (const word of words) {
                pastClasses.add(word);
            }
        }
    } catch (err) {
        // エラー処理（例：ディレクトリが存在しない場合）
        console.error(`過去バージョンのディレクトリを読み込む際にエラーが発生しました: ${err}`);
    }

    return { allowedClasses, allowedParts, pastClasses };
}

// コメントの範囲を取得する関数
function getCommentRanges(text: string): Array<{ start: number; end: number }> {
    const commentRegExp = /<!--[\s\S]*?-->|{{--[\s\S]*?--}}/g;
    const ranges: Array<{ start: number; end: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = commentRegExp.exec(text)) !== null) {
        ranges.push({ start: match.index, end: match.index + match[0].length });
    }
    return ranges;
}

// `{{}}` の範囲を取得する関数
function getTemplateRanges(text: string): Array<{ start: number; end: number }> {
    const templateRegExp = /{{[\s\S]*?}}/g;
    const ranges: Array<{ start: number; end: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = templateRegExp.exec(text)) !== null) {
        ranges.push({ start: match.index, end: match.index + match[0].length });
    }
    return ranges;
}

// 指定された位置がコメントまたはテンプレート内かどうかをチェックする関数
function isPositionInRanges(position: number, ranges: Array<{ start: number; end: number }>): boolean {
    return ranges.some(range => position >= range.start && position < range.end);
}

// `class` 属性の値を解析してクラス名とその位置を取得する関数
function parseClassAttributeValue(value: string, startOffset: number): Array<{ cls: string, start: number, end: number }> {
    const classes: Array<{ cls: string, start: number, end: number }> = [];
    let inMustache = false;
    let buffer = '';
    let i = 0;
    let currentPos = startOffset;

    while (i < value.length) {
        if (!inMustache && value.startsWith('{{', i)) {
            inMustache = true;
            i += 2; // Skip {{
            currentPos += 2;
            if (buffer.trim().length > 0) {
                const classStart = currentPos - buffer.length - 2; // Adjust for the skipped {{
                classes.push({ cls: buffer.trim(), start: classStart, end: currentPos - 2 });
                buffer = '';
            }
            continue;
        }
        if (inMustache && value.startsWith('}}', i)) {
            inMustache = false;
            i += 2; // Skip }}
            currentPos += 2;
            continue;
        }
        if (inMustache) {
            i++;
            currentPos++;
            continue;
        }
        const char = value[i];
        if (/\s/.test(char)) {
            if (buffer.trim().length > 0) {
                const classStart = currentPos - buffer.length;
                classes.push({ cls: buffer.trim(), start: classStart, end: currentPos });
                buffer = '';
            }
            i++;
            currentPos++;
            continue;
        }
        buffer += char;
        i++;
        currentPos++;
    }
    if (buffer.trim().length > 0) {
        const classStart = currentPos - buffer.length;
        classes.push({ cls: buffer.trim(), start: classStart, end: currentPos });
    }
    return classes;
}

// ホワイトリストを引数として受け取るように関数を修正
export async function validateTailwindClasses(
    textDocument: TextDocument,
    whitelist: Set<string>,
    severity: DiagnosticSeverity | undefined,
    severity_pastTailwind: DiagnosticSeverity | undefined,
): Promise<Diagnostic[]> {
    const text = textDocument.getText();

    // コメントとテンプレートの範囲を取得
    const commentRanges = getCommentRanges(text);
    const templateRanges = getTemplateRanges(text);

    const classAttributeRegExp = /(class|:class)="([^"]*)"/g;
    let match: RegExpExecArray | null;

    // 許可された Tailwind クラスと過去のクラスを非同期で読み込む
    const { allowedClasses, allowedParts, pastClasses } = await loadAllowedTailwindClasses();

    const diagnostics: Diagnostic[] = [];

    while ((match = classAttributeRegExp.exec(text)) !== null) {
        const attributeStart = match.index;
        const attributeName = match[1]; // 'class' または ':class'
        const attributeValue = match[2]; // 属性の値

        // 属性がコメント内またはテンプレート内にある場合はスキップ
        if (
            isPositionInRanges(attributeStart, commentRanges) ||
            isPositionInRanges(attributeStart, templateRanges)
        ) {
            continue;
        }

        let classesToCheck: Array<{ cls: string, start: number, end: number }> = [];

        if (attributeName === 'class') {
            // 属性値の開始位置を計算（ドキュメント全体の中での位置）
            const attrValueStartOffset = attributeStart + attributeName.length + 2; // 属性名と =" の分を考慮

            // `class` 属性の値を解析してクラス名とその位置を取得
            classesToCheck = parseClassAttributeValue(attributeValue, attrValueStartOffset);
        } else if (attributeName === ':class') {
            // :class 属性の場合は Tailwind のクラスのみを抽出
            const tailwindClassRegExp = /'([^']+)'|"([^"]+)"/g;
            let classMatch: RegExpExecArray | null;
            const attrValueStartOffset = attributeStart + attributeName.length + 2; // 属性名と =" の分を考慮

            while ((classMatch = tailwindClassRegExp.exec(attributeValue)) !== null) {
                const cls = classMatch[1] || classMatch[2];
                const clsStartInAttrValue = classMatch.index + 1; // 引用符を考慮
                const clsStart = attrValueStartOffset + clsStartInAttrValue;
                const clsEnd = clsStart + cls.length;

                // クラス名をスペースで分割
                const clsList = cls.split(/\s+/);
                let offsetInCls = 0;
                for (const singleCls of clsList) {
                    if (singleCls.trim() === '') {
                        offsetInCls += singleCls.length + 1; // スペース分を考慮
                        continue;
                    }
                    const singleClsStart = clsStart + offsetInCls;
                    const singleClsEnd = singleClsStart + singleCls.length;
                    classesToCheck.push({ cls: singleCls, start: singleClsStart, end: singleClsEnd });
                    offsetInCls += singleCls.length + 1; // スペース分を考慮
                }
            }
        }

        for (const { cls, start, end } of classesToCheck) {
            // 状態変化（variants）を処理
            const parts = cls.split(':');
            const baseClassWithVariants = parts[parts.length - 1]; // 最後の部分が基本クラス

            // クラス名が `-` で始まる場合、`-` を除去
            let isNegative = false;
            let baseClass = baseClassWithVariants;
            if (baseClass.startsWith('-')) {
                isNegative = true;
                baseClass = baseClass.substring(1);
            }

            // '/' が含まれる場合、先に処理
            const slashIndex = baseClass.indexOf('/');
            if (slashIndex !== -1) {
                // '/' を含めてチェックするクラスのセット
                const includeSlashClasses = new Set(['inset', 'start', 'end', 'top', 'right', 'bottom', 'left', 'basis', 'w', 'h', 'size', 'translate']);
                // クラスのプレフィックスを取得
                const baseClassPrefix = baseClass.split('-')[0];

                if (!includeSlashClasses.has(baseClassPrefix)) {
                    baseClass = baseClass.substring(0, slashIndex); // '/' の前の部分を取得
                }
            }

            // 任意の値の部分を検出
            const arbitraryMatch = baseClass.match(/^(.*?)(\[[^\]]+\])$/);
            let hasArbitrary = false;
            let arbitraryValue = '';

            if (arbitraryMatch) {
                hasArbitrary = true;
                baseClass = arbitraryMatch[1]; // 任意の値の前の部分を取得
                arbitraryValue = arbitraryMatch[2]; // 任意の値（[...])を取得

                // 任意の値の前の `-` を除去（任意の値がある場合のみ）
                if (baseClass.endsWith('-')) {
                    baseClass = baseClass.slice(0, -1);
                }
            }

            // baseClassが空の場合（任意の値のみの場合）はスキップ
            if (baseClass === '') {
                continue;
            }

            // ホワイトリストを組み立てる
            let allAllowedClasses = new Set<string>([...allowedClasses, ...whitelist]);
            if (hasArbitrary) {
                // 任意の値がある場合、allowedPartsも含める
                allAllowedClasses = new Set([...allowedClasses, ...allowedParts, ...whitelist]);
            }

            // baseClass を '-' で分割して各部分をチェック（任意の値がある場合のみ）
            let baseParts = [baseClass];
            if (hasArbitrary) {
                baseParts = baseClass.split('-').filter(part => part !== '');
            }

            let isValid = true;
            for (const part of baseParts) {
                if (!allAllowedClasses.has(part)) {
                    isValid = false;
                    let diagnosticSeverity = severity;
                    let message = `${isNegative ? '-' : ''}${part} はTailwind CSSのクラスではありません`;

                    if (pastClasses.has(part)) {
                        diagnosticSeverity = severity_pastTailwind;
                        message = `${isNegative ? '-' : ''}${part} は現在のTailwind CSSバージョンでは使用できない可能性があります`;
                    }

                    if (diagnosticSeverity === undefined) {
                        continue;
                    }

                    diagnostics.push({
                        severity: diagnosticSeverity,
                        range: {
                            start: textDocument.positionAt(start + cls.indexOf(part)),
                            end: textDocument.positionAt(start + cls.indexOf(part) + part.length),
                        },
                        message: message,
                        source: 'Laravel Navigator for Beginners',
                    });
                }
            }
        }
    }

    return diagnostics;
}
