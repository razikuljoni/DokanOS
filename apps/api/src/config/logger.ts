export const logger = {
  info(message: string, meta?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'test') return;
    if (meta) {
      console.info(`[INFO] ${message}`, meta);
    } else {
      console.info(`[INFO] ${message}`);
    }
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'test') return;
    if (meta) {
      console.warn(`[WARN] ${message}`, meta);
    } else {
      console.warn(`[WARN] ${message}`);
    }
  },
  error(message: string, meta?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'test') return;
    if (meta) {
      console.error(`[ERROR] ${message}`, meta);
    } else {
      console.error(`[ERROR] ${message}`);
    }
  },
};
