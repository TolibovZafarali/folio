import { parse, generate } from 'css-tree';
import { calculate } from 'specificity';

// Resolve the book's cascade against its inert XML document. Only approved
// declarations reach the reader; book selectors, IDs, fonts and URLs never do.
const keywords = {
  'font-style': /^(normal|italic|oblique(?: -?\d+(?:\.\d+)?deg)?)$/,
  'font-weight': /^(normal|bold|bolder|lighter|[1-9]\d{0,2}|1000)$/,
  'font-variant-caps': /^(normal|small-caps|all-small-caps|petite-caps|all-petite-caps|unicase|titling-caps)$/,
  'text-decoration-line': /^(none|(?:underline|overline|line-through)(?: (?:underline|overline|line-through))*)$/,
  'text-decoration-style': /^(solid|double|dotted|dashed|wavy)$/,
  'text-align': /^(start|end|left|right|center|justify|match-parent)$/,
  'text-align-last': /^(auto|start|end|left|right|center|justify)$/,
  'vertical-align': /^(baseline|sub|super|text-top|text-bottom|middle|top|bottom)$/,
};
const lengths = new Set(['text-indent', 'margin-left', 'margin-right', 'margin-inline-start', 'margin-inline-end', 'padding-left', 'padding-right', 'padding-inline-start', 'padding-inline-end', 'font-size', 'vertical-align']);
function safeValue(property, value) {
  if (/^(inherit|initial|unset)$/.test(value) || keywords[property]?.test(value)) return true;
  if (!lengths.has(property)) return false;
  if (property.startsWith('margin-') && value === 'auto') return true;
  if (property === 'font-size' && /^(smaller|larger|xx-small|x-small|small|medium|large|x-large|xx-large)$/.test(value)) return true;
  const match = /^(-?\d*\.?\d+)(em|rem|px|pt|%|ch|ex)?$/.exec(value);
  if (!match) return false;
  const number = Number(match[1]), unit = match[2] || '';
  const limit = unit === '%' ? 100 : ['px', 'pt'].includes(unit) ? 120 : 10;
  if (property === 'font-size') return number > 0 && number <= (unit === '%' ? 300 : ['px', 'pt'].includes(unit) ? 72 : 3);
  return Math.abs(number) <= limit && (number >= 0 || !property.startsWith('padding-'));
}
function declarations(source) {
  const style = document.createElement('span').style;
  style.cssText = source;
  return [...new Set([...Object.keys(keywords), ...lengths])].flatMap(property => {
    const value = style.getPropertyValue(property).trim();
    return value && safeValue(property, value) ? [{ property, value, important: style.getPropertyPriority(property) === 'important' }] : [];
  });
}
function outranks(next, previous) {
  for (let i = 0; i < next.length; i++) if (next[i] !== previous[i]) return next[i] > previous[i];
  return true; // Later source order wins ties.
}

export function chapterStyles(doc, chapterPath, readStyle, resolve) {
  const cascade = new WeakMap();
  let bytes = 0, rules = 0, matches = 0;
  function apply(node, values, specificity, inline = 0) {
    let properties = cascade.get(node);
    if (!properties) cascade.set(node, properties = new Map());
    for (const value of values) {
      const rank = [Number(value.important), inline, ...specificity];
      if (!properties.has(value.property) || outranks(rank, properties.get(value.property).rank)) properties.set(value.property, { ...value, rank });
    }
  }
  function media(query) { return !query || matchMedia(query).matches; }
  function sheet(source, base, ancestors = []) {
    bytes += source.length;
    if (bytes > 1024 * 1024 || ancestors.length > 8) throw new Error('This EPUB has too many chapter styles.');
    let tree;
    try { tree = parse(source); } catch { return; } // Damaged CSS must not hide readable text.
    function visit(children) {
      for (const rule of children) {
        if (++rules > 4000) throw new Error('This EPUB has too many chapter styles.');
        if (rule.type === 'Atrule') {
          const name = rule.name.toLowerCase();
          if (name === 'import' && rule.prelude) {
            const parts = rule.prelude.children.toArray();
            const first = parts.shift();
            if (!['String', 'Url'].includes(first?.type)) continue;
            const path = resolve(first.value, base)?.path;
            if (!path || ancestors.includes(path) || !media(parts.map(generate).join(' '))) continue;
            const imported = readStyle(path);
            if (imported !== null) sheet(imported, path, [...ancestors, path]);
          } else if (name === 'media' && rule.prelude && rule.block && media(generate(rule.prelude))) visit(rule.block.children);
          else if (name === 'supports' && rule.prelude && rule.block && CSS.supports(generate(rule.prelude))) visit(rule.block.children);
          continue;
        }
        if (rule.type !== 'Rule' || rule.prelude?.type !== 'SelectorList') continue;
        const values = declarations(rule.block.children.toArray().map(generate).join(';'));
        if (!values.length) continue;
        for (const selector of rule.prelude.children) {
          const text = generate(selector);
          if (text.length > 2048) continue;
          try {
            const { A, B, C } = calculate(text);
            const nodes = doc.querySelectorAll(text);
            matches += nodes.length;
            if (matches > 200000) throw new RangeError('This EPUB has too many matching chapter styles.');
            for (const node of nodes) apply(node, values, [A, B, C]);
          } catch (error) { if (error instanceof RangeError) throw error; }
        }
      }
    }
    visit(tree.children);
  }
  for (const node of doc.querySelectorAll('link, style')) {
    if (!media(node.getAttribute('media'))) continue;
    if (node.localName === 'style') sheet(node.textContent, chapterPath);
    else if (node.getAttribute('rel')?.toLowerCase().split(/\s+/).includes('stylesheet') && !node.hasAttribute('disabled')) {
      const path = resolve(node.getAttribute('href') || '', chapterPath)?.path;
      const source = path && readStyle(path);
      if (typeof source === 'string') sheet(source, path, [path]);
    }
  }
  return (source, target) => {
    // Legacy XHTML alignment has lower precedence than author CSS.
    const alignment = source.getAttribute('align')?.toLowerCase();
    if (/^(left|right|center|justify)$/.test(alignment)) target.style.textAlign = alignment;
    apply(source, declarations(source.getAttribute('style') || ''), [0, 0, 0], 1);
    for (const { property, value } of cascade.get(source)?.values() || []) target.style.setProperty(property, value);
  };
}
