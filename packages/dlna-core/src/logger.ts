export interface DlnaLogger {
  error(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  debug(message: string, ...meta: unknown[]): void;
}

export type LoggerFactory = (moduleName: string) => DlnaLogger;

const noopLogger: DlnaLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

let factory: LoggerFactory = () => noopLogger;

export function setLoggerFactory(f: LoggerFactory | null): void {
  factory = f ?? (() => noopLogger);
}

export function setLogger(l: DlnaLogger | null): void {
  setLoggerFactory(() => l ?? noopLogger);
}

export function createModuleLogger(moduleName: string): DlnaLogger {
  return {
    error: (m, ...a) => factory(moduleName).error(m, ...a),
    warn: (m, ...a) => factory(moduleName).warn(m, ...a),
    info: (m, ...a) => factory(moduleName).info(m, ...a),
    debug: (m, ...a) => factory(moduleName).debug(m, ...a),
  };
}

export default createModuleLogger;
