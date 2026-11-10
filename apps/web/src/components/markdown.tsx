import { Fragment } from 'react';
import { parseMarkdown, type Inline } from '@/lib/markdown';

function Text({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.bold ? <strong key={i}>{p.text}</strong> : <Fragment key={i}>{p.text}</Fragment>,
      )}
    </>
  );
}

/** A legal document. The first heading is skipped: the page title already shows it. */
export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  const body = blocks[0]?.kind === 'heading' && blocks[0].level === 1 ? blocks.slice(1) : blocks;
  return (
    <div className="prose-legal flex max-w-[68ch] flex-col gap-4 text-[16px] leading-7">
      {body.map((b, i) => {
        if (b.kind === 'heading') {
          const H = b.level <= 2 ? 'h2' : 'h3';
          return (
            <H key={i} className={b.level <= 2 ? 'mt-6 text-2xl font-bold' : 'mt-2 font-semibold'}>
              <Text parts={b.text} />
            </H>
          );
        }
        if (b.kind === 'list')
          return (
            <ul key={i} className="flex list-disc flex-col gap-1.5 pl-6 marker:text-brass">
              {b.items.map((it, j) => (
                <li key={j}>
                  <Text parts={it.text} />
                  {it.children.length > 0 && (
                    <ul className="mt-1.5 flex list-[circle] flex-col gap-1 pl-6">
                      {it.children.map((c, k) => (
                        <li key={k}>
                          <Text parts={c} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          );
        return (
          <p key={i}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Text parts={l} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
