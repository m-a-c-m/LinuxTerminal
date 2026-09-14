"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { MdFullscreen, MdFullscreenExit, MdClose } from "react-icons/md";
import {
  executeLine,
  promptString,
  HOME,
  DEFAULT_HOME_ENV,
  type BashOptions,
} from "@/lib/bashCmd";
import {
  createInitialFs,
  createRemoteFs,
  getNode,
  dirExists,
  fileExists,
  pathToString,
  displayPath,
  USER_HOME,
  type FsState,
} from "@/lib/linuxFs";
import {
  handleKey as rlHandleKey,
  acceptSearch,
  commonPrefix,
  type ReadlineState,
  type ReverseSearch,
  type KeyEvent,
} from "@/lib/readline";

interface Props {
  locale?: string;
}

interface OutputEntry {
  kind: "cmd" | "out" | "ok" | "warn" | "err";
  text: string;
}

interface Session {
  id: number;
  remote: { user: string; host: string } | null;
  fs: FsState | null;
  cwd: string[];
  entries: OutputEntry[];
  input: string;
  cursor: number;
  histIdx: number;
  saved: string;
  search: ReverseSearch | null;
  killRing: string;
  env: Record<string, string>;
  pendingScript: { variable: string; resumeLine: number; source: string } | null;
  ended: boolean;
}

const MAX_BUFFER_LINES = 2000;

function trimBuffer(entries: OutputEntry[]): OutputEntry[] {
  let total = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    total += entries[i].text.split("\n").length + 1;
    if (total > MAX_BUFFER_LINES) return entries.slice(i + 1);
  }
  return entries;
}

type TerminalTheme = "ubuntu" | "verde" | "contraste";

interface ThemeSpec {
  labelEs: string;
  labelEn: string;
  prompt: string;
  remote: string;
  out: string;
  ok: string;
  err: string;
  warn: string;
  listing: string;
  caret: string;
}

const THEMES: Record<TerminalTheme, ThemeSpec> = {
  ubuntu: {
    labelEs: "Ubuntu",
    labelEn: "Ubuntu",
    prompt: "text-green-400",
    remote: "text-purple-300",
    out: "text-white/70",
    ok: "text-green-400",
    err: "text-red-400",
    warn: "text-amber-400",
    listing: "text-sky-300",
    caret: "#4ade80",
  },
  verde: {
    labelEs: "Verde",
    labelEn: "Green",
    prompt: "text-green-400",
    remote: "text-emerald-300",
    out: "text-green-200/80",
    ok: "text-green-400",
    err: "text-red-400",
    warn: "text-yellow-400",
    listing: "text-green-300",
    caret: "#34d399",
  },
  contraste: {
    labelEs: "Alto contraste",
    labelEn: "High contrast",
    prompt: "text-yellow-300",
    remote: "text-cyan-300",
    out: "text-white",
    ok: "text-lime-300",
    err: "text-red-300",
    warn: "text-amber-300",
    listing: "text-cyan-200",
    caret: "#fde047",
  },
};

interface SavedEnv {
  savedAt: string;
  fs: FsState;
  sessions: Session[];
  activeId: number;
  doneLessons: string[];
  cmdHistory: string[];
}

function loadSavedEnvs(key: string): Record<string, SavedEnv> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SavedEnv>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

interface LessonStep {
  es: string;
  en: string;
  hintEs: string;
  hintEn: string;
  done: (state: FsState, cwd: string[], cmdsRun: string[]) => boolean;
}

interface Lesson {
  id: string;
  titleEs: string;
  titleEn: string;
  briefingEs: string;
  briefingEn: string;
  steps: LessonStep[];
}

const LESSONS: Lesson[] = [
  {
    id: "navegar",
    titleEs: "Lección 1 · Navegar por el sistema",
    titleEn: "Lesson 1 · Moving around",
    briefingEs: "En Linux todo es una ruta: PWD te dice dónde estás, LS lista el contenido y CD cambia de carpeta. LS -LA muestra todo con detalles.",
    briefingEn: "In Linux everything is a path: PWD shows where you are, LS lists contents and CD changes folder. LS -LA shows everything in detail.",
    steps: [
      {
        es: "Ejecuta LS para ver qué hay en tu carpeta",
        en: "Run LS to see what is in your folder",
        hintEs: "ls",
        hintEn: "ls",
        done: (_s, _c, cmds) => cmds.includes("ls"),
      },
      {
        es: "Mira también los archivos ocultos con LS -A",
        en: "See hidden files too with LS -A",
        hintEs: "ls -a",
        hintEn: "ls -a",
        done: (_s, _c, cmds) => cmds.includes("ls"),
      },
      {
        es: "Entra en la carpeta Documentos con CD",
        en: "Enter the Documentos (Documents) folder with CD",
        hintEs: "cd Documentos",
        hintEn: "cd Documentos",
        done: (_s, cwd) => cwd.join("/").endsWith("Documentos"),
      },
      {
        es: "Vuelve a tu carpeta con CD ~",
        en: "Return to your folder with CD ~",
        hintEs: "cd ~",
        hintEn: "cd ~",
        done: (_s, cwd) => cwd.join("/") === USER_HOME.join("/"),
      },
    ],
  },
  {
    id: "archivos",
    titleEs: "Lección 2 · Crear y borrar",
    titleEn: "Lesson 2 · Create and delete",
    briefingEs: "TOUCH crea archivos vacíos, ECHO > guarda texto, CAT lo lee, MKDIR -P crea carpetas anidadas y RM -R borra carpetas enteras.",
    briefingEn: "TOUCH creates empty files, ECHO > saves text, CAT reads it, MKDIR -P creates nested folders and RM -R deletes whole folders.",
    steps: [
      {
        es: "Crea un archivo vacío llamado practica.txt",
        en: "Create an empty file called practica.txt",
        hintEs: "touch practica.txt",
        hintEn: "touch practica.txt",
        done: (s) => fileExists(s, [...USER_HOME, "practica.txt"]),
      },
      {
        es: "Escríbele algo con ECHO y redirige con >",
        en: "Write into it with ECHO and redirect with >",
        hintEs: "echo Hola Linux > practica.txt",
        hintEn: "echo Hello Linux > practica.txt",
        done: (s) => (getNode(s, [...USER_HOME, "practica.txt"])?.content ?? "").length > 0,
      },
      {
        es: "Crea carpetas anidadas de golpe: MKDIR -P proyectos/web",
        en: "Create nested folders in one go: MKDIR -P proyectos/web",
        hintEs: "mkdir -p proyectos/web",
        hintEn: "mkdir -p proyectos/web",
        done: (s) => dirExists(s, [...USER_HOME, "proyectos", "web"]),
      },
      {
        es: "Lee el archivo con CAT y bórralo con RM",
        en: "Read the file with CAT and delete it with RM",
        hintEs: "cat practica.txt",
        hintEn: "cat practica.txt",
        done: (s, _c, cmds) => cmds.includes("cat") && cmds.includes("rm") && !fileExists(s, [...USER_HOME, "practica.txt"]),
      },
    ],
  },
  {
    id: "permisos",
    titleEs: "Lección 3 · Permisos",
    titleEn: "Lesson 3 · Permissions",
    briefingEs: "En Linux cada archivo tiene permisos rwx. CHMOD 755 da ejecución a todos; LS -L los muestra. SUDO actúa como administrador.",
    briefingEn: "On Linux every file has rwx permissions. CHMOD 755 gives execute to everyone; LS -L shows them. SUDO acts as administrator.",
    steps: [
      {
        es: "Mira los permisos con LS -L",
        en: "Check permissions with LS -L",
        hintEs: "ls -l",
        hintEn: "ls -l",
        done: (_s, _c, cmds) => cmds.includes("ls"),
      },
      {
        es: "Crea un script y dale permisos: TOUCH run.sh y luego CHMOD 755 run.sh",
        en: "Create a script and give it permissions: TOUCH run.sh then CHMOD 755 run.sh",
        hintEs: "chmod 755 run.sh",
        hintEn: "chmod 755 run.sh",
        done: (s) => getNode(s, [...USER_HOME, "run.sh"])?.perms === "-rwxr-xr-x",
      },
      {
        es: "Ejecuta algo como administrador con SUDO",
        en: "Run something as administrator with SUDO",
        hintEs: "sudo apt update",
        hintEn: "sudo apt update",
        done: (_s, _c, cmds) => cmds.includes("sudo"),
      },
    ],
  },
  {
    id: "red",
    titleEs: "Lección 4 · Red y conexiones",
    titleEn: "Lesson 4 · Network and connections",
    briefingEs: "IFCONFIG muestra tu red, PING comprueba conexión y SSH te conecta a otra máquina: aquí se abre una pestaña nueva con el disco del servidor.",
    briefingEn: "IFCONFIG shows your network, PING tests the connection and SSH connects to another machine: a new tab opens with the server's disk.",
    steps: [
      {
        es: "Consulta tu configuración con IFCONFIG",
        en: "Check your config with IFCONFIG",
        hintEs: "ifconfig",
        hintEn: "ifconfig",
        done: (_s, _c, cmds) => cmds.includes("ifconfig") || cmds.includes("ip"),
      },
      {
        es: "Comprueba la conexión con PING",
        en: "Test the connection with PING",
        hintEs: "ping miguelacm.es",
        hintEn: "ping miguelacm.es",
        done: (_s, _c, cmds) => cmds.includes("ping"),
      },
      {
        es: "Conéctate a un servidor con SSH (ejemplo: ssh invitado@servidor-aula)",
        en: "Connect to a server with SSH (example: ssh guest@class-server)",
        hintEs: "ssh invitado@servidor-aula",
        hintEn: "ssh guest@class-server",
        done: (_s, _c, cmds) => cmds.includes("ssh"),
      },
    ],
  },
  {
    id: "productivo",
    titleEs: "Lección 5 · Buscar y filtrar",
    titleEn: "Lesson 5 · Search and filter",
    briefingEs: "GREP busca texto dentro de archivos, la tubería | encadena comandos, HISTORY recuerda lo que has hecho y EXPORT define variables.",
    briefingEn: "GREP searches text inside files, the pipe | chains commands, HISTORY remembers what you did and EXPORT defines variables.",
    steps: [
      {
        es: "Busca texto en un archivo: GREP crear Documentos/tareas.txt",
        en: "Search text in a file: GREP crear Documentos/tareas.txt",
        hintEs: "grep crear Documentos/tareas.txt",
        hintEn: "grep crear Documentos/tareas.txt",
        done: (_s, _c, cmds) => cmds.includes("grep"),
      },
      {
        es: "Encadena comandos con una tubería: LS | GREP Documentos",
        en: "Chain commands with a pipe: LS | GREP Documentos",
        hintEs: "ls | grep Documentos",
        hintEn: "ls | grep Documentos",
        done: (_s, _c, cmds) => cmds.includes("ls"),
      },
      {
        es: "Define una variable: EXPORT curso=linux y luego ECHO $curso",
        en: "Define a variable: EXPORT curso=linux then ECHO $curso",
        hintEs: "export curso=linux",
        hintEn: "export curso=linux",
        done: (_s, _c, cmds) => cmds.includes("export"),
      },
      {
        es: "Revisa lo que has hecho con HISTORY",
        en: "Review what you did with HISTORY",
        hintEs: "history",
        hintEn: "history",
        done: (_s, _c, cmds) => cmds.includes("history"),
      },
    ],
  },
];

const STORAGE_KEY = "macm-linux-terminal-v1";

const COMMAND_NAMES = [
  "help", "clear", "exit", "cd", "pwd", "ls", "cat", "touch", "mkdir", "rmdir", "rm",
  "cp", "mv", "echo", "grep", "head", "tail", "wc", "sort", "uniq", "chmod", "tree",
  "export", "env", "history", "man", "whoami", "hostname", "uname", "ps", "df", "free",
  "ifconfig", "ip", "ss", "ping", "traceroute", "ssh", "scp", "curl", "wget", "wall",
  "nano", "vim", "apt", "date", "uptime", "sudo",
];

function bannerLines(isEs: boolean): string[] {
  return isEs
    ? [
        "Terminal de práctica bash — todo es simulado, nada toca tu PC real ni ningún servidor.",
        "Escribe help para ver los comandos, o elige una lección guiada para empezar.",
        "Las pestañas comparten el disco; ssh invitado@servidor-aula abre una máquina remota.",
        "",
      ]
    : [
        "bash practice terminal — everything is simulated, nothing touches your PC.",
        "Type help to see the commands, or pick a guided lesson to start.",
        "Tabs share the disk; ssh guest@class-server opens a remote machine.",
        "",
      ];
}

function remoteBanner(isEs: boolean, host: string): string[] {
  return isEs
    ? [
        "",
        `Conectado a ${host}. Esta máquina tiene su propio disco: lo que hagas aquí no afecta a tu equipo local.`,
        "Escribe exit para cerrar la conexión y volver a tu terminal.",
        "",
      ]
    : [
        "",
        `Connected to ${host}. This machine has its own disk: what you do here does not touch your local machine.`,
        "Type exit to close the connection and return to your terminal.",
        "",
      ];
}

export default function LinuxTerminal({ locale }: Props) {
  const isEs = locale === "es";

  const [fs, setFs] = useState<FsState>(createInitialFs);
  const [sessions, setSessions] = useState<Session[]>(() => [
    { id: 1, remote: null, fs: null, cwd: [...USER_HOME], entries: bannerLines(locale === "es").map((t) => ({ kind: "out" as const, text: t })), input: "", cursor: 0, histIdx: -1, saved: "", search: null, killRing: "", pendingScript: null, env: { ...DEFAULT_HOME_ENV }, ended: false },
  ]);
  const [activeId, setActiveId] = useState(1);
  const [unread, setUnread] = useState<Record<number, number>>({});
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [doneLessons, setDoneLessons] = useState<string[]>([]);
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [cmdsRun, setCmdsRun] = useState<string[]>([]);
  const [fontSize, setFontSize] = useState<"base" | "lg" | "xl">("base");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [layout, setLayout] = useState<"single" | "split">("single");
  const [theme, setTheme] = useState<TerminalTheme>("ubuntu");
  const [splitPct, setSplitPct] = useState(50);
  const [isMd, setIsMd] = useState(false);
  const [showEnvs, setShowEnvs] = useState(false);
  const [envName, setEnvName] = useState("");
  const [envMsg, setEnvMsg] = useState("");
  const [savedEnvs, setSavedEnvs] = useState<Record<string, SavedEnv>>({});

  const nextIdRef = useRef(2);
  const windowRef = useRef<HTMLDivElement>(null);
  const splitWrapRef = useRef<HTMLDivElement>(null);
  const outputRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const lastTabRef = useRef<Record<number, string>>({});
  const histRef = useRef<string[]>([]);
  histRef.current = cmdHistory;

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { done?: string[]; history?: string[] };
        if (Array.isArray(parsed.done)) setDoneLessons(parsed.done);
        if (Array.isArray(parsed.history)) setCmdHistory(parsed.history);
      }
      const rawFs = localStorage.getItem(`${STORAGE_KEY}-fs`);
      if (rawFs === "base" || rawFs === "lg" || rawFs === "xl") setFontSize(rawFs);
      const rawLayout = localStorage.getItem(`${STORAGE_KEY}-layout`);
      if (rawLayout === "split") setLayout("split");
      const rawTheme = localStorage.getItem(`${STORAGE_KEY}-theme`);
      if (rawTheme === "ubuntu" || rawTheme === "verde" || rawTheme === "contraste") setTheme(rawTheme);
      const rawSplit = Number(localStorage.getItem(`${STORAGE_KEY}-split`));
      if (Number.isFinite(rawSplit) && rawSplit >= 22 && rawSplit <= 78) setSplitPct(rawSplit);
      setSavedEnvs(loadSavedEnvs(`${STORAGE_KEY}-envs`));
    } catch {}
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => setIsMd(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const persist = useCallback((nextDone: string[], nextHistory: string[]) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ done: nextDone, history: nextHistory })); } catch {}
  }, []);

  const changeFontSize = useCallback((next: "base" | "lg" | "xl") => {
    setFontSize(next);
    try { localStorage.setItem(`${STORAGE_KEY}-fs`, next); } catch {}
  }, []);

  const changeLayout = useCallback((next: "single" | "split") => {
    setLayout(next);
    try { localStorage.setItem(`${STORAGE_KEY}-layout`, next); } catch {}
  }, []);

  const changeTheme = useCallback((next: TerminalTheme) => {
    setTheme(next);
    try { localStorage.setItem(`${STORAGE_KEY}-theme`, next); } catch {}
  }, []);

  const changeSplitPct = useCallback((pct: number) => {
    setSplitPct(pct);
    try { localStorage.setItem(`${STORAGE_KEY}-split`, String(pct)); } catch {}
  }, []);

  const startDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = splitWrapRef.current;
    if (!container) return;
    const onMove = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      changeSplitPct(Math.round(Math.min(78, Math.max(22, pct))));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [changeSplitPct]);

  const persistEnvs = useCallback((next: Record<string, SavedEnv>) => {
    setSavedEnvs(next);
    try { localStorage.setItem(`${STORAGE_KEY}-envs`, JSON.stringify(next)); } catch {}
  }, []);

  const applyEnv = useCallback((env: SavedEnv) => {
    setFs(env.fs);
    const restored = env.sessions.map((s) => ({ ...s, input: "", cursor: 0, histIdx: -1, search: null, saved: "", killRing: "", pendingScript: null }));
    setSessions(restored);
    setActiveId(restored.some((s) => s.id === env.activeId) ? env.activeId : restored[0].id);
    nextIdRef.current = Math.max(...restored.map((s) => s.id)) + 1;
    setDoneLessons(env.doneLessons ?? []);
    setCmdHistory(env.cmdHistory ?? []);
    setUnread({});
    setActiveLesson(null);
    setShowHint(false);
  }, []);

  const snapshotEnv = useCallback((): SavedEnv => ({
    savedAt: new Date().toISOString(),
    fs,
    sessions,
    activeId,
    doneLessons,
    cmdHistory,
  }), [fs, sessions, activeId, doneLessons, cmdHistory]);

  const saveEnv = useCallback(() => {
    const name = envName.trim();
    if (!name) return;
    persistEnvs({ ...savedEnvs, [name]: snapshotEnv() });
    setEnvName("");
    setEnvMsg(isEs ? `Entorno «${name}» guardado.` : `Environment «${name}» saved.`);
  }, [envName, savedEnvs, snapshotEnv, persistEnvs, isEs]);

  const deleteEnv = useCallback((name: string) => {
    const next = { ...savedEnvs };
    delete next[name];
    persistEnvs(next);
  }, [savedEnvs, persistEnvs]);

  const exportEnv = useCallback(() => {
    const name = envName.trim() || "entorno-linux";
    const blob = new Blob([JSON.stringify(snapshotEnv(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [envName, snapshotEnv]);

  const importEnv = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as SavedEnv;
        if (!parsed || !parsed.fs || !Array.isArray(parsed.sessions) || parsed.sessions.length === 0) {
          setEnvMsg(isEs ? "El archivo no es un entorno válido." : "The file is not a valid environment.");
          return;
        }
        applyEnv(parsed);
        setEnvMsg(isEs ? "Entorno importado." : "Environment imported.");
      } catch {
        setEnvMsg(isEs ? "El archivo no es un entorno válido." : "The file is not a valid environment.");
      }
    };
    reader.readAsText(file);
  }, [applyEnv, isEs]);

  const toggleFullscreen = useCallback(() => {
    if (!windowRef.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void windowRef.current.requestFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const fontCls = fontSize === "base"
    ? "text-xs sm:text-sm"
    : fontSize === "lg"
      ? "text-sm sm:text-base"
      : "text-base sm:text-lg";

  const patchSession = useCallback((id: number, patch: Partial<Session> | ((s: Session) => Partial<Session>)) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...(typeof patch === "function" ? patch(s) : patch) } : s)));
  }, []);

  useEffect(() => {
    for (const el of Object.values(outputRefs.current)) {
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [sessions]);

  useEffect(() => {
    inputRefs.current[activeId]?.focus();
  }, [activeId]);

  useEffect(() => {
    const el = inputRefs.current[active.id];
    if (!el || document.activeElement !== el) return;
    if (el.selectionStart !== active.cursor || el.selectionEnd !== active.cursor) {
      el.setSelectionRange(active.cursor, active.cursor);
    }
  }, [active.input, active.cursor, active.id]);

  const appendEntries = useCallback((id: number, entries: OutputEntry[]) => {
    patchSession(id, (s) => ({ entries: trimBuffer([...s.entries, ...entries]) }));
  }, [patchSession]);

  const createLocalSession = useCallback(() => {
    const id = nextIdRef.current++;
    setSessions((prev) => [
      ...prev,
      { id, remote: null, fs: null, cwd: [...USER_HOME], entries: [{ kind: "out", text: "" }, { kind: "out", text: isEs ? "Nueva terminal local. Todas las locales comparten el mismo disco." : "New local terminal. All local tabs share the same disk." }], input: "", cursor: 0, histIdx: -1, saved: "", search: null, killRing: "", pendingScript: null, env: { ...DEFAULT_HOME_ENV }, ended: false },
    ]);
    setActiveId(id);
    setUnread((prev) => ({ ...prev, [id]: 0 }));
  }, [isEs]);

  const closeSession = useCallback((id: number) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) {
        const fresh: Session = { id: nextIdRef.current++, remote: null, fs: null, cwd: [...USER_HOME], entries: bannerLines(isEs).map((t) => ({ kind: "out" as const, text: t })), input: "", cursor: 0, histIdx: -1, saved: "", search: null, killRing: "", pendingScript: null, env: { ...DEFAULT_HOME_ENV }, ended: false };
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(next[next.length - 1].id);
      return next;
    });
    setUnread((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [activeId]);

  const resetTerminal = useCallback(() => {
    setFs(createInitialFs());
    setSessions([{ id: nextIdRef.current++, remote: null, fs: null, cwd: [...USER_HOME], entries: bannerLines(isEs).map((t) => ({ kind: "out" as const, text: t })), input: "", cursor: 0, histIdx: -1, saved: "", search: null, killRing: "", pendingScript: null, env: { ...DEFAULT_HOME_ENV }, ended: false }]);
    setActiveLesson(null);
    setShowHint(false);
    setUnread({});
  }, [isEs]);

  const checkLessonProgress = useCallback((lesson: Lesson, st: FsState, cw: string[], cmds: string[], id: number) => {
    let allDone = true;
    for (const step of lesson.steps) {
      if (!step.done(st, cw, cmds)) allDone = false;
    }
    if (allDone) {
      setDoneLessons((prev) => {
        if (prev.includes(lesson.id)) return prev;
        const next = [...prev, lesson.id];
        persist(next, histRef.current);
        return next;
      });
      appendEntries(id, [{ kind: "ok", text: isEs ? `✔ Lección completada: ${lesson.titleEs}` : `✔ Lesson completed: ${lesson.titleEn}` }]);
      setActiveLesson(null);
      setShowHint(false);
    }
  }, [isEs, persist, appendEntries]);

  const handleSubmit = useCallback((session: Session) => {
    const line = session.input;
    const cwd = session.cwd;
    const env = session.env;
    const sessionFs = session.remote && session.fs ? session.fs : fs;
    patchSession(session.id, { input: "", cursor: 0, histIdx: -1, saved: "", search: null, killRing: "" });
    if (!line.trim() && !session.pendingScript) {
      appendEntries(session.id, [{ kind: "cmd", text: `${promptString(cwd, env)} ` }]);
      return;
    }
    appendEntries(session.id, [{ kind: "cmd", text: `${promptString(cwd, env)} ${line}` }]);
    if (line.trim()) {
      const nextHistory = [line, ...cmdHistory.filter((h) => h !== line)].slice(0, 60);
      setCmdHistory(nextHistory);
      persist(doneLessons, nextHistory);
    }

    const opts: BashOptions = { isEs, env, history: cmdHistory, remote: Boolean(session.remote) };
    if (session.pendingScript) {
      opts.pending = { line: session.pendingScript.resumeLine, variable: session.pendingScript.variable, value: line, source: session.pendingScript.source };
    }
    const result = executeLine(sessionFs, cwd, line, opts);

    if (result.clear) {
      patchSession(session.id, { cwd: result.cwd, env: result.env ?? env, fs: session.remote ? result.state : session.fs, entries: [], pendingScript: null });
      if (!session.remote) setFs(result.state);
      if (result.exit) patchSession(session.id, { ended: true });
      return;
    }
    if (result.errFrom !== undefined && result.errFrom > 0) {
      appendEntries(session.id, [
        ...result.lines.slice(0, result.errFrom).map((t) => ({ kind: "out" as const, text: t })),
        ...result.lines.slice(result.errFrom).map((t) => ({ kind: "err" as const, text: t })),
      ]);
    } else {
      appendEntries(session.id, result.lines.map((t) => ({ kind: (result.error ? "err" : "out") as OutputEntry["kind"], text: t })));
    }
    patchSession(session.id, { cwd: result.cwd, env: result.env ?? env, fs: session.remote ? result.state : session.fs, pendingScript: result.pending ?? null });
    if (!session.remote) setFs(result.state);

    if (result.exit) {
      if (session.remote) {
        closeSession(session.id);
      } else {
        patchSession(session.id, { ended: true });
      }
      return;
    }

    if (result.openRemote) {
      const id = nextIdRef.current++;
      const remoteEnv = { USER: result.openRemote.user, HOSTNAME: result.openRemote.host, HOME: `/home/${result.openRemote.user}`, SHELL: "/bin/bash" };
      setSessions((prev) => [
        ...prev,
        {
          id,
          remote: { user: result.openRemote!.user, host: result.openRemote!.host },
          fs: createRemoteFs(result.openRemote!.host, result.openRemote!.user),
          cwd: ["home", result.openRemote!.user],
          entries: remoteBanner(isEs, result.openRemote!.host).map((t) => ({ kind: "out" as const, text: t })),
          input: "",
          cursor: 0,
          histIdx: -1,
          saved: "",
          search: null,
          killRing: "",
          pendingScript: null,
          env: remoteEnv,
          ended: false,
        },
      ]);
      setActiveId(id);
      setUnread((prev) => ({ ...prev, [id]: 0 }));
    }

    if (result.broadcast) {
      setSessions((prev) => prev.map((s) => {
        if (s.id === session.id) return s;
        return { ...s, entries: [...s.entries,
          { kind: "ok", text: isEs ? `--- Mensaje general (wall) desde otra terminal ---` : `--- Broadcast (wall) from another terminal ---` },
          { kind: "out", text: result.broadcast ?? "" },
        ] };
      }));
      setUnread((prev) => {
        const next = { ...prev };
        for (const s of sessions) {
          if (s.id !== session.id) next[s.id] = (next[s.id] ?? 0) + 1;
        }
        return next;
      });
    }

    const lowerCmd = line.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const nextCmds = [...cmdsRun, lowerCmd];
    setCmdsRun(nextCmds);
    if (activeLesson) {
      checkLessonProgress(activeLesson, result.state, result.cwd, nextCmds, session.id);
    }
  }, [fs, cmdHistory, doneLessons, persist, isEs, activeLesson, cmdsRun, checkLessonProgress, patchSession, appendEntries, closeSession, sessions]);

  const toRl = (s: Session): ReadlineState => ({
    input: s.input,
    cursor: s.cursor,
    histIdx: s.histIdx,
    saved: s.saved,
    search: s.search,
    killRing: s.killRing,
    exit: false,
  });

  const patchRl = useCallback((id: number, next: ReadlineState) => {
    patchSession(id, { input: next.input, cursor: next.cursor, histIdx: next.histIdx, saved: next.saved, search: next.search, killRing: next.killRing });
  }, [patchSession]);

  const resetInput = useCallback((id: number) => {
    patchSession(id, { input: "", cursor: 0, histIdx: -1, saved: "", search: null, killRing: "" });
  }, [patchSession]);

  const pasteText = useCallback((session: Session, raw: string) => {
    const text = raw.replace(/\r\n?/g, " ");
    if (!text) return;
    const c = session.cursor;
    patchSession(session.id, { input: session.input.slice(0, c) + text + session.input.slice(c), cursor: c + text.length });
  }, [patchSession]);

  const pasteFromClipboard = useCallback((session: Session) => {
    void navigator.clipboard
      .readText()
      .then((t) => pasteText(session, t))
      .catch(() => {});
  }, [pasteText]);

  const exitSession = useCallback((session: Session) => {
    appendEntries(session.id, [{ kind: "warn", text: "^D" }]);
    if (session.remote) closeSession(session.id);
    else patchSession(session.id, { ended: true });
  }, [appendEntries, closeSession, patchSession]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>, session: Session) => {
    const isAltGr = e.ctrlKey && e.altKey;
    if (e.key === "Enter") {
      e.preventDefault();
      if (session.ended) return;
      let line = session.input;
      if (session.search) {
        const s2 = acceptSearch(toRl(session), histRef.current);
        line = s2.input;
        patchSession(session.id, { input: s2.input, cursor: s2.cursor, histIdx: s2.histIdx, saved: "", search: null });
      }
      if (!line.trim()) {
        appendEntries(session.id, [{ kind: "cmd", text: `${promptString(session.cwd, session.env)} ${line}` }]);
        resetInput(session.id);
        return;
      }
      handleSubmit({ ...session, input: line, cursor: line.length });
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (session.search) return;
      const input = session.input;
      const parts = input.split(/\s+/);
      if (parts.length === 0) return;
      const last = parts[parts.length - 1] ?? "";
      if (last.length === 0) return;
      const lower = last.toLowerCase();
      let candidates: string[];
      if (parts.length === 1) {
        candidates = COMMAND_NAMES.filter((c) => c.startsWith(lower));
      } else {
        const sessionFs = session.remote && session.fs ? session.fs : fs;
        const pathSegs = last.split(/[\\/]+/).filter((p) => p.length > 0);
        const searchName = (pathSegs.pop() ?? "").toLowerCase();
        const targetDir = pathSegs.length > 0 ? pathSegs : session.cwd;
        const dirNode = targetDir.length === 0 ? sessionFs.root : resolveDir(sessionFs, targetDir);
        candidates = Object.values(dirNode?.children ?? {})
          .filter((c) => c.name.toLowerCase().startsWith(searchName))
          .map((c) => (c.kind === "dir" ? `${c.name}/` : c.name));
      }
      if (candidates.length === 1) {
        parts[parts.length - 1] = candidates[0];
        const done = parts.join(" ");
        lastTabRef.current[session.id] = done;
        patchSession(session.id, { input: done, cursor: done.length });
      } else if (candidates.length > 1) {
        if (lastTabRef.current[session.id] === input) {
          appendEntries(session.id, [{ kind: "out", text: candidates.join("  ") }]);
        } else {
          const common = commonPrefix(candidates);
          if (common.length > last.length) {
            parts[parts.length - 1] = common;
            const done = parts.join(" ");
            lastTabRef.current[session.id] = done;
            patchSession(session.id, { input: done, cursor: done.length });
          } else {
            lastTabRef.current[session.id] = input;
          }
        }
      }
      return;
    }
    if (e.ctrlKey && e.shiftKey && (e.key === "C" || e.key === "c")) {
      e.preventDefault();
      const sel = window.getSelection()?.toString();
      if (sel) void navigator.clipboard.writeText(sel).catch(() => {});
      return;
    }
    if (e.ctrlKey && e.shiftKey && (e.key === "V" || e.key === "v")) {
      e.preventDefault();
      pasteFromClipboard(session);
      return;
    }
    if (e.ctrlKey && e.key === "c") {
      e.preventDefault();
      appendEntries(session.id, [
        { kind: "cmd", text: `${promptString(session.cwd, session.env)} ${session.input}` },
        { kind: "warn", text: "^C" },
      ]);
      resetInput(session.id);
      return;
    }
    if (e.ctrlKey && e.key === "l") {
      e.preventDefault();
      patchSession(session.id, { entries: [] });
      return;
    }
    const plainTyping = e.key.length === 1 && (isAltGr || (!e.ctrlKey && !e.altKey));
    if (plainTyping && !session.search) return;
    if (e.key === " " || e.key === "Tab" || e.ctrlKey || e.altKey || session.search) e.preventDefault();
    const ev: KeyEvent = { key: e.key, ctrl: isAltGr ? false : e.ctrlKey, alt: isAltGr ? false : e.altKey };
    const next = rlHandleKey(toRl(session), ev, histRef.current);
    if (next.exit) {
      exitSession(session);
      return;
    }
    patchRl(session.id, next);
  }, [fs, handleSubmit, patchSession, appendEntries, patchRl, resetInput, pasteFromClipboard, exitSession]);

  const resolveDir = (fsState: FsState, segs: string[]) => {
    let node = fsState.root;
    for (const seg of segs) {
      const child = node.children?.[seg];
      if (!child) return null;
      node = child;
      if (node.kind !== "dir") return null;
    }
    return node;
  };

  const startLesson = useCallback((lesson: Lesson) => {
    setActiveLesson(lesson);
    setShowHint(false);
    const intro = [
      "",
      isEs ? `— ${lesson.titleEs} —` : `— ${lesson.titleEn} —`,
      isEs ? lesson.briefingEs : lesson.briefingEn,
      isEs ? `Paso 1 de ${lesson.steps.length}: ${lesson.steps[0].es}` : `Step 1 of ${lesson.steps.length}: ${lesson.steps[0].en}`,
      "",
    ];
    appendEntries(activeId, intro.map((t) => ({ kind: "out" as const, text: t })));
    inputRefs.current[activeId]?.focus();
  }, [isEs, activeId, appendEntries]);

  const activeStepIdx = useMemo(() => {
    if (!activeLesson) return 0;
    const lessonFs = active.remote && active.fs ? active.fs : fs;
    let idx = 0;
    for (let i = 0; i < activeLesson.steps.length; i++) {
      if (activeLesson.steps[i].done(lessonFs, active.cwd, cmdsRun)) idx = i + 1;
    }
    return idx;
  }, [activeLesson, fs, active.cwd, active.fs, active.remote, cmdsRun]);

  const nextStep = activeLesson?.steps[Math.min(activeStepIdx, activeLesson.steps.length - 1)] ?? null;

  const tabLabel = (s: Session) => {
    if (s.remote) return `${s.remote.user}@${s.remote.host}`;
    return `bash · ${displayPath(s.cwd)}`;
  };

  const visibleSessions = layout === "split" && sessions.length > 1
    ? [sessions[0], active.id === sessions[0].id ? sessions[1] : active]
    : [active];
  const isSplit = layout === "split" && visibleSessions.length > 1;
  const outputHeight = isFullscreen ? "min-h-0 flex-1" : isSplit ? "h-[300px] sm:h-[360px]" : "h-[380px] sm:h-[460px]";

  const renderPane = (s: Session) => {
    const paneActive = s.id === activeId;
    const th = THEMES[theme];
    return (
      <div
        key={s.id}
        onMouseDown={() => {
          if (!paneActive) setActiveId(s.id);
        }}
        className="flex min-h-0 min-w-0 flex-col"
      >
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/5 px-3 py-2 sm:px-4">
          {!isFullscreen && (
            <>
              <span className="h-3 w-3 rounded-full bg-red-500/80" />
              <span className="h-3 w-3 rounded-full bg-yellow-500/80" />
              <span className="h-3 w-3 rounded-full bg-green-500/80" />
            </>
          )}
          <span className={`ml-2 hidden truncate font-mono text-xs sm:inline ${s.remote ? "text-purple-300/70" : "text-white/50"}`}>
            {s.remote ? `ssh ${s.remote.user}@${s.remote.host} — bash` : `bash — ${displayPath(s.cwd)}`}
          </span>
          {paneActive && (
            <div className="ml-auto flex items-center gap-1">
              <div className="mr-1 hidden items-center gap-1 rounded-md border border-white/10 p-0.5 sm:flex">
                {(["base", "lg", "xl"] as const).map((size) => (
                  <button
                    key={size}
                    onClick={() => changeFontSize(size)}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
                      fontSize === size ? "bg-white/15 text-white" : "text-white/40 hover:text-white/80"
                    }`}
                    title={isEs ? "Tamaño de letra (para proyectar)" : "Font size (for projecting)"}
                  >
                    {size === "base" ? "A" : size === "lg" ? "A+" : "A++"}
                  </button>
                ))}
              </div>
              <button
                onClick={toggleFullscreen}
                className="flex h-7 w-7 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                title={isEs ? "Pantalla completa para proyectar" : "Fullscreen for projecting"}
              >
                {isFullscreen ? <MdFullscreenExit /> : <MdFullscreen />}
              </button>
              <button
                onClick={createLocalSession}
                className="hidden rounded-md px-2.5 py-1 font-mono text-[11px] font-bold text-white/40 transition-colors hover:text-white/80 sm:block"
              >
                {isEs ? "+ bash" : "+ bash"}
              </button>
            </div>
          )}
        </div>
        <div
          ref={(el) => { outputRefs.current[s.id] = el; }}
          onMouseUp={() => {
            const sel = window.getSelection()?.toString();
            if (sel) {
              void navigator.clipboard.writeText(sel).catch(() => {});
              return;
            }
            inputRefs.current[s.id]?.focus();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            pasteFromClipboard(s);
          }}
          className={`overflow-y-auto px-3 py-3 font-mono leading-relaxed text-white/90 sm:px-4 ${outputHeight} ${fontCls}`}
        >
          {s.entries.map((entry, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap break-words ${
                entry.kind === "cmd"
                  ? "font-semibold text-white"
                  : entry.kind === "ok"
                    ? th.ok
                    : entry.kind === "err"
                      ? th.err
                      : entry.kind === "warn"
                        ? th.warn
                        : entry.text.trimStart().startsWith("drwx") || entry.text.trimStart().startsWith("-rw") || entry.text.trimStart().startsWith("lrwx") || entry.text.trimStart().startsWith("total")
                          ? th.listing
                          : th.out
              }`}
            >
              {entry.text}
            </div>
          ))}
          {s.search && (
            <div className="mb-1 font-mono text-xs">
              <span className={s.search.failed ? "text-red-400" : "text-amber-300"}>
                ({isEs ? "búsqueda inversa" : "reverse-i-search"})`{s.search.query}`:{" "}
              </span>
              <span className="text-white">{s.search.matchIdx >= 0 ? histRef.current[s.search.matchIdx] ?? "" : ""}</span>
            </div>
          )}
          <div className="flex items-center gap-0">
            <span className={`shrink-0 whitespace-pre ${s.remote ? th.remote : th.prompt}`}>{s.ended ? "" : `${promptString(s.cwd, s.env)}`}</span>
            {s.ended ? (
              <span className="text-white/70">{isEs ? "Sesión cerrada. Cierra la pestaña o pulsa «Reiniciar terminal»." : "Session closed. Close the tab or press «Reset terminal»."}</span>
            ) : (
              <input
                ref={(el) => { inputRefs.current[s.id] = el; }}
                value={s.input}
                onChange={(e) => patchSession(s.id, { input: e.target.value, cursor: e.target.selectionStart ?? e.target.value.length })}
                onKeyDown={(e) => handleKey(e, s)}
                spellCheck={false}
                autoComplete="off"
                style={{ caretColor: th.caret }}
                className="w-full bg-transparent font-mono text-white outline-none"
                aria-label={isEs ? "Comandos de la terminal Linux" : "Linux terminal commands"}
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/20 bg-surface/30 p-3">
        <span className="text-xs font-bold text-text">{isEs ? "Modo" : "Mode"}:</span>
        <button
          onClick={() => { setActiveLesson(null); setShowHint(false); }}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            !activeLesson ? "bg-primary text-background" : "bg-surface/60 text-text-muted hover:text-text"
          }`}
        >
          {isEs ? "Terminal libre" : "Free terminal"}
        </button>
        {LESSONS.map((l) => (
          <button
            key={l.id}
            onClick={() => startLesson(l)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeLesson?.id === l.id ? "bg-primary text-background" : doneLessons.includes(l.id) ? "bg-green-500/15 text-green-400" : "bg-surface/60 text-text-muted hover:text-text"
            }`}
          >
            {doneLessons.includes(l.id) ? "✔ " : ""}{isEs ? l.titleEs.split(" · ")[1] : l.titleEn.split(" · ")[1]}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => changeLayout(layout === "split" ? "single" : "split")}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              layout === "split" ? "border-primary/40 bg-primary/10 text-primary" : "border-border/30 bg-surface/60 text-text-muted hover:text-text"
            }`}
            title={isEs ? "Ver dos terminales a la vez" : "See two terminals at once"}
          >
            {layout === "split" ? (isEs ? "1 panel" : "1 pane") : (isEs ? "2 paneles" : "2 panes")}
          </button>
          <div className="flex items-center gap-1 rounded-lg border border-border/30 bg-surface/60 px-1 py-1">
            {(Object.keys(THEMES) as TerminalTheme[]).map((t) => (
              <button
                key={t}
                onClick={() => changeTheme(t)}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                  theme === t ? "bg-primary/20 text-primary" : "text-text-muted hover:text-text"
                }`}
                title={isEs ? `Tema ${THEMES[t].labelEs}` : `${THEMES[t].labelEn} theme`}
              >
                {t === "ubuntu" ? "Ubuntu" : t === "verde" ? "Verde" : "Contraste"}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowEnvs((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              showEnvs ? "border-primary/40 bg-primary/10 text-primary" : "border-border/30 bg-surface/60 text-text-muted hover:text-text"
            }`}
          >
            {isEs ? "Entornos" : "Environments"}
          </button>
          <button
            onClick={resetTerminal}
            className="rounded-lg border border-border/30 bg-surface/60 px-3 py-1.5 text-xs font-semibold text-text-muted transition-colors hover:text-text"
          >
            {isEs ? "Reiniciar terminal" : "Reset terminal"}
          </button>
        </div>
      </div>

      {showEnvs && (
        <div className="rounded-2xl border border-border/20 bg-surface/30 p-4 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={envName}
              onChange={(e) => setEnvName(e.target.value)}
              placeholder={isEs ? "Nombre del entorno (ej. clase-1)" : "Environment name (e.g. class-1)"}
              className="w-48 rounded-lg border border-border/30 bg-background px-3 py-1.5 text-xs text-text outline-none focus:border-primary/50"
            />
            <button
              onClick={saveEnv}
              disabled={!envName.trim()}
              className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 font-semibold text-primary transition-colors disabled:opacity-40"
            >
              {isEs ? "Guardar" : "Save"}
            </button>
            <button
              onClick={exportEnv}
              className="rounded-lg border border-border/30 bg-surface/60 px-3 py-1.5 font-semibold text-text-muted transition-colors hover:text-text"
            >
              {isEs ? "Exportar archivo" : "Export file"}
            </button>
            <label className="cursor-pointer rounded-lg border border-border/30 bg-surface/60 px-3 py-1.5 font-semibold text-text-muted transition-colors hover:text-text">
              {isEs ? "Importar archivo" : "Import file"}
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) importEnv(file);
                  e.target.value = "";
                }}
              />
            </label>
            {envMsg && <span className="text-green-400">{envMsg}</span>}
          </div>
          {Object.keys(savedEnvs).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(savedEnvs).map(([name, env]) => (
                <span key={name} className="flex items-center gap-1 rounded-lg border border-border/30 bg-surface/60 px-2 py-1">
                  <button
                    onClick={() => { applyEnv(env); setEnvMsg(isEs ? `Entorno «${name}» cargado.` : `Environment «${name}» loaded.`); }}
                    className="font-semibold text-text transition-colors hover:text-primary"
                    title={isEs ? "Cargar este entorno" : "Load this environment"}
                  >
                    {name}
                  </button>
                  <button
                    onClick={() => deleteEnv(name)}
                    className="rounded p-0.5 text-text-muted/60 transition-colors hover:text-red-400"
                    title={isEs ? "Eliminar" : "Delete"}
                  >
                    <MdClose className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="mt-3 text-[11px] text-text-muted/70">
            {isEs
              ? "Un entorno guarda el disco virtual completo, las pestañas, el historial y las lecciones. Se almacena en tu navegador; exporta el archivo para compartirlo con la clase."
              : "An environment saves the whole virtual disk, the tabs, the history and the lessons. It is stored in your browser; export the file to share it with the class."}
          </p>
        </div>
      )}

      {activeLesson && nextStep && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-primary">
              {isEs ? `Paso ${activeStepIdx + 1} de ${activeLesson.steps.length}` : `Step ${activeStepIdx + 1} of ${activeLesson.steps.length}`}
            </p>
            <button
              onClick={() => setShowHint(true)}
              className="rounded-lg border border-border/30 bg-surface/60 px-3 py-1 text-xs text-text-muted transition-colors hover:text-text"
            >
              {isEs ? "Ver pista" : "Show hint"}
            </button>
          </div>
          <p className="mt-1 text-sm text-text">{isEs ? nextStep.es : nextStep.en}</p>
          {showHint && (
            <p className="mt-2 font-mono text-xs text-green-400">$ {isEs ? nextStep.hintEs : nextStep.hintEn}</p>
          )}
        </div>
      )}

      <div
        ref={windowRef}
        className={`overflow-hidden border border-white/15 bg-black ${
          isFullscreen ? "flex h-screen flex-col rounded-none" : "rounded-2xl"
        }`}
      >
        <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 bg-black px-2 pt-2">
          {sessions.map((s, i) => (
            <div
              key={s.id}
              className={`flex shrink-0 items-center gap-1 rounded-t-md border-t border-r border-l px-2.5 py-1 font-mono text-[11px] transition-colors ${
                s.id === activeId
                  ? "border-white/15 bg-white/10 text-white"
                  : "border-transparent text-white/40 hover:text-white/80"
              }`}
            >
              <button
                onClick={(e) => { e.stopPropagation(); setActiveId(s.id); setUnread((prev) => ({ ...prev, [s.id]: 0 })); }}
                className="flex items-center gap-1.5"
              >
                <span className={s.remote ? "text-purple-300/70" : "text-white/30"}>{i + 1}</span>
                {tabLabel(s)}
                {(unread[s.id] ?? 0) > 0 && s.id !== activeId && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-black">
                    {unread[s.id]}
                  </span>
                )}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); closeSession(s.id); }}
                className="rounded p-0.5 text-white/30 transition-colors hover:bg-white/10 hover:text-white"
                title={s.remote ? (isEs ? "Cerrar la conexión" : "Close the connection") : (isEs ? "Cerrar esta terminal" : "Close this terminal")}
              >
                <MdClose className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button
            onClick={(e) => { e.stopPropagation(); createLocalSession(); }}
            className="shrink-0 rounded-t-md px-2 py-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            title={isEs ? "Nueva terminal local (comparte el disco)" : "New local terminal (shares the disk)"}
            aria-label={isEs ? "Nueva terminal" : "New terminal"}
          >
            +
          </button>
        </div>
        <div ref={splitWrapRef} className={`flex min-h-0 flex-col md:flex-row ${isFullscreen ? "flex-1" : ""}`}>
          {isSplit ? (
            <>
              <div className="min-h-0 min-w-0" style={isMd ? { width: `${splitPct}%` } : undefined}>
                {renderPane(visibleSessions[0])}
              </div>
              <div
                onPointerDown={startDrag}
                className="hidden h-2 w-full shrink-0 cursor-row-resize bg-white/10 transition-colors hover:bg-primary/60 md:h-auto md:w-2 md:cursor-col-resize"
                aria-hidden="true"
              />
              <div className="min-h-0 min-w-0 flex-1">
                {renderPane(visibleSessions[1])}
              </div>
            </>
          ) : (
            renderPane(visibleSessions[0])
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-muted/70">
        <span>
          {isEs
            ? "↑/↓ historial · Tab completa (2× lista opciones) · Ctrl+R busca en el historial · Ctrl+A/E/U/K/W estilo readline · Ctrl+L limpia · selecciona para copiar · click derecho pega · Ctrl+Mayús+C/V copiar/pegar · ssh abre máquina remota · wall avisa a todas"
            : "↑/↓ history · Tab completes (2× lists options) · Ctrl+R searches history · Ctrl+A/E/U/K/W readline keys · Ctrl+L clears · select to copy · right-click to paste · Ctrl+Shift+C/V copy/paste · ssh opens a remote machine · wall broadcasts"}
        </span>
        {doneLessons.length > 0 && (
          <span className="font-semibold text-green-400">
            {doneLessons.length}/{LESSONS.length} {isEs ? "lecciones completadas" : "lessons completed"}
          </span>
        )}
      </div>

      <details className="rounded-2xl border border-border/20 bg-surface/30 p-4 text-sm text-text-muted">
        <summary className="cursor-pointer font-semibold text-text">{isEs ? "Qué es esta terminal y hasta dónde llega" : "What this terminal is and where it ends"}</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          <li>
            {isEs
              ? "Es un simulador con fines educativos: hay un sistema de archivos virtual en memoria. Nada de lo que escribas toca tu ordenador, tu red real ni ningún dato."
              : "It is a teaching simulator: there is an in-memory virtual filesystem. Nothing you type touches your computer, your network or any real data."}
          </li>
          <li>
            {isEs
              ? "Las pestañas locales comparten el mismo disco virtual. SSH abre una pestaña con la máquina remota simulada: su disco es independiente y exit cierra la conexión."
              : "Local tabs share the same virtual disk. SSH opens a tab with the simulated remote machine: its disk is independent and exit closes the connection."}
          </li>
          <li>
            {isEs
              ? "Los comandos de red (ifconfig, ping, traceroute, ss, curl, wget, scp) muestran valores de ejemplo para aprender a leerlos; nada sale de tu navegador."
              : "Network commands (ifconfig, ping, traceroute, ss, curl, wget, scp) show sample values so you learn to read them; nothing leaves your browser."}
          </li>
          <li>
            {isEs
              ? "Progreso de lecciones e historial se guardan solo en tu navegador (localStorage)."
              : "Lesson progress and history are stored only in your browser (localStorage)."}
          </li>
          <li>
            {isEs
              ? "Ojo con la diferencia clave del mundo real: en un Linux de verdad rm -r borra de verdad y no hay papelera; aquí no hay permisos ni usuarios reales."
              : "Mind the real-world difference: on a real Linux rm -r deletes for real and there is no recycle bin; there are no real permissions or users here."}
          </li>
        </ul>
      </details>
    </div>
  );
}
