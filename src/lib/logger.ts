/**
 * Structured Logger Module
 *
 * Provides a centralized logging utility with configurable log levels.
 * Allows controlling verbosity via LOG_LEVEL environment variable.
 *
 * Log Levels (in order of verbosity):
 * - debug: Detailed debugging information (most verbose)
 * - info: General information about operations
 * - warn: Warning messages for potential issues
 * - error: Error messages (always shown)
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('Operation completed', { count: 5 });
 *   logger.error('Failed to process', error);
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Get the current log level from environment variable
 * Defaults to 'info' in production, 'debug' in development
 */
function getCurrentLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

/**
 * Check if a log level should be output
 */
function shouldLog(level: LogLevel): boolean {
  const currentLevel = getCurrentLogLevel();
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

/**
 * Format a log message with optional context
 */
function formatMessage(prefix: string, message: string, context?: object): string {
  if (context && Object.keys(context).length > 0) {
    return `${prefix} ${message} ${JSON.stringify(context)}`;
  }
  return `${prefix} ${message}`;
}

/**
 * Structured logger with configurable levels
 */
export const logger = {
  /**
   * Log debug information (only in debug mode)
   * Use for detailed tracing and development debugging
   */
  debug(message: string, context?: object): void {
    if (shouldLog('debug')) {
      console.log(formatMessage('[DEBUG]', message, context));
    }
  },

  /**
   * Log general information
   * Use for tracking normal operations
   */
  info(message: string, context?: object): void {
    if (shouldLog('info')) {
      console.log(formatMessage('[INFO]', message, context));
    }
  },

  /**
   * Log warnings for potential issues
   * Use for non-critical problems that should be monitored
   */
  warn(message: string, context?: object): void {
    if (shouldLog('warn')) {
      console.warn(formatMessage('[WARN]', message, context));
    }
  },

  /**
   * Log errors (always shown)
   * Use for actual errors and exceptions
   */
  error(message: string, error?: unknown, context?: object): void {
    const errorDetails = error instanceof Error
      ? { errorMessage: error.message, stack: error.stack }
      : error
        ? { error: String(error) }
        : undefined;

    const mergedContext = { ...context, ...errorDetails };
    console.error(formatMessage('[ERROR]', message, mergedContext));
  },

  /**
   * Create a child logger with a prefix for a specific module
   * Useful for identifying log sources in large applications
   *
   * @param module - Module name to prefix logs with (e.g., 'RAG', 'Qdrant')
   */
  child(module: string) {
    const prefix = `[${module}]`;
    return {
      debug: (message: string, context?: object) =>
        logger.debug(`${prefix} ${message}`, context),
      info: (message: string, context?: object) =>
        logger.info(`${prefix} ${message}`, context),
      warn: (message: string, context?: object) =>
        logger.warn(`${prefix} ${message}`, context),
      error: (message: string, error?: unknown, context?: object) =>
        logger.error(`${prefix} ${message}`, error, context),
    };
  },
};

// Pre-configured child loggers for common modules
export const ragLogger = logger.child('RAG');
export const toolsLogger = logger.child('Tools');
export const ingestLogger = logger.child('Ingest');
export const rerankerLogger = logger.child('Reranker');

export default logger;
