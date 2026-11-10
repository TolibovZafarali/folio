import { unzipSync, strFromU8 } from 'fflate';

// Bound decompression before allocating book resources. Archive entries stay in
// memory; EPUB paths are never extracted into the filesystem.
export function readEpubArchive(bytes) {
  let size = 0, count = 0;
  let files;
  try {
    files = unzipSync(new Uint8Array(bytes), { filter(entry) {
      size += Math.max(entry.size, entry.originalSize);
      if (++count > 10000 || Math.max(entry.size, entry.originalSize) > 32 * 1024 * 1024 || size > 128 * 1024 * 1024) {
        throw new Error('This EPUB is too large to unpack.');
      }
      return !entry.name.endsWith('/');
    } });
  } catch (error) {
    throw new Error(error.message === 'This EPUB is too large to unpack.' ? error.message : 'This EPUB archive is damaged or unreadable.');
  }
  if (!Object.hasOwn(files, 'mimetype') || strFromU8(files.mimetype).trim() !== 'application/epub+zip' || !Object.hasOwn(files, 'META-INF/container.xml')) {
    throw new Error('This file does not appear to be an EPUB book.');
  }
  return files;
}
