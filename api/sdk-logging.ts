type LogFn = (message: string, ...rest: unknown[]) => void
export type Logger = {
  error: LogFn
  warn: LogFn
  info: LogFn
  debug: LogFn
}

export interface WithLogger {
  logger?: Logger
}
