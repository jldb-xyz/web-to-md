import { Container } from 'inversify';
import { CrawlerService } from '../core/crawler';
import { ILoggerService, IFileSystemService, IConfigService, IHtmlCleanser, ILinkExtractor, IMarkdownConverter } from '../interfaces';
import { TYPES } from '../di/types';
import { CrawlOptions } from '../types';

describe('CrawlerService', () => {
  let container: Container;
  let crawlerService: CrawlerService;
  let mockOptions: CrawlOptions;
  let mockLoggerService: ILoggerService;
  let mockFileSystemService: IFileSystemService;

  beforeEach(() => {
    container = new Container();

    // Mock services
    mockLoggerService = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };
    container.bind<ILoggerService>(TYPES.LoggerService).toConstantValue(mockLoggerService);

    mockFileSystemService = {
      saveToFile: jest.fn(),
      readFile: jest.fn(),
      fileExists: jest.fn(),
      readDirectory: jest.fn(),
    };
    container.bind<IFileSystemService>(TYPES.FileSystemService).toConstantValue(mockFileSystemService);

    container.bind<IConfigService>(TYPES.ConfigService).toConstantValue({
      getConfig: jest.fn(),
      setConfig: jest.fn(),
    });

    container.bind<IHtmlCleanser>(TYPES.HtmlCleanser).toConstantValue({
      cleanseHTML: jest.fn(),
    });

    container.bind<ILinkExtractor>(TYPES.LinkExtractor).toConstantValue({
      extractLinks: jest.fn(),
    });

    container.bind<IMarkdownConverter>(TYPES.MarkdownConverter).toConstantValue({
      convert: jest.fn(),
    });

    container.bind<CrawlerService>(TYPES.CrawlerService).to(CrawlerService);

    crawlerService = container.get<CrawlerService>(TYPES.CrawlerService);

    mockOptions = {
      url: 'https://example.com',
      output: 'output',
      depth: '2',
      timeout: '5000',
      rate: '5',
      maxFileSize: '2',
      initialTimeout: '10000',
      retries: '3',
      workers: '1',
      combine: false,
      exclude: '',
      name: '',
      preserveStructure: false,
    };
  });

  it('should log the crawling process', async () => {
    // Mock the browser and page
    const mockPage = {
      goto: jest.fn().mockResolvedValue(undefined),
      content: jest.fn().mockResolvedValue('<html><head><title>Test Title</title></head><body>Test content</body></html>'),
    };
    const mockBrowser = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn(),
    };
    (global as any).puppeteer = {
      launch: jest.fn().mockResolvedValue(mockBrowser),
    };

    await crawlerService.crawlWebsite(mockOptions);

    expect(mockLoggerService.log).toHaveBeenCalledWith('Crawling: https://example.com');
    expect(mockFileSystemService.saveToFile).toHaveBeenCalled();
  });

  // Add more tests as needed
});