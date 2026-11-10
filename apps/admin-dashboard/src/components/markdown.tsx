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

/** Renders a legal document's Markdown as the apps and website will show it. */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed">
      {parseMarkdown(source).map((b, i) => {
        if (b.kind === 'heading') {
          const cls =
            b.level === 1
              ? 'text-xl font-semibold'
              : b.level === 2
                ? 'mt-2 text-base font-semibold'
                : 'font-semibold';
          const H = `h${b.level + 1}` as 'h2' | 'h3' | 'h4';
          return (
            <H key={i} className={cls}>
              <Text parts={b.text} />
            </H>
          );
        }
        if (b.kind === 'list')
          return (
            <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
              {b.items.map((it, j) => (
                <li key={j}>
                  <Text parts={it.text} />
                  {it.children.length > 0 && (
                    <ul className="mt-1 flex list-[circle] flex-col gap-1 pl-5">
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
