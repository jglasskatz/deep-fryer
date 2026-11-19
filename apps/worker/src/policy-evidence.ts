import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { RetrievedPolicyEvidence } from '@deep-fryer/core';
type Obj=Record<string,unknown>;
const obj=(x:unknown):x is Obj=>Boolean(x)&&typeof x==='object'&&!Array.isArray(x);
/** Parse only real assistant tool_use/user tool_result frames, never prose claiming a fetch occurred. */
export function retrievedPolicyEvidence(transcript:Buffer):RetrievedPolicyEvidence[]{
  let raw:string;try{raw=gunzipSync(transcript,{maxOutputLength:16*1024*1024}).toString('utf8');}catch{return [];}
  const calls=new Map<string,string>(),receipts:RetrievedPolicyEvidence[]=[];
  for(const line of raw.split('\n')){
    let frame:unknown;try{frame=JSON.parse(line);}catch{continue;}
    if(!obj(frame)||!obj(frame.message)||!Array.isArray(frame.message.content))continue;
    for(const block of frame.message.content){if(!obj(block))continue;
      if(frame.type==='assistant'&&block.type==='tool_use'&&block.name==='WebFetch'&&typeof block.id==='string'&&obj(block.input)&&typeof block.input.url==='string'&&/^https:\/\//.test(block.input.url))calls.set(block.id,block.input.url);
      if(frame.type!=='user'||block.type!=='tool_result'||block.is_error===true||typeof block.tool_use_id!=='string')continue;
      const url=calls.get(block.tool_use_id);if(!url)continue;
      const content=typeof block.content==='string'?block.content:Array.isArray(block.content)?block.content.filter(obj).filter(c=>c.type==='text'&&typeof c.text==='string').map(c=>c.text).join('\n'):'';
      if(content.length<80||/\b(access denied|captcha|failed to fetch|fetch failed|blocked by|robots\.txt|403 forbidden|404 not found)\b/i.test(content))continue;
      receipts.push({url,content,contentSha256:createHash('sha256').update(content).digest('hex')});
    }
  }
  return receipts;
}

