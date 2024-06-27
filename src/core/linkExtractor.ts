import { injectable } from 'inversify';
import { ILinkExtractor } from '../interfaces';
import * as cheerio from 'cheerio';

@injectable()
export class LinkExtractor implements ILinkExtractor {
  extractLinks(html: string, baseUrl: string): string[] {
    const $ = cheerio.load(html);
    const links: string[] = [];

    $('a').each((_, element) => {
      const href = $(element).attr('href');
      if (href) {
        try {
          const absoluteUrl = new URL(href, baseUrl).href;
          if (absoluteUrl.startsWith(baseUrl) && !links.includes(absoluteUrl)) {
            links.push(absoluteUrl);
          }
        } catch (error) {
          // Invalid URL, skip it
        }
      }
    });

    return links;
  }
}