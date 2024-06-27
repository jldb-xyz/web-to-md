import { URL } from 'url';
import * as cheerio from 'cheerio';
import { ICrawlerUtils, IHtmlCleanser, ILinkExtractor } from '../interfaces';

export const crawlerUtils: ICrawlerUtils & IHtmlCleanser & ILinkExtractor = {
  normalizeUrl(url: string): string {
    const parsedUrl = new URL(url);
    return `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/$/, '')}`;
  },

  isExcluded(url: string, baseUrl: string, excludePaths: string[]): boolean {
    const parsedUrl = new URL(url);
    const parsedBaseUrl = new URL(baseUrl);
    
    // Check if the URL is within the base URL
    if (parsedUrl.origin !== parsedBaseUrl.origin) {
      return true; // Exclude URLs from different origins
    }

    // Get the path relative to the base URL
    let relativePath = parsedUrl.pathname;
    if (parsedBaseUrl.pathname !== '/') {
      relativePath = relativePath.slice(parsedBaseUrl.pathname.length);
    }

    // Check if the relative path matches any of the exclude paths exactly
    return excludePaths.some(excludePath => relativePath === excludePath);
  },

  cleanseHTML(html: string): string {
    const $ = cheerio.load(html);

    // Remove unnecessary stylesheets
    $('link[rel="stylesheet"]').each((_, el) => {
      const media = $(el).attr('media');
      if (media && media.includes('print')) {
        $(el).attr('media', 'all');
      } else {
        $(el).remove();
      }
    });

    // Remove unnecessary styles
    $('style').each((_, el) => {
      if (!$(el).html()?.includes('@media print')) {
        $(el).remove();
      }
    });

    // Remove scripts
    $('script').remove();

    // Remove specific elements
    const elementsToRemove = [
      'header:not(:has(h1, h2, h3, h4, h5, h6))',
      'nav:not(:has(ul, ol))',
      'aside:not(:has(h1, h2, h3, h4, h5, h6, p))',
      'footer:not(:has(p))',
      '[role="banner"]:empty',
      '[role="navigation"]:empty',
      '[role="complementary"]:empty',
      '.header:empty',
      '.nav:empty',
      '.sidebar:empty',
      '.footer:empty',
      '.ad',
      '.advertisement'
    ];
    $(elementsToRemove.join(', ')).remove();

    // Remove inline event handlers
    $('*').each((_, el) => {
      if ('attribs' in el) {
        Object.keys(el.attribs)
          .filter(attr => attr.startsWith('on'))
          .forEach(attr => $(el).removeAttr(attr));
      }
    });

    // Set alt text for images without it
    $('img').each((_, el) => {
      if (!$(el).attr('alt')) {
        $(el).attr('alt', 'Image');
      }
    });

    return $.html();
  },

  extractLinks(html: string, baseUrl: string): string[] {
    const $ = cheerio.load(html);
    const links: string[] = [];

    $('a').each((_, el) => {
      const href = $(el).attr('href');
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
};