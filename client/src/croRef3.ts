// croRef.ts

import * as fs from 'fs';
import * as path from 'path';

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

export interface VariableDifferences {
    view: string;
    variablesSentNotUsed: string[];
    variablesUsedNotSent: string[];
}

/**
 * 変数の差分を比較する関数
 * @param jsonData - 解析結果のJSONデータ
 * @returns 変数の差分リスト
 */
export function compareVariables(jsonData: AnalysisResult): VariableDifferences[] {
    const result: VariableDifferences[] = [];

    const views = jsonData.views;
    const controllers = jsonData.controllers;

    // ビュー名をキーとして、使用されている変数のマップを作成
    const viewVariablesUsedMap: { [key: string]: Set<string> } = {};

    for (const viewName in views) {
        const variablesUsed = views[viewName].variablesUsed;
        const variableNames = new Set<string>();
        for (const variable of variablesUsed) {
            // 変数名の先頭の'$'を削除し、小文字に変換
            const name = variable.name.replace(/^\$+/, '').toLowerCase();
            variableNames.add(name);
        }
        viewVariablesUsedMap[viewName] = variableNames;
    }

    // ビュー名をキーとして、送信された変数のマップを作成
    const viewVariablesSentMap: { [key: string]: Set<string> } = {};

    for (const controllerName in controllers) {
        const variablesSent = controllers[controllerName].variablesSent;
        for (const variable of variablesSent) {
            const sentTo = variable.sentTo;
            // sentToがビューの場合のみ処理
            if (sentTo && !sentTo.startsWith('redirect') && !sentTo.includes('@')) {
                if (!viewVariablesSentMap[sentTo]) {
                    viewVariablesSentMap[sentTo] = new Set<string>();
                }
                const name = variable.name.replace(/^\$+/, '').toLowerCase();
                viewVariablesSentMap[sentTo].add(name);
            }
        }
    }

    // 各ビューについて、変数の差分を計算
    for (const viewName in views) {
        const variablesUsed = viewVariablesUsedMap[viewName] || new Set<string>();
        const variablesSent = viewVariablesSentMap[viewName] || new Set<string>();

        // 送信されたが使用されていない変数
        const variablesSentNotUsed = Array.from(variablesSent).filter(v => !variablesUsed.has(v));
        // 使用されたが送信されていない変数
        const variablesUsedNotSent = Array.from(variablesUsed).filter(v => !variablesSent.has(v));

        result.push({
            view: viewName,
            variablesSentNotUsed,
            variablesUsedNotSent,
        });
    }

    return result;
}

/**
 * JSONファイルを読み込んで解析結果を取得する関数
 * @param jsonFilePath - JSONファイルのパス
 * @returns 解析結果のオブジェクト
 */
export function readAnalysisResult(jsonFilePath: string): AnalysisResult {
    const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8')) as AnalysisResult;

    // ファイルパスを正しい形式に修正
    for (const controllerName in jsonData.controllers) {
        const controller = jsonData.controllers[controllerName];
        controller.file = path.normalize(controller.file);

        for (const variable of controller.variablesSent) {
            variable.sentFrom = path.normalize(variable.sentFrom);
        }
    }

    for (const viewName in jsonData.views) {
        const view = jsonData.views[viewName];
        view.file = path.normalize(view.file);
    }

    return jsonData;
}
