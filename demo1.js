const acorn = require("acorn");
const babel = require("@babel/core");
const generate = require("@babel/generator").default;

const toAssignMap = new Map([
  [
    "Literal",
    (value) => {
      if (typeof parseInt(value) === "number") {
        return "NumericLiteral";
      }
      return "StringLiteral";
    },
  ],
  ["Property", () => "ObjectProperty"],
]);

const parse = acorn.Parser.extend((Parser) => {
  const skipWhiteSpace = /(?:\s|\/\/.*|\/\*[^]*?\*\/)*/g;
  const whiteSpace = (acorn) => {
    skipWhiteSpace.lastIndex = acorn.pos;
    const skip = skipWhiteSpace.exec(acorn.input);
    return skip[0].length;
  };
  const isAtFunction = (acorn) => {
    const next = acorn.pos + whiteSpace(acorn);
    return (
      acorn.type.label === "@" && acorn.input.slice(next, next + 4) === "wrap"
    );
  };
  const atToken = new acorn.TokenType("@");
  return class extends Parser {
    finishNode(node, type) {
      const assignType = toAssignMap.get(type);
      if (assignType) {
        return super.finishNode(node, assignType(type));
      }
      return super.finishNode(node, type);
    }
    readToken(code) {
      if (code === 64) {
        ++this.pos;
        return this.finishToken(atToken);
      }
      return super.readToken(code);
    }
    parseStatement(context, topLevel, exports) {
      if (isAtFunction(this)) {
        this.eat(atToken);
        const wrap = [];
        let isAsync = false;
        while (this.type !== acorn.tokTypes._function) {
          if (this.isContextual("async")) {
            isAsync = true;
            this.next();
            break;
          }
          wrap.push(this.parseExpression(null, null));
          this.eat(atToken);
        }
        const functionNode = this.parseFunctionStatement(
          this.startNode,
          isAsync,
          !context
        );
        functionNode.wrap = wrap;
        return functionNode;
      }
      return super.parseStatement(context, topLevel, exports);
    }
  };
});

const buildHoc = (wrap, replaceAst, id) => {
  const buildWrap = babel.template`let FUNCTIONNAME = (args)=> WRAPAST`;
  while (wrap.length) {
    const current = wrap.shift();
    const args = [
      replaceAst,
      ...current
        .get("arguments")
        .slice(1)
        .map((v) => v.node),
    ];
    replaceAst = babel.types.callExpression(current.get("arguments.0").node, [
      ...args,
      babel.types.identifier("args"),
    ]);
  }
  return buildWrap({
    FUNCTIONNAME: id,
    WRAPAST: replaceAst,
  });
};

const transitionCode = (code) => {
  const ast = {
    type: "File",
    program: parse.parse(code, {}),
  };
  babel.traverse(ast, {
    FunctionDeclaration(path) {
      const wrap = path.get("wrap");
      if (Array.isArray(wrap)) {
        const node = path.node;
        let id = node.id;
        delete node.wrap;
        node.id = null;
        node.type = "FunctionExpression";
        path.replaceWith(buildHoc(wrap, node, id));
      }
    },
  });
  return generate(ast);
};


const code = transitionCode.parse(`
function log(fn,args){
  console.log(fn.name,'开始执行');
  fn(args);
  console.log(fn.name,'开始结束');
}
@wrap(log)
function so(args){
  console.log(args);
}
`, {})
console.log(code);
