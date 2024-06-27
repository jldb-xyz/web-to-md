import { injectable } from 'inversify';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IFileSystemService } from '../interfaces';

@injectable()
export class FileSystemService implements IFileSystemService {
  async saveToFile(content: string, filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async readFile(filePath: string): Promise<string> {
    return await fs.readFile(filePath, 'utf-8');
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async readDirectory(directoryPath: string): Promise<string[]> {
    return await fs.readdir(directoryPath);
  }
}