'use client';
import { useEffect, useRef, useState } from 'react';
import type { OutreachContactData } from '@deep-fryer/core';
import { saveOutreachContact, publishOutreachContact, setOutreachArchived } from '@/lib/outreach-admin-actions';
import { useAction } from '@/lib/use-action';
import { unwrap } from '@/lib/action-result';
import { safeHref } from '@/lib/safe-url';
export interface ManagedOutreachContact { id:string; archived:boolean; publishedVersionId:string|null; versions:{id:string;versionNum:number;data:OutreachContactData}[] }
const empty:OutreachContactData={org:'',tags:[],data_needs:[]};
const field='mt-1 min-h-11 w-full rounded border border-field-border bg-[color:var(--color-bg)] px-3 py-2';
const button='min-h-11 rounded border border-black/20 px-3 py-2 text-sm disabled:opacity-40';
export function OutreachContactsEditor({tenantSlug,contacts}:{tenantSlug:string;contacts:ManagedOutreachContact[]}){
 const {run,pending,error}=useAction(); const [contactId,setContactId]=useState<string|undefined>(); const [data,setData]=useState<OutreachContactData>(empty); const [tags,setTags]=useState('');const [needs,setNeeds]=useState('');const [status,setStatus]=useState(''); const editor=useRef<HTMLHeadingElement>(null); const list=useRef<HTMLUListElement>(null);
 useEffect(()=>{const root=list.current;if(!root)return;let restore:(()=>void)|null=null;const before=()=>{restore=openDetailsForPrint(root);};const after=()=>{restore?.();restore=null;};window.addEventListener('beforeprint',before);window.addEventListener('afterprint',after);return()=>{window.removeEventListener('beforeprint',before);window.removeEventListener('afterprint',after);};},[contacts.length]);
 function edit(contact:ManagedOutreachContact|undefined,version?:ManagedOutreachContact['versions'][number]) {setContactId(contact?.id);const value=version?.data??empty;setData(value);setTags(value.tags.join(', '));setNeeds(value.data_needs.join('\n'));setStatus('');requestAnimationFrame(()=>editor.current?.focus());}
 function update(key:keyof OutreachContactData,value:string){setData({...data,[key]:value});}
 return <div className="mt-8 space-y-8">
  <section aria-labelledby="contact-editor" className="rounded-lg border border-black/15 p-4 print:hidden"><div className="flex flex-wrap items-center justify-between gap-3"><h2 ref={editor} tabIndex={-1} id="contact-editor" className="text-lg font-semibold">{contactId?'Edit contact as a new draft':'Add an outreach contact'}</h2>{contactId?<button className={button} disabled={pending} onClick={()=>edit(undefined)}>Start a new contact</button>:null}</div>
  <p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-950">Publishing shares the organization name, website, public description and tags. Person, email, phone, address, data needs and draft message remain available to staff only. Saving a draft does not publish or send a message.</p>
  <form className="mt-4 space-y-4" onSubmit={e=>{e.preventDefault();run(async()=>{const saved=unwrap(await saveOutreachContact({tenantSlug,contactId,data:{...data,tags:tags.split(',').map(s=>s.trim()).filter(Boolean),data_needs:needs.split('\n').map(s=>s.trim()).filter(Boolean)}}));setContactId(saved.contactId);setStatus('Draft contact saved. Review its public preview below before publishing.');});}}>
    <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Organization name (public)<input className={field} required maxLength={200} value={data.org} onChange={e=>update('org',e.target.value)}/></label><label className="text-sm">Website (public, HTTPS)<input className={field} type="url" placeholder="https://" value={data.website??''} onChange={e=>update('website',e.target.value)}/></label></div>
    <label className="block text-sm">Public description<textarea className={field} rows={3} value={data.why??''} onChange={e=>update('why',e.target.value)}/></label><label className="block text-sm">Tags (public, separated by commas)<input className={field} value={tags} onChange={e=>setTags(e.target.value)}/></label>
    <details className="rounded border border-black/10 p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Staff contact details and notes</summary><div className="mt-3 grid gap-4 sm:grid-cols-2">{([{key:'person',label:'Contact person',type:'text'},{key:'email',label:'Email',type:'email'},{key:'phone',label:'Phone',type:'tel'},{key:'address',label:'Address',type:'text'}] as const).map(({key,label,type})=><label key={key} className="text-sm">{label}<input className={field} type={type} value={data[key]??''} onChange={e=>update(key,e.target.value)}/></label>)}</div><label className="mt-4 block text-sm">Data needs (one per line)<textarea className={field} rows={3} value={needs} onChange={e=>setNeeds(e.target.value)}/></label><label className="mt-4 block text-sm">Draft message<textarea className={field} rows={4} aria-describedby="draft-message-hint" value={data.draft_message??''} onChange={e=>update('draft_message',e.target.value)}/></label><p id="draft-message-hint" className="mt-1 text-xs text-[color:var(--color-muted)]">Start with a line such as “Subject: Data for our doughnut” to fill in the email’s subject when you open the draft in your email program.</p></details>
    <button className={`${button} bg-black text-white`} disabled={pending}>{pending?'Saving…':'Save contact draft'}</button>
  </form></section>
  {error?<p role="alert" className="text-sm text-red-800 print:hidden">{error}</p>:null}<p role="status" className="text-sm print:hidden">{status}</p>
  <section aria-labelledby="saved-contacts"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="saved-contacts" className="text-lg font-semibold">Saved outreach contacts</h2>{contacts.length?<button type="button" className={`${button} print:hidden`} onClick={()=>window.print()}>Print the list</button>:null}</div>{contacts.length===0?<p className="mt-3 text-sm text-[color:var(--color-muted)]">No outreach contacts have been added.</p>:<ul ref={list} className="mt-4 space-y-4">{contacts.map(contact=>{const latest=contact.versions[0];return <li key={contact.id} className="break-inside-avoid-page rounded-lg border border-black/15 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-semibold">{latest?.data.org||'Untitled contact'}</h3><p className="mt-1 text-xs text-[color:var(--color-muted)]">{contact.archived?'Archived':contact.publishedVersionId?'Published':'Draft only'} · {contact.versions.length} {contact.versions.length === 1 ? 'version' : 'versions'}</p></div><button className={`${button} print:hidden`} disabled={pending} onClick={()=>run(async()=>{unwrap(await setOutreachArchived({tenantSlug,contactId:contact.id,archived:!contact.archived}));setStatus(contact.archived?(contact.publishedVersionId?'Contact restored. Its previously published version is visible again.':'Draft contact restored. Review a version before publishing.'):'Contact archived. It is hidden from the public page; its history is retained.');})}>{contact.archived?'Restore contact':'Archive contact'}</button></div>
    {latest?<StaffDetails key={latest.id} data={latest.data} versionNum={latest.versionNum}/>:null}
    <ul className="mt-4 space-y-3">{contact.versions.map(version=><li key={version.id} className="break-inside-avoid-page rounded border border-black/10 p-3"><details><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Version {version.versionNum}{contact.publishedVersionId===version.id?' · published version':''} — preview public fields</summary><div className="mt-3 rounded bg-black/[0.03] p-3 text-sm"><p className="break-words font-semibold">{version.data.org}</p>{safeHref(version.data.website)?<a className="mt-1 block break-all underline" href={safeHref(version.data.website)} target="_blank" rel="noreferrer">{version.data.website}</a>:null}<p className="mt-2 whitespace-pre-wrap break-words">{version.data.why}</p><p className="mt-2 break-words text-xs text-[color:var(--color-muted)]">{version.data.tags.join(' · ')}</p></div></details><div className="mt-2 flex flex-wrap gap-2 print:hidden"><button className={button} disabled={pending} onClick={()=>edit(contact,version)}>Edit from version {version.versionNum}</button><button className={`${button} bg-green-700 text-white`} disabled={pending||contact.archived||contact.publishedVersionId===version.id} onClick={()=>run(async()=>{unwrap(await publishOutreachContact({tenantSlug,contactId:contact.id,versionId:version.id}));setStatus(`Published ${version.data.org}, version ${version.versionNum}.`);})}>{contact.publishedVersionId===version.id?'Published':`Publish version ${version.versionNum}`}</button></div></li>)}</ul>
  </li>;})}</ul>}</section>
 </div>;
}

/**
 * Opens every closed <details> inside `root` so a printout shows each
 * contact in full, and returns what puts them back as they were. Run from
 * the window's beforeprint event (which also fires for the browser's own
 * Print command) and undone on afterprint.
 */
export function openDetailsForPrint(root: Pick<ParentNode, 'querySelectorAll'>): () => void {
  const closed = Array.from(root.querySelectorAll<HTMLDetailsElement>('details')).filter(d => !d.open);
  for (const d of closed) d.open = true;
  return () => { for (const d of closed) d.open = false; };
}

/** A first line "Subject: …" becomes the email's subject; the rest is its body. */
export function splitDraft(draft: string): { subject: string; body: string } {
  const text = draft.replace(/\r\n?/g, '\n').trim();
  const first = /^subject:[ \t]*(.*)$/im.exec(text.split('\n', 1)[0] ?? '');
  if (!first) return { subject: '', body: text };
  return { subject: first[1]!.trim(), body: text.slice(text.indexOf('\n') === -1 ? text.length : text.indexOf('\n') + 1).trim() };
}

/**
 * Plain address check: one @, no spaces, a dot in the domain, and none of the
 * characters that would start a query or path (? & = % /). Anything else is
 * not put in a link, and the editor says the address does not look complete.
 */
const EMAIL = /^[^\s@<>()",;:?&=%/]+@[^\s@<>()",;:?&=%/]+\.[^\s@<>()",;:?&=%/]+$/;

/**
 * A mailto: link that opens the person's email program with the contact's
 * address and the draft filled in (RFC 6068: values percent-encoded, line
 * breaks as CRLF). Null when the contact has no usable address.
 */
export function mailtoHref(email: string | null | undefined, draft: string | null | undefined): string | null {
  const to = (email ?? '').trim();
  if (!EMAIL.test(to)) return null;
  const { subject, body } = splitDraft(draft ?? '');
  const query = [
    subject ? `subject=${encodeURIComponent(subject)}` : '',
    body ? `body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}` : '',
  ].filter(Boolean).join('&');
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}${query ? `?${query}` : ''}`;
}

/** Past about this many characters some email programs (Outlook on Windows among them) truncate a mailto: link. */
export const LONG_MAILTO = 2000;

/**
 * A tel: link for a phone number as staff typed it: the digits (and a leading
 * +) before any extension ("ext. 12", "x12", "#12", or a comma or semicolon
 * pause), so the extension is never dialled as part of the number. Null when
 * no digits are left, and the number is then shown as plain text.
 */
export function telHref(phone: string | null | undefined): string | null {
  const main = (phone ?? '').split(/ext|x|#|,|;/i)[0] ?? '';
  const digits = main.replace(/[^\d]/g, '');
  if (!digits) return null;
  return `tel:${main.trim().startsWith('+') ? '+' : ''}${digits}`;
}

/** Writes `text` to the clipboard; false when the browser refuses or has no clipboard. */
export async function copyText(text: string, clipboard: Pick<Clipboard, 'writeText'> | undefined = globalThis.navigator?.clipboard): Promise<boolean> {
  if (!clipboard) return false;
  try { await clipboard.writeText(text); return true; } catch { return false; }
}

/**
 * The staff-only side of a contact's latest version: who to reach and how,
 * what data to ask for, and the draft message with Copy and email buttons.
 * Closed on screen to keep the list short; printing opens it.
 */
function StaffDetails({ data, versionNum }: { data: OutreachContactData; versionNum: number }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const draft = data.draft_message?.trim() ?? '';
  const mail = mailtoHref(data.email, draft);
  const phone = data.phone?.trim();
  const rows = [
    { label: 'Contact person', value: data.person?.trim() },
    { label: 'Email', value: data.email?.trim(), href: mail ? `mailto:${encodeURIComponent(data.email!.trim()).replace(/%40/g, '@')}` : undefined },
    { label: 'Phone', value: phone, href: telHref(phone) ?? undefined },
    { label: 'Address', value: data.address?.trim() },
  ].filter(row => row.value);
  return <div className="mt-3">
    {draft || mail ? <div className="flex flex-wrap gap-2 print:hidden">
      {draft ? <button type="button" className={button} onClick={async () => setCopied(await copyText(draft) ? 'copied' : 'failed')}>{copied === 'copied' ? 'Copied' : 'Copy draft message'}</button> : null}
      {mail ? <a className={`${button} inline-flex items-center underline-offset-2 hover:underline`} href={mail}>{draft ? 'Open the draft in your email program' : 'Write an email'}</a> : null}
    </div> : null}
    {mail && draft && mail.length > LONG_MAILTO ? <p className="mt-1 text-xs text-[color:var(--color-muted)] print:hidden">This draft is long. Some email programs cut a long draft short when opening it this way; if yours does, use Copy draft message and paste it in.</p> : null}
    <p role="status" className="mt-1 text-sm print:hidden">{copied === 'copied' ? 'Draft message copied. Paste it into your email or letter.' : copied === 'failed' ? 'This browser did not allow copying. Open “Staff details” below, select the draft message and copy it yourself.' : ''}</p>
    <details className="mt-2 rounded border border-black/10 p-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Staff details (version {versionNum}) — not shown to the public</summary>
      {rows.length ? <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">{rows.map(row => <div key={row.label} className="contents"><dt className="font-medium">{row.label}</dt><dd className="min-w-0 break-words">{row.href ? <a className="underline" href={row.href}>{row.value}</a> : row.value}</dd></div>)}</dl> : <p className="mt-2 text-sm text-[color:var(--color-muted)]">No contact person, email, phone or address saved.</p>}
      {data.email?.trim() && !mail ? <p className="mt-2 text-sm text-amber-900">The saved email address does not look complete, so it cannot be opened in your email program. Edit the contact to correct it.</p> : null}
      {data.data_needs.length ? <><h4 className="mt-3 text-sm font-semibold">Data needs</h4><ul className="mt-1 list-disc space-y-1 ps-5 text-sm">{data.data_needs.map((need, i) => <li key={i} className="break-words">{need}</li>)}</ul></> : null}
      <h4 className="mt-3 text-sm font-semibold">Draft message</h4>
      {draft ? <p className="mt-1 whitespace-pre-wrap break-words rounded bg-black/[0.03] p-3 text-sm">{draft}</p> : <p className="mt-1 text-sm text-[color:var(--color-muted)]">No draft message yet. Edit the contact to write one.</p>}
    </details>
  </div>;
}
