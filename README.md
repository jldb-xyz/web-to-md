# TypeScript Documentation Crawler

This CLI tool crawls documentation websites, converts the content to Markdown, and saves it either as separate files or as a single combined file.

## Features

- Crawls documentation websites using a headless browser (Puppeteer)
- Converts HTML content to Markdown
- Supports resuming interrupted crawls
- Can output separate Markdown files or combine them into a single file
- Shows progress during the crawl

## Installation

1. Clone this repository
2. Run `npm install` to install dependencies

## Usage

Run the tool using the following command:

```
npm start -- -u <url> -o <output_directory> [-c]
```

Options:
- `-u, --url <url>`: URL of the documentation website to crawl (required)
- `-o, --output <output>`: Output directory (required)
- `-c, --combine`: Combine all pages into a single Markdown file (optional)

Example:
```
npm start -- -u https://example.com/docs -o ./output -c
```

This will crawl the documentation at https://example.com/docs, convert it to Markdown, and save it to the ./output directory. The -c flag combines all pages into a single file.

## License

ISC
