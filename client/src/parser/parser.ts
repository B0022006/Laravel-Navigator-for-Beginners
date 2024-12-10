// parser.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { Engine } from 'php-parser';
import { RedirectInfo } from './parser_redirect'; // リダイレクト解析は既存
import { analyzeControllerPHP, ControllerInfo } from './parser_controller';
import { parseViews, VariablesMap } from './parser_view'; // parseViews, VariablesMapをインポート
import { analyzeRoutes, Route } from './parser_route';

export async function parse(projectPath: string): Promise<void> {
  const parser = new Engine({
    parser: {
      extractDoc: true,
      php7: true,
    },
    ast: {
      withPositions: true,
    },
  });

  // Laravelプロジェクト内の各ディレクトリ
  const controllerDir: string = path.join(projectPath, 'app/Http/Controllers');
  const modelDir: string = path.join(projectPath, 'app/Models');
  const viewDir: string = path.join(projectPath, 'resources/views');
  const routesDir: string = path.join(projectPath, 'routes');

  let controllers: { [key: string]: ControllerInfo } = {};
  let models: { [key: string]: string } = {};
  let routes: { [key: string]: Route } = {};
  let views: VariablesMap = {}; // VariablesMapを格納するための変数

  async function readDirectory(
    directory: string,
    callback: (filePath: string, content: string) => void
  ): Promise<void> {
    try {
      const files = await fs.readdir(directory);
      for (const file of files) {
        const filePath: string = path.join(directory, file);
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) {
          await readDirectory(filePath, callback);
        } else if (file.endsWith('.php')) {
          const content: string = await fs.readFile(filePath, 'utf-8');
          callback(filePath, content);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  await Promise.all([
    // モデルディレクトリ解析
    readDirectory(modelDir, (filePath, content) => {
      const modelName = path.basename(filePath, '.php');
      models[modelName] = filePath;
    }),
    // コントローラーディレクトリ解析
    readDirectory(controllerDir, (filePath, content) => {
      const controllerName = path.basename(filePath, '.php');
      const analysis = analyzeControllerPHP(content, filePath, parser, models);
      controllers[controllerName] = {
        file: filePath,
        models: analysis.models,
        views: analysis.views,
        redirects: analysis.redirects,
        viewVariables: analysis.viewVariables,
      };
    }),
    // ルートディレクトリ解析
    readDirectory(routesDir, (filePath, content) => {
      const routeMappings = analyzeRoutes(filePath, content, parser);
      routeMappings.forEach((route) => {
        const key = `${route.method.toUpperCase()} ${route.path}`;
        if (!routes[key]) {
          routes[key] = route;
        }
      });
    }),
  ]);

  // ビュー解析 (parseViewsを利用)
  views = await parseViews(viewDir, projectPath);

  const result = {
    controllers,
    models,
    views,
    routes,
  };
  const outputFilePath: string = path.join(__dirname, 'output.json');
  await fs.writeFile(outputFilePath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`解析結果を ${outputFilePath} に保存しました`);
}
