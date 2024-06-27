import { Container } from 'inversify';
import { CrawlerService } from '../core/crawler';
import { FileSystemService } from '../services/fileSystemService';
import { ConfigService } from '../services/configService';
import { LoggerService } from '../core/loggerService';
import { HtmlCleanser } from '../core/htmlCleanser';
import { LinkExtractor } from '../core/linkExtractor';
import { MarkdownConverter } from '../core/markdownConverter';
import { TYPES } from './types';

const container = new Container();

container.bind<CrawlerService>(TYPES.CrawlerService).to(CrawlerService);
container.bind<FileSystemService>(TYPES.FileSystemService).to(FileSystemService);
container.bind<ConfigService>(TYPES.ConfigService).to(ConfigService);
container.bind<LoggerService>(TYPES.LoggerService).to(LoggerService);
container.bind<HtmlCleanser>(TYPES.HtmlCleanser).to(HtmlCleanser);
container.bind<LinkExtractor>(TYPES.LinkExtractor).to(LinkExtractor);
container.bind<MarkdownConverter>(TYPES.MarkdownConverter).to(MarkdownConverter);

export { container };