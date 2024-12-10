// parser_route.ts

import { Engine } from 'php-parser';

export interface Route {
  method: string;
  path: string;
  controller?: string;
  views?: string[];
  file: string;
  line: number;
}

export function analyzeRoutes(
  filePath: string,
  content: string,
  parser: Engine
): Route[] {
  let ast = parser.parseCode(content, filePath);
  let result: Route[] = [];

  function traverse(node: any): void {
    if (node.kind === 'call') {
      let methodName = '';
      let route: Route = {
        method: '',
        path: '',
        file: filePath,
        line: node.loc ? node.loc.start.line : null,
      };

      if (node.what.kind === 'staticlookup') {
        if (node.what.offset && node.what.offset.kind === 'identifier') {
          methodName = node.what.offset.name;
        }
      } else if (node.what.kind === 'propertylookup') {
        if (node.what.offset && node.what.offset.kind === 'identifier') {
          methodName = node.what.offset.name;
        }
      }

      if (
        methodName &&
        ['get', 'post', 'put', 'delete', 'patch', 'options', 'match', 'any'].includes(
          methodName
        )
      ) {
        route.method = methodName;
        if (node.arguments && node.arguments.length > 0) {
          if (node.arguments[0].kind === 'string') {
            route.path = node.arguments[0].value;
          }

          // コントローラの呼び出し
          if (node.arguments[1]) {
            if (
              node.arguments[1].kind === 'string' ||
              node.arguments[1].kind === 'array'
            ) {
              if (node.arguments[1].kind === 'string') {
                route.controller = node.arguments[1].value;
              } else if (node.arguments[1].kind === 'array') {
                let controllerAndAction = extractControllerAndAction(node.arguments[1]);
                if (controllerAndAction.controller && controllerAndAction.action) {
                  route.controller = `${controllerAndAction.controller}@${controllerAndAction.action}`;
                }
              }
            } else if (node.arguments[1].kind === 'closure') {
              // クロージャの場合はビュー抽出
              const closureNode = node.arguments[1];
              const views = extractViewsFromClosure(closureNode);
              if (views.length > 0) {
                route.views = views;
              }
            }
          }
        }
        result.push(route);
      }
    }

    for (let key in node) {
      if (node[key] && typeof node[key] === 'object') {
        traverse(node[key]);
      }
    }
  }

  function extractControllerAndAction(node: any): { controller: string; action: string } {
    let controllerName = '';
    let actionName = '';

    if (node.kind === 'array') {
      if (
        node.items.length > 0 &&
        node.items[0].value.kind === 'staticlookup' &&
        node.items[0].value.what.kind === 'name' &&
        node.items[0].value.what.name &&
        node.items[0].value.offset.kind === 'identifier' &&
        node.items[0].value.offset.name === 'class'
      ) {
        controllerName = node.items[0].value.what.name;
      } else if (node.items[0].value.kind === 'string') {
        controllerName = node.items[0].value.value;
      }
      if (node.items.length > 1 && node.items[1].value.kind === 'string') {
        actionName = node.items[1].value.value;
      }
    }

    return { controller: controllerName, action: actionName };
  }

  function extractViewsFromClosure(closureNode: any): string[] {
    let views: string[] = [];

    function traverseClosure(node: any): void {
      if (!node) return;

      if (node.kind === 'return') {
        if (
          node.expr &&
          node.expr.kind === 'call' &&
          node.expr.what.name === 'view'
        ) {
          if (
            node.expr.arguments &&
            node.expr.arguments[0] &&
            node.expr.arguments[0].kind === 'string'
          ) {
            views.push(node.expr.arguments[0].value);
          }
        }
      }

      if (Array.isArray(node.children)) {
        for (let child of node.children) {
          traverseClosure(child);
        }
      } else {
        for (let key in node) {
          if (node[key] && typeof node[key] === 'object') {
            traverseClosure(node[key]);
          }
        }
      }
    }

    traverseClosure(closureNode.body);
    return views;
  }

  traverse(ast);
  return result;
}
