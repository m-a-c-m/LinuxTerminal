export interface KeyEvent {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
}

export interface ReverseSearch {
  query: string;
  matchIdx: number;
  failed: boolean;
}

export interface ReadlineState {
  input: string;
  cursor: number;
  histIdx: number;
  saved: string;
  search: ReverseSearch | null;
  killRing: string;
  exit: boolean;
}

export function initReadline(): ReadlineState {
  return { input: "", cursor: 0, histIdx: -1, saved: "", search: null, killRing: "", exit: false };
}

export function wordLeftIndex(input: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && /\s/.test(input[i - 1])) i--;
  while (i > 0 && !/\s/.test(input[i - 1])) i--;
  return i;
}

export function wordRightIndex(input: string, cursor: number): number {
  const len = input.length;
  let i = cursor;
  while (i < len && /\s/.test(input[i])) i++;
  while (i < len && !/\s/.test(input[i])) i++;
  return i;
}

function findMatch(history: string[], query: string, startIdx: number): number {
  for (let i = startIdx; i < history.length; i++) {
    if (history[i].includes(query)) return i;
  }
  return -1;
}

export function startSearch(state: ReadlineState): ReadlineState {
  return { ...state, saved: state.input, search: { query: "", matchIdx: -1, failed: false } };
}

export function acceptSearch(state: ReadlineState, history: string[]): ReadlineState {
  const s = state.search;
  if (!s) return state;
  if (s.matchIdx >= 0) {
    const line = history[s.matchIdx] ?? "";
    return { ...state, input: line, cursor: line.length, histIdx: s.matchIdx, saved: "", search: null };
  }
  return { ...state, input: state.saved, cursor: state.saved.length, search: null };
}

function handleSearchKey(state: ReadlineState, ev: KeyEvent, history: string[]): ReadlineState {
  const ctrl = Boolean(ev.ctrl);
  const alt = Boolean(ev.alt);
  const key = ev.key;
  const s = state.search;
  if (!s) return state;
  const cancel = (): ReadlineState => ({ ...state, input: state.saved, cursor: state.saved.length, search: null });
  if (key === "Escape") return cancel();
  if (ctrl && key === "c") return { ...state, input: "", cursor: 0, search: null };
  if (ctrl && key === "g") return cancel();
  if (key === "Enter" || (ctrl && key === "j")) return acceptSearch(state, history);
  if (ctrl && key === "r") {
    if (!s.query) return state;
    const idx = findMatch(history, s.query, s.matchIdx + 1);
    return { ...state, search: { ...s, matchIdx: idx, failed: idx === -1 } };
  }
  if (key === "Backspace" || (ctrl && key === "h")) {
    if (!s.query) return state;
    const q = s.query.slice(0, -1);
    if (!q) return { ...state, search: { query: "", matchIdx: -1, failed: false } };
    const idx = findMatch(history, q, 0);
    return { ...state, search: { query: q, matchIdx: idx, failed: idx === -1 } };
  }
  if (key.length === 1 && !ctrl && !alt) {
    const q = s.query + key;
    const idx = findMatch(history, q, 0);
    return { ...state, search: { query: q, matchIdx: idx, failed: idx === -1 } };
  }
  return state;
}

export function handleKey(state: ReadlineState, ev: KeyEvent, history: string[]): ReadlineState {
  if (state.search) return handleSearchKey(state, ev, history);
  const ctrl = Boolean(ev.ctrl);
  const alt = Boolean(ev.alt);
  const key = ev.key;
  if (ctrl && key === "r") return startSearch(state);

  const s: ReadlineState = { ...state, exit: false };
  if (key.length === 1 && !ctrl && !alt) {
    const c = s.cursor;
    return { ...s, input: s.input.slice(0, c) + key + s.input.slice(c), cursor: c + 1, histIdx: -1 };
  }
  switch (key) {
    case "Backspace": {
      if (s.cursor === 0) return s;
      return { ...s, input: s.input.slice(0, s.cursor - 1) + s.input.slice(s.cursor), cursor: s.cursor - 1, histIdx: -1 };
    }
    case "Delete": {
      if (s.cursor >= s.input.length) return s;
      return { ...s, input: s.input.slice(0, s.cursor) + s.input.slice(s.cursor + 1), histIdx: -1 };
    }
    case "ArrowLeft":
      return { ...s, cursor: Math.max(0, s.cursor - 1) };
    case "ArrowRight":
      return { ...s, cursor: Math.min(s.input.length, s.cursor + 1) };
    case "Home":
      return { ...s, cursor: 0 };
    case "End":
      return { ...s, cursor: s.input.length };
    case "ArrowUp": {
      if (history.length === 0) return s;
      const next = Math.min(s.histIdx + 1, history.length - 1);
      const saved = s.histIdx === -1 ? s.input : s.saved;
      const line = history[next] ?? "";
      return { ...s, histIdx: next, saved, input: line, cursor: line.length };
    }
    case "ArrowDown": {
      if (s.histIdx === -1) return s;
      if (s.histIdx === 0) {
        const line = s.saved;
        return { ...s, histIdx: -1, input: line, cursor: line.length };
      }
      const next = s.histIdx - 1;
      const line = history[next] ?? "";
      return { ...s, histIdx: next, input: line, cursor: line.length };
    }
    default:
      break;
  }
  if (ctrl && key === "a") return { ...s, cursor: 0 };
  if (ctrl && key === "e") return { ...s, cursor: s.input.length };
  if (ctrl && key === "u") {
    return { ...s, killRing: s.input.slice(0, s.cursor), input: s.input.slice(s.cursor), cursor: 0 };
  }
  if (ctrl && key === "k") {
    return { ...s, killRing: s.input.slice(s.cursor), input: s.input.slice(0, s.cursor) };
  }
  if (ctrl && key === "w") {
    const idx = wordLeftIndex(s.input, s.cursor);
    return { ...s, killRing: s.input.slice(idx, s.cursor), input: s.input.slice(0, idx) + s.input.slice(s.cursor), cursor: idx };
  }
  if (ctrl && key === "y") {
    const c = s.cursor;
    return { ...s, input: s.input.slice(0, c) + s.killRing + s.input.slice(c), cursor: c + s.killRing.length };
  }
  if (alt && key === "b") return { ...s, cursor: wordLeftIndex(s.input, s.cursor) };
  if (alt && key === "f") return { ...s, cursor: wordRightIndex(s.input, s.cursor) };
  if (ctrl && key === "d") {
    if (s.input.length === 0) return { ...s, exit: true };
    return { ...s, input: s.input.slice(0, s.cursor) + s.input.slice(s.cursor + 1) };
  }
  return s;
}

export function commonPrefix(candidates: string[]): string {
  if (candidates.length === 0) return "";
  let prefix = candidates[0];
  for (const c of candidates) {
    let i = 0;
    while (i < prefix.length && i < c.length && prefix[i] === c[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}
