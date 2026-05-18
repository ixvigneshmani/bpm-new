/* ─── FEEL-lite parser (design-time syntax check) ─────────────────────
 * The runtime accepts a JS-subset (see api/src/engine/engine.service.ts
 *   `evalCondition`): identifiers + member access, numeric/string/bool
 *   literals, arithmetic + comparison + logical operators, parens,
 *   string quotes ("...", '...', `...`). No control flow, no `new`,
 *   no member-method calls beyond simple property reads.
 *
 * This parser runs in the designer, before save, to catch:
 *   • unclosed strings/parens
 *   • dangling or doubled operators
 *   • forbidden identifiers (sandbox-escape vectors)
 *   • characters outside the allow-set
 * Without it, broken expressions ship and explode at run time.
 *
 * Not a full FEEL implementation. The runtime is JS-shaped, so this is
 * a JS-expression subset checker. Keep the allowed surface in sync
 * with the engine's `ALLOWED_CONDITION_CHAR_RE` /
 * `FORBIDDEN_CONDITION_TOKENS_RE` constants.
 * ──────────────────────────────────────────────────────────────────── */

const MAX_LEN = 500;

/** Mirrors engine.service.ts. Anything outside this set is structural
 *  code (`;`, `{`, `=>`), not a value expression. */
const ALLOWED_CHAR_RE = /^[\w\s\d.,[\]()+\-*/%<>=!&|"'`?:]+$/;

/** Mirrors engine.service.ts. We reject these design-time so authors
 *  see a clear error instead of a "Condition contains forbidden
 *  identifier" surprise on first execution. */
const FORBIDDEN_RE =
  /\b(this|window|globalThis|process|global|require|import|export|eval|Function|constructor|prototype|__proto__|arguments|new|class|async|await|yield|throw|while|for|do|if|else|return|var|let|const|delete|void|typeof|instanceof|in)\b/;

export type FeelError = {
  /** Human-readable message; safe to render in a UI label. */
  message: string;
  /** Byte offset in the source string where the error was detected.
   *  -1 for whole-expression errors (length, charset). */
  offset: number;
};

export type FeelAst =
  | { kind: "literal"; value: number | string | boolean | null }
  | { kind: "ident"; name: string; path: string[] }
  | { kind: "unary"; op: "-" | "!" | "+"; arg: FeelAst }
  | {
      kind: "binary";
      op: string;
      left: FeelAst;
      right: FeelAst;
    }
  | { kind: "ternary"; test: FeelAst; consequent: FeelAst; alternate: FeelAst };

export type ParseResult =
  | { ok: true; ast: FeelAst; identifiers: string[] }
  | { ok: false; error: FeelError };

/** Tokens recognised by the lexer. */
type Tok =
  | { type: "num"; value: number; pos: number }
  | { type: "str"; value: string; pos: number }
  | { type: "ident"; value: string; pos: number }
  | { type: "op"; value: string; pos: number }
  | { type: "lparen" | "rparen" | "lbrack" | "rbrack" | "comma" | "question" | "colon"; pos: number };

const KEYWORDS = new Set(["true", "false", "null"]);

/* ─── Lexer ─────────────────────────────────────────────────────────── */

function tokenize(src: string): { ok: true; tokens: Tok[] } | { ok: false; error: FeelError } {
  const tokens: Tok[] = [];
  let i = 0;
  const len = src.length;
  while (i < len) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c >= "0" && c <= "9") {
      const start = i;
      while (i < len && /[0-9]/.test(src[i])) i++;
      if (src[i] === ".") {
        i++;
        if (!/[0-9]/.test(src[i] ?? "")) {
          return { ok: false, error: { message: "Number ends with a stray '.'", offset: start } };
        }
        while (i < len && /[0-9]/.test(src[i])) i++;
      }
      tokens.push({ type: "num", value: Number(src.slice(start, i)), pos: start });
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const start = i;
      i++;
      let value = "";
      while (i < len && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < len) {
          value += src[i + 1];
          i += 2;
          continue;
        }
        value += src[i];
        i++;
      }
      if (src[i] !== quote) {
        return { ok: false, error: { message: `Unclosed string starting at offset ${start}`, offset: start } };
      }
      i++;
      tokens.push({ type: "str", value, pos: start });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      // Identifier with optional .path / [bracket] reads.
      while (i < len && /[\w$]/.test(src[i])) i++;
      while (src[i] === "." || src[i] === "[") {
        if (src[i] === ".") {
          i++;
          if (!/[A-Za-z_$]/.test(src[i] ?? "")) {
            return { ok: false, error: { message: "Member access '.' must be followed by an identifier", offset: i } };
          }
          while (i < len && /[\w$]/.test(src[i])) i++;
        } else {
          // Bracket access — slurp until matching ']'. The contents
          // get tokenised by the next pass when the parser recurses,
          // not here (kept as part of the ident token for simplicity).
          let depth = 1;
          i++;
          while (i < len && depth > 0) {
            if (src[i] === "[") depth++;
            else if (src[i] === "]") depth--;
            if (depth > 0) i++;
          }
          if (depth !== 0) {
            return { ok: false, error: { message: "Unclosed '['", offset: start } };
          }
          i++;
        }
      }
      tokens.push({ type: "ident", value: src.slice(start, i), pos: start });
      continue;
    }
    if (c === "(") { tokens.push({ type: "lparen", pos: i++ }); continue; }
    if (c === ")") { tokens.push({ type: "rparen", pos: i++ }); continue; }
    if (c === "[") { tokens.push({ type: "lbrack", pos: i++ }); continue; }
    if (c === "]") { tokens.push({ type: "rbrack", pos: i++ }); continue; }
    if (c === ",") { tokens.push({ type: "comma", pos: i++ }); continue; }
    if (c === "?") { tokens.push({ type: "question", pos: i++ }); continue; }
    if (c === ":") { tokens.push({ type: "colon", pos: i++ }); continue; }

    // Operators — match longest first.
    const two = src.slice(i, i + 2);
    const three = src.slice(i, i + 3);
    if (three === "===" || three === "!==") {
      tokens.push({ type: "op", value: three, pos: i });
      i += 3;
      continue;
    }
    if (
      two === "==" ||
      two === "!=" ||
      two === "<=" ||
      two === ">=" ||
      two === "&&" ||
      two === "||"
    ) {
      tokens.push({ type: "op", value: two, pos: i });
      i += 2;
      continue;
    }
    if ("+-*/%<>!".includes(c)) {
      tokens.push({ type: "op", value: c, pos: i });
      i++;
      continue;
    }
    return {
      ok: false,
      error: { message: `Unexpected character '${c}'`, offset: i },
    };
  }
  return { ok: true, tokens };
}

/* ─── Parser ────────────────────────────────────────────────────────── */

const PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3, "!=": 3, "===": 3, "!==": 3,
  "<": 4, "<=": 4, ">": 4, ">=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
};

class Parser {
  i = 0;
  constructor(public toks: Tok[]) {}

  peek(): Tok | undefined { return this.toks[this.i]; }
  eat(): Tok { return this.toks[this.i++]; }

  parseExpression(): FeelAst {
    const t = this.parseTernary();
    if (this.i < this.toks.length) {
      const next = this.toks[this.i];
      throw new SyntaxError(`Unexpected token '${tokText(next)}' at offset ${next.pos}`);
    }
    return t;
  }

  parseTernary(): FeelAst {
    const test = this.parseBinary(0);
    if (this.peek()?.type === "question") {
      this.eat();
      const consequent = this.parseTernary();
      const colon = this.peek();
      if (colon?.type !== "colon") {
        throw new SyntaxError("Ternary '?' without matching ':'");
      }
      this.eat();
      const alternate = this.parseTernary();
      return { kind: "ternary", test, consequent, alternate };
    }
    return test;
  }

  parseBinary(minPrec: number): FeelAst {
    let left = this.parseUnary();
    while (true) {
      const tok = this.peek();
      if (!tok || tok.type !== "op") break;
      const prec = PRECEDENCE[tok.value];
      if (prec === undefined || prec < minPrec) break;
      this.eat();
      const right = this.parseBinary(prec + 1);
      left = { kind: "binary", op: tok.value, left, right };
    }
    return left;
  }

  parseUnary(): FeelAst {
    const tok = this.peek();
    if (tok?.type === "op" && (tok.value === "-" || tok.value === "+" || tok.value === "!")) {
      this.eat();
      return { kind: "unary", op: tok.value as "-" | "+" | "!", arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary(): FeelAst {
    const tok = this.eat();
    if (!tok) throw new SyntaxError("Unexpected end of expression");
    if (tok.type === "num") return { kind: "literal", value: tok.value };
    if (tok.type === "str") return { kind: "literal", value: tok.value };
    if (tok.type === "ident") {
      if (tok.value === "true") return { kind: "literal", value: true };
      if (tok.value === "false") return { kind: "literal", value: false };
      if (tok.value === "null") return { kind: "literal", value: null };
      const parts = tok.value.split(".");
      return { kind: "ident", name: tok.value, path: parts };
    }
    if (tok.type === "lparen") {
      const inner = this.parseTernary();
      const close = this.eat();
      if (close?.type !== "rparen") {
        throw new SyntaxError(`Expected ')' at offset ${tok.pos}`);
      }
      return inner;
    }
    throw new SyntaxError(`Unexpected token '${tokText(tok)}' at offset ${tok.pos}`);
  }
}

function tokText(t: Tok): string {
  switch (t.type) {
    case "num": return String(t.value);
    case "str": return `"${t.value}"`;
    case "ident":
    case "op": return t.value;
    case "lparen": return "(";
    case "rparen": return ")";
    case "lbrack": return "[";
    case "rbrack": return "]";
    case "comma": return ",";
    case "question": return "?";
    case "colon": return ":";
  }
}

/** Collect all root-identifier names used in the expression (e.g. for
 *  `customer.id + order.total` returns ["customer", "order"]). Used by
 *  the dry-run helper to know which variables the expression needs. */
function collectIdentifiers(ast: FeelAst, into: Set<string>): void {
  switch (ast.kind) {
    case "literal": return;
    case "ident": into.add(ast.path[0]); return;
    case "unary": collectIdentifiers(ast.arg, into); return;
    case "binary":
      collectIdentifiers(ast.left, into);
      collectIdentifiers(ast.right, into);
      return;
    case "ternary":
      collectIdentifiers(ast.test, into);
      collectIdentifiers(ast.consequent, into);
      collectIdentifiers(ast.alternate, into);
      return;
  }
}

/** Parse a JS-subset condition expression. Empty / whitespace-only
 *  input returns `{ ok: false }` with message "empty expression" so
 *  callers can distinguish from a syntactically-valid expression. */
export function parseFeelCondition(src: string): ParseResult {
  if (typeof src !== "string") {
    return { ok: false, error: { message: "Expression is not a string", offset: -1 } };
  }
  const trimmed = src.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: { message: "Expression is empty", offset: -1 } };
  }
  if (src.length > MAX_LEN) {
    return {
      ok: false,
      error: { message: `Expression longer than ${MAX_LEN} characters`, offset: -1 },
    };
  }
  if (!ALLOWED_CHAR_RE.test(src)) {
    const bad = src.match(/[^\w\s\d.,[\]()+\-*/%<>=!&|"'`?:]/);
    return {
      ok: false,
      error: {
        message: `Disallowed character '${bad?.[0] ?? "?"}'`,
        offset: bad ? src.indexOf(bad[0]) : -1,
      },
    };
  }
  const forbidden = FORBIDDEN_RE.exec(src);
  if (forbidden) {
    return {
      ok: false,
      error: {
        message: `Forbidden identifier '${forbidden[0]}'`,
        offset: forbidden.index,
      },
    };
  }
  const lex = tokenize(src);
  if (!lex.ok) return { ok: false, error: lex.error };
  const parser = new Parser(lex.tokens);
  try {
    const ast = parser.parseExpression();
    const ids = new Set<string>();
    collectIdentifiers(ast, ids);
    // Root identifiers that are keywords aren't free variables.
    for (const kw of KEYWORDS) ids.delete(kw);
    return { ok: true, ast, identifiers: [...ids] };
  } catch (e) {
    return {
      ok: false,
      error: {
        message: (e as Error).message,
        offset: -1,
      },
    };
  }
}

/** Strict `${path.to.var}` form used for assignment expressions and
 *  template mappings. Anything else is a syntax error at this surface,
 *  even if it would be a valid condition expression — the engine's
 *  `resolveVariableExpression` only resolves this exact shape. */
export function parseVariableRef(src: string): ParseResult {
  if (typeof src !== "string") {
    return { ok: false, error: { message: "Expression is not a string", offset: -1 } };
  }
  const m = /^\s*\$\{\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\}\s*$/.exec(src);
  if (!m) {
    return {
      ok: false,
      error: {
        message: "Expected '${variable.path}' — use FEEL ${...} syntax for assignment expressions.",
        offset: -1,
      },
    };
  }
  const path = m[1].split(".");
  return {
    ok: true,
    ast: { kind: "ident", name: m[1], path },
    identifiers: [path[0]],
  };
}

/** Best-effort evaluator over a literal AST + scope. Used by the
 *  designer's "evaluates to:" preview. Returns `undefined` on any
 *  undefined identifier so the UI can render "—" rather than a noisy
 *  exception. Throws on type errors (e.g. comparing object to number)
 *  so a true mistake still surfaces. */
export function evaluate(ast: FeelAst, scope: Record<string, unknown>): unknown {
  switch (ast.kind) {
    case "literal": return ast.value;
    case "ident": {
      let cur: unknown = scope;
      for (const seg of ast.path) {
        if (cur == null || typeof cur !== "object") return undefined;
        cur = (cur as Record<string, unknown>)[seg];
      }
      return cur;
    }
    case "unary": {
      const v = evaluate(ast.arg, scope) as number | boolean;
      if (ast.op === "-") return -(v as number);
      if (ast.op === "+") return +(v as number);
      return !v;
    }
    case "binary": {
      const l = evaluate(ast.left, scope);
      const r = evaluate(ast.right, scope);
      switch (ast.op) {
        case "+": return (l as number) + (r as number);
        case "-": return (l as number) - (r as number);
        case "*": return (l as number) * (r as number);
        case "/": return (l as number) / (r as number);
        case "%": return (l as number) % (r as number);
        case "<": return (l as number) < (r as number);
        case "<=": return (l as number) <= (r as number);
        case ">": return (l as number) > (r as number);
        case ">=": return (l as number) >= (r as number);
        case "==": return l == r;
        case "!=": return l != r;
        case "===": return l === r;
        case "!==": return l !== r;
        case "&&": return l && r;
        case "||": return l || r;
        default: throw new TypeError(`Unsupported operator '${ast.op}'`);
      }
    }
    case "ternary":
      return evaluate(ast.test, scope) ? evaluate(ast.consequent, scope) : evaluate(ast.alternate, scope);
  }
}
