#!/usr/bin/env node

import { Command } from 'commander';
import * as puppeteer from 'puppeteer';
import TurndownService from 'turndown';
import * as fs from 'fs';
import * as path from 'path';
import CliProgress from 'cli-progress';
import colors from 'ansi-colors';
import crypto from 'crypto';
import * as os from 'os';
import { TimeoutError } from 'puppeteer';
import { EventEmitter } from 'events';
import { exit } from 'process';
import * as util from 'util';

const program = new Command();

program
  .version('1.0.0')
  .description('A CLI tool to crawl documentation websites and convert them to Markdown')
  .option('-u, --url <url>', 'URL of the documentation website to crawl')
  .option('-o, --output <output>', 'Output directory')
  .option('-c, --combine', 'Combine all pages into a single Markdown file')
  .option('-e, --exclude <paths>', 'Comma-separated list of paths to exclude from crawling')
  .option('-r, --rate <rate>', 'Maximum pages per second to crawl', '5')
  .option('-d, --depth <depth>', 'Maximum depth to crawl', '3')
  .option('-m, --max-file-size <size>', 'Maximum file size in MB for combined output', '2')
  .option('-n, --name <name>', 'Name for the combined output file')
  .option('-p, --preserve-structure', 'Preserve directory structure when not combining files')
  .option('-t, --timeout <timeout>', 'Timeout in seconds for page navigation', '3.5')
  .option('-i, --initial-timeout <initialTimeout>', 'Initial timeout in seconds for the first page load', '60')
  .option('-re, --retries <retries>', 'Number of retries for initial page load', '3')
  .option('-w, --workers <workers>', 'Number of concurrent workers', '1')
  .parse(process.argv);

const options = program.opts();
const excludePaths = options.exclude ? options.exclude.split(',') : [];
let totalEstimatedPages = 100;

interface CrawlState {
  visited: string[];
  queue: [string, number, string][]; // Add title to the queue
  jobId: string;
  contentHashes?: { [url: string]: string };
  settings: {
    url: string;
    outputDir: string;
    excludePaths: string[];
    maxPagesPerSecond: number;
    maxDepth: number;
    maxFileSizeMB: number;
    combine: boolean;
    name: string | undefined;
    preserveStructure: boolean;
    timeout: number;
    initialTimeout: number;
    retries: number;
    numWorkers: number;
  };
}

function getJobDirectory(baseDir: string, url: string): string {
  const urlHash = crypto.createHash('md5').update(url).digest('hex');
  return path.join(baseDir, `job_${urlHash}`);
}

// Create a new EventEmitter for state updates
const stateEmitter = new EventEmitter();

// Modify the saveState function to emit an event
function saveState(jobDir: string, state: CrawlState): void {
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'state.json'), JSON.stringify(state));
  stateEmitter.emit('stateUpdated', state);
}

function loadState(jobDir: string): CrawlState | null {
  const statePath = path.join(jobDir, 'state.json');
  if (fs.existsSync(statePath)) {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  }
  return null;
}

function isExcluded(url: string, baseUrl: string, excludePaths: string[]): boolean {
  const urlPath = new URL(url).pathname;
  return excludePaths.some(excludePath => urlPath.startsWith(excludePath));
}

async function saveToFile(content: string, filePath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content);
}

async function combineFiles(jobDir: string, outputDir: string, maxFileSizeMB: number, name: string | undefined, url: string): Promise<void> {
  const files = await fs.promises.readdir(jobDir);
  const mdFiles = files.filter(file => file.endsWith('.md'));

  let combinedContent = '';
  let currentFileSize = 0;
  let fileCounter = 1;

  // Use the provided name, or fallback to the URL's hostname
  const baseFileName = name || new URL(url).hostname;

  for (const file of mdFiles) {
    const content = await fs.promises.readFile(path.join(jobDir, file), 'utf-8');
    const fileContent = `\n\n# ${file}\n\n${content}`;
    const contentSize = Buffer.byteLength(fileContent, 'utf-8');

    if (currentFileSize + contentSize > maxFileSizeMB * 1024 * 1024) {
      // Save current combined content and start a new file
      await saveToFile(combinedContent.trim(), path.join(outputDir, `${baseFileName}_${fileCounter}.md`));
      combinedContent = '';
      currentFileSize = 0;
      fileCounter++;
    }

    combinedContent += fileContent;
    currentFileSize += contentSize;
  }

  // Save any remaining content
  if (combinedContent) {
    await saveToFile(combinedContent.trim(), path.join(outputDir, `${baseFileName}_${fileCounter}.md`));
  }
}

async function moveFiles(jobDir: string, outputDir: string, preserveStructure: boolean): Promise<void> {
  const files = await fs.promises.readdir(jobDir);
  await Promise.all(
    files
      .filter(file => file.endsWith('.md'))
      .map(file => {
        const filePath = path.join(jobDir, file);
        const fileName = path.basename(file);
        const newFilePath = preserveStructure
          ? path.join(outputDir, path.dirname(file), fileName)
          : path.join(outputDir, fileName);
        return fs.promises.rename(filePath, newFilePath);
      })
  );
}

async function savePageContent(page: puppeteer.Page, url: string, jobDir: string, turndownService: TurndownService): Promise<{ title: string, contentHash: string }> {
  const content = await page.content();
  const markdown = turndownService.turndown(content);
  const title = await page.title();
  const sanitizedTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const contentHash = crypto.createHash('md5').update(markdown).digest('hex');
  const fileName = `${sanitizedTitle}_${crypto.createHash('md5').update(url).digest('hex')}.md`;
  const filePath = path.join(jobDir, fileName);
  await saveToFile(markdown, filePath);
  return { title: sanitizedTitle, contentHash };
}

// Add these variables before the crawlWebsite function
const crawlerEvents = new EventEmitter();
let activeWorkers = 0;
let isFinishing = false;
let queue: [string, number, string][] = [];
let visited: Set<string> = new Set();
let state: CrawlState;

// Add these variables at the global scope
let multibar: CliProgress.MultiBar;
let browser: puppeteer.Browser;
let isCleaningUp = false;

// Add this function to check if all work is done
function isWorkComplete(): boolean {
  const complete = queue.length === 0 && activeWorkers === 0;
  logger.log(`isWorkComplete check: queue length = ${queue.length}, active workers = ${activeWorkers}, result = ${complete}`);
  return complete;
}

// Add these variables at the global scope
const DEBUG = process.env.DEBUG === 'true';
let logger: Console;

if (DEBUG) {
  logger = new console.Console({
    stdout: process.stdout,
    stderr: process.stderr,
    inspectOptions: {depth: null, colors: true}
  });
} else {
  logger = {
    log: () => {},
    error: console.error,
    warn: console.warn,
    debug: () => {},
  } as Console;
}

function readConfigFile(outputDir: string): CrawlState | null {
  const configPath = path.join(outputDir, 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const configData = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(configData) as CrawlState;
    } catch (error) {
      console.error('Error reading config file:', error);
    }
  }
  return null;
}

async function crawlWebsite(url: string, outputDir: string, excludePaths: string[], maxPagesPerSecond: number, maxDepth: number, maxFileSizeMB: number, combine: boolean, name: string | undefined, preserveStructure: boolean, timeout: number, initialTimeout: number, retries: number, numWorkers: number): Promise<void> {
  logger.log('Starting crawl process');

  const turndownService = new TurndownService();
  const jobDir = getJobDirectory(outputDir, url);

  const config = readConfigFile(outputDir);
  if (config) {
    logger.log('Using config file');
    ({ url, outputDir, excludePaths, maxPagesPerSecond, maxDepth, maxFileSizeMB, combine, name, preserveStructure, timeout, initialTimeout, retries, numWorkers } = config.settings);
    state = config;
    visited = new Set<string>(state.visited);
    queue = state.queue;
  } else {
    logger.log('No config file found, using provided parameters');
    state = loadState(getJobDirectory(outputDir, url)) || {
      visited: [],
      queue: [[url, 0, '']],
      jobId: crypto.randomUUID(),
      settings: {
        url,
        outputDir,
        excludePaths,
        maxPagesPerSecond,
        maxDepth,
        maxFileSizeMB,
        combine,
        name,
        preserveStructure,
        timeout,
        initialTimeout,
        retries,
        numWorkers
      }
    };
    // Use saved settings if resuming
    ({ url, outputDir, excludePaths, maxPagesPerSecond, maxDepth, maxFileSizeMB, combine, name, preserveStructure, timeout, initialTimeout, retries, numWorkers } = state.settings);
    visited = new Set<string>(state.visited);
    queue = state.queue;
  }

  browser = await puppeteer.launch({});

  let overallProgress: CliProgress.SingleBar | null;
  let multibar: CliProgress.MultiBar | null;
  
  if (!DEBUG) {
    multibar = new CliProgress.MultiBar({
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
    }, CliProgress.Presets.shades_classic);
    overallProgress = multibar.create(0, 0, { status: 'Starting...', type: 'main' });
  } else {
    multibar = null;
    overallProgress = null;
  }

  const workerBars = new Map();

  activeWorkers = numWorkers;

  const workerPool = await Promise.all(
    Array(numWorkers).fill(null).map(async (_, id) => ({
      page: await browser.newPage(),
      id: id + 1
    }))
  );

  for (let i = 0; i < numWorkers; i++) {
    workerBars.set(i + 1, multibar ? multibar.create(1, 0, { status: `Worker ${i + 1}: Idle`, type: 'worker' }) : null);
  }

  async function crawlPage(worker: puppeteer.Page, workerId: number): Promise<void> {
    logger.log(`Worker ${workerId} starting`);
    const workerBar = workerBars.get(workerId);
    const workerCrawlInterval = 1000 / maxPagesPerSecond;
    let lastCrawlTime = Date.now();

    try {
      while (!isFinishing) {
        const item = queue.shift();
        if (!item) {
          logger.log(`Worker ${workerId} waiting for new URLs. Queue length: ${queue.length}, Active workers: ${activeWorkers}`);
          if (workerBar) workerBar.update(0, { status: `Worker ${workerId}: Waiting for new URLs` });
          const hasNewUrls = await waitForNewUrls(5000); // Add a timeout of 5 seconds
          if (!hasNewUrls) {
            logger.log(`Worker ${workerId} finishing as no more work is available`);
            break;
          }
          continue;
        }
    
        const [currentUrl, depth, parentTitle] = item;
        logger.log(`Worker ${workerId} processing URL: ${currentUrl}, Depth: ${depth}, Parent: ${parentTitle}`);
    
        // Update overall progress at the start of each iteration
        if (overallProgress) overallProgress.update(visited.size, { status: `Crawled: ${visited.size}, Queued: ${queue.length}, Estimated: ${totalEstimatedPages}` });
    
        if (visited.has(currentUrl) || isExcluded(currentUrl, url, excludePaths) || depth > maxDepth) {
          continue;
        }
    
        visited.add(currentUrl);
    
        if (workerBar) workerBar.update(0, { status: `Worker ${workerId}: 🔍 Crawling ${colors.cyan(currentUrl)}` });
    
        try {
          let navigated = false;
          if (await canClickTo(worker, currentUrl)) {
            if (workerBar) workerBar.update(0, { status: `Worker ${workerId}: 🖱️ Clicking to ${colors.cyan(currentUrl)}` });
            await clickAndWait(worker, currentUrl, timeout * 1000, workerId, depth, parentTitle);
            navigated = true;
          }
    
          if (!navigated) {
            if (workerBar) workerBar.update(0, { status: `Worker ${workerId}: 🌐 Navigating to ${colors.cyan(currentUrl)}` });
            const isInitialNavigation = visited.size === 1;
            const navigationTimeout = isInitialNavigation ? initialTimeout * 1000 : timeout * 1000;
            const maxRetries = isInitialNavigation ? retries : 1;
    
            let success = false;
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              try {
                const response = await worker.goto(currentUrl, { waitUntil: 'networkidle0', timeout: navigationTimeout });
                success = true;
    
                // Check for redirects
                const finalUrl = worker.url();
                if (finalUrl !== currentUrl) {
                  if (workerBar) workerBar.update(0, { status: `Worker ${workerId}: 🔀 Redirected from ${colors.yellow(currentUrl)} to ${colors.green(finalUrl)}` });
                  visited.add(finalUrl);
                  if (!isExcluded(finalUrl, url, excludePaths)) {
                    queue.push([finalUrl, depth, parentTitle]);
                  }
                }
    
                break; // If successful, exit the retry loop
              } catch (error) {
                if (error instanceof TimeoutError && attempt < maxRetries) {
                  if (workerBar) workerBar.update(0, { status: `Worker ${workerId}: ⏱️ Timeout on attempt ${attempt}/${maxRetries} for ${colors.yellow(currentUrl)} - Retrying...` });
                  await worker.reload({ waitUntil: 'networkidle0', timeout: navigationTimeout });
                } else {
                  throw error; // Rethrow if it's not a timeout or we've exhausted retries
                }
              }
            }
    
            if (!success) {
              throw new Error(`Failed to load ${currentUrl} after ${maxRetries} attempts`);
            }
          }
    
          const { title: pageTitle, contentHash } = await savePageContent(worker, currentUrl, jobDir, turndownService);
          const existingHash = state.contentHashes ? state.contentHashes[currentUrl] : null;
          if (existingHash && existingHash === contentHash) {
            if (workerBar) workerBar.update(0, { status: `Worker ${workerId}: 🔄 No changes for ${colors.green(pageTitle)}` });
          } else {
            if (workerBar) workerBar.update(0, { status: `Worker ${workerId}: 💾 Saved ${colors.green(pageTitle)}` });
            if (!state.contentHashes) state.contentHashes = {};
            state.contentHashes[currentUrl] = contentHash;
          }
    
          if (depth < maxDepth) {
            const newUrls = await worker.evaluate((baseUrl) => {
              const links = Array.from(document.querySelectorAll('a'));
              return links
                .map(link => ({ href: link.href, text: link.textContent || '' }))
                .filter(({ href }) => href.startsWith(baseUrl) && !href.includes('#'));
            }, url);
    
            let addedUrls = 0;
            for (const { href: newUrl, text: linkText } of newUrls) {
              if (!visited.has(newUrl) && !isExcluded(newUrl, url, excludePaths) && !isInQueue(newUrl)) {
                queue.push([newUrl, depth + 1, linkText]);
                addedUrls++;
                if (overallProgress) overallProgress.setTotal(queue.length + visited.size);
                crawlerEvents.emit('urlAdded');  // Add this line
              }
            }
            if (workerBar) workerBar.update(0, { status: `Worker ${workerId}: ➕ Added ${colors.yellow(addedUrls.toString())} new URLs` });
          }
    
          if (overallProgress) overallProgress.update(visited.size, { status: `🕷️ Crawling: (Crawled: ${visited.size}, Queued: ${queue.length})` });
          if (workerBar) workerBar.update(0, { status: `Worker ${workerId}: ✅ Completed ${colors.green(currentUrl)}` });
        } catch (error) {
          if (error instanceof puppeteer.TimeoutError) {
            if (workerBar) workerBar.update(0, { status: `Worker ${workerId}: ⏱️ Timeout: ${colors.yellow(currentUrl)} - Requeueing` });
            queue.push([currentUrl, depth, parentTitle]);
          } else if (
            error instanceof Error &&
            'name' in error &&
            error.name === 'HttpError' &&
            'response' in error &&
            typeof error.response === 'object' &&
            error.response !== null &&
            'status' in error.response &&
            error.response.status === 401
          ) {
            if (workerBar) workerBar.update(0, { status: `Worker ${workerId}: 🚫 Unauthorized: ${colors.red(currentUrl)} - Exiting` });
            process.exit(1);
          } else {
            if (workerBar) workerBar.update(0, { status: `Worker ${workerId}: ❌ Error: ${colors.red(currentUrl)} - ${colors.red(error instanceof Error ? error.message : 'Unknown error')}` });
          }
        }
    
        const now = Date.now();
        const timeToWait = Math.max(0, workerCrawlInterval - (now - lastCrawlTime));
        await new Promise(resolve => setTimeout(resolve, timeToWait));
        lastCrawlTime = Date.now();
    
        // Update and save state after processing each URL
        updateAndSaveState();
    
        // Check if work is complete after processing each URL
        if (isWorkComplete()) {
          logger.log(`Worker ${workerId} detected work completion`);
          break;
        }
      }
    } finally {
      if (workerBar) workerBar.update(1, { status: `Worker ${workerId}: 🏁 Finished` });
      logger.log(`Worker ${workerId} exiting`);
      activeWorkers--;
      logger.log(`Active workers after ${workerId} exit: ${activeWorkers}`);
      crawlerEvents.emit('workerFinished');
    }
  }

  async function canClickTo(page: puppeteer.Page, url: string): Promise<boolean> {
    return page.evaluate((targetUrl) => {
      const link = Array.from(document.querySelectorAll('a')).find(a => a.href === targetUrl);
      return !!link && link.offsetParent !== null;
    }, url);
  }

  async function clickAndWait(page: puppeteer.Page, url: string, timeout: number, workerId: number, depth: number, parentTitle: string): Promise<void> {
    try {
      await Promise.race([
        Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0', timeout }),
          page.evaluate((targetUrl) => {
            const link = Array.from(document.querySelectorAll('a')).find(a => a.href === targetUrl);
            if (link) link.click();
            else throw new Error('Link not found');
          }, url),
        ]),
        new Promise((_, reject) => setTimeout(() => reject(new TimeoutError('Navigation timeout')), timeout + 5000))
      ]);
    } catch (error) {
      if (workerBars.get(workerId)) workerBars.get(workerId).update(0, { status: `Worker ${workerId}: ⚠️ Click and wait failed for ${colors.yellow(url)}: ${colors.red(error instanceof Error ? error.message : 'Unknown error')}` });
      // Fallback to direct navigation
      await page.goto(url, { waitUntil: 'networkidle0', timeout });
    }

    // Check if we've been redirected
    const currentUrl = page.url();
    if (currentUrl !== url) {
      if (workerBars.get(workerId)) workerBars.get(workerId).update(0, { status: `Worker ${workerId}: 🔀 Redirected from ${colors.yellow(url)} to ${colors.green(currentUrl)}` });
      visited.add(currentUrl);
      if (!isExcluded(currentUrl, state.settings.url, state.settings.excludePaths)) {
        queue.push([currentUrl, depth, parentTitle]);
      }
    }
  }

  function isInQueue(url: string): boolean {
    return queue.some(([queuedUrl]) => queuedUrl === url);
  }

  function updateAndSaveState() {
    state = {
      visited: Array.from(visited),
      queue: queue,
      jobId: state.jobId,
      settings: state.settings
    };
    saveState(getJobDirectory(outputDir, url), state);

    // Update total estimated pages to exact count
    totalEstimatedPages = visited.size + queue.length;
    if (overallProgress) overallProgress.setTotal(totalEstimatedPages);

    // Update overall progress
    if (overallProgress) overallProgress.update(visited.size, { status: `Crawled: ${visited.size}, Queued: ${queue.length}, Total: ${totalEstimatedPages}` });

    logger.log('State updated:', { visitedCount: visited.size, queueLength: queue.length, totalEstimatedPages, activeWorkers });

    if (isWorkComplete()) {
      logger.log('Work complete detected in updateAndSaveState. Initiating shutdown.');
      isFinishing = true;
    }
  }

  const crawlTimeout = setTimeout(() => {
    logger.log('Crawl timeout reached. Initiating shutdown.');
    isFinishing = true;
  }, initialTimeout * 1000 * 10); // Use initialTimeout * 10 for overall crawl timeout

  try {
    // Create a promise for each worker
    const workerPromises = workerPool.map(({ page, id }) => crawlPage(page, id));

    // Set up an interval to periodically save the state and check for completion
    const checkInterval = setInterval(() => {
      updateAndSaveState();
      logger.log(`Check interval: Active workers: ${activeWorkers}, Queue length: ${queue.length}`);
      if (isWorkComplete()) {
        isFinishing = true;
        clearInterval(checkInterval);
      }
    }, 1000);

    // Wait for all workers to finish
    await Promise.all(workerPromises);

    clearInterval(checkInterval);

    if (overallProgress) overallProgress.update(visited.size, { status: 'Complete!' });
    if (multibar) multibar.stop();

    if (combine) {
      await combineFiles(getJobDirectory(outputDir, url), outputDir, maxFileSizeMB, name, url);
    } else {
      await moveFiles(getJobDirectory(outputDir, url), outputDir, preserveStructure);
    }

    console.log('Crawling completed successfully.');
  } catch (error) {
    console.error('Error during crawling:', error);
  } finally {
    clearTimeout(crawlTimeout);
    // Cleanup
    await cleanup();
    if (isWorkComplete()) {
      // Save the final state as the config file
      const configPath = path.join(outputDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(state, null, 2));
      console.log('Crawl completed. Config file saved for future use.');
    } else {
      console.log('Crawl interrupted. Job directory preserved for resuming later.');
    }
  }
}

// Add this function to handle cleanup
async function cleanup() {
  if (isCleaningUp) return; // Prevent multiple cleanup calls
  isCleaningUp = true;

  logger.log('\nCleaning up...');
  if (multibar && !DEBUG) {
    multibar.stop();
  }
  if (browser) {
    await browser.close();
  }
  logger.log('Cleanup completed.');
}

// Modify event listeners
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT. Initiating graceful shutdown...');
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM. Initiating graceful shutdown...');
  await cleanup();
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  await cleanup();
  process.exit(1);
});

// Modify the main function to handle errors
async function main() {
  logger.log('Starting main function');
  try {
    const maxPagesPerSecond = parseFloat(options.rate);
    const maxDepth = parseInt(options.depth);
    const maxFileSizeMB = parseFloat(options.maxFileSize);
    const timeout = parseFloat(options.timeout);
    const initialTimeout = parseFloat(options.initialTimeout);
    const retries = parseInt(options.retries);
    const numWorkers = parseInt(options.workers);

    await crawlWebsite(options.url, options.output, excludePaths, maxPagesPerSecond, maxDepth, maxFileSizeMB, options.combine, options.name, options.preserveStructure, timeout, initialTimeout, retries, numWorkers);
    logger.log("Crawling process completed.");
    
    // Wait for all workers to finish
    while (activeWorkers > 0) {
      logger.log(`Waiting for workers to finish. Active workers: ${activeWorkers}`);
      await new Promise(resolve => crawlerEvents.once('workerFinished', resolve));
    }
    
    logger.log("All workers have finished. Cleaning up job directory...");
    // Add this line to clean up the job directory
    await fs.promises.rm(getJobDirectory(options.output, options.url), { recursive: true, force: true });
    logger.log("Job directory cleaned up. Exiting...");
  } catch (error) {
    logger.error("Fatal error during crawling:", error);
  } finally {
    await cleanup();
    process.exit(0);
  }
}

function waitForNewUrls(timeout: number): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    if (queue.length > 0) {
      logger.log('New URLs available immediately');
      resolve(true);
    } else {
      const checkQueue = () => {
        if (queue.length > 0) {
          logger.log('New URLs added to queue');
          crawlerEvents.removeListener("urlAdded", checkQueue);
          clearTimeout(timeoutId);
          resolve(true);
        } else if (isWorkComplete()) {
          logger.log('No new URLs and work is complete');
          crawlerEvents.removeListener("urlAdded", checkQueue);
          clearTimeout(timeoutId);
          resolve(false);
        }
      };
      crawlerEvents.on("urlAdded", checkQueue);
      const timeoutId = setTimeout(() => {
        logger.log('Timeout waiting for new URLs');
        crawlerEvents.removeListener("urlAdded", checkQueue);
        resolve(false);
      }, timeout);
      checkQueue();
    }
  });
}

// Execute the main function
main();
