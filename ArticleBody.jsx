import React from 'react';
export function imageBlock(url,caption){return ':::image\n'+JSON.stringify({url,caption})+'\n:::';}
export default function ArticleBody({body=''}){
 return <div className="frequency-body" dir="auto">{body.split(/\n\s*\n/).map((text,i)=>{
  if(text.startsWith(':::image\n')&&text.endsWith('\n:::')){
   try{const data=JSON.parse(text.slice(9,-4));const url=new URL(data.url);if(url.protocol!=='https:'||typeof data.caption!=='string')throw Error('Invalid image');return <figure className="frequency-inline-image" key={i}><img loading="lazy" src={url.href} alt={data.caption}/>{data.caption&&<figcaption dir="auto">{data.caption}</figcaption>}</figure>;}catch{return <p key={i}>{text}</p>;}
  }
  return text.startsWith('## ')?<h2 key={i}>{text.slice(3)}</h2>:<p key={i}>{text}</p>;
 })}</div>;
}
