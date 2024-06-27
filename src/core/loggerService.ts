import { injectable, inject } from 'inversify';
import { ILoggerService, IConfigService } from '../interfaces';
import { TYPES } from '../di/types';
import colors from 'ansi-colors';
import cliProgress from 'cli-progress';

@injectable()
export class LoggerService implements ILoggerService {
  private logLevel: string;

  constructor(@inject(TYPES.ConfigService) private configService: IConfigService) {
    this.logLevel = this.configService.getConfig().logLevel || 'silent';
  }

  private shouldLog(level: string): boolean {
    const levels = ['silent', 'error', 'warn', 'info', 'debug'];
    return levels.indexOf(level) <= levels.indexOf(this.logLevel);
  }

  log(message: string): void {
    if (this.shouldLog('info')) {
      console.log(message);
    }
  }

  error(message: string, error?: Error): void {
    if (this.shouldLog('error')) {
      console.error(colors.red(`❌ ${message}`));
      if (error) {
        console.error(error.stack);
      }
    }
  }

  warn(message: string): void {
    if (this.shouldLog('warn')) {
      console.warn(colors.yellow(`⚠️ ${message}`));
    }
  }

  debug(message: string): void {
    if (this.shouldLog('debug')) {
      console.debug(colors.gray(`🔍 ${message}`));
    }
  }

  logInfo(message: string): void {
    if (this.shouldLog('info')) {
      console.log(colors.cyan(`ℹ️ ${message}`));
    }
  }

  logSuccess(message: string): void {
    if (this.shouldLog('info')) {
      console.log(colors.green(`✅ ${message}`));
    }
  }

  logWarning(message: string): void {
    this.warn(message);
  }

  logError(message: string): void {
    this.error(message);
  }

  createMultiBar(options?: cliProgress.Options): cliProgress.MultiBar {
    const mbar = new cliProgress.MultiBar({
      clearOnComplete: false,
      hideCursor: true,
      format: colors.cyan('{bar}') + ' {percentage}% | ETA: {eta}s | {value}/{total} | {status}',
      ...options
    }, cliProgress.Presets.shades_classic);
    return mbar;
  }

  logWithoutInterference(message: string, ...meta: any[]): void {
    if (this.shouldLog('info')) {
      process.stderr.clearLine(1);
      console.log(message, ...meta);
    }
  }

  infoWithoutInterference(message: string, ...meta: any[]): void {
    if (this.shouldLog('info')) {
      this.logWithoutInterference(colors.cyan(`ℹ️ ${message}`), ...meta);
    }
  }

  warnWithoutInterference(message: string, ...meta: any[]): void {
    if (this.shouldLog('warn')) {
      this.logWithoutInterference(colors.yellow(`⚠️ ${message}`), ...meta);
    }
  }

  errorWithoutInterference(message: string, ...meta: any[]): void {
    if (this.shouldLog('error')) {
      this.logWithoutInterference(colors.red(`❌ ${message}`), ...meta);
    }
  }

  debugWithoutInterference(message: string, ...meta: any[]): void {
    if (this.shouldLog('debug')) {
      this.logWithoutInterference(colors.gray(`🔍 ${message}`), ...meta);
    }
  }
}
