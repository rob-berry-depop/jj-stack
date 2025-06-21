interface Logger {
  debug(log: string, ...args: unknown[]): void;
  info(log: string, ...args: unknown[]): void;
  warn(log: string, ...args: unknown[]): void;
  error(log: string, ...args: unknown[]): void;
}

class ConsoleLogger implements Logger {
  debug(log: string, ...args: unknown[]) {
    console.log(log, ...args);
  }
  info(log: string, ...args: unknown[]) {
    console.log(log, ...args);
  }
  warn(log: string, ...args: unknown[]) {
    console.error(log, ...args);
  }
  error(log: string, ...args: unknown[]) {
    console.error(log, ...args);
  }
}

class NullLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

export const logger =
  process.env.DEBUG === "true" ? new ConsoleLogger() : new NullLogger();
