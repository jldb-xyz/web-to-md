import { injectable, inject } from 'inversify';
import * as puppeteer from 'puppeteer';
import { CrawlOptions, PageResult, WorkerPool } from '../types';
import { ICrawlerService, ILoggerService, IFileSystemService, IConfigService, IHtmlCleanser, ILinkExtractor, IMarkdownConverter } from '../interfaces';
import { TYPES } from '../di/types';
import { StateManager } from '../services/stateManager';
import crypto from 'crypto';
import path from 'path';
import cliProgress from 'cli-progress';
import colors from 'ansi-colors';

@injectable()
export class CrawlerService implements ICrawlerService {
  private browser: puppeteer.Browser | null = null;
  private stateManager: StateManager;
  private workerPool: WorkerPool = {};
  private multibar: cliProgress.MultiBar;
  private overallProgress: cliProgress.Bar;

  constructor(
    @inject(TYPES.LoggerService) private loggerService: ILoggerService,
    @inject(TYPES.FileSystemService) private fileSystemService: IFileSystemService,
    @inject(TYPES.ConfigService) private configService: IConfigService,
    @inject(TYPES.HtmlCleanser) private htmlCleanser: IHtmlCleanser,
    @inject(TYPES.LinkExtractor) private linkExtractor: ILinkExtractor,
    @inject(TYPES.MarkdownConverter) private markdownConverter: IMarkdownConverter
  ) {
    this.stateManager = StateManager.getInstance();
    this.multibar = new cliProgress.MultiBar({
      clearOnComplete: true,
      hideCursor: true,
      format: (options, params, payload) => {
        const percentage = Math.round((params.value / params.total) * 100);
        let bar = options.barCompleteString?.substr(0, percentage) ?? '';
        if (payload.type === 'main') {
          return `${colors.cyan(bar)} ${colors.cyan(params.value + '/' + params.total)} | ${colors.green(payload.status)}`;
        } else {
          return colors.magenta(payload.status);
        }
      },
    }, cliProgress.Presets.shades_classic);

    this.overallProgress = this.multibar.create(0, 1, { status: 'Starting...', type: 'main' });
  }

  public async crawlWebsite(options: CrawlOptions): Promise<void> {
    const config = this.configService.getConfig();
    const mergedOptions = { ...config, ...options };

    this.browser = await puppeteer.launch();
    
    const rateLimiter = this.createRateLimiter(parseFloat(mergedOptions.rate || '5'));
    const numWorkers = parseInt(mergedOptions.workers || '1', 10);

    try {
      const startMessage = '🚀 Starting the crawl process...';
      this.loggerService.logInfo(colors.cyan(startMessage));
      this.overallProgress.update(0, { status: colors.cyan(startMessage) });

      await this.initializeWorkerPool(numWorkers);
      
      this.stateManager.reset();
      this.stateManager.addToQueue(mergedOptions.url, 0, '');

      await this.crawlWithWorkers(mergedOptions, rateLimiter);

      if (mergedOptions.combine) {
        const combineMessage = '📚 Combining files...';
        this.loggerService.logInfo(combineMessage);
        this.overallProgress.update(this.overallProgress.getProgress(), { status: colors.cyan(combineMessage) });
        await this.combineFiles(mergedOptions);
      }

      const successMessage = '✅ Crawl process completed successfully!';
      this.loggerService.logSuccess(colors.green(successMessage));
      this.overallProgress.update(100, { status: colors.green(successMessage) });
    } catch (error) {
      const errorMessage = '❌ Error during crawl: ' + (error instanceof Error ? error.message : String(error));
      this.loggerService.logError(colors.red(errorMessage));
      this.overallProgress.update(this.overallProgress.getProgress(), { status: colors.red(errorMessage) });
    } finally {
      await this.cleanupWorkerPool();
      if (this.browser) {
        await this.browser.close();
      }
      this.multibar.stop();
    }
  }

  private async initializeWorkerPool(numWorkers: number): Promise<void> {
    const initMessage = `👷 Initializing ${numWorkers} workers...`;
    this.loggerService.logInfo(colors.cyan(initMessage));
    this.overallProgress.update(this.overallProgress.getProgress(), { status: colors.cyan(initMessage) });
    for (let i = 0; i < numWorkers; i++) {
      const page = await this.browser!.newPage();
      this.workerPool[i] = page;
    }
  }

  private async cleanupWorkerPool(): Promise<void> {
    const cleanupMessage = '🧹 Cleaning up worker pool...';
    this.loggerService.logInfo(colors.cyan(cleanupMessage));
    this.overallProgress.update(this.overallProgress.getProgress(), { status: colors.cyan(cleanupMessage) });
    for (const page of Object.values(this.workerPool)) {
      await page.close();
    }
    this.workerPool = {};
  }

  private async crawlWithWorkers(options: CrawlOptions, rateLimiter: () => Promise<void>): Promise<void> {
    const workers = Object.keys(this.workerPool).map(Number);
    const crawlPromises = workers.map(workerId => this.workerCrawl(workerId, options, rateLimiter));
    await Promise.all(crawlPromises);
  }

  private async workerCrawl(workerId: number, options: CrawlOptions, rateLimiter: () => Promise<void>): Promise<void> {
    const page = this.workerPool[workerId];
    const workerBar = this.multibar.create(0, 0, { status: `👷 Worker ${workerId} idle` });
    
    let processedCount = 0;

    while (true) {
      const next = this.stateManager.getNextFromQueue();
      if (!next) {
        if (this.stateManager.getQueueSize() === 0 && this.stateManager.getActiveWorkers() === 0) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        this.updateOverallProgress(); // Update progress even when waiting
        continue;
      }

      this.stateManager.incrementActiveWorkers();
      const [url, depth, parentUrl] = next;
      if (!this.stateManager.isVisited(url)) {
        await rateLimiter();
        workerBar.update(processedCount, { status: `🔍 Worker ${workerId} crawling ${url}` });
        await this.crawlPage(page, url, depth, options, parentUrl);
        processedCount++;
        workerBar.update(processedCount);
      }
      this.stateManager.decrementActiveWorkers();
      this.updateOverallProgress(); // Update progress after each URL

      workerBar.setTotal(this.stateManager.getTotalUrlCount());
    }

    workerBar.update(processedCount, { status: `✅ Worker ${workerId} finished` });
  }

  private updateOverallProgress(): void {
    const totalUrls = this.stateManager.getTotalUrlCount();
    const visitedUrls = this.stateManager.getVisitedCount();
    const status = `🌐 Overall Progress: ${visitedUrls.toString().padStart(5)}/${totalUrls.toString().padStart(5)} URLs`;
    this.loggerService.debugWithoutInterference(`Updating progress: ${visitedUrls}/${totalUrls}`);
    this.overallProgress.setTotal(totalUrls);
    this.overallProgress.update(visitedUrls, { status: colors.cyan(status.padEnd(50)) });
  }

  private createRateLimiter(maxRequestsPerSecond: number): () => Promise<void> {
    const minInterval = 1000 / maxRequestsPerSecond;
    let lastRequestTime = 0;

    return async () => {
      const now = Date.now();
      const timeToWait = minInterval - (now - lastRequestTime);
      if (timeToWait > 0) {
        await new Promise(resolve => setTimeout(resolve, timeToWait));
      }
      lastRequestTime = Date.now();
    };
  }

  private async crawlPage(page: puppeteer.Page, url: string, depth: number, options: CrawlOptions, parentUrl: string): Promise<void> {
    if (depth > parseInt(options.depth)) {
      return;
    }

    this.loggerService.infoWithoutInterference(colors.yellow(`🕷️ Crawling: ${url}`));

    try {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: parseInt(options.initialTimeout) * 1000 });
      const content = await page.content();
      const cleansedHtml = this.htmlCleanser.cleanseHTML(content);

      const contentHash = crypto.createHash('md5').update(cleansedHtml).digest('hex');
      const existingHash = this.stateManager.getContentHash(url);

      if (existingHash !== contentHash) {
        const { title, markdown } = await this.processPage(cleansedHtml, url, parentUrl);
        await this.savePage(title, markdown, url, options);
        this.stateManager.setContentHash(url, contentHash);
      }

      this.stateManager.addVisited(url);

      this.loggerService.debugWithoutInterference(colors.gray(`📊 Current depth: ${depth}, Max depth: ${parseInt(options.depth)}`));

      if (depth < parseInt(options.depth)) {
        const links = this.linkExtractor.extractLinks(cleansedHtml, options.url);
        this.loggerService.debugWithoutInterference(`🔗 Extracted ${links.length} links`);

        for (const link of links) {
          const isVisited = this.stateManager.isVisited(link);
          const isExcluded = this.isExcluded(link, options);
          this.loggerService.debugWithoutInterference(`🔍 Link: ${link}, Visited: ${isVisited ? '✅' : '❌'}, Excluded: ${isExcluded ? '⛔' : '✅'}`);

          if (!isVisited && !isExcluded) {
            this.stateManager.addToQueue(link, depth + 1, url);
            this.loggerService.debugWithoutInterference(`➕ Added to queue: ${link}`);
          }
        }
      }
    } catch (error) {
      this.loggerService.errorWithoutInterference(colors.red(`❌ Error crawling ${url}: ` + (error instanceof Error ? error.message : String(error))));
    }
  }

  private isExcluded(url: string, options: CrawlOptions): boolean {
    if (!options.exclude) return false;
    const excludePaths = options.exclude.split(',');
    return excludePaths.some(path => url.includes(path));
  }

  private async processPage(html: string, url: string, parentUrl: string): Promise<PageResult> {
    const title = this.extractTitle(html);
    const markdown = this.markdownConverter.convert(html);

    const breadcrumb = parentUrl ? `Parent page: ${parentUrl}\n\n` : '';
    return { title, markdown: `URL: ${url}\n${breadcrumb}\n${markdown}` };
  }

  private extractTitle(html: string): string {
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    return titleMatch ? titleMatch[1] : 'Untitled';
  }

  private async savePage(title: string, markdown: string, url: string, options: CrawlOptions): Promise<void> {
    const sanitizedTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    let filePath: string;

    if (options.preserveStructure) {
      const parsedUrl = new URL(url);
      const relativePath = parsedUrl.pathname.replace(/^\//, '').replace(/\/$/, '');
      filePath = path.join(options.output, relativePath, `${sanitizedTitle}.md`);
    } else {
      filePath = path.join(options.output, `${sanitizedTitle}.md`);
    }

    await this.fileSystemService.saveToFile(markdown, filePath);
  }

  private async combineFiles(options: CrawlOptions): Promise<void> {
    const files = await this.fileSystemService.readDirectory(options.output);
    const mdFiles = files.filter((file: string) => file.endsWith('.md'));

    let combinedContent = '';
    let currentFileSize = 0;
    let fileCounter = 1;

    const baseFileName = options.name || path.basename(options.output);
    const maxFileSizeBytes = parseInt(options.maxFileSize || '2') * 1024 * 1024;

    for (const file of mdFiles) {
      const content = await this.fileSystemService.readFile(path.join(options.output, file));
      const fileContent = `\n\n# ${file}\n\n${content}`;
      const contentSize = Buffer.byteLength(fileContent, 'utf-8');

      if (currentFileSize + contentSize > maxFileSizeBytes) {
        await this.fileSystemService.saveToFile(combinedContent.trim(), path.join(options.output, `${baseFileName}_${fileCounter}.md`));
        combinedContent = '';
        currentFileSize = 0;
        fileCounter++;
      }

      combinedContent += fileContent;
      currentFileSize += contentSize;
    }

    if (combinedContent) {
      await this.fileSystemService.saveToFile(combinedContent.trim(), path.join(options.output, `${baseFileName}_${fileCounter}.md`));
    }
  }
}