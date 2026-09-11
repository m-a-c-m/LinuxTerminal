import {
  createInitialFs,
  resolvePath,
  pathToString,
  displayPath,
  getNode,
  listDir,
  mkdir,
  mkdirP,
  writeFile,
  readFile,
  deletePath,
  copyPath,
  movePath,
  chmod,
  countTree,
  renderTree,
  matchWildcard,
  USER_HOME,
  DEFAULT_PERMS,
  type FsState,
} from "./linuxFs";

export interface BashOptions {
  isEs: boolean;
  env?: Record<string, string>;
  history?: string[];
  remote?: boolean;
  piped?: boolean;
}

export interface BashResult {
  lines: string[];
  state: FsState;
  cwd: string[];
  clear: boolean;
  exit: boolean;
  error?: boolean;
  env?: Record<string, string>;
  broadcast?: string;
  openRemote?: { user: string; host: string };
}

export const HOME = [...USER_HOME];

export const DEFAULT_HOME_ENV: Record<string, string> = {
  HOME: `/${USER_HOME.join("/")}`,
  USER: "alumno",
  SHELL: "/bin/bash",
  HOSTNAME: "pc-aula",
};

export function promptString(cwd: string[], env: Record<string, string> = {}): string {
  const user = env.USER ?? "alumno";
  const host = env.HOSTNAME ?? "pc-aula";
  return `${user}@${host}:${displayPath(cwd)}$`;
}

const FAKES = {
  uname: ["Linux pc-aula 6.8.0-simulado #1 SMP x86_64 GNU/Linux"],
  ps: [
    "  PID TTY          TIME CMD",
    "  842 pts/0    00:00:01 bash",
    "  915 pts/0    00:00:00 ps",
  ],
  df: [
    "S.ficheros     Tamaño Usados Disp Uso% Montado en",
    "/dev/sda1         40G    12G  28G  31% /",
    "tmpfs            2,0G      0  2,0G   0% /dev/shm",
  ],
  free: [
    "               total       usado      libre",
    "Mem:          16384Mi       7168Mi    9216Mi",
    "Swap:          2048Mi          0Mi    2048Mi",
  ],
  ifconfig: [
    "eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500",
    "        inet 192.168.1.42  netmask 255.255.255.0  broadcast 192.168.1.255",
    "        ether 4a:2c:1b:00:11:22  txqueuelen 1000  (Ethernet)",
    "",
    "lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536",
    "        inet 127.0.0.1  netmask 255.0.0.0",
  ],
  ss: [
    "Netid State   Recv-Q  Send-Q   Local Address:Port     Peer Address:Port",
    "tcp   ESTAB        0       0   192.168.1.42:50123   93.184.216.34:https",
    "tcp   ESTAB        0       0   192.168.1.42:50124   142.250.200.99:https",
    "udp   UNCONN       0       0   192.168.1.42:53            *:*",
  ],
};

const MAN_PAGES: Record<string, { synopsis: string; descEs: string; descEn: string }> = {
  ls: { synopsis: "ls [-l] [-a] [-h] [ruta...]", descEs: "Lista el contenido de los directorios. -l muestra detalles (permisos, tamaño, fecha) y -a incluye los archivos ocultos que empiezan por punto.", descEn: "List directory contents. -l shows details (permissions, size, date) and -a includes hidden files starting with a dot." },
  cd: { synopsis: "cd [ruta]", descEs: "Cambia el directorio actual. cd .. sube un nivel, cd ~ va a tu carpeta personal.", descEn: "Change the current directory. cd .. goes up one level, cd ~ goes to your home folder." },
  cat: { synopsis: "cat ARCHIVO...", descEs: "Muestra el contenido completo de uno o varios archivos.", descEn: "Print the full contents of one or more files." },
  mkdir: { synopsis: "mkdir [-p] DIRECTORIO...", descEs: "Crea directorios. Con -p crea las carpetas intermedias que falten.", descEn: "Create directories. With -p it creates missing parent folders." },
  rm: { synopsis: "rm [-r] [-f] ARCHIVO...", descEs: "Borra archivos. Con -r borra carpetas con todo su contenido. Ojo: en un Linux real no hay papelera.", descEn: "Remove files. With -r it deletes folders recursively. Careful: on a real Linux there is no recycle bin." },
  grep: { synopsis: "grep [-i] [-v] [-n] PATRÓN [ARCHIVO...]", descEs: "Busca líneas que contienen el patrón. Puede filtrar la salida de otro comando con una tubería: ls | grep txt.", descEn: "Search for lines matching the pattern. It can filter another command's output through a pipe: ls | grep txt." },
  chmod: { synopsis: "chmod MODOS ARCHIVO...", descEs: "Cambia los permisos: chmod 755 script.sh da lectura y ejecución a todos, y escritura solo al dueño.", descEn: "Change permissions: chmod 755 script.sh gives read+execute to everyone, write only to the owner." },
  ssh: { synopsis: "ssh [usuario@]host", descEs: "Abre una sesión remota en otra máquina. Aquí se simula: se abre una pestaña con el disco de la otra máquina.", descEn: "Open a remote session on another machine. Simulated here: it opens a tab with the other machine's disk." },
  history: { synopsis: "history", descEs: "Muestra los comandos ejecutados en esta sesión, del más antiguo al más reciente.", descEn: "Shows the commands run in this session, oldest first." },
  export: { synopsis: "export VARIABLE=valor", descEs: "Define una variable de entorno. Se usa con $VARIABLE, por ejemplo echo $VARIABLE.", descEn: "Defines an environment variable. Use it as $VARIABLE, e.g. echo $VARIABLE." },
  man: { synopsis: "man COMANDO", descEs: "Muestra el manual del comando.", descEn: "Shows the command's manual." },
};

function timestamp(): string {
  const d = new Date();
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function ok(state: FsState, cwd: string[], lines: string[], clear = false, exit = false): BashResult {
  return { lines, state, cwd, clear, exit };
}

function err(state: FsState, cwd: string[], _lines: string[], isEs: boolean, code: string): BashResult {
  const messages: Record<string, [string, string]> = {
    notFound: ["No existe el archivo o el directorio", "No such file or directory"],
    duplicate: ["El archivo ya existe", "File exists"],
    notADir: ["No es un directorio", "Not a directory"],
    notAFile: ["Es un directorio", "Is a directory"],
    isDir: ["Es un directorio", "Is a directory"],
    dirNotEmpty: ["El directorio no está vacío", "Directory not empty"],
    rootOp: ["Operación no permitida sobre /", "Operation not permitted on /"],
    destExists: ["El destino ya existe", "Destination already exists"],
    invalidPath: ["Ruta no válida", "Invalid path"],
    denied: ["Permiso denegado", "Permission denied"],
  };
  const [msgEs, msgEn] = messages[code] ?? ["Error", "Error"];
  return { lines: [`bash: ${isEs ? msgEs : msgEn}`], state, cwd, clear: false, exit: false, error: true };
}

function tokenize(line: string): string[] {
  return line.trim().split(/\s+/).filter((t) => t.length > 0);
}

function expandVars(text: string, env: Record<string, string>): string {
  return text
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => {
      const key = Object.keys(env).find((k) => k === name);
      return key ? env[key] : "";
    })
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name: string) => {
      const key = Object.keys(env).find((k) => k === name);
      return key ? env[key] : "";
    });
}

function permString(mode: string): string | null {
  const digits = mode.length === 4 ? mode.slice(1) : mode;
  if (!/^[0-7]{3}$/.test(digits)) return null;
  const rwx = ["r", "w", "x"];
  let out = "";
  for (const digit of digits) {
    const bits = Number(digit);
    out += rwx.map((c, i) => (bits & (4 >> i) ? c : "-")).join("");
  }
  return out;
}

function lsLines(state: FsState, cwd: string[], args: string[], isEs: boolean, piped: boolean): BashResult {
  const flags: string[] = [];
  const paths: string[] = [];
  for (const a of args) {
    if (a.startsWith("-")) flags.push(...a.slice(1).split(""));
    else paths.push(a);
  }
  const long = flags.includes("l");
  const all = flags.includes("a");
  const target = paths.length > 0 ? resolvePath(cwd, paths[0]).value : cwd;
  const node = getNode(state, target);
  if (!node) {
    return { lines: [`ls: no se puede acceder a '${paths[0]}': No existe el archivo o el directorio`], state, cwd, clear: false, exit: false, error: true };
  }
  if (node.kind !== "dir") {
    return { lines: [paths[0]], state, cwd, clear: false, exit: false };
  }
  const res = listDir(state, target);
  const entries = res.ok ? res.value : [];
  const visible = all ? entries : entries.filter((e) => !e.name.startsWith("."));
  const lines: string[] = [];
  if (long) {
    lines.push(`total ${visible.length}`);
    for (const e of visible) {
      const node2 = getNode(state, [...target, e.name]);
      const size = e.kind === "file" ? (node2?.content ?? "").length : 4096;
      const perms = e.perms ?? (e.kind === "dir" ? DEFAULT_PERMS.dir : DEFAULT_PERMS.file);
      lines.push(`${perms} 1 alumno alumno ${String(size).padStart(8)} ${timestamp()} ${e.name}`);
    }
  } else if (piped) {
    for (const e of visible) lines.push(e.name);
  } else {
    lines.push(visible.map((e) => e.name).join("  "));
  }
  return { lines, state, cwd, clear: false, exit: false };
}

interface Pipeline {
  segments: string[][];
}

function redirectAtEnd(text: string): RegExpMatchArray | null {
  return text.match(/(>>|>)\s*([^\s>]+)\s*$/);
}

function contentLines(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function parsePipeline(mainLine: string): Pipeline | null {
  const parts = mainLine.split("|").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length < 2) return null;
  return { segments: parts.map((p) => p.split(/\s+/).filter((t) => t.length > 0)) };
}

function applyFilter(cmd: string[], stdin: string[], isEs: boolean): { lines: string[]; error?: string } {
  const cmdName = cmd[0];
  const flags = cmd.slice(1).filter((a) => a.startsWith("-") && a.length > 1).flatMap((a) => a.slice(1).split(""));
  const rest = cmd.slice(1).filter((a) => !(a.startsWith("-") && a.length > 1));
  if (cmdName === "grep") {
    const pattern = rest[0];
    if (!pattern) return { lines: [], error: isEs ? "grep: falta el patrón" : "grep: missing pattern" };
    const lower = pattern.toLowerCase();
    const hits = flags.includes("v")
      ? stdin.map((l, i) => ({ l, i })).filter((x) => !x.l.toLowerCase().includes(lower))
      : stdin.map((l, i) => ({ l, i })).filter((x) => x.l.toLowerCase().includes(lower));
    const out = hits.map((x) => (flags.includes("n") ? `${String(x.i + 1).padStart(2)}:${x.l}` : x.l));
    return { lines: out };
  }
  if (cmdName === "head") {
    const nIdx = cmd.indexOf("-n");
    const n = nIdx >= 0 ? Number(cmd[nIdx + 1]) || 10 : 10;
    return { lines: stdin.slice(0, n) };
  }
  if (cmdName === "tail") {
    const nIdx = cmd.indexOf("-n");
    const n = nIdx >= 0 ? Number(cmd[nIdx + 1]) || 10 : 10;
    return { lines: stdin.slice(Math.max(0, stdin.length - n)) };
  }
  if (cmdName === "wc") {
    if (flags.includes("l")) return { lines: [String(stdin.length)] };
    return { lines: [`${stdin.length} ${stdin.length} ${stdin.join(" ").length}`] };
  }
  if (cmdName === "sort") {
    return { lines: [...stdin].sort() };
  }
  if (cmdName === "uniq") {
    const out: string[] = [];
    for (const l of stdin) {
      if (out.length === 0 || out[out.length - 1] !== l) out.push(l);
    }
    return { lines: out };
  }
  return { lines: [], error: isEs ? `bash: ${cmdName}: no se admite en una tubería` : `bash: ${cmdName}: not supported in a pipe` };
}

export function executeLine(state: FsState, cwd: string[], rawLine: string, opts: BashOptions): BashResult {
  const redir = redirectAtEnd(rawLine);
  if (redir) {
    const mainLine = rawLine.slice(0, rawLine.length - redir[0].length).trim();
    const inner = executeLine(state, cwd, mainLine, opts);
    if (inner.error) return inner;
    const target = resolvePath(cwd, redir[2]).value;
    const res = writeFile(inner.state, target, inner.lines.join("\n") + "\n", redir[1] === ">>");
    if (!res.ok) return err(inner.state, cwd, [], opts.isEs, res.error);
    return { lines: [], state: res.value, cwd, clear: false, exit: false, env: inner.env };
  }
  const isEs = opts.isEs;
  const env: Record<string, string> = { ...(opts.env ?? {}) };
  const line = expandVars(rawLine, env);
  const tokens = tokenize(line);
  if (tokens.length === 0) return ok(state, cwd, []);
  const cmd = tokens[0];
  const args = tokens.slice(1);

  if (cmd === "sudo") {
    if (args.length === 0) {
      return { lines: [isEs ? "uso: sudo <comando>" : "usage: sudo <command>"], state, cwd, clear: false, exit: false, error: true };
    }
    const pwLine = isEs ? "[sudo] contraseña de alumno: (simulada, aceptada)" : "[sudo] password for alumno: (simulated, accepted)";
    const inner = executeLine(state, cwd, args.join(" "), { ...opts, env });
    return { ...inner, lines: [pwLine, ...inner.lines] };
  }

  const pipeline = parsePipeline(line);
  if (pipeline) {
    const first = pipeline.segments[0];
    if (first.length === 0) return err(state, cwd, [], isEs, "invalidPath");
    const firstLine = first.join(" ");
    const firstRes = executeLine(state, cwd, firstLine, { ...opts, env, piped: true });
    if (firstRes.error) return firstRes;
    let stdinLines = firstRes.lines;
    for (const filterSeg of pipeline.segments.slice(1)) {
      if (filterSeg.length === 0) return err(state, cwd, [], isEs, "invalidPath");
      const filtered = applyFilter(filterSeg, stdinLines, isEs);
      if (filtered.error) return { lines: [filtered.error], state, cwd, clear: false, exit: false, error: true };
      stdinLines = filtered.lines;
    }
    return { ...firstRes, lines: stdinLines, env };
  }

  switch (cmd) {
    case "help": {
      const rows = isEs
        ? [
            "",
            "Comandos disponibles (man comando para el manual):",
            "  LS [-l] [-a]     Lista archivos               CD [ruta]    Cambia de directorio",
            "  PWD              Muestra la ruta actual       CAT archivo  Muestra el contenido",
            "  TOUCH archivo    Crea un archivo vacío        MKDIR [-p] d Crea carpetas",
            "  RM [-r] destino  Borra archivos               CP [-r] o d  Copia",
            "  MV origen dst    Mueve o renombra             ECHO texto [> | >> archivo]",
            "  GREP patrón      Busca texto (también con |)  HEAD/TAIL -n N",
            "  CHMOD 755 f      Cambia permisos              TREE         Árbol de carpetas",
            "  EXPORT VAR=valor Define una variable          ENV          Ver variables",
            "  HISTORY          Historial de comandos        MAN comando  Manual",
            "  SSH user@host    Conexión remota (pestaña)    WALL texto   Mensaje a todas las terminales",
            "  PING host        Comprueba conexión           IFCONFIG     Configuración de red",
            "  WGET url         Descarga (simulada)          CURL url     Pide una web (simulada)",
            "  UNAME [-a]       Sistema                      PS / DF / FREE / SS  Procesos, disco, memoria, red",
            "  WHOAMI / HOSTNAME / DATE / UPTIME",
            "  CLEAR            Limpia la pantalla           EXIT         Cierra la sesión",
            "",
          ]
        : [
            "",
            "Available commands (man command for the manual):",
            "  LS [-l] [-a]     List files                   CD [path]    Change directory",
            "  PWD              Print working directory      CAT file     Show contents",
            "  TOUCH file       Create empty file            MKDIR [-p] d Make directories",
            "  RM [-r] target   Remove files                 CP [-r] s d  Copy",
            "  MV src dst       Move or rename               ECHO text [> | >> file]",
            "  GREP pattern     Search text (also with |)    HEAD/TAIL -n N",
            "  CHMOD 755 f      Change permissions           TREE         Folder tree",
            "  EXPORT VAR=value Define a variable            ENV          List variables",
            "  HISTORY          Command history              MAN command  Manual",
            "  SSH user@host    Remote connection (tab)      WALL text    Message to all terminals",
            "  PING host        Test connection              IFCONFIG     Network config",
            "  WGET url         Download (simulated)         CURL url     Request a page (simulated)",
            "  UNAME [-a]       System info                  PS / DF / FREE / SS  Processes, disk, memory, network",
            "  WHOAMI / HOSTNAME / DATE / UPTIME",
            "  CLEAR            Clear the screen             EXIT         Close the session",
            "",
          ];
      return ok(state, cwd, rows);
    }

    case "clear":
      return ok(state, cwd, [], true);

    case "exit":
      return ok(state, cwd, [isEs ? "Sesión cerrada." : "Session closed."], false, true);

    case "pwd":
      return ok(state, cwd, [pathToString(cwd)]);

    case "cd": {
      if (args.length === 0) {
        const home = resolvePath(cwd, "~").value;
        return ok(state, home, []);
      }
      if (args[0] === "-") {
        return ok(state, cwd, [isEs ? "cd - no está disponible en el simulador." : "cd - is not available in the simulator."]);
      }
      const target = resolvePath(cwd, args[0]);
      const node = getNode(state, target.value);
      if (!node) {
        return { lines: [`bash: cd: ${args[0]}: No existe el archivo o el directorio`], state, cwd, clear: false, exit: false, error: true };
      }
      if (node.kind !== "dir") {
        return { lines: [`bash: cd: ${args[0]}: No es un directorio`], state, cwd, clear: false, exit: false, error: true };
      }
      return ok(state, target.value, []);
    }

    case "ls":
      return lsLines(state, cwd, args, isEs, opts.piped === true);

    case "cat": {
      if (args.length === 0) return err(state, cwd, [], isEs, "invalidPath");
      const lines: string[] = [];
      for (const a of args) {
        const res = readFile(state, resolvePath(cwd, a).value);
        if (!res.ok) {
          return { lines: [`cat: ${a}: No existe el archivo o el directorio`], state, cwd, clear: false, exit: false, error: true };
        }
        if (res.value.length > 0) lines.push(...contentLines(res.value));
      }
      return ok(state, cwd, lines);
    }

    case "touch": {
      if (args.length === 0) return err(state, cwd, [], isEs, "invalidPath");
      let st = state;
      for (const a of args) {
        if (getNode(st, resolvePath(cwd, a).value)) continue;
        const res = writeFile(st, resolvePath(cwd, a).value, "");
        if (!res.ok) return err(st, cwd, [], isEs, res.error);
        st = res.value;
      }
      return ok(st, cwd, []);
    }

    case "mkdir": {
      const pFlag = args[0] === "-p";
      const dirs = pFlag ? args.slice(1) : args;
      if (dirs.length === 0) return err(state, cwd, [], isEs, "invalidPath");
      let st = state;
      for (const d of dirs) {
        const target = resolvePath(cwd, d).value;
        const res = pFlag ? mkdirP(st, target) : mkdir(st, target);
        if (!res.ok) return err(st, cwd, [], isEs, res.error);
        st = res.value;
      }
      return ok(st, cwd, []);
    }

    case "rmdir": {
      if (args.length === 0) return err(state, cwd, [], isEs, "invalidPath");
      let st = state;
      for (const a of args) {
        const res = deletePath(st, resolvePath(cwd, a).value, false);
        if (!res.ok) return err(st, cwd, [], isEs, res.error);
        st = res.value;
      }
      return ok(st, cwd, []);
    }

    case "rm": {
      const recursive = args.some((a) => a.startsWith("-") && a.slice(1).includes("r"));
      const targets = args.filter((a) => !a.startsWith("-"));
      if (targets.length === 0) {
        return { lines: [isEs ? "uso: rm [-r] <archivo|carpeta>..." : "usage: rm [-r] <file|folder>..."], state, cwd, clear: false, exit: false, error: true };
      }
      let st = state;
      for (const raw of targets) {
        const parentPart = raw.includes("/") ? raw.slice(0, raw.lastIndexOf("/") + 1) : "";
        const pattern = raw.slice(raw.lastIndexOf("/") + 1) || raw;
        const parentPath = resolvePath(cwd, parentPart).value;
        const node = getNode(st, parentPath);
        if (!node || node.kind !== "dir") return err(st, cwd, [], isEs, "notFound");
        const matches = Object.values(node.children ?? {})
          .filter((c) => matchWildcard(c.name, pattern))
          .map((c) => c.name);
        if (matches.length === 0 && !pattern.includes("*")) {
          return { lines: [`rm: no se puede borrar '${raw}': No existe el archivo o el directorio`], state: st, cwd, clear: false, exit: false, error: true };
        }
        for (const name of matches) {
          const res = deletePath(st, [...parentPath, name], recursive);
          if (!res.ok) return err(st, cwd, [], isEs, res.error);
          st = res.value;
        }
      }
      return ok(st, cwd, []);
    }

    case "cp": {
      const recursive = args.some((a) => a.startsWith("-") && a.slice(1).includes("r"));
      const targets = args.filter((a) => !a.startsWith("-"));
      if (targets.length < 2) return err(state, cwd, [], isEs, "invalidPath");
      const src = resolvePath(cwd, targets[0]).value;
      const srcNode = getNode(state, src);
      if (!srcNode) return err(state, cwd, [], isEs, "notFound");
      if (srcNode.kind === "dir" && !recursive) {
        return { lines: [`cp: -r no especificado; omitiendo el directorio '${targets[0]}'`], state, cwd, clear: false, exit: false, error: true };
      }
      const dstArg = resolvePath(cwd, targets[1]).value;
      const dstNode = getNode(state, dstArg);
      let st = state;
      if (dstNode && dstNode.kind === "dir" && dstNode.children?.[srcNode.name]) {
        const removed = deletePath(st, [...dstArg, srcNode.name], true);
        if (!removed.ok) return err(st, cwd, [], isEs, removed.error);
        st = removed.value;
      }
      const dstPath = getNode(st, dstArg)?.kind === "dir" ? [...dstArg, srcNode.name] : dstArg;
      const res = copyPath(st, src, dstPath);
      if (!res.ok) return err(st, cwd, [], isEs, res.error);
      return ok(res.value, cwd, []);
    }

    case "mv": {
      if (args.length < 2) return err(state, cwd, [], isEs, "invalidPath");
      const src = resolvePath(cwd, args[0]).value;
      const srcNode = getNode(state, src);
      if (!srcNode) return err(state, cwd, [], isEs, "notFound");
      const dstArg = resolvePath(cwd, args[1]).value;
      const dstNode = getNode(state, dstArg);
      let st = state;
      if (dstNode && dstNode.kind === "dir" && dstNode.children?.[srcNode.name]) {
        const removed = deletePath(st, [...dstArg, srcNode.name], true);
        if (!removed.ok) return err(st, cwd, [], isEs, removed.error);
        st = removed.value;
      }
      const dstPath = getNode(st, dstArg)?.kind === "dir" ? [...dstArg, srcNode.name] : dstArg;
      const res = movePath(st, src, dstPath);
      if (!res.ok) return err(st, cwd, [], isEs, res.error);
      return ok(res.value, cwd, []);
    }

    case "echo": {
      const text = expandVars(args.join(" ").replace(/^["']|["']$/g, ""), env);
      return ok(state, cwd, [text]);
    }

    case "grep": {
      const flags: string[] = [];
      const rest: string[] = [];
      for (const a of args) {
        if (a.startsWith("-") && a.length > 1) flags.push(...a.slice(1).split(""));
        else rest.push(a);
      }
      const pattern = rest[0];
      if (!pattern) return { lines: [isEs ? "uso: grep [-i] [-v] [-n] patrón [archivo...]" : "usage: grep [-i] [-v] [-n] pattern [file...]"], state, cwd, clear: false, exit: false, error: true };
      const files = rest.slice(1);
      if (files.length === 0) return { lines: [isEs ? "grep: se necesita un archivo (o entra por una tubería)" : "grep: a file is required (or pipe input)"], state, cwd, clear: false, exit: false, error: true };
      const out: string[] = [];
      for (const fileRaw of files) {
        const res = readFile(state, resolvePath(cwd, fileRaw).value);
        if (!res.ok) {
          return { lines: [`grep: ${fileRaw}: No existe el archivo o el directorio`], state, cwd, clear: false, exit: false, error: true };
        }
        const fileLines = contentLines(res.value);
        fileLines.forEach((l, i) => {
          const hit = flags.includes("i") ? l.toLowerCase().includes(pattern.toLowerCase()) : l.includes(pattern);
          if (flags.includes("v") ? !hit : hit) {
            const prefix = flags.includes("n") ? `${String(i + 1).padStart(2)}:` : "";
            out.push(files.length > 1 ? `${fileRaw}:${prefix}${l}` : `${prefix}${l}`);
          }
        });
      }
      return ok(state, cwd, out);
    }

    case "head":
    case "tail": {
      if (args.length === 0) return err(state, cwd, [], isEs, "invalidPath");
      const nIdx = args.indexOf("-n");
      const n = nIdx >= 0 ? Number(args[nIdx + 1]) || 10 : 10;
      const fileArg = nIdx >= 0 ? args[nIdx + 2] : args[0];
      const res = readFile(state, resolvePath(cwd, fileArg ?? "").value);
      if (!res.ok) return err(state, cwd, [], isEs, res.error);
      const fileLines = contentLines(res.value);
      return ok(state, cwd, cmd === "head" ? fileLines.slice(0, n) : fileLines.slice(Math.max(0, fileLines.length - n)));
    }

    case "wc": {
      if (args.length === 0) return err(state, cwd, [], isEs, "invalidPath");
      const flags = args.filter((a) => a.startsWith("-")).flatMap((a) => a.slice(1).split(""));
      const fileArg = args.find((a) => !a.startsWith("-"));
      const res = readFile(state, resolvePath(cwd, fileArg ?? "").value);
      if (!res.ok) return err(state, cwd, [], isEs, res.error);
      const fileLines = contentLines(res.value);
      const words = res.value.split(/\s+/).filter((w) => w.length > 0).length;
      if (flags.includes("l")) return ok(state, cwd, [String(fileLines.length)]);
      return ok(state, cwd, [`${String(fileLines.length).padStart(4)} ${String(words).padStart(4)} ${String(res.value.length).padStart(4)} ${fileArg ?? ""}`]);
    }

    case "sort":
    case "uniq": {
      if (args.length === 0) return err(state, cwd, [], isEs, "invalidPath");
      const fileArg = args.find((a) => !a.startsWith("-"));
      const res = readFile(state, resolvePath(cwd, fileArg ?? "").value);
      if (!res.ok) return err(state, cwd, [], isEs, res.error);
      let fileLines = contentLines(res.value);
      if (cmd === "sort") {
        fileLines = [...fileLines].sort();
      } else {
        const out: string[] = [];
        for (const l of fileLines) {
          if (out.length === 0 || out[out.length - 1] !== l) out.push(l);
        }
        fileLines = out;
      }
      return ok(state, cwd, fileLines);
    }

    case "chmod": {
      const targets = args.filter((a) => !/^[0-7]{3,4}$/.test(a));
      const modeArg = args.find((a) => /^[0-7]{3,4}$/.test(a));
      if (!modeArg || targets.length === 0) return { lines: [isEs ? "uso: chmod <modo octal> <archivo...>" : "usage: chmod <octal mode> <file...>"], state, cwd, clear: false, exit: false, error: true };
      const perms = permString(modeArg);
      if (!perms) return err(state, cwd, [], isEs, "invalidPath");
      let st = state;
      for (const t of targets) {
        const res = chmod(st, resolvePath(cwd, t).value, perms);
        if (!res.ok) return err(st, cwd, [], isEs, res.error);
        st = res.value;
      }
      return ok(st, cwd, []);
    }

    case "tree": {
      const target = args[0] ? resolvePath(cwd, args[0]).value : cwd;
      const node = getNode(state, target);
      if (!node) return err(state, cwd, [], isEs, "notFound");
      if (node.kind !== "dir") return err(state, cwd, [], isEs, "notADir");
      const counts = countTree(node);
      return ok(state, cwd, [pathToString(target), ...renderTree(node), "", isEs
        ? `${counts.dirs} directorios, ${counts.files} archivos`
        : `${counts.dirs} directories, ${counts.files} files`]);
    }

    case "export": {
      const joined = args.join(" ");
      const eq = joined.indexOf("=");
      if (eq <= 0) {
        return { lines: [isEs ? "uso: export VARIABLE=valor" : "usage: export VARIABLE=value"], state, cwd, clear: false, exit: false, error: true };
      }
      const name = joined.slice(0, eq).trim();
      const value = expandVars(joined.slice(eq + 1).trim(), env);
      env[name] = value;
      return { lines: [], state, cwd, clear: false, exit: false, env };
    }

    case "env": {
      const rows = Object.keys(env).sort().map((k) => `${k}=${env[k]}`);
      return ok(state, cwd, rows.length > 0 ? rows : [isEs ? "Sin variables definidas." : "No variables defined."]);
    }

    case "history": {
      const hist = (opts.history ?? []).slice().reverse();
      const numbered = hist.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`);
      return ok(state, cwd, numbered.length > 0 ? numbered : [isEs ? "Historial vacío." : "History is empty."]);
    }

    case "man": {
      const page = args[0]?.toLowerCase();
      if (!page) return { lines: [isEs ? "¿Qué página de manual quieres?" : "What manual page do you want?"], state, cwd, clear: false, exit: false, error: true };
      const entry = MAN_PAGES[page];
      if (!entry) {
        return { lines: [isEs ? `No hay entrada de manual para ${page}` : `No manual entry for ${page}`], state, cwd, clear: false, exit: false, error: true };
      }
      return ok(state, cwd, [
        `${page.toUpperCase()} (1)`,
        "",
        "SINOPSIS",
        `     ${entry.synopsis}`,
        "",
        "DESCRIPCIÓN",
        `     ${isEs ? entry.descEs : entry.descEn}`,
      ]);
    }

    case "whoami":
      return ok(state, cwd, [opts.remote ? "invitado" : env.USER ?? "alumno"]);

    case "hostname":
      return ok(state, cwd, [env.HOSTNAME ?? "pc-aula"]);

    case "uname":
      return ok(state, cwd, [args.some((a) => a.includes("a"))
        ? "Linux pc-aula 6.8.0-simulado #1 SMP x86_64 GNU/Linux"
        : "Linux"]);

    case "ps":
      return ok(state, cwd, FAKES.ps);

    case "df":
      return ok(state, cwd, FAKES.df);

    case "free":
      return ok(state, cwd, FAKES.free);

    case "ifconfig":
    case "ip":
      return ok(state, cwd, FAKES.ifconfig);

    case "ss":
    case "netstat":
      return ok(state, cwd, FAKES.ss);

    case "ping": {
      if (args.length === 0) return err(state, cwd, [], isEs, "invalidPath");
      const host = args[0].replace(/^https?:\/\//, "");
      const lines = isEs
        ? [
            `PING ${host} (93.184.216.34) 56(84) bytes de datos.`,
            "64 bytes desde 93.184.216.34: icmp_seq=1 ttl=57 tiempo=24.2 ms",
            "64 bytes desde 93.184.216.34: icmp_seq=2 ttl=57 tiempo=25.1 ms",
            "64 bytes desde 93.184.216.34: icmp_seq=3 ttl=57 tiempo=23.8 ms",
            "",
            `--- estadísticas de ping de ${host} ---`,
            "3 paquetes transmitidos, 3 recibidos, 0% perdidos",
            isEs ? "(simulado: pulse Ctrl+C para detener en un Linux real)" : "(simulated: press Ctrl+C to stop on a real Linux)",
          ]
        : [
            `PING ${host} (93.184.216.34) 56(84) bytes of data.`,
            "64 bytes from 93.184.216.34: icmp_seq=1 ttl=57 time=24.2 ms",
            "64 bytes from 93.184.216.34: icmp_seq=2 ttl=57 time=25.1 ms",
            "64 bytes from 93.184.216.34: icmp_seq=3 ttl=57 time=23.8 ms",
            "",
            `--- ${host} ping statistics ---`,
            "3 packets transmitted, 3 received, 0% packet loss",
            "(simulated: press Ctrl+C to stop on a real Linux)",
          ];
      return ok(state, cwd, lines);
    }

    case "traceroute": {
      if (args.length === 0) return err(state, cwd, [], isEs, "invalidPath");
      const host = args[0];
      return ok(state, cwd, [
        `traceroute hacia ${host} (93.184.216.34), 30 saltos máximo`,
        "  1  router.miguelacm.local (192.168.1.1)  2.1 ms  1.9 ms  2.0 ms",
        "  2  10.10.0.1 (10.10.0.1)  11.2 ms  10.8 ms  12.1 ms",
        "  3  80.58.32.1 (80.58.32.1)  19.5 ms  20.2 ms  18.9 ms",
        "  4  93.184.216.34 (93.184.216.34)  24.3 ms  23.9 ms  24.8 ms",
      ]);
    }

    case "ssh": {
      const target = args.find((a) => !a.startsWith("-"));
      if (!target || !target.includes("@")) {
        return { lines: [isEs
          ? "uso: ssh usuario@host — ejemplo: ssh invitado@servidor-aula"
          : "usage: ssh user@host — example: ssh guest@class-server"], state, cwd, clear: false, exit: false, error: true };
      }
      const [user, host] = target.split("@");
      return {
        lines: [
          `ssh: conectando con ${host} (simulado)...`,
          `La autenticidad del host '${host}' no puede establecerse (entorno de práctica).`,
          `${user}@${host}'s password: (simulada, aceptada)`,
          "",
          isEs
            ? `Bienvenido a ${host} (Ubuntu simulado). Se abre una pestaña nueva con el disco de esa máquina.`
            : `Welcome to ${host} (simulated Ubuntu). A new tab opens with that machine's disk.`,
        ],
        state, cwd, clear: false, exit: false,
        openRemote: { user, host },
      };
    }

    case "scp": {
      if (args.length < 2) return err(state, cwd, [], isEs, "invalidPath");
      const [src, dst] = args;
      return ok(state, cwd, [isEs
        ? `${src} → ${dst} (copia remota simulada): 100%`
        : `${src} → ${dst} (simulated remote copy): 100%`]);
    }

    case "curl": {
      const url = args.find((a) => !a.startsWith("-"));
      if (!url) return err(state, cwd, [], isEs, "invalidPath");
      const body = [
        "<!DOCTYPE html>",
        "<html lang=\"es\">",
        "<head><title>Página simulada</title></head>",
        "<body><h1>Respuesta simulada de " + url + "</h1></body>",
        "</html>",
      ];
      return ok(state, cwd, isEs
        ? [`Pidiendo ${url}...`, "", ...body, "", "(respuesta simulada; nada sale de tu navegador)"]
        : [`Requesting ${url}...`, "", ...body, "", "(simulated response; nothing leaves your browser)"]);
    }

    case "wget": {
      const url = args.find((a) => !a.startsWith("-"));
      if (!url) return err(state, cwd, [], isEs, "invalidPath");
      const fileName = url.replace(/\/+$/, "").split("/").pop() || "index.html";
      const target = resolvePath(cwd, fileName).value;
      const res = writeFile(state, target, `<html><body>Descarga simulada de ${url}</body></html>\n`);
      if (!res.ok) return err(state, cwd, [], isEs, res.error);
      return ok(res.value, cwd, [
        `--${timestamp()}--  ${url}`,
        "Resolviendo host (simulado)... conectado.",
        `HTTP request sent, awaiting response... 200 OK`,
        `Guardando como: '${fileName}'`,
        "",
        `${fileName} guardado (simulado) en ${pathToString(cwd)}.`,
      ]);
    }

    case "wall": {
      const message = args.join(" ");
      if (message.length === 0) {
        return { lines: [isEs ? "uso: wall <mensaje para todas las terminales>" : "usage: wall <message for every terminal>"], state, cwd, clear: false, exit: false, error: true };
      }
      return { lines: [isEs ? `Mensaje difundido a todas las terminales.` : `Message broadcast to every terminal.`], state, cwd, clear: false, exit: false, broadcast: message };
    }

    case "nano":
    case "vim":
    case "vi":
      return ok(state, cwd, [isEs
        ? `${cmd} (simulado): aquí los archivos se editan con echo > archivo y se leen con cat.`
        : `${cmd} (simulated): here files are edited with echo > file and read with cat.`]);

    case "apt":
    case "apt-get": {
      const sub = args[0];
      if (sub === "install" && args[1]) {
        return ok(state, cwd, isEs
          ? [
              "Leyendo lista de paquetes... (simulado)",
              `Se instalarán los siguientes paquetes NUEVOS: ${args.slice(1).join(" ")}`,
              `Desempaquetando ${args[1]} ... Configurando ${args[1]} ... hecho.`,
            ]
          : [
              "Reading package lists... (simulated)",
              `The following NEW packages will be installed: ${args.slice(1).join(" ")}`,
              `Unpacking ${args[1]} ... Setting up ${args[1]} ... done.`,
            ]);
      }
      if (sub === "update") {
        return ok(state, cwd, [isEs ? "Obj y listas actualizadas (simulado)." : "Package lists updated (simulated)."]);
      }
      return ok(state, cwd, [isEs ? "uso: apt install <paquete> | apt update" : "usage: apt install <package> | apt update"]);
    }

    case "date":
      return ok(state, cwd, [new Date().toLocaleString(isEs ? "es-ES" : "en-US")]);

    case "uptime":
      return ok(state, cwd, [` ${timestamp()}  activo 2:14,  1 usuario,  carga: 0.15, 0.10, 0.05`]);

    case "lsb_release":
      return ok(state, cwd, ["Distributor ID: Ubuntu (simulado)"]);

    default:
      return { lines: [isEs
        ? `${cmd}: orden no encontrada`
        : `${cmd}: command not found`], state, cwd, clear: false, exit: false, error: true };
  }
}
