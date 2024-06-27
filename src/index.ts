import 'reflect-metadata';
import { container } from './di/container';
import { TYPES } from './di/types';
import { ICrawlerService, IConfigService, ILoggerService } from './interfaces';
import { program } from './cli';
import { CrawlOptions } from './types';

async function main() {
  const configService = container.get<IConfigService>(TYPES.ConfigService);
  const loggerService = container.get<ILoggerService>(TYPES.LoggerService);
  const crawlerService = container.get<ICrawlerService>(TYPES.CrawlerService);

  try {
    program.parse(process.argv);
    const options = program.opts() as CrawlOptions;

    loggerService.log('📚 Web-to-MD Crawler Starting Up!');
    loggerService.log('🔧 Updating configuration...');
    configService.setConfig(options);
    
    const config = configService.getConfig();

    if (!config.url || !config.output) {
      throw new Error('URL and output directory are required.');
    }

    loggerService.logInfo(`🌐 Starting crawl of ${config.url}`);
    loggerService.logInfo(`📁 Output directory: ${config.output}`);
    loggerService.logInfo(`🔍 Crawl depth: ${config.depth}`);
    loggerService.logInfo(`👷 Number of workers: ${config.workers}`);

    await crawlerService.crawlWebsite(config);
    loggerService.logSuccess("🎉 Crawling process completed successfully!");
  } catch (error) {
    if (error instanceof Error) {
      loggerService.error("Fatal error during crawling:", error);
    } else {
      loggerService.error("An unknown error occurred during crawling.");
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});