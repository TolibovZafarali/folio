import { zipSync, strToU8 } from 'fflate';

export function createEpub(overrides = {}) {
  const paragraphs = Array.from({ length: 45 }, (_, i) => `<p>Garden passage ${i + 1}. The orchard was quiet, and the leaves moved gently in the morning light.</p>`).join('');
  const formatting = `<div class="formatted"><p><em>Semantic italic</em> <strong>Semantic bold</strong> <u>Semantic underline</u> <del>Semantic strike</del> <sup>Semantic superscript</sup> <sub>Semantic subscript</sub></p>
    <p><span class="italic">Styled italic</span> <span class="bold">Styled bold</span> <span class="caps">Styled small caps</span> <span class="underline">Styled underline</span> <span class="strike">Styled strike</span> <span class="super">Styled superscript</span> <span class="sub">Styled subscript</span></p>
    <p class="indented aligned">Indented aligned paragraph</p><p class="hanging">Hanging paragraph</p><p align="right">Legacy alignment</p>
    <p id="cascade" class="cascade" style="font-weight:normal; font-family:Comic Sans MS">Cascade paragraph</p>
    <p class="inherited"><span>Inherited italic</span></p><p style="font:italic small-caps bold 1em publisher; text-decoration:underline line-through">Inline shorthand</p>
    <p class="scoped">Embedded stylesheet</p><p class="conditional">Screen media rule</p><p class="print-only">Print-only rule</p></div>`;
  const files = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OPS/package.opf': strToU8('<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Quiet Garden</dc:title><dc:identifier id="id">folio-test</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="two" href="Text/chapter%20two.xhtml" media-type="application/xhtml+xml"/><item id="one" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/><item id="image" href="Images/dot.png" media-type="image/png"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>'),
    'OPS/Text/chapter1.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Morning</title><style>body { display:none }</style></head><body><h1>Morning in the garden</h1><p>The first chapter has <em>quiet words</em>.</p><img src="../Images/dot.png" alt="Garden illustration"/><script>window.epubExecuted = true;</script><p onclick="window.epubExecuted=true">This book cannot run code.</p><iframe src="https://example.invalid/blocked"/><img src="https://example.invalid/blocked.png"/><a href="javascript:window.epubExecuted=true">Unsafe link</a><a href="chapter%20two.xhtml#evening">Read the evening chapter</a></body></html>'),
    'OPS/Text/chapter two.xhtml': strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Evening</title><link rel="stylesheet" href="../Styles/book.css"/><style>.scoped {font-style: italic} #reader {display:none} @font-face {font-family:publisher; src:url(https://example.invalid/font.woff2)}</style></head><body style="font-family:publisher!important">${formatting}<h1>Evening in the garden</h1>${paragraphs}<p id="evening">At last, the stars appeared.</p></body></html>`),
    'OPS/Styles/book.css': strToU8(`@import "nested/emphasis.css"; @import url(https://example.invalid/blocked.css);
      .formatted .bold {font-weight:700} .caps {font-variant:small-caps} .underline {text-decoration:underline} .strike {text-decoration:line-through}
      .super {vertical-align:super; font-size:75%} .sub {vertical-align:sub; font-size:75%}
      .indented {text-indent:2em; margin-left:1em} .aligned {text-align:center} .hanging {text-indent:-1em; padding-left:1em}
      p.cascade {font-weight:900} #cascade {font-weight:700!important} .cascade {font-weight:400!important}
      .inherited {font-style:italic} * {font-family:publisher!important; background-image:url(https://example.invalid/pixel)}
      @media screen { .conditional {text-align:right} } @media print { .print-only {font-style:italic} }
      body {position:fixed; display:none} #text-content {font-size:1px} .scoped {text-indent:var(--unsafe)}
    `),
    'OPS/Styles/nested/emphasis.css': strToU8('@import "../book.css"; .italic {font-style:italic}'),
    'OPS/Images/dot.png': new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')),
    ...overrides,
  };
  return zipSync(files);
}
