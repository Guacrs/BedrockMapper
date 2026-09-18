/**
 * Console logging for a server that is meant to run for weeks at a time.
 *
 * One line per event, always in the same shape:
 *
 *   2026-09-17T22:41:03.118Z info  terrain.updated  chunks=74 tiles=5 redrawn=5 version=2
 *
 * so `grep terrain.updated` or a log shipper can read it, while it still reads
 * like a sentence in a terminal. Events that repeat on a timer (player reports
 * every few seconds, refreshes that found nothing) are deliberately silent:
 * anything logged here is something that happened, not something that ticked.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const SEVERITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

export interface Logger {
  readonly level: LogLevel;
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** A bare line, for the startup banner where prose beats key=value. */
  plain(text: string): void;
}

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/** `key=value`, quoted only when the value would otherwise be ambiguous. */
function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '-';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Error) return quote(value.message);
  const text = String(value);
  return quote(text);
}

function quote(text: string): string {
  if (text === '') return '""';
  return /[\s"=]/.test(text) ? JSON.stringify(text) : text;
}

export function formatLine(level: LogLevel, event: string, fields: LogFields = {}): string {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`);
  // Padded so levels and events line up when scanning a terminal.
  return [new Date().toISOString(), level.padEnd(5), event.padEnd(22), parts.join(' ')]
    .join(' ')
    .trimEnd();
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Where lines go; the console by default. Tests capture them instead. */
  write?: (level: LogLevel, line: string) => void;
}

const toConsole = (level: LogLevel, line: string): void => {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const write = options.write ?? toConsole;
  const threshold = SEVERITY[level];

  const at = (wanted: LogLevel) => (event: string, fields?: LogFields) => {
    if (SEVERITY[wanted] < threshold) return;
    write(wanted, formatLine(wanted, event, fields));
  };

  return {
    level,
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    plain: (text: string) => {
      if (SEVERITY.info < threshold) return;
      write('info', text);
    },
  };
}

/** A logger that swallows everything, for tests and library-style use. */
export const silentLogger: Logger = createLogger({ level: 'error', write: () => {} });
