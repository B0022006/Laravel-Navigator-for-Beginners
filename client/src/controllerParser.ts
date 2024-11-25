import * as fs from 'fs';
import * as path from 'path';
import * as phpParser from 'php-parser';

export interface ViewVariableMap {
  [viewName: string]: {
    filePath: string;
    variables: string[];
  }[];
}

export async function parseControllers(controllersDir: string): Promise<ViewVariableMap> {
  const viewVariables: ViewVariableMap = {};

  console.log("Starting to parse controllers in directory:", controllersDir);
  await scanDirectory(controllersDir, viewVariables);

  // console.log("Final View Variables Map:", JSON.stringify(viewVariables, null, 2));
  return viewVariables;
}

async function scanDirectory(dir: string, viewVariables: ViewVariableMap) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      console.log("Entering directory:", fullPath);
      await scanDirectory(fullPath, viewVariables);
    } else if (file.endsWith('.php')) {
      // console.log("Parsing PHP file:", fullPath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      parseControllerFile(content, viewVariables, fullPath);
    }
  }
}

function parseControllerFile(content: string, viewVariables: ViewVariableMap, filePath: string) {
  const parser = new phpParser.Engine({
    parser: {
      extractDoc: true,
      suppressErrors: true,
    },
    ast: {
      withPositions: true,
    },
  });

  let ast;
  try {
    ast = parser.parseCode(content, filePath);
  } catch (error) {
    console.error(`Failed to parse PHP file: ${filePath}`, error);
    return;
  }
  if (filePath == "c:\\Users\\B0022006\\Documents\\2024年度\\卒業制作\\プログラム\\デバッグ用\\sample-app\\app\\Http\\Controllers\\Admin\\BookController.php") {
    // console.log("Parsed AST:", JSON.stringify(ast, null, 2));
    // fs.writeFileSync(path.join(__dirname, 'ast例3.json'), JSON.stringify(ast, null, 2));
    console.log("Traversing AST...", path.join(__dirname, 'ast例2.json'));
  }
  traverseAST(ast, viewVariables, filePath);
}

function traverseAST(node: any, viewVariables: ViewVariableMap, filePath: string) {
  if (!node) return;

  if (node.kind === 'call') {
    const viewCallNode = findViewCall(node);
    if (viewCallNode) {
      handleViewCall(viewCallNode, viewVariables, filePath);
    }
  }

  // 子ノードを再帰的に探索
  for (const key in node) {
    if (node.hasOwnProperty(key)) {
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((c) => traverseAST(c, viewVariables, filePath));
      } else if (typeof child === 'object' && child !== null && child.kind) {
        traverseAST(child, viewVariables, filePath);
      }
    }
  }
}

function findViewCall(node: any): any | null {
  if (node.kind === 'call') {
    if (node.what.kind === 'identifier' || node.what.kind === 'name') {
      if (node.what.name === 'view') {
        return node;
      }
    } else if (node.what.kind === 'propertylookup' || node.what.kind === 'staticlookup') {
      if (node.what.offset.kind === 'identifier' && node.what.offset.name === 'view') {
        return node;
      } else {
        return findViewCall(node.what.what);
      }
    } else if (node.what.kind === 'call') {
      return findViewCall(node.what);
    }
  } else if (node.kind === 'propertylookup' || node.kind === 'staticlookup') {
    if (node.offset.kind === 'identifier' && node.offset.name === 'view') {
      return node;
    } else {
      return findViewCall(node.what);
    }
  }

  return null;
}

function handleViewCall(node: any, viewVariables: ViewVariableMap, filePath: string) {
  const args = node.arguments;

  let viewName = '';
  if (args.length >= 1) {
    const viewArg = args[0];
    if (viewArg.kind === 'string') {
      viewName = viewArg.value;
    } else if (viewArg.kind === 'encapsed') {
      viewName = viewArg.value.map((v: any) => v.value || '').join('');
    }
  }

  let variables: string[] = [];
  if (args.length >= 2) {
    variables = extractVariablesFromArg(args[1]);
  }

  if (viewName) {
    if (!viewVariables[viewName]) {
      viewVariables[viewName] = [];
    }
    viewVariables[viewName].push({
      filePath,
      variables,
    });
    // console.log(`Found view call in ${filePath}: viewName=${viewName}, variables=${variables.join(", ")}`);
  }
}

function extractVariablesFromArg(arg: any): string[] {
  const variables: string[] = [];

  if (arg.kind === 'array') {
    arg.items.forEach((item: any) => {
      if (item.kind === 'entry') {
        const key = item.key;
        if (key.kind === 'string') {
          variables.push(key.value);
        } else if (key.kind === 'variable') {
          variables.push(key.name);
        }
      }
    });
  } else if (arg.kind === 'variable') {
    variables.push(arg.name);
  } else if (arg.kind === 'call' && arg.what.name === 'compact') {
    // compact('var1', 'var2', ...)
    arg.arguments.forEach((argItem: any) => {
      if (argItem.kind === 'string') {
        variables.push(argItem.value);
      }
    });
  }

  return variables;
}
