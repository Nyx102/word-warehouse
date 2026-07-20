/* Byte-exact unified diff model. Server diff text is split into files and
 * hunks with every byte preserved (CRLF, "\ No newline" markers, C-quoted
 * paths, rename/mode header lines), so reserializing yields the input
 * verbatim and every patch sent back to git apply is a verbatim slice of
 * what the server produced. Pure functions, no fetch. */

export interface DiffHunk {
  /** Verbatim hunk: the @@ line plus body lines, EOLs intact */
  text: string;
  /** The @@ line without its EOL, for display */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface DiffFile {
  /** Verbatim header block: diff --git through the line before the first hunk */
  header: string;
  /** a-side path (decoded, no a/ prefix); null when /dev/null */
  oldPath: string | null;
  /** b-side path (decoded, no b/ prefix); null when /dev/null */
  newPath: string | null;
  /** Display path: b-side, falling back to a-side */
  path: string;
  isNew: boolean;
  isDeleted: boolean;
  isRename: boolean;
  isBinary: boolean;
  hunks: DiffHunk[];
  /** Bytes after the hunks belonging to no hunk; '' in real git output */
  trailer: string;
}

export interface ParsedDiff {
  /** Bytes before the first diff --git line; '' in real git output */
  preamble: string;
  files: DiffFile[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const DIFF_GIT_RE = /^diff --git (?:"a\/(.*)"|a\/(.*?)) (?:"b\/(.*)"|b\/(.*))$/;

/** Split into lines with their EOL bytes attached (last line may lack one) */
function splitLines(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let nl;
  while ((nl = text.indexOf('\n', start)) !== -1) {
    out.push(text.slice(start, nl + 1));
    start = nl + 1;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

const stripEol = (line: string) => line.replace(/\r?\n$/, '');

const ESCAPES: Record<string, number> = {
  a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, '"': 34,
};

/** Decode the body of a C-quoted git path (quotes already removed).
 * Octal escapes are UTF-8 bytes, so decoding goes through a byte buffer. */
function cUnquoteBody(body: string): string {
  const enc = new TextEncoder();
  const bytes: number[] = [];
  let i = 0;
  while (i < body.length) {
    const bs = body.indexOf('\\', i);
    if (bs === -1) {
      bytes.push(...enc.encode(body.slice(i)));
      break;
    }
    if (bs > i) bytes.push(...enc.encode(body.slice(i, bs)));
    const e = body[bs + 1];
    if (e === undefined) {
      bytes.push(92);
      break;
    }
    if (e >= '0' && e <= '7') {
      let j = bs + 1;
      let v = 0;
      while (j < body.length && j < bs + 4 && body[j] >= '0' && body[j] <= '7') {
        v = v * 8 + (body.charCodeAt(j) - 48);
        j++;
      }
      bytes.push(v);
      i = j;
    } else if (e in ESCAPES) {
      bytes.push(ESCAPES[e]);
      i = bs + 2;
    } else {
      // Unknown escape: keep the backslash literally
      bytes.push(92);
      i = bs + 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Path from a ---/+++ marker (text after the four-char prefix, EOL stripped).
 * Git terminates unquoted paths containing spaces with a tab. */
function markerPath(rest: string): string | null {
  if (rest === '/dev/null') return null;
  let p = rest;
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) p = cUnquoteBody(p.slice(1, -1));
  else if (p.endsWith('\t')) p = p.slice(0, -1);
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p;
}

/** Path from a rename/copy from/to line (no prefix, no tab terminator) */
function plainPath(rest: string): string {
  if (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) {
    return cUnquoteBody(rest.slice(1, -1));
  }
  return rest;
}

interface HeaderInfo {
  oldPath: string | null;
  newPath: string | null;
  isNew: boolean;
  isDeleted: boolean;
  isRename: boolean;
  isBinary: boolean;
}

function parseHeader(headerLines: string[]): HeaderInfo {
  let markerOld: string | null | undefined;
  let markerNew: string | null | undefined;
  let renameOld: string | undefined;
  let renameNew: string | undefined;
  let isNew = false;
  let isDeleted = false;
  let isRename = false;
  let isBinary = false;
  for (const raw of headerLines.slice(1)) {
    const line = stripEol(raw);
    if (markerOld === undefined && line.startsWith('--- ')) markerOld = markerPath(line.slice(4));
    else if (markerNew === undefined && line.startsWith('+++ ')) markerNew = markerPath(line.slice(4));
    else if (line.startsWith('rename from ')) { renameOld = plainPath(line.slice(12)); isRename = true; }
    else if (line.startsWith('rename to ')) { renameNew = plainPath(line.slice(10)); isRename = true; }
    else if (line.startsWith('copy from ')) renameOld ??= plainPath(line.slice(10));
    else if (line.startsWith('copy to ')) renameNew ??= plainPath(line.slice(8));
    else if (line.startsWith('new file mode ')) isNew = true;
    else if (line.startsWith('deleted file mode ')) isDeleted = true;
    else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) isBinary = true;
  }
  // Last resort for hunkless entries (binary, mode-only): the diff --git
  // line itself; ambiguous for pathological names, same guess gitops makes
  let guessOld: string | undefined;
  let guessNew: string | undefined;
  const m = DIFF_GIT_RE.exec(stripEol(headerLines[0]));
  if (m) {
    guessOld = m[1] !== undefined ? cUnquoteBody(m[1]) : m[2];
    guessNew = m[3] !== undefined ? cUnquoteBody(m[3]) : m[4];
  }
  const oldPath = markerOld !== undefined ? markerOld
    : renameOld !== undefined ? renameOld
      : (isNew ? null : guessOld ?? null);
  const newPath = markerNew !== undefined ? markerNew
    : renameNew !== undefined ? renameNew
      : (isDeleted ? null : guessNew ?? null);
  return { oldPath, newPath, isNew, isDeleted, isRename, isBinary };
}

export function parseDiff(text: string): ParsedDiff {
  const lines = splitLines(text);
  const files: DiffFile[] = [];
  let preamble = '';
  let i = 0;
  while (i < lines.length && !lines[i].startsWith('diff --git ')) preamble += lines[i++];
  while (i < lines.length) {
    const headerLines: string[] = [lines[i++]];
    while (i < lines.length && !lines[i].startsWith('diff --git ') && !HUNK_RE.test(lines[i])) {
      headerLines.push(lines[i++]);
    }
    const hunks: DiffHunk[] = [];
    while (i < lines.length) {
      const m = HUNK_RE.exec(lines[i]);
      if (!m) break;
      let hunkText = lines[i];
      const header = stripEol(lines[i]);
      i++;
      // Counted consumption: the @@ counts say how many body lines follow;
      // "\ No newline" markers ride along without counting
      let oldLeft = m[2] === undefined ? 1 : parseInt(m[2], 10);
      let newLeft = m[4] === undefined ? 1 : parseInt(m[4], 10);
      while (i < lines.length && (oldLeft > 0 || newLeft > 0 || lines[i].startsWith('\\'))) {
        const l = lines[i];
        if (l.startsWith('\\')) { /* marker */ }
        else if (l.startsWith('+')) newLeft--;
        else if (l.startsWith('-')) oldLeft--;
        else { oldLeft--; newLeft--; }
        hunkText += l;
        i++;
      }
      hunks.push({
        text: hunkText,
        header,
        oldStart: parseInt(m[1], 10),
        oldLines: m[2] === undefined ? 1 : parseInt(m[2], 10),
        newStart: parseInt(m[3], 10),
        newLines: m[4] === undefined ? 1 : parseInt(m[4], 10),
      });
    }
    let trailer = '';
    while (i < lines.length && !lines[i].startsWith('diff --git ')) trailer += lines[i++];
    const info = parseHeader(headerLines);
    files.push({
      header: headerLines.join(''),
      ...info,
      path: info.newPath ?? info.oldPath ?? '',
      hunks,
      trailer,
    });
  }
  return { preamble, files };
}

/** Inverse of parseDiff: byte-identical to the originally parsed text */
export function serializeDiff(d: ParsedDiff): string {
  return d.preamble + d.files
    .map((f) => f.header + f.hunks.map((h) => h.text).join('') + f.trailer)
    .join('');
}

/** Patch for one hunk: verbatim file header block + the hunk verbatim */
export function buildHunkPatch(file: DiffFile, hunk: DiffHunk): string {
  return file.header + hunk.text;
}

/** Patch for a whole file entry: verbatim header + all hunks */
export function buildFilePatch(file: DiffFile): string {
  return file.header + file.hunks.map((h) => h.text).join('');
}

/** Hunk body without the @@ line, for rendering under a hunk header bar */
export function hunkBody(hunk: DiffHunk): string {
  const nl = hunk.text.indexOf('\n');
  return nl === -1 ? '' : hunk.text.slice(nl + 1);
}
