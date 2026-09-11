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
  histIdx: number;
  env: Record<string, string>;
  ended: boolean;
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
    { id: 1, remote: null, fs: null, cwd: [...USER_HOME], entries: bannerLines(locale === "es").map((t) => ({ kind: "out" as const, text: t })), input: "", histIdx: -1, env: { ...DEFAULT_HOME_ENV }, ended: false },
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

  const nextIdRef = useRef(2);
  const windowRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const histRef = useRef<string[]>([]);
  histRef.current = cmdHistory;

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];
  const activeIdx = sessions.findIndex((s) => s.id === active.id);

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
    } catch {}
  }, []);

  const persist = useCallback((nextDone: string[], nextHistory: string[]) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ done: nextDone, history: nextHistory })); } catch {}
  }, []);

  const changeFontSize = useCallback((next: "base" | "lg" | "xl") => {
    setFontSize(next);
    try { localStorage.setItem(`${STORAGE_KEY}-fs`, next); } catch {}
  }, []);

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
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [active?.entries]);

  const appendEntries = useCallback((id: number, entries: OutputEntry[]) => {
    patchSession(id, (s) => ({ entries: [...s.entries, ...entries] }));
  }, [patchSession]);

  const createLocalSession = useCallback(() => {
    const id = nextIdRef.current++;
    setSessions((prev) => [
      ...prev,
      { id, remote: null, fs: null, cwd: [...USER_HOME], entries: [{ kind: "out", text: "" }, { kind: "out", text: isEs ? "Nueva terminal local. Todas las locales comparten el mismo disco." : "New local terminal. All local tabs share the same disk." }], input: "", histIdx: -1, env: { ...DEFAULT_HOME_ENV }, ended: false },
    ]);
    setActiveId(id);
    setUnread((prev) => ({ ...prev, [id]: 0 }));
  }, [isEs]);

  const closeSession = useCallback((id: number) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) {
        const fresh: Session = { id: nextIdRef.current++, remote: null, fs: null, cwd: [...USER_HOME], entries: bannerLines(isEs).map((t) => ({ kind: "out" as const, text: t })), input: "", histIdx: -1, env: { ...DEFAULT_HOME_ENV }, ended: false };
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
    setSessions([{ id: nextIdRef.current++, remote: null, fs: null, cwd: [...USER_HOME], entries: bannerLines(isEs).map((t) => ({ kind: "out" as const, text: t })), input: "", histIdx: -1, env: { ...DEFAULT_HOME_ENV }, ended: false }]);
    setActiveLesson(null);
    setShowHint(false);
    setUnread({});
  }, [isEs]);

  const checkLessonProgress = useCallback((lesson: Lesson, st: FsState, cw: string[], cmds: string[]) => {
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
      appendEntries(activeId, [{ kind: "ok", text: isEs ? `✔ Lección completada: ${lesson.titleEs}` : `✔ Lesson completed: ${lesson.titleEn}` }]);
      setActiveLesson(null);
      setShowHint(false);
    }
  }, [isEs, persist, appendEntries, activeId]);

  const handleSubmit = useCallback(() => {
    const line = active.input;
    const cwd = active.cwd;
    const env = active.env;
    const sessionFs = active.remote && active.fs ? active.fs : fs;
    patchSession(active.id, { input: "", histIdx: -1 });
    if (!line.trim()) {
      appendEntries(active.id, [{ kind: "cmd", text: `${promptString(cwd, env)} ` }]);
      return;
    }
    appendEntries(active.id, [{ kind: "cmd", text: `${promptString(cwd, env)} ${line}` }]);
    const nextHistory = [line, ...cmdHistory.filter((h) => h !== line)].slice(0, 60);
    setCmdHistory(nextHistory);
    persist(doneLessons, nextHistory);

    const opts: BashOptions = { isEs, env, history: cmdHistory, remote: Boolean(active.remote) };
    const result = executeLine(sessionFs, cwd, line, opts);

    if (result.clear) {
      patchSession(active.id, { cwd: result.cwd, env: result.env ?? env, fs: active.remote ? result.state : active.fs, entries: [] });
      if (!active.remote) setFs(result.state);
      if (result.exit) patchSession(active.id, { ended: true });
      return;
    }
    appendEntries(active.id, result.lines.map((t) => ({ kind: (result.error ? "err" : "out") as OutputEntry["kind"], text: t })));
    patchSession(active.id, { cwd: result.cwd, env: result.env ?? env, fs: active.remote ? result.state : active.fs });
    if (!active.remote) setFs(result.state);

    if (result.exit) {
      if (active.remote) {
        closeSession(active.id);
      } else {
        patchSession(active.id, { ended: true });
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
          histIdx: -1,
          env: remoteEnv,
          ended: false,
        },
      ]);
      setActiveId(id);
      setUnread((prev) => ({ ...prev, [id]: 0 }));
    }

    if (result.broadcast) {
      setSessions((prev) => prev.map((s) => {
        if (s.id === active.id) return s;
        return { ...s, entries: [...s.entries,
          { kind: "ok", text: isEs ? `--- Mensaje general (wall) desde otra terminal ---` : `--- Broadcast (wall) from another terminal ---` },
          { kind: "out", text: result.broadcast ?? "" },
        ] };
      }));
      setUnread((prev) => {
        const next = { ...prev };
        for (const s of sessions) {
          if (s.id !== active.id) next[s.id] = (next[s.id] ?? 0) + 1;
        }
        return next;
      });
    }

    const lowerCmd = line.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const nextCmds = [...cmdsRun, lowerCmd];
    setCmdsRun(nextCmds);
    if (activeLesson) {
      checkLessonProgress(activeLesson, result.state, result.cwd, nextCmds);
    }
  }, [active, activeIdx, activeId, fs, cmdHistory, doneLessons, persist, isEs, activeLesson, cmdsRun, checkLessonProgress, patchSession, appendEntries, closeSession, sessions]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (active.ended) return;
      handleSubmit();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (histRef.current.length === 0) return;
      const next = Math.min(active.histIdx + 1, histRef.current.length - 1);
      patchSession(active.id, { histIdx: next, input: histRef.current[next] });
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (active.histIdx <= 0) {
        patchSession(active.id, { histIdx: -1, input: "" });
      } else {
        patchSession(active.id, { histIdx: active.histIdx - 1, input: histRef.current[active.histIdx - 1] });
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      const input = active.input;
      const parts = input.split(/\s+/);
      if (parts.length === 0) return;
      const last = parts[parts.length - 1];
      if (last.length === 0) return;
      const lower = last.toLowerCase();
      let candidates: string[];
      if (parts.length === 1) {
        candidates = COMMAND_NAMES.filter((c) => c.startsWith(lower));
      } else {
        const sessionFs = active.remote && active.fs ? active.fs : fs;
        const pathSegs = last.split(/[\\/]+/).filter((p) => p.length > 0);
        const searchName = (pathSegs.pop() ?? "").toLowerCase();
        const targetDir = pathSegs.length > 0 ? pathSegs : active.cwd;
        const dirNode = targetDir.length === 0 ? sessionFs.root : resolveDir(sessionFs, targetDir);
        candidates = Object.values(dirNode?.children ?? {})
          .filter((c) => c.name.toLowerCase().startsWith(searchName))
          .map((c) => (c.kind === "dir" ? `${c.name}/` : c.name));
      }
      if (candidates.length === 1) {
        parts[parts.length - 1] = candidates[0];
        patchSession(active.id, { input: parts.join(" ") });
      } else if (candidates.length > 1) {
        appendEntries(active.id, [{ kind: "out", text: candidates.join("  ") }]);
      }
    } else if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      appendEntries(active.id, [
        { kind: "cmd", text: `${promptString(active.cwd, active.env)} ${active.input}` },
        { kind: "warn", text: "^C" },
      ]);
      patchSession(active.id, { input: "" });
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      patchSession(active.id, { entries: [] });
    }
  }, [active, fs, handleSubmit, patchSession, appendEntries]);

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
    inputRef.current?.focus();
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
        <button
          onClick={resetTerminal}
          className="ml-auto rounded-lg border border-border/30 bg-surface/60 px-3 py-1.5 text-xs font-semibold text-text-muted transition-colors hover:text-text"
        >
          {isEs ? "Reiniciar terminal" : "Reset terminal"}
        </button>
      </div>

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
        onClick={() => inputRef.current?.focus()}
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
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/5 px-3 py-2 sm:px-4">
          {!isFullscreen && (
            <>
              <span className="h-3 w-3 rounded-full bg-red-500/80" />
              <span className="h-3 w-3 rounded-full bg-yellow-500/80" />
              <span className="h-3 w-3 rounded-full bg-green-500/80" />
              <span className={`ml-2 hidden font-mono text-xs sm:inline ${active.remote ? "text-purple-300/70" : "text-white/50"}`}>
                {active.remote ? `ssh ${active.remote.user}@${active.remote.host} — bash` : `bash — ${displayPath(active.cwd)}`}
              </span>
            </>
          )}
          {isFullscreen && (
            <span className={`font-mono text-xs ${active.remote ? "text-purple-300/70" : "text-white/50"}`}>
              {active.remote ? `ssh ${active.remote.user}@${active.remote.host} — bash` : `bash — ${displayPath(active.cwd)}`}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <div className="mr-1 hidden items-center gap-1 rounded-md border border-white/10 p-0.5 sm:flex">
              {(["base", "lg", "xl"] as const).map((s) => (
                <button
                  key={s}
                  onClick={(e) => { e.stopPropagation(); changeFontSize(s); }}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
                    fontSize === s ? "bg-white/15 text-white" : "text-white/40 hover:text-white/80"
                  }`}
                  title={isEs ? "Tamaño de letra (para proyectar)" : "Font size (for projecting)"}
                >
                  {s === "base" ? "A" : s === "lg" ? "A+" : "A++"}
                </button>
              ))}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              title={isEs ? "Pantalla completa para proyectar" : "Fullscreen for projecting"}
            >
              {isFullscreen ? <MdFullscreenExit /> : <MdFullscreen />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); createLocalSession(); }}
              className="hidden rounded-md px-2.5 py-1 font-mono text-[11px] font-bold text-white/40 transition-colors hover:text-white/80 sm:block"
            >
              {isEs ? "+ bash" : "+ bash"}
            </button>
          </div>
        </div>
        <div
          ref={outputRef}
          key={active.id}
          className={`overflow-y-auto px-3 py-3 font-mono leading-relaxed text-white/90 sm:px-4 ${
            isFullscreen ? "min-h-0 flex-1" : "h-[380px] sm:h-[460px]"
          } ${fontCls}`}
        >
          {active.entries.map((entry, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap break-words ${
                entry.kind === "cmd"
                  ? "font-semibold text-white"
                  : entry.kind === "ok"
                    ? "text-green-400"
                    : entry.kind === "err"
                      ? "text-red-400"
                      : entry.kind === "warn"
                        ? "text-amber-400"
                        : entry.text.trimStart().startsWith("drwx") || entry.text.trimStart().startsWith("-rw") || entry.text.trimStart().startsWith("total")
                          ? "text-sky-300"
                          : "text-white/70"
              }`}
            >
              {entry.text}
            </div>
          ))}
          <div className="flex items-center gap-0">
            <span className={`shrink-0 whitespace-pre ${active.remote ? "text-purple-300" : "text-green-400"}`}>{active.ended ? "" : `${promptString(active.cwd, active.env)}`}</span>
            {active.ended ? (
              <span className="text-white/70">{isEs ? "Sesión cerrada. Cierra la pestaña o pulsa «Reiniciar terminal»." : "Session closed. Close the tab or press «Reset terminal»."}</span>
            ) : (
              <input
                ref={inputRef}
                value={active.input}
                onChange={(e) => patchSession(active.id, { input: e.target.value })}
                onKeyDown={handleKey}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                className="w-full bg-transparent font-mono text-white outline-none [caret-color:#4ade80]"
                aria-label={isEs ? "Comandos de la terminal Linux" : "Linux terminal commands"}
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-muted/70">
        <span>
          {isEs
            ? "↑/↓ historial · Tab completa nombres · Ctrl+L limpia · ssh abre una máquina remota en una pestaña nueva · wall avisa a todas las terminales"
            : "↑/↓ history · Tab completes · Ctrl+L clears · ssh opens a remote machine in a tab · wall broadcasts to every terminal"}
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
