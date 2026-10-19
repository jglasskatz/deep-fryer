import { Fragment } from 'react';

/**
 * A message that names the deployment's support address (lib/billing.ts
 * contactSentence), with that address as a mailto link. The messages stay
 * plain text so server actions can return them as errors; a page that can
 * link renders them through this. Without an address in the text it is the
 * text as is.
 */
export function ContactText({ text, contact, subject }: { text: string; contact: string | null; subject?: string }) {
  if (!contact || !text.includes(contact)) return <>{text}</>;
  const href = `mailto:${contact}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
  return (
    <>
      {text.split(contact).map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <a className="underline" href={href}>
              {contact}
            </a>
          ) : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}
