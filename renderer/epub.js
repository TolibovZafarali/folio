import { strFromU8 } from 'fflate';
import { readEpubArchive } from '../epub.mjs';
import { chapterStyles } from './epub-styles.js';

const origin = 'https://epub.invalid';
function resolve(reference, base = '') {
  try {
    if (reference.includes('\\')) return null;
    const url = new URL(reference, `${origin}/${base}`);
    if (url.origin !== origin || url.search) return null;
    return { path: decodeURIComponent(url.pathname.slice(1)), fragment: decodeURIComponent(url.hash.slice(1)) };
  } catch { return null; }
}
const elements = (node, name) => [...node.getElementsByTagNameNS('*', name)];
function xml(files, path) {
  if (!path || !Object.hasOwn(files, path)) throw new Error('This EPUB is missing a required book file.');
  const source = strFromU8(files[path]);
  if (/<!DOCTYPE[^>]*\[|<!ENTITY/i.test(source)) throw new Error('This EPUB uses unsupported XML entities.');
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (elements(doc, 'parsererror').length) throw new Error('This EPUB contains a damaged document.');
  return doc;
}
const allowed = new Set('p h1 h2 h3 h4 h5 h6 blockquote em strong b i u s del strike ins cite small sub sup pre code ul ol li br hr div span section figure figcaption table thead tbody tfoot tr th td dl dt dd a img'.split(' '));
const dropped = new Set('script style iframe object embed form input button textarea select link meta base audio video'.split(' '));
const raster = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function openEpub(bytes) {
  const files = readEpubArchive(bytes);
  const container = xml(files, 'META-INF/container.xml');
  const root = elements(container, 'rootfile').find(item => item.getAttribute('media-type') === 'application/oebps-package+xml') || elements(container, 'rootfile')[0];
  const packagePath = resolve(root?.getAttribute('full-path') || '')?.path;
  const pkg = xml(files, packagePath);
  const manifest = new Map(elements(pkg, 'item').map(item => [item.getAttribute('id'), {
    ...resolve(item.getAttribute('href') || '', packagePath), type: item.getAttribute('media-type'),
  }]));
  const spine = elements(pkg, 'itemref').filter(item => item.getAttribute('linear') !== 'no').map(item => manifest.get(item.getAttribute('idref')));
  if (!spine.length || spine.length > 10000 || spine.some(item => !item?.path || !Object.hasOwn(files, item.path) || !['application/xhtml+xml', 'text/html'].includes(item.type))) {
    throw new Error('This EPUB has an unsupported or incomplete reading order.');
  }
  if (Object.hasOwn(files, 'META-INF/encryption.xml')) {
    const encryption = xml(files, 'META-INF/encryption.xml');
    const fontObfuscation = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);
    if (elements(encryption, 'EncryptionMethod').some(item => !fontObfuscation.has(item.getAttribute('Algorithm')))) {
      throw new Error('This EPUB is protected. Open a DRM-free copy to read it here.');
    }
  }
  const resources = new Map([...manifest.values()].filter(item => item.path).map(item => [item.path, item]));
  let urls = [];
  function disposeChapter() { for (const url of urls) URL.revokeObjectURL(url); urls = []; }
  return {
    numPages: spine.length,
    dispose: disposeChapter,
    chapter(number, navigate) {
      disposeChapter();
      const chapter = spine[number - 1];
      const doc = xml(files, chapter.path);
      const body = elements(doc, 'body')[0];
      if (!body) throw new Error('This EPUB chapter has no readable content.');
      const applyStyles = chapterStyles(doc, chapter.path, path =>
        Object.hasOwn(files, path) && (resources.get(path)?.type === 'text/css' || /\.css$/i.test(path)) ? strFromU8(files[path]) : null, resolve);
      let count = 0;
      const anchors = new Map();
      const images = [];
      function copy(node, depth = 0) {
        if (++count > 100000 || depth > 100) throw new Error('This EPUB chapter is too complex to display.');
        if (node.nodeType === 3) return document.createTextNode(node.nodeValue);
        if (node.nodeType !== 1) return document.createDocumentFragment();
        const name = node.localName.toLowerCase();
        if (dropped.has(name)) return document.createDocumentFragment();
        // SVG cover wrappers commonly contain an image reference. Only load the
        // referenced raster image, never SVG scripts.
        if (name === 'img' || name === 'image') {
          const href = node.getAttribute('src') || node.getAttribute('href') || node.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
          const target = resolve(href, chapter.path);
          const resource = resources.get(target?.path);
          if (!resource || !raster.has(resource.type) || !Object.hasOwn(files, target.path)) return document.createTextNode(node.getAttribute('alt') || '');
          const img = document.createElement('img');
          const url = URL.createObjectURL(new Blob([files[target.path]], { type: resource.type }));
          urls.push(url); img.src = url; img.alt = node.getAttribute('alt') || '';
          applyStyles(node, img);
          images.push(img); return img;
        }
        const element = document.createElement(allowed.has(name) ? name : 'div');
        applyStyles(node, element);
        const id = node.getAttribute('id') || node.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id');
        if (id) anchors.set(id, element);
        if (['ltr', 'rtl', 'auto'].includes(node.getAttribute('dir'))) element.dir = node.getAttribute('dir');
        if (node.getAttribute('lang')) element.lang = node.getAttribute('lang');
        for (const key of ['colspan', 'rowspan']) {
          const value = Number(node.getAttribute(key));
          if (['td', 'th'].includes(name) && Number.isInteger(value) && value > 0 && value <= 100) element.setAttribute(key, value);
        }
        if (name === 'a') {
          const target = resolve(node.getAttribute('href') || '', chapter.path);
          const index = spine.findIndex(item => item.path === target?.path);
          if (index >= 0) {
            element.href = '#';
            element.onclick = event => { event.preventDefault(); navigate(index + 1, target.fragment); };
          }
        }
        for (const child of node.childNodes) element.append(copy(child, depth + 1));
        return element;
      }
      // Retain the html/body inheritance chain without importing their IDs or
      // classes, which could collide with the reader's own controls.
      const content = document.createElement('div');
      applyStyles(doc.documentElement, content);
      content.append(copy(body));
      return { content, anchors, images, direction: ['ltr', 'rtl'].includes(body.getAttribute('dir')) ? body.getAttribute('dir') : 'auto' };
    },
  };
}
