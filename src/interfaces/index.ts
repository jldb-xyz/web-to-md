import { CrawlOptions } from '../types';
import cliProgress from 'cli-progress';

export interface ICrawlerService {
  crawlWebsite(options: CrawlOptions): Promise<void>;
}

export interface IConfigService {
  getConfig(): CrawlOptions;
  setConfig(partialConfig: Partial<CrawlOptions>): void;
}

export interface ILoggerService {
  logInfo(message: string, ...meta: any[]): void;
  logError(message: string, ...meta: any[]): void;
  logSuccess(message: string, ...meta: any[]): void;

  log(message: string): void;
  error(message: string, error?: Error): void;

  infoWithoutInterference(message: string, ...meta: any[]): void;
  warnWithoutInterference(message: string, ...meta: any[]): void;
  errorWithoutInterference(message: string, ...meta: any[]): void;
  debugWithoutInterference(message: string, ...meta: any[]): void;

  createMultiBar(options?: cliProgress.Options): cliProgress.MultiBar;
}

export interface IFileSystemService {
  saveToFile(content: string, filePath: string): Promise<void>;
  readFile(filePath: string): Promise<string>;
  fileExists(filePath: string): Promise<boolean>;
  readDirectory(dirPath: string): Promise<string[]>;
}

export interface IHtmlCleanser {
  cleanseHTML(html: string): string;
}

export interface ILinkExtractor {
  extractLinks(html: string, baseUrl: string): string[];
}

export interface IMarkdownConverter {
  convert(html: string): string;
}

export interface ICrawlerUtils {
  normalizeUrl(url: string): string;
  isExcluded(url: string, baseUrl: string, excludePaths: string[]): boolean;
}