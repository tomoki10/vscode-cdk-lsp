import * as path from 'path';

export interface ParsedSynthError {
  message: string;
  code?: string;
  file: string;
  line: number;
  character: number;
}

// The server forwards synth stderr line-by-line via window/logMessage and strips
// the leading indentation of each line, so frames arrive as "at ... (file:1:2)"
// with no leading whitespace. Match with optional leading spaces.
// サーバーは synth の stderr を1行ずつ window/logMessage で転送し、その際に
// 各行の先頭インデントを除去する。そのためフレームは行頭空白なしの
// "at ... (file:1:2)" 形式で届く。先頭空白は任意でマッチさせる。
const NODE_FRAME_WITH_PARENS = /^\s*at\s+.*?\((.+?):(\d+):(\d+)\)\s*$/;
const NODE_FRAME_BARE = /^\s*at\s+(.+?):(\d+):(\d+)\s*$/;
const GUILLEMET_LINE = /^«([^»]+)»\s*(.*)$/;
const ERROR_SHAPED_LINE = /^[A-Za-z_][\w.]*(?:Error|Exception)\b\s*:\s*.+$/;
const PYTHON_FRAME = /^\s*File "(.+?)", line (\d+)/;

// Noise lines that appear around the real message in Node crash output
// (uncaught-exception banner, source-pointer caret, abbreviated frames, etc.).
// Node のクラッシュ出力でメッセージの周りに混ざるノイズ行
// (uncaughtException のバナー、キャレット、省略表記のフレームなど)。
const NOISE_LINE = /^(\^|node:internal\/|triggerUncaughtException|Node\.js v|\.\.\..*\.\.\.$|npm warn )/;

function isInsideApplicationDir(filePath: string, applicationDir: string, excludedSegments: string[]): boolean {
  if (!path.isAbsolute(filePath)) {
    return false;
  }

  const relative = path.relative(applicationDir, filePath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return false;
  }

  return !excludedSegments.some((segment) => relative.split(path.sep).includes(segment));
}

function matchNodeFrame(line: string): { file: string; line: number; character: number } | undefined {
  const match = NODE_FRAME_WITH_PARENS.exec(line) ?? NODE_FRAME_BARE.exec(line);

  if (!match) {
    return undefined;
  }

  return {
    file: match[1],
    line: Math.max(0, Number(match[2]) - 1),
    character: Math.max(0, Number(match[3]) - 1),
  };
}

function parseNodeError(logText: string, applicationDir: string): ParsedSynthError | undefined {
  const lines = logText.split('\n').map((line) => line.trimEnd());
  const firstFrameIndex = lines.findIndex((line) => matchNodeFrame(line) !== undefined);

  if (firstFrameIndex === -1) {
    return undefined;
  }

  // Topmost in-app frame = the frame closest to the throw site inside user code.
  // アプリ内の最上位フレーム = ユーザーコード内で throw 地点に最も近いフレーム。
  let frame: { file: string; line: number; character: number } | undefined;

  for (const line of lines.slice(firstFrameIndex)) {
    const candidate = matchNodeFrame(line);

    if (candidate && isInsideApplicationDir(candidate.file, applicationDir, ['node_modules'])) {
      frame = candidate;
      break;
    }
  }

  if (!frame) {
    return undefined;
  }

  // Message: prefer the «ErrorName» line CDK errors print, then a generic
  // "SomeError: ..." line, then the nearest non-noise line above the frames.
  // メッセージ: CDK エラーが出力する «エラー名» 行を最優先し、次に一般的な
  // "SomeError: ..." 形式の行、最後にフレーム直前の非ノイズ行を採用する。
  const headLines = lines.slice(0, firstFrameIndex);
  let message: string | undefined;
  let code: string | undefined;

  for (let i = headLines.length - 1; i >= 0; i--) {
    const guillemet = GUILLEMET_LINE.exec(headLines[i]);

    if (guillemet) {
      code = guillemet[1];
      message = guillemet[2].trim();
      break;
    }
  }

  if (!message) {
    message = [...headLines].reverse().find((line) => ERROR_SHAPED_LINE.test(line));
  }

  if (!message) {
    message = [...headLines]
      .reverse()
      .find((line) => line.trim().length > 0 && !NOISE_LINE.test(line.trim()));
  }

  if (!message || /Subprocess exited with error/.test(message)) {
    return undefined;
  }

  const constructTreeIndex = lines.findIndex((line) => /^Relates to construct:/.test(line));

  if (constructTreeIndex !== -1) {
    const constructTree: string[] = [];

    for (const line of lines.slice(constructTreeIndex)) {
      if (line.trim().length === 0 || /^Node\.js v/.test(line)) {
        break;
      }

      constructTree.push(line);
    }

    message = [message, ...constructTree].join('\n');
  }

  return { message, code, file: frame.file, line: frame.line, character: frame.character };
}

function parsePythonError(logText: string, applicationDir: string): ParsedSynthError | undefined {
  const tracebackIndex = logText.indexOf('Traceback (most recent call last):');

  if (tracebackIndex === -1) {
    return undefined;
  }

  const lines = logText.slice(tracebackIndex).split('\n');
  let frame: { file: string; line: number } | undefined;

  for (const line of lines) {
    const match = PYTHON_FRAME.exec(line);

    if (!match || !isInsideApplicationDir(match[1], applicationDir, ['node_modules', 'site-packages', '.venv'])) {
      continue;
    }

    // Python のトレースバックは内側(throw 地点)が最後に来るので上書きし続ける
    frame = { file: match[1], line: Math.max(0, Number(match[2]) - 1) };
  }

  if (!frame) {
    return undefined;
  }

  const lastLine = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !NOISE_LINE.test(line))
    .pop();

  if (!lastLine) {
    return undefined;
  }

  const separatorIndex = lastLine.indexOf(': ');
  const candidateCode = separatorIndex === -1 ? undefined : lastLine.slice(0, separatorIndex);
  const code = candidateCode && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(candidateCode) ? candidateCode : undefined;

  return { message: lastLine, code, file: frame.file, line: frame.line, character: 0 };
}

export function parseSynthError(logText: string, applicationDir: string): ParsedSynthError | undefined {
  return parseNodeError(logText, applicationDir) ?? parsePythonError(logText, applicationDir);
}
