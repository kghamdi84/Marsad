/**
 * A small XML reader for well-formed machine documents such as SEC ownership forms. It supports elements,
 * attributes, self-closing tags, the XML declaration, comments and the five standard entities plus numeric
 * references. It does not support CDATA, DTDs or namespaces, and it throws on anything malformed, so a broken
 * document is an error and never a half-read one. Core has no DOM, so this stands in for DOMParser.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Text directly inside the element, trimmed. Empty for elements that only hold other elements. */
  text: string;
}

export class XmlError extends Error {}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of src.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g))
    attrs[m[1] as string] = decode((m[3] ?? m[4]) as string);
  return attrs;
}

export function parseXml(xml: string): XmlNode {
  const src = xml.replace(/^\uFEFF/, '');
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const tag = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;
  let pos = 0;
  for (let m = tag.exec(src); m !== null; m = tag.exec(src)) {
    const top = stack[stack.length - 1] as XmlNode;
    const between = src.slice(pos, m.index);
    if (between.trim() !== '') top.text += decode(between.trim());
    pos = tag.lastIndex;
    if (m[0].startsWith('<!--') || m[0].startsWith('<?')) continue;
    const [, closing, name, rest, selfClose] = m as unknown as [
      string,
      string,
      string,
      string,
      string,
    ];
    if (closing) {
      if (stack.length < 2 || top.name !== name)
        throw new XmlError(`Unexpected closing tag </${name}> (open: ${top.name})`);
      stack.pop();
      continue;
    }
    const node: XmlNode = { name, attrs: parseAttrs(rest), children: [], text: '' };
    top.children.push(node);
    if (!selfClose) stack.push(node);
  }
  if (src.slice(pos).trim() !== '') throw new XmlError('Text after the last tag');
  if (stack.length !== 1)
    throw new XmlError(`Unclosed element <${(stack[stack.length - 1] as XmlNode).name}>`);
  const doc = root.children[0];
  if (root.children.length !== 1 || !doc) throw new XmlError('Expected exactly one root element');
  return doc;
}

/** The first descendant reached by a slash-separated path of element names, or null. */
export function child(node: XmlNode | null | undefined, path: string): XmlNode | null {
  let cur: XmlNode | null | undefined = node;
  for (const part of path.split('/')) {
    cur = cur?.children.find((c) => c.name === part);
    if (!cur) return null;
  }
  return cur ?? null;
}

export function children(node: XmlNode | null | undefined, path: string): XmlNode[] {
  const parts = path.split('/');
  let level: XmlNode[] = node ? [node] : [];
  for (const part of parts) level = level.flatMap((n) => n.children.filter((c) => c.name === part));
  return level;
}

/** Text of the element at `path`, or null when it is missing or empty. */
export function text(node: XmlNode | null | undefined, path: string): string | null {
  const t = child(node, path)?.text;
  return t === undefined || t === '' ? null : t;
}

/** Every descendant element with this name, at any depth, in document order. */
export function descendants(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    out.push(...descendants(c, name));
  }
  return out;
}
