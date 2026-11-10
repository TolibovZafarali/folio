import { zipSync, strToU8 } from 'fflate';

export function createEpub(overrides = {}) {
  const paragraphs = Array.from({ length: 45 }, (_, i) => `<p>Garden passage ${i + 1}. The orchard was quiet, and the leaves moved gently in the morning light.</p>`).join('');
  const files = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OPS/package.opf': strToU8('<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Quiet Garden</dc:title><dc:identifier id="id">folio-test</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="two" href="Text/chapter%20two.xhtml" media-type="application/xhtml+xml"/><item id="one" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/><item id="image" href="Images/dot.png" media-type="image/png"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>'),
    'OPS/Text/chapter1.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Morning</title><style>body { display:none }</style></head><body><h1>Morning in the garden</h1><p>The first chapter has <em>quiet words</em>.</p><img src="../Images/dot.png" alt="Garden illustration"/><script>window.epubExecuted = true;</script><p onclick="window.epubExecuted=true">This book cannot run code.</p><iframe src="https://example.invalid/blocked"/><img src="https://example.invalid/blocked.png"/><a href="javascript:window.epubExecuted=true">Unsafe link</a><a href="chapter%20two.xhtml#evening">Read the evening chapter</a></body></html>'),
    'OPS/Text/chapter two.xhtml': strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Evening</title></head><body><h1>Evening in the garden</h1>${paragraphs}<p id="evening">At last, the stars appeared.</p></body></html>`),
    'OPS/Images/dot.png': new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')),
    ...overrides,
  };
  return zipSync(files);
}
