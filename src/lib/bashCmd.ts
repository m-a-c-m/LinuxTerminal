import {
  createInitialFs,
  resolvePath,
  pathToString,
  displayPath,
  getNode,
  getNodeRaw,
  listDir,
  mkdir,
  mkdirP,
  writeFile,
  readFile,
  deletePath,
  copyPath,
  movePath,
  chmod,
  createLink,
  countTree,
  renderTree,
  matchWildcard,
  USER_HOME,
  DEFAULT_PERMS,
  type FsNode,
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
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  LANG: "es_ES.UTF-8",
  TERM: "xterm-256color",
};

const FALLBACK_PATH = DEFAULT_HOME_ENV.PATH;

const BUILTIN_ALIASES: Record<string, string> = {
  ll: "ls -l",
  la: "ls -a",
  cls: "clear",
};

export function promptString(cwd: string[], env: Record<string, string> = {}): string {
  const ps1 = env.PS1;
  if (ps1 && ps1.trim()) return renderPs1(ps1, cwd, env);
  const user = env.USER ?? "alumno";
  const host = env.HOSTNAME ?? "pc-aula";
  return `${user}@${host}:${displayPath(cwd)}$`;
}

export function renderPs1(ps1: string, cwd: string[], env: Record<string, string>): string {
  const user = env.USER ?? "alumno";
  const host = env.HOSTNAME ?? "pc-aula";
  const home = env.HOME && env.HOME.startsWith("/") ? env.HOME : `/home/${user}`;
  const full = cwd.length === 0 ? "/" : `/${cwd.join("/")}`;
  let w: string;
  if (full === home) w = "~";
  else if (full.startsWith(`${home}/`)) w = `~${full.slice(home.length)}`;
  else w = full;
  return ps1.replace(/\\./g, (m) => {
    switch (m) {
      case "\\u": return user;
      case "\\h": return host;
      case "\\w": return w;
      case "\\W": {
        if (w === "~") return "~";
        const base = w.split("/").pop() ?? "";
        return base.length > 0 ? base : "/";
      }
      case "\\$": return user === "root" ? "#" : "$";
      case "\\\\": return "\\";
      default: return m;
    }
  });
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && ((value[0] === "'" && value[value.length - 1] === "'") || (value[0] === '"' && value[value.length - 1] === '"'))) {
    return value.slice(1, -1);
  }
  return value;
}

const HOSTS: Record<string, string> = {
  localhost: "127.0.0.1",
  "pc-aula": "192.168.1.42",
  router: "192.168.1.1",
  "router.miguelacm.local": "192.168.1.1",
  "miguelacm.es": "93.184.216.34",
  "www.miguelacm.es": "93.184.216.34",
  "google.com": "142.250.200.99",
  "youtube.com": "142.250.185.78",
  "wikipedia.org": "208.80.154.224",
  "github.com": "140.82.121.4",
};

function isIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function resolveHost(host: string): { ip: string; local: boolean } | null {
  const clean = host.toLowerCase();
  if (isIpv4(clean)) return { ip: clean, local: clean.startsWith("127.") };
  const ip = HOSTS[clean];
  if (!ip) return null;
  return { ip, local: ip.startsWith("127.") };
}

const PACKAGES = [
  "apache2", "aptitude", "build-essential", "cowsay", "curl", "docker.io", "figlet", "firefox",
  "gcc", "git", "htop", "jq", "make", "mysql-server", "nano", "neofetch", "net-tools", "nginx",
  "nodejs", "openssh-server", "postgresql", "python3", "sl", "tmux", "tree", "vim", "vlc", "wget",
];

const PREINSTALLED = ["bash", "coreutils", "curl", "grep", "jq", "nano", "openssh-client", "python3", "tar", "vim", "wget"];

const FAKES = {
  unameFull: "Linux pc-aula 6.8.0-simulado #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux",
  ps: [
    "  PID TTY          TIME CMD",
    "  842 pts/0    00:00:01 bash",
    "  915 pts/0    00:00:00 ps",
  ],
  psAuxEs: [
    "USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND",
    "alumno     842  0.0  0.1  12012  5312 pts/0    Ss   08:15   0:01 bash",
    "alumno     915  0.0  0.0  13000  3200 pts/0    R+   08:20   0:00 ps aux",
  ],
  psAuxEn: [
    "USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND",
    "alumno     842  0.0  0.1  12012  5312 pts/0    Ss   08:15   0:01 bash",
    "alumno     915  0.0  0.0  13000  3200 pts/0    R+   08:20   0:00 ps aux",
  ],
  dfEs: [
    "S.ficheros     Tamaño Usados Disp Uso% Montado en",
    "/dev/sda1         40G    12G  28G  31% /",
    "tmpfs            2,0G      0  2,0G   0% /dev/shm",
  ],
  dfEn: [
    "Filesystem      Size  Used Avail Use% Mounted on",
    "/dev/sda1        40G   12G   28G  31% /",
    "tmpfs           2.0G     0  2.0G   0% /dev/shm",
  ],
  freeEs: [
    "               total       usado      libre   compartido  búfer/caché  disponible",
    "Mem:          16384Mi       7168Mi    9216Mi       512Mi       2048Mi      8704Mi",
    "Swap:          2048Mi          0Mi    2048Mi",
  ],
  freeEn: [
    "               total        used        free      shared  buff/cache   available",
    "Mem:           16384Mi      7168Mi      9216Mi       512Mi      2048Mi      8704Mi",
    "Swap:           2048Mi         0Mi      2048Mi",
  ],
  ifconfig: [
    "eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500",
    "        inet 192.168.1.42  netmask 255.255.255.0  broadcast 192.168.1.255",
    "        ether 4a:2c:1b:00:11:22  txqueuelen 1000  (Ethernet)",
    "",
    "lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536",
    "        inet 127.0.0.1  netmask 255.0.0.0",
  ],
  ipAddr: [
    "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000",
    "    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00",
    "    inet 127.0.0.1/8 scope host lo",
    "       valid_lft forever preferred_lft forever",
    "2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000",
    "    link/ether 4a:2c:1b:00:11:22 brd ff:ff:ff:ff:ff:ff",
    "    inet 192.168.1.42/24 brd 192.168.1.255 scope global dynamic eth0",
    "       valid_lft 86231sec preferred_lft 86231sec",
  ],
  ss: [
    "Netid State   Recv-Q  Send-Q   Local Address:Port     Peer Address:Port",
    "tcp   ESTAB        0       0   192.168.1.42:50123   93.184.216.34:https",
    "tcp   ESTAB        0       0   192.168.1.42:50124   142.250.200.99:https",
    "udp   UNCONN       0       0   192.168.1.42:53            *:*",
  ],
};

const MAN_PAGES: Record<string, { synopsis: string; descEs: string; descEn: string }> = {
  ls: { synopsis: "ls [-l] [-a] [-R] [ruta...]", descEs: "Lista el contenido de los directorios. -l muestra detalles (permisos, tamaño, fecha), -a incluye los archivos ocultos que empiezan por punto y -R entra en los subdirectorios.", descEn: "List directory contents. -l shows details (permissions, size, date), -a includes hidden files starting with a dot and -R recurses into subdirectories." },
  cd: { synopsis: "cd [ruta]", descEs: "Cambia el directorio actual. cd .. sube un nivel, cd ~ va a tu carpeta personal.", descEn: "Change the current directory. cd .. goes up one level, cd ~ goes to your home folder." },
  cat: { synopsis: "cat ARCHIVO...", descEs: "Muestra el contenido completo de uno o varios archivos.", descEn: "Print the full contents of one or more files." },
  mkdir: { synopsis: "mkdir [-p] DIRECTORIO...", descEs: "Crea directorios. Con -p crea las carpetas intermedias que falten.", descEn: "Create directories. With -p it creates missing parent folders." },
  rm: { synopsis: "rm [-r] [-f] ARCHIVO...", descEs: "Borra archivos. Con -r borra carpetas con todo su contenido. Ojo: en un Linux real no hay papelera.", descEn: "Remove files. With -r it deletes folders recursively. Careful: on a real Linux there is no recycle bin." },
  grep: { synopsis: "grep [-i] [-v] [-n] PATRÓN [ARCHIVO...]", descEs: "Busca líneas que contienen el patrón. Puede filtrar la salida de otro comando con una tubería: ls | grep txt.", descEn: "Search for lines matching the pattern. It can filter another command's output through a pipe: ls | grep txt." },
  chmod: { synopsis: "chmod MODOS ARCHIVO...", descEs: "Cambia los permisos: chmod 755 script.sh o chmod +x script.sh.", descEn: "Change permissions: chmod 755 script.sh or chmod +x script.sh." },
  ssh: { synopsis: "ssh [usuario@]host", descEs: "Abre una sesión remota en otra máquina. Aquí se simula: se abre una pestaña con el disco de la otra máquina.", descEn: "Open a remote session on another machine. Simulated here: it opens a tab with the other machine's disk." },
  history: { synopsis: "history", descEs: "Muestra los comandos ejecutados en esta sesión, del más antiguo al más reciente.", descEn: "Shows the commands run in this session, oldest first." },
  export: { synopsis: "export VARIABLE=valor", descEs: "Define una variable de entorno. Se usa con $VARIABLE, por ejemplo echo $VARIABLE.", descEn: "Defines an environment variable. Use it as $VARIABLE, e.g. echo $VARIABLE." },
  man: { synopsis: "man COMANDO", descEs: "Muestra el manual del comando.", descEn: "Shows the command's manual." },
  find: { synopsis: "find [ruta] [-name PATRÓN] [-type f|d]", descEs: "Busca archivos y carpetas recorriendo el árbol. Ejemplo: find . -name \"*.txt\" encuentra todos los .txt.", descEn: "Find files and folders walking the tree. Example: find . -name \"*.txt\" finds every .txt." },
  ln: { synopsis: "ln [-s] DESTINO [NOMBRE]", descEs: "Crea un enlace. Con -s es un enlace simbólico (como un acceso directo). Sin -s es un enlace duro.", descEn: "Create a link. With -s it is a symbolic link (like a shortcut). Without -s it is a hard link." },
  stat: { synopsis: "stat ARCHIVO", descEs: "Muestra toda la información de un archivo: permisos en octal, tamaño, fechas e inodo.", descEn: "Show full file information: octal permissions, size, dates and inode." },
  du: { synopsis: "du [-h] [-s] [ruta]", descEs: "Muestra el espacio que ocupan las carpetas. -h en formato legible y -s solo el total.", descEn: "Show the space folders take. -h for human-readable and -s for the total only." },
  which: { synopsis: "which PROGRAMA...", descEs: "Indica la ruta del programa que se ejecutaría, buscando en las carpetas del PATH.", descEn: "Show the path of the program that would run, searching the PATH folders." },
  whereis: { synopsis: "whereis PROGRAMA", descEs: "Localiza el binario y el manual de un programa.", descEn: "Locate a program's binary and manual." },
  who: { synopsis: "who", descEs: "Muestra los usuarios conectados al sistema.", descEn: "Show the users logged into the system." },
  last: { synopsis: "last", descEs: "Muestra el historial de inicios de sesión.", descEn: "Show the login history." },
  alias: { synopsis: "alias [nombre='comando']", descEs: "Crea atajos: alias ll='ls -l' hace que ll ejecute ls -l. Sin argumentos lista los alias.", descEn: "Create shortcuts: alias ll='ls -l' makes ll run ls -l. Without arguments it lists aliases." },
  jq: { synopsis: "jq [filtro] [archivo.json]", descEs: "Lee y formatea JSON. Ejemplo: jq .ciudad datos.json o cat datos.json | jq .ciudad.", descEn: "Read and format JSON. Example: jq .city data.json or cat data.json | jq .city." },
  tar: { synopsis: "tar -czf ARCHIVO.tar.gz ORIGEN... | tar -tzf ARCHIVO | tar -xzf ARCHIVO", descEs: "Empaqueta carpetas en un archivo .tar.gz (simulado), lista su contenido (-t) o lo extrae (-x).", descEn: "Pack folders into a .tar.gz file (simulated), list its contents (-t) or extract it (-x)." },
  crontab: { synopsis: "crontab -l | -e", descEs: "Tareas programadas. -l lista las tareas y -e las edita (aquí simulado).", descEn: "Scheduled tasks. -l lists tasks and -e edits them (simulated here)." },
  apt: { synopsis: "apt install PAQUETE... | apt update | apt list --installed | apt search TEXTO", descEs: "Gestor de paquetes de Ubuntu. Aquí hay un catálogo simulado de paquetes.", descEn: "Ubuntu package manager. Here there is a simulated package catalog." },
  date: { synopsis: "date [+FORMATO]", descEs: "Muestra la fecha y la hora. Con +%F muestra solo la fecha (2026-09-11) y +%T solo la hora.", descEn: "Show date and time. +%F shows just the date (2026-09-11) and +%T just the time." },
  uname: { synopsis: "uname [-a] [-r] [-m]", descEs: "Información del sistema: -a todo, -r versión del kernel, -m arquitectura.", descEn: "System information: -a everything, -r kernel version, -m architecture." },
  ps: { synopsis: "ps [aux]", descEs: "Lista los procesos. ps aux muestra todos los procesos con su usuario y consumo.", descEn: "List processes. ps aux shows every process with user and usage." },
  df: { synopsis: "df [-h]", descEs: "Muestra el espacio libre de los discos. -h en formato legible.", descEn: "Show disk free space. -h for human-readable." },
  free: { synopsis: "free", descEs: "Muestra la memoria RAM y la swap usadas y disponibles.", descEn: "Show used and available RAM and swap." },
  ping: { synopsis: "ping [-c VECES] host", descEs: "Comprueba si otro equipo responde. -c limita el número de paquetes.", descEn: "Check whether another host responds. -c limits the number of packets." },
  wget: { synopsis: "wget URL", descEs: "Descarga un archivo de internet (simulado: crea el archivo en el directorio actual).", descEn: "Download a file from the internet (simulated: creates the file in the current directory)." },
  curl: { synopsis: "curl URL", descEs: "Pide una página web y muestra la respuesta (simulado).", descEn: "Request a web page and show the response (simulated)." },
  touch: { synopsis: "touch ARCHIVO...", descEs: "Crea archivos vacíos o actualiza su fecha.", descEn: "Create empty files or update their date." },
  cp: { synopsis: "cp [-r] ORIGEN DESTINO", descEs: "Copia archivos. Con -r copia carpetas enteras.", descEn: "Copy files. With -r it copies whole folders." },
  mv: { synopsis: "mv ORIGEN DESTINO", descEs: "Mueve o renombra archivos y carpetas.", descEn: "Move or rename files and folders." },
  head: { synopsis: "head [-n N] ARCHIVO", descEs: "Muestra las primeras N líneas (10 por defecto).", descEn: "Show the first N lines (10 by default)." },
  tail: { synopsis: "tail [-n N] ARCHIVO", descEs: "Muestra las últimas N líneas (10 por defecto).", descEn: "Show the last N lines (10 by default)." },
  wc: { synopsis: "wc [-l] ARCHIVO", descEs: "Cuenta líneas, palabras y caracteres. -l solo líneas.", descEn: "Count lines, words and characters. -l only lines." },
  tree: { synopsis: "tree [ruta]", descEs: "Dibuja el árbol de carpetas y archivos.", descEn: "Draw the folder and file tree." },
};

function timestamp(): string {
  const d = new Date();
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function longDate(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.000000000 +0200`;
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

function permsToOctal(perms: string): string {
  const body = perms.slice(1);
  let out = "";
  for (let i = 0; i < 3; i++) {
    const trio = body.slice(i * 3, i * 3 + 3);
    const bits = (trio.includes("r") ? 4 : 0) + (trio.includes("w") ? 2 : 0) + (trio.includes("x") ? 1 : 0);
    out += String(bits);
  }
  return out;
}

function applySymbolic(current: string, spec: string): string | null {
  const m = spec.match(/^([ugoa]*)([+\-=])([rwx]+)$/);
  if (!m) return null;
  const cats = m[1].length > 0 ? m[1] : "a";
  const op = m[2];
  const letters = m[3];
  const chars = current.split("");
  const ranges: Record<string, [number, number]> = { u: [0, 2], g: [3, 5], o: [6, 8] };
  const targets: number[] = [];
  for (const c of cats === "a" ? "ugo" : cats) {
    const r = ranges[c];
    if (!r) continue;
    for (let i = r[0]; i <= r[1]; i++) targets.push(i);
  }
  for (const i of targets) {
    const letter = ["r", "w", "x"][i % 3];
    const inLetters = letters.includes(letter);
    if (op === "+") {
      if (inLetters) chars[i] = letter;
    } else if (op === "-") {
      if (inLetters) chars[i] = "-";
    } else {
      chars[i] = inLetters ? letter : "-";
    }
  }
  return chars.join("");
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
  const recursive = flags.includes("R");
  const target = paths.length > 0 ? resolvePath(cwd, paths[0]).value : cwd;
  const node = getNode(state, target);
  if (!node) {
    return { lines: [`ls: ${isEs ? "no se puede acceder a" : "cannot access"} '${paths[0]}': ${isEs ? "No existe el archivo o el directorio" : "No such file or directory"}`], state, cwd, clear: false, exit: false, error: true };
  }
  if (node.kind !== "dir") {
    return { lines: [paths[0]], state, cwd, clear: false, exit: false };
  }
  const renderDir = (dirPath: string[]): string[] => {
    const res = listDir(state, dirPath);
    const entries = res.ok ? res.value : [];
    const visible = all ? entries : entries.filter((e) => !e.name.startsWith("."));
    if (long) {
      const out: string[] = [`total ${visible.length}`];
      for (const e of visible) {
        const node2 = getNode(state, [...dirPath, e.name]);
        const size = e.kind === "file" ? (node2?.content ?? "").length : 4096;
        const perms = e.perms ?? (e.kind === "dir" ? DEFAULT_PERMS.dir : DEFAULT_PERMS.file);
        out.push(`${perms} 1 alumno alumno ${String(size).padStart(8)} ${timestamp()} ${e.name}${e.link ? ` -> ${e.link}` : ""}`);
      }
      return out;
    }
    if (piped) return visible.map((e) => e.name);
    return [visible.map((e) => e.name).join("  ")];
  };
  if (recursive) {
    const out: string[] = [];
    const walk = (dirPath: string[]) => {
      out.push("", `${pathToString(dirPath)}:`, ...renderDir(dirPath));
      const res = listDir(state, dirPath);
      const entries = res.ok ? res.value : [];
      for (const e of entries) {
        if (e.kind === "dir" && (all || !e.name.startsWith("."))) walk([...dirPath, e.name]);
      }
    };
    walk(target);
    return { lines: out, state, cwd, clear: false, exit: false };
  }
  return { lines: renderDir(target), state, cwd, clear: false, exit: false };
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

function jqFormat(value: unknown): string[] {
  if (typeof value === "string") return [`"${value}"`];
  if (value === null || typeof value !== "object") return [String(value)];
  return JSON.stringify(value, null, 2).split("\n");
}

function jqEval(value: unknown, filter: string): { ok: true; value: unknown } | { ok: false } {
  const parts = filter.replace(/^\./, "").split(".").filter((p) => p.length > 0);
  let current = value;
  for (const part of parts) {
    const m = part.match(/^([A-Za-z0-9_$-]*)(?:\[(\d+)\])?$/);
    if (!m) return { ok: false };
    if (m[1].length > 0) {
      if (typeof current !== "object" || current === null || Array.isArray(current)) return { ok: false };
      const obj = current as Record<string, unknown>;
      if (!(m[1] in obj)) return { ok: false };
      current = obj[m[1]];
    }
    if (m[2] !== undefined) {
      const idx = Number(m[2]);
      if (!Array.isArray(current) || idx >= current.length) return { ok: false };
      current = current[idx];
    }
  }
  return { ok: true, value: current };
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
    const sorted = [...stdin].sort();
    return { lines: flags.includes("r") ? sorted.reverse() : sorted };
  }
  if (cmdName === "uniq") {
    const out: string[] = [];
    for (const l of stdin) {
      if (out.length === 0 || out[out.length - 1] !== l) out.push(l);
    }
    return { lines: out };
  }
  if (cmdName === "jq") {
    const filter = rest[0] ?? ".";
    try {
      const parsed = JSON.parse(stdin.join("\n"));
      const evaluated = jqEval(parsed, filter);
      if (!evaluated.ok) return { lines: [], error: `jq: error: no se puede aplicar el filtro '${filter}'` };
      return { lines: jqFormat(evaluated.value) };
    } catch {
      return { lines: [], error: "jq: error: no se pudo analizar el JSON" };
    }
  }
  return { lines: [], error: isEs ? `bash: ${cmdName}: no se admite en una tubería` : `bash: ${cmdName}: not supported in a pipe` };
}

function collectEntries(node: FsNode, prefix: string, out: { path: string; kind: string; content?: string; perms?: string }[]): void {
  if (node.kind === "file") {
    out.push({ path: prefix, kind: "file", content: node.content ?? "", perms: node.perms });
    return;
  }
  out.push({ path: prefix, kind: "dir", perms: node.perms });
  for (const child of Object.values(node.children ?? {})) {
    collectEntries(child, `${prefix}/${child.name}`, out);
  }
}

function duLines(node: FsNode, path: string[], human: boolean): { lines: string[]; bytes: number } {
  let bytes = 4096;
  const lines: string[] = [];
  for (const child of Object.values(node.children ?? {})) {
    if (child.kind === "dir") {
      const sub = duLines(child, [...path, child.name], human);
      bytes += sub.bytes;
      lines.push(...sub.lines);
    } else {
      bytes += (child.content ?? "").length;
    }
  }
  const humanSize = (b: number) => (b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)}M` : `${Math.ceil(b / 1024)}K`);
  const size = human ? humanSize(bytes) : String(Math.ceil(bytes / 1024));
  lines.push(`${size}\t${pathToString(path)}`);
  return { lines, bytes };
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

  const aliasValue = env[`ALIAS.${cmd}`] ?? BUILTIN_ALIASES[cmd];
  if (aliasValue) {
    const expanded = expandVars(aliasValue, env).split(/\s+/).filter((t) => t.length > 0);
    if (expanded.length > 0 && expanded[0] !== cmd) {
      return executeLine(state, cwd, [...expanded, ...args].join(" "), { ...opts, env });
    }
  }

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
            "  NAVEGAR   ls [-l] [-a] [-R], cd, pwd, tree",
            "  ARCHIVOS  cat, touch, mkdir [-p], rm [-r], cp [-r], mv, ln [-s], find",
            "  VER       head/tail -n N, wc [-l], sort, uniq, less, stat, du [-h]",
            "  BUSCAR    grep [-i] [-v] [-n], which, whereis, find -name",
            "  TEXTO     echo texto [> | >> archivo], cat, jq",
            "  ENTORNO   export VAR=valor, env, alias, history",
            "  PERMISOS  chmod 755 archivo, chmod +x script.sh",
            "  PAQUETES  apt install/update/list/search, tar -czf/-tzf/-xzf",
            "  SISTEMA   whoami, hostname [-I], uname [-a], ps [aux], df [-h], free, date [+%F], uptime, who, last, crontab -l",
            "  RED       ping [-c N], traceroute, ip addr, ifconfig, ss, ssh user@host, scp",
            "  WEB       curl url, wget url",
            "  SESIÓN    wall mensaje, sudo comando, man comando, nano/vim, clear, exit",
            "",
          ]
        : [
            "",
            "Available commands (man command for the manual):",
            "  NAVIGATE  ls [-l] [-a] [-R], cd, pwd, tree",
            "  FILES     cat, touch, mkdir [-p], rm [-r], cp [-r], mv, ln [-s], find",
            "  VIEW      head/tail -n N, wc [-l], sort, uniq, less, stat, du [-h]",
            "  SEARCH    grep [-i] [-v] [-n], which, whereis, find -name",
            "  TEXT      echo text [> | >> file], cat, jq",
            "  ENV       export VAR=value, env, alias, history",
            "  PERMS     chmod 755 file, chmod +x script.sh",
            "  PACKAGES  apt install/update/list/search, tar -czf/-tzf/-xzf",
            "  SYSTEM    whoami, hostname [-I], uname [-a], ps [aux], df [-h], free, date [+%F], uptime, who, last, crontab -l",
            "  NETWORK   ping [-c N], traceroute, ip addr, ifconfig, ss, ssh user@host, scp",
            "  WEB       curl url, wget url",
            "  SESSION   wall message, sudo command, man command, nano/vim, clear, exit",
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
        return { lines: [`bash: cd: ${args[0]}: ${isEs ? "No existe el archivo o el directorio" : "No such file or directory"}`], state, cwd, clear: false, exit: false, error: true };
      }
      if (node.kind !== "dir") {
        return { lines: [`bash: cd: ${args[0]}: ${isEs ? "No es un directorio" : "Not a directory"}`], state, cwd, clear: false, exit: false, error: true };
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
          return { lines: [`cat: ${a}: ${isEs ? "No existe el archivo o el directorio" : "No such file or directory"}`], state, cwd, clear: false, exit: false, error: true };
        }
        if (res.value.length > 0) lines.push(...contentLines(res.value));
      }
      return ok(state, cwd, lines);
    }

    case "less":
    case "more": {
      if (args.length === 0) return err(state, cwd, [], isEs, "invalidPath");
      const res = readFile(state, resolvePath(cwd, args[0]).value);
      if (!res.ok) {
        return { lines: [`${cmd}: ${args[0]}: ${isEs ? "No existe el archivo o el directorio" : "No such file or directory"}`], state, cwd, clear: false, exit: false, error: true };
      }
      const lines = contentLines(res.value);
      if (lines.length > 20) {
        lines.push(isEs
          ? `-- Más -- (simulado: ${cmd} muestra el contenido completo de una vez)`
          : `-- More -- (simulated: ${cmd} shows the full content at once)`);
      }
      return ok(state, cwd, lines);
    }

    case "touch": {
      if (args.length === 0) return err(state, cwd, [], isEs, "invalidPath");
      let st = state;
      for (const a of args) {
        if (getNodeRaw(st, resolvePath(cwd, a).value)) continue;
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
      for (const rawTarget of targets) {
        const raw = rawTarget.replace(/\/+$/, "") || rawTarget;
        const parentPart = raw.includes("/") ? raw.slice(0, raw.lastIndexOf("/") + 1) : "";
        const pattern = raw.slice(raw.lastIndexOf("/") + 1) || raw;
        const parentPath = resolvePath(cwd, parentPart).value;
        const node = getNode(st, parentPath);
        if (!node || node.kind !== "dir") return err(st, cwd, [], isEs, "notFound");
        const matches = Object.values(node.children ?? {})
          .filter((c) => matchWildcard(c.name, pattern))
          .map((c) => c.name);
        if (matches.length === 0 && !pattern.includes("*")) {
          return { lines: [`rm: ${isEs ? "no se puede borrar" : "cannot remove"} '${rawTarget}': ${isEs ? "No existe el archivo o el directorio" : "No such file or directory"}`], state: st, cwd, clear: false, exit: false, error: true };
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

    case "ln": {
      const symbolic = args.some((a) => a.startsWith("-") && a.slice(1).includes("s"));
      const names = args.filter((a) => !a.startsWith("-"));
      if (names.length === 0) return err(state, cwd, [], isEs, "invalidPath");
      const targetRaw = names[0];
      const targetPath = resolvePath(cwd, targetRaw).value;
      if (!getNodeRaw(state, targetPath)) {
        return { lines: [`ln: ${isEs ? "fallo al crear el enlace" : "failed to create link"} '${targetRaw}': ${isEs ? "No existe el archivo o el directorio" : "No such file or directory"}`], state, cwd, clear: false, exit: false, error: true };
      }
      const linkName = names[1] ?? targetRaw.replace(/\/+$/, "").split("/").pop() ?? "";
      const linkPath = resolvePath(cwd, linkName).value;
      if (getNodeRaw(state, linkPath)) {
        return { lines: [`ln: ${isEs ? "no se puede crear el enlace" : "cannot create link"} '${linkName}': ${isEs ? "El archivo ya existe" : "File exists"}`], state, cwd, clear: false, exit: false, error: true };
      }
      if (symbolic) {
        const res = createLink(state, linkPath, targetPath);
        if (!res.ok) return err(state, cwd, [], isEs, res.error);
        return ok(res.value, cwd, []);
      }
      const res = copyPath(state, targetPath, linkPath);
      if (!res.ok) return err(state, cwd, [], isEs, res.error);
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
          return { lines: [`grep: ${fileRaw}: ${isEs ? "No existe el archivo o el directorio" : "No such file or directory"}`], state, cwd, clear: false, exit: false, error: true };
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
        if (args.some((a) => a.startsWith("-") && a.slice(1).includes("r"))) fileLines.reverse();
      } else {
        const out: string[] = [];
        for (const l of fileLines) {
          if (out.length === 0 || out[out.length - 1] !== l) out.push(l);
        }
        fileLines = out;
      }
      return ok(state, cwd, fileLines);
    }

    case "jq": {
      const rest = args.filter((a) => !a.startsWith("-"));
      const filter = rest[0] ?? ".";
      const fileArg = rest[1];
      if (!fileArg) {
        return { lines: [isEs ? "jq: se necesita un archivo (o entra por una tubería)" : "jq: a file is required (or pipe input)"], state, cwd, clear: false, exit: false, error: true };
      }
      const res = readFile(state, resolvePath(cwd, fileArg).value);
      if (!res.ok) {
        return { lines: [`jq: ${isEs ? "no se puede abrir" : "cannot open"} ${fileArg}`], state, cwd, clear: false, exit: false, error: true };
      }
      try {
        const parsed = JSON.parse(res.value);
        const evaluated = jqEval(parsed, filter);
        if (!evaluated.ok) return { lines: [`jq: error: no se puede aplicar el filtro '${filter}'`], state, cwd, clear: false, exit: false, error: true };
        return ok(state, cwd, jqFormat(evaluated.value));
      } catch {
        return { lines: ["jq: error: no se pudo analizar el JSON"], state, cwd, clear: false, exit: false, error: true };
      }
    }

    case "chmod": {
      const modeArg = args.find((a) => /^[0-7]{3,4}$/.test(a) || /^[ugoa]*[+\-=][rwx]+$/.test(a));
      const targets = args.filter((a) => a !== modeArg);
      if (!modeArg || targets.length === 0) return { lines: [isEs ? "uso: chmod <modo octal|+x> <archivo...>" : "usage: chmod <octal mode|+x> <file...>"], state, cwd, clear: false, exit: false, error: true };
      let st = state;
      for (const t of targets) {
        const targetPath = resolvePath(cwd, t).value;
        const node = getNodeRaw(st, targetPath);
        if (!node) return err(st, cwd, [], isEs, "notFound");
        let newBody: string | null = null;
        if (/^[0-7]{3,4}$/.test(modeArg)) {
          newBody = permString(modeArg);
        } else {
          const current = node.perms ?? (node.kind === "dir" ? DEFAULT_PERMS.dir : DEFAULT_PERMS.file);
          newBody = applySymbolic(current.slice(1), modeArg);
        }
        if (!newBody) return err(st, cwd, [], isEs, "invalidPath");
        const res = chmod(st, targetPath, newBody);
        if (!res.ok) return err(st, cwd, [], isEs, res.error);
        st = res.value;
      }
      return ok(st, cwd, []);
    }

    case "tree": {
      const target = args.find((a) => !a.startsWith("-")) ? resolvePath(cwd, args.find((a) => !a.startsWith("-"))!).value : cwd;
      const node = getNode(state, target);
      if (!node) return err(state, cwd, [], isEs, "notFound");
      if (node.kind !== "dir") return err(state, cwd, [], isEs, "notADir");
      const counts = countTree(node);
      return ok(state, cwd, [pathToString(target), ...renderTree(node), "", isEs
        ? `${counts.dirs} directorios, ${counts.files} archivos`
        : `${counts.dirs} directories, ${counts.files} files`]);
    }

    case "find": {
      let startRaw = ".";
      let namePattern: string | undefined;
      let typeFilter: string | undefined;
      const clean: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "-name" && args[i + 1]) { namePattern = args[i + 1].replace(/^["']|["']$/g, ""); i++; }
        else if (args[i] === "-type" && args[i + 1]) { typeFilter = args[i + 1]; i++; }
        else clean.push(args[i]);
      }
      if (clean.length > 0) startRaw = clean[0];
      const startPath = resolvePath(cwd, startRaw).value;
      const startNode = getNode(state, startPath);
      if (!startNode) {
        return { lines: [`find: '${startRaw}': ${isEs ? "No existe el archivo o el directorio" : "No such file or directory"}`], state, cwd, clear: false, exit: false, error: true };
      }
      const prefix = startRaw === "." ? "." : startRaw.replace(/\/+$/, "");
      const out: string[] = [];
      const matches = (n: FsNode) => (namePattern ? matchWildcard(n.name, namePattern) : true) && (typeFilter ? (typeFilter === "d" ? n.kind === "dir" : n.kind === "file") : true);
      const walk = (n: FsNode, display: string) => {
        if (matches(n)) out.push(display);
        if (n.kind === "dir") {
          for (const child of Object.values(n.children ?? {})) walk(child, `${display}/${child.name}`);
        }
      };
      walk(startNode, prefix);
      return ok(state, cwd, out);
    }

    case "stat": {
      const targetRaw = args.find((a) => !a.startsWith("-"));
      if (!targetRaw) return err(state, cwd, [], isEs, "invalidPath");
      const targetPath = resolvePath(cwd, targetRaw).value;
      const node = getNode(state, targetPath);
      if (!node) return err(state, cwd, [], isEs, "notFound");
      const perms = node.perms ?? (node.kind === "dir" ? DEFAULT_PERMS.dir : DEFAULT_PERMS.file);
      const octal = permsToOctal(perms);
      const size = node.kind === "file" ? (node.content ?? "").length : 4096;
      const kindLabel = isEs
        ? (node.kind === "dir" ? "directorio" : "fichero regular")
        : (node.kind === "dir" ? "directory" : "regular file");
      return ok(state, cwd, isEs
        ? [
            `  Fichero: ${pathToString(targetPath)}`,
            `   Tamaño: ${size}      	Bloques: 8          Bloque E/S: 4096   ${kindLabel}`,
            `Dispositivo: 801h/2049d	Inodo: 131074       Enlaces: 1`,
            `Acceso: (0${octal}/${perms})  Uid: (1000/  alumno)   Gid: (1000/  alumno)`,
            `Acceso: ${longDate()}`,
            `Modificación: ${longDate()}`,
            `Cambio: ${longDate()}`,
          ]
        : [
            `  File: ${pathToString(targetPath)}`,
            `  Size: ${size}      	Blocks: 8          IO Block: 4096   ${kindLabel}`,
            `Device: 801h/2049d	Inode: 131074       Links: 1`,
            `Access: (0${octal}/${perms})  Uid: (1000/  alumno)   Gid: (1000/  alumno)`,
            `Access: ${longDate()}`,
            `Modify: ${longDate()}`,
            `Change: ${longDate()}`,
          ]);
    }

    case "du": {
      const human = args.some((a) => a.startsWith("-") && a.slice(1).includes("h"));
      const summary = args.some((a) => a.startsWith("-") && a.slice(1).includes("s"));
      const pathArg = args.find((a) => !a.startsWith("-"));
      const targetPath = pathArg ? resolvePath(cwd, pathArg).value : cwd;
      const node = getNode(state, targetPath);
      if (!node) return err(state, cwd, [], isEs, "notFound");
      if (node.kind === "file") {
        const kb = Math.ceil((node.content ?? "").length / 1024) || 4;
        return ok(state, cwd, [`${human ? `${kb}K` : String(kb)}\t${pathArg ?? pathToString(targetPath)}`]);
      }
      const result = duLines(node, targetPath, human);
      if (summary) return ok(state, cwd, [result.lines[result.lines.length - 1]]);
      return ok(state, cwd, result.lines);
    }

    case "which": {
      const names = args.filter((a) => !a.startsWith("-"));
      if (names.length === 0) return err(state, cwd, [], isEs, "invalidPath");
      const pathDirs = (env.PATH ?? FALLBACK_PATH).split(":");
      const out: string[] = [];
      for (const name of names) {
        for (const dir of pathDirs) {
          const dirPath = resolvePath([], dir).value;
          const node = getNode(state, [...dirPath, name]);
          if (node && node.kind === "file") {
            out.push(pathToString([...dirPath, name]));
            break;
          }
        }
      }
      if (out.length === 0) return { lines: [], state, cwd, clear: false, exit: false, error: true };
      return ok(state, cwd, out);
    }

    case "whereis": {
      const name = args.find((a) => !a.startsWith("-"));
      if (!name) return err(state, cwd, [], isEs, "invalidPath");
      const node = getNode(state, ["usr", "bin", name]);
      const line = node && node.kind === "file" ? `${name}: /usr/bin/${name}` : `${name}:`;
      return ok(state, cwd, [line]);
    }

    case "who":
      return ok(state, cwd, [`alumno   pts/0        ${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")} 08:15 (:0)`]);

    case "last":
      return ok(state, cwd, isEs
        ? [
            "alumno   pts/0        :0               vie sep 11 08:15   aún conectado",
            "alumno   tty1                          vie sep 11 08:00 - 08:14  (00:14)",
            "reboot   system boot  6.8.0-simulado   vie sep 11 07:59   aún ejecutándose",
            "",
            "wtmp comienza vie sep 11 07:59:01 2026",
          ]
        : [
            "alumno   pts/0        :0               Fri Sep 11 08:15   still logged in",
            "alumno   tty1                          Fri Sep 11 08:00 - 08:14  (00:14)",
            "reboot   system boot  6.8.0-simulado   Fri Sep 11 07:59   still running",
            "",
            "wtmp begins Fri Sep 11 07:59:01 2026",
          ]);

    case "alias": {
      const defaults = "alias ll='ls -l'\nalias la='ls -a'\nalias cls='clear'";
      if (args.length === 0 || args[0] === "-p") {
        const stored = Object.keys(env).filter((k) => k.startsWith("ALIAS.")).sort().map((k) => `alias ${k.slice(6)}='${env[k]}'`);
        return ok(state, cwd, [...defaults.split("\n"), ...stored]);
      }
      const joined = args.join(" ");
      const eq = joined.indexOf("=");
      if (eq <= 0) {
        return { lines: [isEs ? "uso: alias nombre='comando'" : "usage: alias name='command'"], state, cwd, clear: false, exit: false, error: true };
      }
      const name = joined.slice(0, eq).trim().replace(/^alias\s+/, "");
      const value = joined.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      env[`ALIAS.${name}`] = value;
      return { lines: [], state, cwd, clear: false, exit: false, env };
    }

    case "unalias": {
      const name = args[0];
      if (!name) return err(state, cwd, [], isEs, "invalidPath");
      const key = Object.keys(env).find((k) => k === `ALIAS.${name}`);
      if (key) delete env[key];
      return { lines: [], state, cwd, clear: false, exit: false, env };
    }

    case "tar": {
      const flagArg = args.find((a) => a.startsWith("-") && /[cxt]/.test(a));
      const operands = args.filter((a) => !a.startsWith("-") || a === flagArg);
      const archive = operands[1];
      const sources = operands.slice(2);
      if (!flagArg || !archive) {
        return { lines: [isEs ? "uso: tar -czf archivo.tar.gz origen... | tar -tzf archivo | tar -xzf archivo" : "usage: tar -czf file.tar.gz source... | tar -tzf file | tar -xzf file"], state, cwd, clear: false, exit: false, error: true };
      }
      const archivePath = resolvePath(cwd, archive).value;
      if (flagArg.includes("c")) {
        if (sources.length === 0) return err(state, cwd, [], isEs, "invalidPath");
        const entries: { path: string; kind: string; content?: string; perms?: string }[] = [];
        for (const src of sources) {
          const srcPath = resolvePath(cwd, src).value;
          const node = getNode(state, srcPath);
          if (!node) return err(state, cwd, [], isEs, "notFound");
          collectEntries(node, src.replace(/\/+$/, ""), entries);
        }
        const res = writeFile(state, archivePath, JSON.stringify({ entries }));
        if (!res.ok) return err(state, cwd, [], isEs, res.error);
        return ok(res.value, cwd, []);
      }
      const read = readFile(state, archivePath);
      if (!read.ok) {
        return { lines: [`tar: ${archive}: ${isEs ? "No se puede abrir" : "Cannot open"}: ${isEs ? "No existe el archivo o el directorio" : "No such file or directory"}`], state, cwd, clear: false, exit: false, error: true };
      }
      let parsed: { entries: { path: string; kind: string; content?: string; perms?: string }[] };
      try {
        parsed = JSON.parse(read.value);
      } catch {
        return { lines: [`tar: ${archive}: ${isEs ? "no es un archivo comprimido válido" : "not a valid archive"}`], state, cwd, clear: false, exit: false, error: true };
      }
      if (flagArg.includes("t")) {
        return ok(state, cwd, parsed.entries.map((e) => e.path));
      }
      let st = state;
      for (const entry of parsed.entries) {
        const entryPath = resolvePath(cwd, entry.path).value;
        if (entry.kind === "dir") {
          const res = mkdirP(st, entryPath);
          if (res.ok) st = res.value;
        } else {
          const res = writeFile(st, entryPath, entry.content ?? "");
          if (res.ok) st = res.value;
        }
      }
      return ok(st, cwd, []);
    }

    case "export": {
      const joined = args.join(" ");
      const eq = joined.indexOf("=");
      if (eq <= 0) {
        return { lines: [isEs ? "uso: export VARIABLE=valor" : "usage: export VARIABLE=value"], state, cwd, clear: false, exit: false, error: true };
      }
      const name = joined.slice(0, eq).trim();
      const value = stripQuotes(expandVars(joined.slice(eq + 1).trim(), env));
      env[name] = value;
      return { lines: [], state, cwd, clear: false, exit: false, env };
    }

    case "env": {
      const rows = Object.keys(env).filter((k) => !k.startsWith("ALIAS.")).sort().map((k) => `${k}=${env[k]}`);
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

    case "hostname": {
      if (args.some((a) => a.toUpperCase().includes("I"))) return ok(state, cwd, ["192.168.1.42"]);
      return ok(state, cwd, [env.HOSTNAME ?? "pc-aula"]);
    }

    case "uname": {
      const flags = args.filter((a) => a.startsWith("-")).flatMap((a) => a.slice(1).split(""));
      if (flags.includes("a")) return ok(state, cwd, [FAKES.unameFull]);
      const parts: string[] = [];
      if (flags.length === 0) parts.push("Linux");
      else {
        if (flags.includes("s")) parts.push("Linux");
        if (flags.includes("r")) parts.push("6.8.0-simulado");
        if (flags.includes("m")) parts.push("x86_64");
        if (flags.includes("o")) parts.push("GNU/Linux");
        if (flags.includes("n")) parts.push(env.HOSTNAME ?? "pc-aula");
        if (parts.length === 0) parts.push("Linux");
      }
      return ok(state, cwd, [parts.join(" ")]);
    }

    case "ps":
      return ok(state, cwd, args.some((a) => a.includes("a")) ? (isEs ? FAKES.psAuxEs : FAKES.psAuxEn) : FAKES.ps);

    case "df":
      return ok(state, cwd, isEs ? FAKES.dfEs : FAKES.dfEn);

    case "free":
      return ok(state, cwd, isEs ? FAKES.freeEs : FAKES.freeEn);

    case "ifconfig":
      return ok(state, cwd, FAKES.ifconfig);

    case "ip": {
      const sub = args[0];
      if (sub === "route" || sub === "r") {
        return ok(state, cwd, [
          "default via 192.168.1.1 dev eth0 proto dhcp src 192.168.1.42 metric 100",
          "192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.42 metric 100",
        ]);
      }
      if (sub === "addr" || sub === "a" || sub === undefined) return ok(state, cwd, FAKES.ipAddr);
      return { lines: [isEs ? "uso: ip addr | ip route" : "usage: ip addr | ip route"], state, cwd, clear: false, exit: false, error: true };
    }

    case "ss":
    case "netstat":
      return ok(state, cwd, FAKES.ss);

    case "ping": {
      let count = 3;
      let host: string | undefined;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "-c" && args[i + 1]) {
          const n = Number(args[i + 1]);
          if (Number.isFinite(n)) count = Math.min(10, Math.max(1, Math.floor(n)));
          i++;
        } else if (!a.startsWith("-") && !host) {
          host = a;
        }
      }
      if (!host) return err(state, cwd, [], isEs, "invalidPath");
      const target = resolveHost(host);
      if (!target) {
        return { lines: [`ping: ${host}: ${isEs ? "Nombre o servicio desconocido" : "Name or service not known"}`], state, cwd, clear: false, exit: false, error: true };
      }
      const seed = host.toLowerCase().split("").reduce((a, c) => a + c.charCodeAt(0), 0);
      const base = target.local ? 0 : 20 + (seed % 8);
      const replies: string[] = [];
      for (let i = 0; i < count; i++) {
        const ms = target.local ? "0.03" : (base + (i % 3) + 0.2).toFixed(1);
        replies.push(isEs
          ? `64 bytes desde ${target.ip}: icmp_seq=${i + 1} ttl=${target.local ? 64 : 57} tiempo=${ms} ms`
          : `64 bytes from ${target.ip}: icmp_seq=${i + 1} ttl=${target.local ? 64 : 57} time=${ms} ms`);
      }
      return ok(state, cwd, isEs
        ? [
            `PING ${host} (${target.ip}) 56(84) bytes de datos.`,
            ...replies,
            "",
            `--- estadísticas de ping de ${host} ---`,
            `${count} paquetes transmitidos, ${count} recibidos, 0% perdidos`,
            "(simulado: pulse Ctrl+C para detener en un Linux real)",
          ]
        : [
            `PING ${host} (${target.ip}) 56(84) bytes of data.`,
            ...replies,
            "",
            `--- ${host} ping statistics ---`,
            `${count} packets transmitted, ${count} received, 0% packet loss`,
            "(simulated: press Ctrl+C to stop on a real Linux)",
          ]);
    }

    case "traceroute": {
      const host = args.find((a) => !a.startsWith("-"));
      if (!host) return err(state, cwd, [], isEs, "invalidPath");
      const target = resolveHost(host);
      if (!target) {
        return { lines: [`traceroute: ${host}: ${isEs ? "Nombre o servicio desconocido" : "Name or service not known"}`], state, cwd, clear: false, exit: false, error: true };
      }
      return ok(state, cwd, [
        `traceroute hacia ${host} (${target.ip}), 30 saltos máximo`,
        "  1  router.miguelacm.local (192.168.1.1)  2.1 ms  1.9 ms  2.0 ms",
        "  2  10.10.0.1 (10.10.0.1)  11.2 ms  10.8 ms  12.1 ms",
        "  3  80.58.32.1 (80.58.32.1)  19.5 ms  20.2 ms  18.9 ms",
        `  4  ${target.ip} (${target.ip})  24.3 ms  23.9 ms  24.8 ms`,
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
        const requested = args.slice(1).filter((a) => !a.startsWith("-"));
        const unknown = requested.filter((p) => !PACKAGES.includes(p));
        if (unknown.length > 0) {
          return { lines: unknown.map((p) => `E: ${isEs ? "No se ha podido localizar el paquete" : "Unable to locate package"} ${p}`), state, cwd, clear: false, exit: false, error: true };
        }
        return ok(state, cwd, isEs
          ? [
              "Leyendo lista de paquetes... (simulado)",
              `Se instalarán los siguientes paquetes NUEVOS: ${requested.join(" ")}`,
              ...requested.map((p) => `Desempaquetando ${p} ... Configurando ${p} ... hecho.`),
            ]
          : [
              "Reading package lists... (simulated)",
              `The following NEW packages will be installed: ${requested.join(" ")}`,
              ...requested.map((p) => `Unpacking ${p} ... Setting up ${p} ... done.`),
            ]);
      }
      if (sub === "update") {
        return ok(state, cwd, [isEs ? "Obj y listas actualizadas (simulado)." : "Package lists updated (simulated)."]);
      }
      if (sub === "list" && args.includes("--installed")) {
        return ok(state, cwd, [
          `${isEs ? "Listado de paquetes instalados" : "Listing installed packages"}...`,
          ...PREINSTALLED.map((p) => `${p}/now amd64 [${isEs ? "instalado" : "installed"}]`),
        ]);
      }
      if (sub === "search" && args[1]) {
        const term = args[1].toLowerCase();
        const hits = PACKAGES.filter((p) => p.includes(term));
        if (hits.length === 0) return ok(state, cwd, [isEs ? `Sin resultados para '${args[1]}'.` : `No results for '${args[1]}'.`]);
        return ok(state, cwd, hits.map((p) => `${p}/noble  amd64  ${isEs ? "paquete simulado del catálogo" : "simulated catalog package"}`));
      }
      if (sub === "remove" && args[1]) {
        return ok(state, cwd, isEs
          ? [`Se eliminará ${args[1]}... hecho (simulado).`]
          : [`${args[1]} will be removed... done (simulated).`]);
      }
      return ok(state, cwd, [isEs ? "uso: apt install <paquete> | apt update | apt list --installed | apt search <texto> | apt remove <paquete>" : "usage: apt install <package> | apt update | apt list --installed | apt search <text> | apt remove <package>"]);
    }

    case "crontab": {
      if (args[0] === "-l") {
        return ok(state, cwd, isEs
          ? [
              "# Edición de crontab de alumno",
              "*/5 * * * * /usr/bin/date >> /home/alumno/fecha.txt",
              "0 8 * * 1 /usr/bin/apt update",
            ]
          : [
              "# alumno's crontab",
              "*/5 * * * * /usr/bin/date >> /home/alumno/fecha.txt",
              "0 8 * * 1 /usr/bin/apt update",
            ]);
      }
      if (args[0] === "-e") {
        return ok(state, cwd, [isEs ? "crontab -e (simulado): aquí se editarían las tareas programadas." : "crontab -e (simulated): scheduled tasks would be edited here."]);
      }
      return { lines: [isEs ? "uso: crontab -l | crontab -e" : "usage: crontab -l | crontab -e"], state, cwd, clear: false, exit: false, error: true };
    }

    case "lsb_release": {
      if (args.some((a) => a.includes("a"))) {
        return ok(state, cwd, [
          "Distributor ID: Ubuntu",
          "Description:    Ubuntu 24.04 LTS (simulado)",
          "Release:        24.04",
          "Codename:       noble",
        ]);
      }
      return ok(state, cwd, ["Distributor ID: Ubuntu (simulado)"]);
    }

    case "date": {
      const format = args.find((a) => a.startsWith("+"));
      if (format) {
        const d = new Date();
        const p = (x: number) => String(x).padStart(2, "0");
        const out = format.slice(1)
          .replace(/%F/g, `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)
          .replace(/%T/g, `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`)
          .replace(/%Y/g, String(d.getFullYear()))
          .replace(/%m/g, p(d.getMonth() + 1))
          .replace(/%d/g, p(d.getDate()))
          .replace(/%H/g, p(d.getHours()))
          .replace(/%M/g, p(d.getMinutes()))
          .replace(/%S/g, p(d.getSeconds()));
        return ok(state, cwd, [out]);
      }
      return ok(state, cwd, [new Date().toLocaleString(isEs ? "es-ES" : "en-US")]);
    }

    case "uptime":
      return ok(state, cwd, [` ${timestamp()}  activo 2:14,  1 usuario,  carga: 0.15, 0.10, 0.05`]);

    default:
      return { lines: [isEs
        ? `${cmd}: orden no encontrada`
        : `${cmd}: command not found`], state, cwd, clear: false, exit: false, error: true };
  }
}
