export type FsKind = "dir" | "file";

export interface FsNode {
  name: string;
  kind: FsKind;
  children?: Record<string, FsNode>;
  content?: string;
  perms?: string;
  link?: string[];
}

export interface FsState {
  root: FsNode;
}

export type FsError =
  | "invalidPath"
  | "notFound"
  | "duplicate"
  | "notADir"
  | "notAFile"
  | "isDir"
  | "dirNotEmpty"
  | "rootOp"
  | "destExists"
  | "emptyArg"
  | "denied";

export type FsResult<T> = { ok: true; value: T } | { ok: false; error: FsError };

export const USER_HOME = ["home", "alumno"];

export const DEFAULT_PERMS = { dir: "drwxr-xr-x", file: "-rw-r--r--" };

function cloneNode(node: FsNode): FsNode {
  const out: FsNode = { name: node.name, kind: node.kind };
  if (node.perms) out.perms = node.perms;
  if (node.link) out.link = [...node.link];
  if (node.children) {
    out.children = {};
    for (const key of Object.keys(node.children)) {
      out.children[key] = cloneNode(node.children[key]);
    }
  }
  if (node.content !== undefined) out.content = node.content;
  return out;
}

export function cloneState(state: FsState): FsState {
  return { root: cloneNode(state.root) };
}

function usrBinChildren(): Record<string, FsNode> {
  const names = ["apt", "bash", "cat", "chmod", "cp", "curl", "date", "df", "du", "env", "find", "free", "grep", "head", "hostname", "ip", "jq", "less", "ln", "ls", "man", "mkdir", "mv", "nano", "ping", "ps", "pwd", "rm", "scp", "sort", "ssh", "stat", "tail", "tar", "touch", "tree", "uname", "uniq", "vim", "wc", "wget", "which", "who", "whoami"];
  const out: Record<string, FsNode> = {};
  for (const name of names) out[name] = { name, kind: "file", content: "binario simulado", perms: "-rwxr-xr-x" };
  return out;
}

export function createInitialFs(): FsState {
  const root: FsNode = {
    name: "/",
    kind: "dir",
    perms: "drwxr-xr-x",
    children: {
      etc: {
        name: "etc",
        kind: "dir",
        children: {
          hostname: { name: "hostname", kind: "file", content: "pc-aula\n" },
          hosts: {
            name: "hosts",
            kind: "file",
            content: "127.0.0.1    localhost\n192.168.1.42 pc-aula\n",
          },
          "os-release": {
            name: "os-release",
            kind: "file",
            content:
              'PRETTY_NAME="Ubuntu 24.04 LTS (simulado)"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04 LTS (Noble Numbat)"\nID=ubuntu\nID_LIKE=debian\nHOME_URL="https://www.ubuntu.com/"\n',
          },
        },
      },
      usr: {
        name: "usr",
        kind: "dir",
        children: {
          bin: {
            name: "bin",
            kind: "dir",
            children: usrBinChildren(),
          },
        },
      },
      home: {
        name: "home",
        kind: "dir",
        children: {
          alumno: {
            name: "alumno",
            kind: "dir",
            children: {
              Documentos: {
                name: "Documentos",
                kind: "dir",
                children: {
                  "apuntes.txt": {
                    name: "apuntes.txt",
                    kind: "file",
                    content: "Comandos basicos de bash:\n  ls, cd, mkdir, cat, echo, rm, cp, grep\nPractica todos los dias.",
                  },
                  "tareas.txt": {
                    name: "tareas.txt",
                    kind: "file",
                    content: "1. Navegar con cd y ls\n2. Crear carpetas con mkdir\n3. Leer archivos con cat",
                  },
                  "notas.md": {
                    name: "notas.md",
                    kind: "file",
                    content: "# Notas\n\n- ls -la lista con detalles\n- grep busca texto\n- | encadena comandos\n",
                  },
                },
              },
              Descargas: { name: "Descargas", kind: "dir", children: {} },
              Proyectos: { name: "Proyectos", kind: "dir", children: {} },
              ".bashrc": {
                name: ".bashrc",
                kind: "file",
                content: "# entorno simulado\nexport PS1='\\u@\\h:\\w$ '\n",
              },
            },
          },
        },
      },
      tmp: { name: "tmp", kind: "dir", children: {} },
      var: {
        name: "var",
        kind: "dir",
        children: {
          log: {
            name: "log",
            kind: "dir",
            children: {
              "syslog.log": {
                name: "syslog.log",
                kind: "file",
                content: "sep 11 08:00:01 pc-aula systemd: arranque del sistema\nsep 11 08:00:02 pc-aula sshd: servidor ssh iniciado\nsep 11 09:12:45 pc-aula kernel: paquete recibido en eth0\n",
              },
            },
          },
        },
      },
    },
  };
  return { root };
}

export function resolvePath(cwd: string[], input: string): { ok: true; value: string[] } {
  const trimmed = input.trim();
  const home = USER_HOME;
  let rawParts: string[];
  let combined: string[];
  if (trimmed === "~") {
    return { ok: true, value: [...home] };
  }
  if (trimmed.startsWith("~/")) {
    rawParts = trimmed.slice(2).split(/\/+/);
    combined = [...home, ...rawParts];
  } else {
    const absolute = trimmed.startsWith("/");
    rawParts = trimmed.split(/\/+/);
    combined = absolute ? rawParts : [...cwd, ...rawParts];
  }
  const out: string[] = [];
  for (const part of combined) {
    if (part.length === 0 || part === ".") continue;
    if (part === "..") {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(part);
  }
  return { ok: true, value: out };
}

export function pathToString(segments: string[]): string {
  if (segments.length === 0) return "/";
  return `/${segments.join("/")}`;
}

export function displayPath(cwd: string[]): string {
  const full = pathToString(cwd);
  const home = `/${USER_HOME.join("/")}`;
  if (full === home) return "~";
  if (full.startsWith(`${home}/`)) return `~${full.slice(home.length)}`;
  return full;
}

function findNodeRaw(node: FsNode, segments: string[]): FsNode | null {
  let current: FsNode = node;
  for (const seg of segments) {
    if (current.kind !== "dir" || !current.children) return null;
    const child = current.children[seg];
    if (!child) return null;
    current = child;
  }
  return current;
}

export function getNodeRaw(state: FsState, path: string[]): FsNode | null {
  return findNodeRaw(state.root, path);
}

export function getNode(state: FsState, path: string[]): FsNode | null {
  let current: FsNode | null = state.root;
  let hops = 0;
  for (const seg of path) {
    if (!current || current.kind !== "dir" || !current.children) return null;
    let child: FsNode | null = current.children[seg] ?? null;
    while (child?.link && hops < 20) {
      child = findNodeRaw(state.root, child.link);
      hops++;
    }
    current = child;
  }
  while (current?.link && hops < 20) {
    current = findNodeRaw(state.root, current.link);
    hops++;
  }
  return current;
}

export function pathExists(state: FsState, path: string[]): boolean {
  return getNode(state, path) !== null;
}

export function dirExists(state: FsState, path: string[]): boolean {
  const node = getNode(state, path);
  return node !== null && node.kind === "dir";
}

export function fileExists(state: FsState, path: string[]): boolean {
  const node = getNode(state, path);
  return node !== null && node.kind === "file";
}

export function dirContains(state: FsState, dirPath: string[], childName: string, kind?: FsKind): boolean {
  const node = getNode(state, dirPath);
  if (!node || node.kind !== "dir" || !node.children) return false;
  const child = node.children[childName];
  if (!child) return false;
  return kind ? child.kind === kind : true;
}

export function listDir(state: FsState, path: string[]): FsResult<{ name: string; kind: FsKind; perms?: string; link?: string }[]> {
  const node = getNode(state, path);
  if (!node) return { ok: false, error: "notFound" };
  if (node.kind !== "dir") return { ok: false, error: "notADir" };
  const entries = Object.values(node.children ?? {}).map((n) => ({ name: n.name, kind: n.kind, perms: n.perms, link: n.link ? pathToString(n.link) : undefined }));
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
  return { ok: true, value: entries };
}

function insertChild(node: FsNode, segments: string[], build: () => FsNode): FsError | null {
  if (segments.length === 0) return "rootOp";
  let current = node;
  for (let i = 0; i < segments.length - 1; i++) {
    const child = current.children?.[segments[i]];
    if (!child) return "notFound";
    if (child.kind !== "dir") return "notADir";
    current = child;
  }
  const leafName = segments[segments.length - 1];
  if (!leafName) return "invalidPath";
  if (current.children?.[leafName]) return "duplicate";
  current.children = current.children ?? {};
  current.children[leafName] = build();
  current.children[leafName].name = leafName;
  return null;
}

export function mkdir(state: FsState, path: string[]): FsResult<FsState> {
  if (path.length === 0) return { ok: false, error: "rootOp" };
  const next = cloneState(state);
  const err = insertChild(next.root, path, () => ({ name: path[path.length - 1], kind: "dir", children: {} }));
  if (err) return { ok: false, error: err };
  return { ok: true, value: next };
}

export function mkdirP(state: FsState, path: string[]): FsResult<FsState> {
  if (path.length === 0) return { ok: false, error: "rootOp" };
  let st = state;
  for (let i = 1; i <= path.length; i++) {
    const partial = path.slice(0, i);
    const node = getNode(st, partial);
    if (node) {
      if (node.kind !== "dir") return { ok: false, error: "notADir" };
      continue;
    }
    const res = mkdir(st, partial);
    if (!res.ok) return res;
    st = res.value;
  }
  return { ok: true, value: st };
}

export function writeFile(state: FsState, path: string[], content: string, append = false): FsResult<FsState> {
  if (path.length === 0) return { ok: false, error: "rootOp" };
  const parent = getNode(state, path.slice(0, -1));
  if (!parent || parent.kind !== "dir") return { ok: false, error: "notFound" };
  const leafName = path[path.length - 1];
  if (!leafName) return { ok: false, error: "invalidPath" };
  const existing = parent.children?.[leafName];
  if (existing && existing.kind === "dir") return { ok: false, error: "isDir" };
  const next = cloneState(state);
  const parentNode = getNode(next, path.slice(0, -1))!;
  parentNode.children = parentNode.children ?? {};
  const prevContent = existing?.content ?? "";
  parentNode.children[leafName] = {
    name: leafName,
    kind: "file",
    content: append && existing ? prevContent + content : content,
  };
  return { ok: true, value: next };
}

export function readFile(state: FsState, path: string[]): FsResult<string> {
  const node = getNode(state, path);
  if (!node) return { ok: false, error: "notFound" };
  if (node.kind !== "file") return { ok: false, error: "notAFile" };
  return { ok: true, value: node.content ?? "" };
}

export function chmod(state: FsState, path: string[], perms: string): FsResult<FsState> {
  const node = getNode(state, path);
  if (!node) return { ok: false, error: "notFound" };
  const next = cloneState(state);
  const target = getNode(next, path)!;
  target.perms = target.kind === "dir" ? `d${perms}` : `-${perms}`;
  return { ok: true, value: next };
}

export function createLink(state: FsState, linkPath: string[], target: string[]): FsResult<FsState> {
  if (linkPath.length === 0) return { ok: false, error: "rootOp" };
  const next = cloneState(state);
  const err = insertChild(next.root, linkPath, () => ({ name: linkPath[linkPath.length - 1], kind: "file", link: [...target], perms: "lrwxrwxrwx" }));
  if (err) return { ok: false, error: err };
  return { ok: true, value: next };
}

export function deletePath(state: FsState, path: string[], recursive = false): FsResult<FsState> {
  if (path.length === 0) return { ok: false, error: "rootOp" };
  const target = getNodeRaw(state, path);
  if (!target) return { ok: false, error: "notFound" };
  if (target.kind === "dir" && !recursive && Object.keys(target.children ?? {}).length > 0) {
    return { ok: false, error: "dirNotEmpty" };
  }
  const next = cloneState(state);
  const parent = getNode(next, path.slice(0, -1));
  if (!parent || parent.kind !== "dir" || !parent.children) return { ok: false, error: "notFound" };
  delete parent.children[path[path.length - 1]];
  return { ok: true, value: next };
}

export function copyPath(state: FsState, srcPath: string[], dstPath: string[]): FsResult<FsState> {
  const src = getNode(state, srcPath);
  if (!src) return { ok: false, error: "notFound" };
  const dst = getNode(state, dstPath);
  if (dst && dst.kind === "dir") {
    const next = cloneState(state);
    const dstNode = getNode(next, dstPath)!;
    if (dstNode.children?.[src.name]) return { ok: false, error: "destExists" };
    const clone = cloneNode(src);
    dstNode.children = dstNode.children ?? {};
    dstNode.children[clone.name] = clone;
    return { ok: true, value: next };
  }
  const next = cloneState(state);
  const err = insertChild(next.root, dstPath, () => cloneNode(src));
  if (err) return { ok: false, error: err };
  return { ok: true, value: next };
}

export function movePath(state: FsState, srcPath: string[], dstPath: string[]): FsResult<FsState> {
  const copied = copyPath(state, srcPath, dstPath);
  if (!copied.ok) return copied;
  const removed = deletePath(copied.value, srcPath, true);
  if (!removed.ok) return { ok: false, error: removed.error };
  return removed;
}

export function countTree(node: FsNode): { dirs: number; files: number } {
  let dirs = 0;
  let files = 0;
  for (const child of Object.values(node.children ?? {})) {
    if (child.kind === "dir") {
      dirs++;
      const sub = countTree(child);
      dirs += sub.dirs;
      files += sub.files;
    } else {
      files++;
    }
  }
  return { dirs, files };
}

export function renderTree(node: FsNode, prefix = ""): string[] {
  const out: string[] = [];
  const children = Object.values(node.children ?? {});
  children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
  children.forEach((child, i) => {
    const last = i === children.length - 1;
    out.push(`${prefix}${last ? "└── " : "├── "}${child.name}`);
    if (child.kind === "dir") {
      out.push(...renderTree(child, `${prefix}${last ? "    " : "│   "}`));
    }
  });
  return out;
}

export function matchWildcard(name: string, pattern: string): boolean {
  if (!pattern.includes("*")) return name === pattern;
  const regex = new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return regex.test(name);
}

export function countNodes(node: FsNode): number {
  let count = 1;
  for (const child of Object.values(node.children ?? {})) count += countNodes(child);
  return count;
}

export function createRemoteFs(host: string, user: string): FsState {
  const root: FsNode = {
    name: "/",
    kind: "dir",
    perms: "drwxr-xr-x",
    children: {
      etc: {
        name: "etc",
        kind: "dir",
        children: {
          hostname: { name: "hostname", kind: "file", content: `${host}\n` },
        },
      },
      home: {
        name: "home",
        kind: "dir",
        children: {
          [user]: {
            name: user,
            kind: "dir",
            children: {
              "leeme.txt": {
                name: "leeme.txt",
                kind: "file",
                content: `Estás dentro de ${host} (sesión remota simulada).\nEl disco de esta máquina es independiente del de tu equipo local.\nEscribe exit para cerrar la conexión y volver a tu terminal.`,
              },
            },
          },
        },
      },
      var: {
        name: "var",
        kind: "dir",
        children: {
          log: {
            name: "log",
            kind: "dir",
            children: {
              "auth.log": {
                name: "auth.log",
                kind: "file",
                content: `sesión abierta para ${user} desde 192.168.1.42\n`,
              },
            },
          },
        },
      },
    },
  };
  return { root };
}
