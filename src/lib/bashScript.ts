import { resolvePath, getNode, type FsState } from "./linuxFs";
import type { BashOptions, BashResult } from "./bashCmd";

export type ExecFn = (state: FsState, cwd: string[], line: string, opts: BashOptions) => BashResult;

export interface ScriptResume {
  line: number;
  variable: string;
  value: string;
}

export interface ScriptPending {
  variable: string;
  resumeLine: number;
  source: string;
}

interface Block {
  kind: "simple" | "if" | "for" | "while" | "function";
  text?: string;
  idx?: number;
  branches?: { cond: string | null; body: Block[] }[];
  varName?: string;
  words?: string;
  name?: string;
  body?: Block[];
}

interface Ctx {
  state: FsState;
  cwd: string[];
  opts: BashOptions;
  exec: ExecFn;
  env: Record<string, string>;
  out: string[];
  errFrom: number;
  hasError: boolean;
  exited: boolean;
  status: number;
  wait: { variable: string; prompt: string } | null;
  resumeLine: number;
}

function stripInlineComment(line: string): string {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseEntries(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((l) => stripInlineComment(l).trim())
    .filter((l) => l.length > 0);
}

function parseBlocks(lines: string[], start: number, terminators: string[]): { blocks: Block[]; next: number; terminator: string | null } {
  const blocks: Block[] = [];
  let i = start;
  while (i < lines.length) {
    const raw = lines[i];
    const lowered = raw.toLowerCase();
    if (terminators.includes(lowered)) {
      return { blocks, next: i + 1, terminator: lowered };
    }
    if (terminators.some((t) => lowered.startsWith(`${t} `) || lowered === t)) {
      const matched = terminators.find((t) => lowered.startsWith(`${t} `) || lowered === t) ?? lowered;
      return { blocks, next: i, terminator: matched };
    }
    const block = parseOne(lines, i);
    if (block) {
      blocks.push(block.block);
      i = block.next;
      continue;
    }
    blocks.push({ kind: "simple", text: raw, idx: i });
    i++;
  }
  return { blocks, next: i, terminator: terminators.length > 0 ? terminators[0] : null };
}

function parseOne(lines: string[], i: number): { block: Block; next: number } | null {
  const raw = lines[i];
  const lowered = raw.toLowerCase();

  if (lowered.startsWith("if ")) {
    const inlineIf = raw.match(/^if\s+(.+);\s*then\s+(.+);\s*fi$/i);
    if (inlineIf) {
      return { block: { kind: "if", branches: [{ cond: inlineIf[1].trim(), body: [{ kind: "simple", text: inlineIf[2].trim(), idx: i }] }] }, next: i + 1 };
    }
    const cond = extractIfCond(raw);
    const branches: { cond: string | null; body: Block[] }[] = [];
    let j = i + 1;
    let pendingCond = cond;
    for (;;) {
      const res = parseBlocks(lines, j, ["elif", "else", "fi"]);
      branches.push({ cond: pendingCond, body: res.blocks });
      j = res.next;
      if (res.terminator === "fi" || res.terminator === null || res.next >= lines.length) break;
      if (res.terminator === "elif" && res.next < lines.length) {
        pendingCond = extractIfCond(lines[res.next]);
        j = res.next + 1;
        continue;
      }
      if (res.terminator === "else") {
        const elseRes = parseBlocks(lines, j, ["fi"]);
        branches.push({ cond: null, body: elseRes.blocks });
        j = elseRes.next;
        break;
      }
      break;
    }
    return { block: { kind: "if", branches }, next: j };
  }

  const forMatch = raw.match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+);\s*do$/i);
  if (forMatch) {
    const res = parseBlocks(lines, i + 1, ["done"]);
    return { block: { kind: "for", varName: forMatch[1], words: forMatch[2], body: res.blocks }, next: res.next };
  }

  if (lowered.startsWith("while ") && lowered.endsWith("; do")) {
    const cond = raw.slice(6, raw.length - 4).trim();
    const res = parseBlocks(lines, i + 1, ["done"]);
    return { block: { kind: "while", text: cond, body: res.blocks }, next: res.next };
  }

  const fnMatch = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{$/);
  if (fnMatch) {
    const res = parseBlocks(lines, i + 1, ["}"]);
    return { block: { kind: "function", name: fnMatch[1], body: res.blocks }, next: res.next };
  }

  return null;
}

function extractIfCond(line: string): string {
  return line
    .replace(/^(if|elif)\s+/i, "")
    .replace(/;\s*then$/i, "")
    .trim();
}

function nodeAt(state: FsState, cwd: string[], raw: string): ReturnType<typeof getNode> {
  return getNode(state, resolvePath(cwd, raw).value);
}

function testEval(tokens: string[], state: FsState, cwd: string[], env: Record<string, string>): boolean {
  if (tokens.length === 0) return false;
  if (tokens[0] === "!") return !testEval(tokens.slice(1), state, cwd, env);
  if (tokens.length === 1) return tokens[0].length > 0;
  if (tokens.length === 2) {
    const [op, a] = tokens;
    if (op === "-n") return a.length > 0;
    if (op === "-z") return a.length === 0;
    if (op === "-f") return nodeAt(state, cwd, a)?.kind === "file";
    if (op === "-d") return nodeAt(state, cwd, a)?.kind === "dir";
    if (op === "-e") return nodeAt(state, cwd, a) !== null;
    if (op === "-r" || op === "-w" || op === "-x") {
      const node = nodeAt(state, cwd, a);
      if (!node) return false;
      const perms = node.perms ?? "";
      const body = perms.slice(1);
      const isOwner = !node.owner || node.owner === (env.USER ?? "alumno");
      const set = isOwner ? body.slice(0, 3) : body.slice(3, 9);
      return set.includes(op === "-r" ? "r" : op === "-w" ? "w" : "x");
    }
    return false;
  }
  const [a, op, b, ...extra] = tokens;
  if (extra.length > 0) return false;
  switch (op) {
    case "-f": return nodeAt(state, cwd, a)?.kind === "file";
    case "-d": return nodeAt(state, cwd, a)?.kind === "dir";
    case "-e": return nodeAt(state, cwd, a) !== null;
    case "-r": case "-w": case "-x": {
      const node = nodeAt(state, cwd, a);
      if (!node) return false;
      const perms = node.perms ?? "";
      const body = perms.slice(1);
      const isOwner = !node.owner || node.owner === (env.USER ?? "alumno");
      const set = isOwner ? body.slice(0, 3) : body.slice(3, 9);
      return set.includes(op === "-r" ? "r" : op === "-w" ? "w" : "x");
    }
    case "=": return a === b;
    case "==": return a === b;
    case "!=": return a !== b;
    case "-eq": return Number(a) === Number(b);
    case "-ne": return Number(a) !== Number(b);
    case "-gt": return Number(a) > Number(b);
    case "-ge": return Number(a) >= Number(b);
    case "-lt": return Number(a) < Number(b);
    case "-le": return Number(a) <= Number(b);
    default: return false;
  }
}

export function scriptTestEval(tokens: string[], state: FsState, cwd: string[], env: Record<string, string>): boolean {
  return testEval(tokens, state, cwd, env);
}

export function evalArithmetic(expr: string, env: Record<string, string>): number | null {
  const clean = expr.replace(/\s+/g, "");
  if (!/^[\d+\-*/%()A-Za-z_]*$/.test(clean)) return null;
  let pos = 0;
  const peek = (): string => clean[pos] ?? "";
  const parseExpr = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;
    for (;;) {
      const c = peek();
      if (c === "+" || c === "-") {
        pos++;
        const right = parseTerm();
        if (right === null) return null;
        left = c === "+" ? left + right : left - right;
      } else break;
    }
    return left;
  };
  const parseTerm = (): number | null => {
    let left = parseFactor();
    if (left === null) return null;
    for (;;) {
      const c = peek();
      if (c === "*" || c === "/" || c === "%") {
        pos++;
        const right = parseFactor();
        if (right === null) return null;
        if (c === "*") left = left * right;
        else if (c === "/") left = right === 0 ? 0 : Math.trunc(left / right);
        else left = right === 0 ? 0 : left % right;
      } else break;
    }
    return left;
  };
  const parseFactor = (): number | null => {
    const c = peek();
    if (c === "(") {
      pos++;
      const v = parseExpr();
      if (v === null || peek() !== ")") return null;
      pos++;
      return v;
    }
    if (c === "-") {
      pos++;
      const v = parseFactor();
      return v === null ? null : -v;
    }
    if (c === "+") {
      pos++;
      return parseFactor();
    }
    if (/\d/.test(c)) {
      let num = "";
      while (/\d/.test(peek())) {
        num += peek();
        pos++;
      }
      return Number(num);
    }
    if (/[A-Za-z_]/.test(c)) {
      let name = "";
      while (/[A-Za-z0-9_]/.test(peek())) {
        name += peek();
        pos++;
      }
      const v = Number(env[name] ?? 0);
      return Number.isFinite(v) ? v : 0;
    }
    return null;
  };
  const result = parseExpr();
  if (result === null || pos !== clean.length) return null;
  return result;
}

function expandArithmetic(text: string, env: Record<string, string>): string {
  return text.replace(/\$\(\(([\s\S]*?)\)\)/g, (m, e: string) => {
    const v = evalArithmetic(expandScriptVars(e, env), env);
    return v === null ? m : String(v);
  });
}

function expandScriptVars(text: string, env: Record<string, string>): string {
  return expandArithmetic(text, env)
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, n: string) => env[n] ?? "")
    .replace(/\$\?/g, () => env["?"] ?? "0")
    .replace(/\$(\d)/g, (_m, n: string) => env[`__A${n}`] ?? "")
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, n: string) => env[n] ?? "");
}

function expandForWord(state: FsState, cwd: string[], word: string): string[] {
  if (!/[*?[]/.test(word)) return [word];
  const segs = word.split("/");
  const pattern = segs.pop() ?? "";
  let dirPath = cwd;
  if (segs.length > 0) dirPath = resolvePath(cwd, segs.join("/")).value;
  const node = getNode(state, dirPath);
  if (!node || node.kind !== "dir") return [word];
  const matches = Object.values(node.children ?? {})
    .filter((c) => !(pattern[0] !== "." && c.name.startsWith(".")))
    .filter((c) => pattern.length > 0 ? matchWord(c.name, pattern) : true)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => (segs.length > 0 ? `${segs.join("/")}/${c.name}` : c.name));
  return matches.length > 0 ? matches : [word];
}

function matchWord(name: string, pattern: string): boolean {
  let re = "";
  for (const c of pattern) {
    if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else re += c.replace(/[.+^$(){}|[\]\\]/g, "\\$&");
  }
  try {
    return new RegExp(`^${re}$`).test(name);
  } catch {
    return false;
  }
}

function conditionTrue(ctx: Ctx, condRaw: string): boolean {
  const expanded = expandScriptVars(condRaw, ctx.env).trim();
  if (expanded.startsWith("[") && expanded.endsWith("]")) {
    return testEval(splitWords(expanded.slice(1, -1).trim()), ctx.state, ctx.cwd, ctx.env);
  }
  if (expanded.startsWith("test ")) {
    return testEval(splitWords(expanded.slice(5)), ctx.state, ctx.cwd, ctx.env);
  }
  const res = ctx.exec(ctx.state, ctx.cwd, expanded, { ...ctx.opts, env: ctx.env });
  if (res.env) ctx.env = res.env;
  ctx.state = res.state;
  ctx.cwd = res.cwd;
  return !res.error;
}

function splitWords(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = "";
  for (const c of text.trim()) {
    if (quote) {
      if (c === quote) quote = "";
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur.length > 0) out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function runSimple(ctx: Ctx, line: string, idx: number): void {
  const expanded = expandScriptVars(line, ctx.env).trim();
  if (expanded.length === 0) return;
  if (/^set\s+/.test(expanded)) {
    if (expanded.includes("-e")) ctx.env["__SET_E"] = "1";
    if (expanded.includes("-x")) ctx.env["__SET_X"] = "1";
    ctx.env["?"] = "0";
    return;
  }
  const assignMatch = expanded.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (assignMatch && !/\s/.test(assignMatch[1])) {
    ctx.env[assignMatch[1]] = assignMatch[2].replace(/^["']|["']$/g, "");
    ctx.env["?"] = "0";
    return;
  }
  if (expanded === "exit" || /^exit\s/.test(expanded)) {
    const codeStr = expanded.split(/\s+/)[1];
    const code = Number(codeStr);
    ctx.exited = true;
    ctx.status = codeStr !== undefined && Number.isFinite(code) ? code : ctx.status;
    return;
  }
  const readMatch = expanded.match(/^read\s+(?:-p\s+(?:"([^"]*)"|'([^']*)')\s+)?([A-Za-z_][A-Za-z0-9_]*)$/);
  if (readMatch) {
    ctx.wait = { variable: readMatch[3], prompt: readMatch[1] ?? readMatch[2] ?? "" };
    ctx.resumeLine = idx + 1;
    return;
  }
  if (ctx.env["__SET_X"] === "1") ctx.out.push(`+ ${expanded}`);
  const args = splitWords(expanded);
  const fnKey = `FN.${args[0]}`;
  if (ctx.env[fnKey]) {
    const fnBody = JSON.parse(ctx.env[fnKey]) as Block[];
    for (let i = 1; i < Math.min(args.length, 10); i++) {
      ctx.env[`__A${i}`] = args[i];
    }
    runBlocks(ctx, fnBody);
    for (let i = 1; i < 10; i++) delete ctx.env[`__A${i}`];
    return;
  }
  const res = ctx.exec(ctx.state, ctx.cwd, expanded, { ...ctx.opts, env: ctx.env });
  if (res.env) ctx.env = res.env;
  ctx.state = res.state;
  ctx.cwd = res.cwd;
  if (res.lines.length > 0) ctx.out.push(...res.lines);
  if (res.error) {
    if (ctx.errFrom === -1) ctx.errFrom = Math.max(0, ctx.out.length - res.lines.length);
    ctx.hasError = true;
  }
  ctx.env["?"] = res.error ? "1" : "0";
  if (res.exit) ctx.exited = true;
}

function runBlocks(ctx: Ctx, blocks: Block[]): void {
  for (const block of blocks) {
    if (ctx.exited || ctx.wait) return;
    switch (block.kind) {
      case "simple":
        runSimple(ctx, block.text ?? "", block.idx ?? -1);
        break;
      case "if": {
        for (const branch of block.branches ?? []) {
          if (branch.cond === null || conditionTrue(ctx, branch.cond)) {
            runBlocks(ctx, branch.body);
            break;
          }
        }
        break;
      }
      case "for": {
        const wordsText = expandScriptVars(block.words ?? "", ctx.env);
        const words = splitWords(wordsText).flatMap((w) => expandForWord(ctx.state, ctx.cwd, w));
        for (const word of words) {
          if (ctx.exited || ctx.wait) return;
          if (block.varName) ctx.env[block.varName] = word;
          runBlocks(ctx, block.body ?? []);
        }
        break;
      }
      case "while": {
        for (let guard = 0; guard < 500; guard++) {
          if (ctx.exited || ctx.wait) return;
          if (!conditionTrue(ctx, block.text ?? "true")) break;
          runBlocks(ctx, block.body ?? []);
        }
        break;
      }
      case "function": {
        if (block.name) ctx.env[`FN.${block.name}`] = JSON.stringify(block.body ?? []);
        ctx.env["?"] = "0";
        break;
      }
    }
    if (ctx.env["__SET_E"] === "1" && ctx.env["?"] === "1" && !ctx.exited) {
      ctx.exited = true;
      ctx.out.push(ctx.opts.isEs ? "script: error, salida por set -e" : "script: error, exiting due to set -e");
    }
  }
}

export interface ScriptOutcome {
  lines: string[];
  state: FsState;
  cwd: string[];
  status: number;
  error: boolean;
  errFrom: number;
  env: Record<string, string>;
  pending: ScriptPending | null;
  exited: boolean;
}

export function runScript(
  state: FsState,
  cwd: string[],
  source: string,
  opts: BashOptions,
  exec: ExecFn,
  resume?: ScriptResume,
): ScriptOutcome {
  const entries = parseEntries(source);
  const ctx: Ctx = {
    state,
    cwd,
    opts,
    exec,
    env: { ...(opts.env ?? {}) },
    status: 0,
    out: [],
    errFrom: -1,
    hasError: false,
    exited: false,
    wait: null,
    resumeLine: -1,
  };
  let start = 0;
  if (resume && entries.length > 0) {
    start = Math.max(0, Math.min(resume.line, entries.length));
    ctx.env[resume.variable] = resume.value;
    ctx.env["?"] = "0";
  }
  const { blocks } = parseBlocks(entries, start, []);
  runBlocks(ctx, blocks);
  if (ctx.wait) {
    return {
      lines: ctx.out,
      state: ctx.state,
      cwd: ctx.cwd,
      status: 0,
      error: false,
      errFrom: ctx.errFrom,
      env: ctx.env,
      pending: {
        variable: ctx.wait.variable,
        resumeLine: ctx.resumeLine >= 0 ? ctx.resumeLine : entries.length,
        source,
      },
      exited: false,
    };
  }
  const status = ctx.env["?"] === "1" ? 1 : ctx.status;
  return {
    lines: ctx.out,
    state: ctx.state,
    cwd: ctx.cwd,
    status,
    error: status !== 0 || ctx.hasError,
    errFrom: ctx.errFrom,
    env: ctx.env,
    pending: null,
    exited: ctx.exited,
  };
}
