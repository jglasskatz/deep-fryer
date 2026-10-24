import { Fragment, createElement } from 'react';
import { safeHref } from '@/lib/safe-url';

/** A small civic-page format. Content is always text, never executable MDX/HTML. */
export function MarkdownContent({ body }: { body: string }) {
  const inline = (text: string) => text.split(/(\[[^\]\n]+\]\([^\s)]+\))/g).map((part, index) => {
    const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(part);
    const href = link ? safeHref(link[2]) : null;
    return href && link ? <a key={index} href={href} className="underline" rel="noopener noreferrer">{link[1]}</a> : <Fragment key={index}>{part}</Fragment>;
  });
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) code.push(lines[i++]!);
      if (i < lines.length) i++;
      blocks.push(<pre key={blocks.length} className="overflow-x-auto rounded bg-black/5 p-4 text-sm"><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(createElement(`h${heading[1]!.length + 1}`, { key: blocks.length, className: 'pt-3 text-xl font-semibold' }, inline(heading[2]!)));
      i++;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) items.push(<li key={items.length}>{inline(lines[i++]!.replace(/^[-*]\s+/, ''))}</li>);
      blocks.push(<ul key={blocks.length} className="list-disc space-y-2 ps-6">{items}</ul>);
      continue;
    }
    const paragraph = [];
    do { paragraph.push(lines[i++]!); }
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|[-*]\s|```)/.test(lines[i]!));
    blocks.push(<p key={blocks.length} className="whitespace-pre-line leading-relaxed">{inline(paragraph.join('\n'))}</p>);
  }
  return <div className="space-y-4 break-words">{blocks}</div>;
}
