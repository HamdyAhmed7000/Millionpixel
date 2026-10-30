export function csvText(rows){return '\uFEFF'+rows.map(row=>row.map(v=>{let s=String(v??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
export function downloadCsv(name,rows){const u=URL.createObjectURL(new Blob([csvText(rows)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
export function seoChecks(form){const body=[form.body,...(form.chapters||[]).flatMap(c=>[c.title,c.body])].filter(Boolean).join(' ');return [
 ['title',String(form.title||'').trim().length>=25&&String(form.title||'').trim().length<=70],
 ['description',String(form.excerpt||'').trim().length>=70&&String(form.excerpt||'').trim().length<=160],
 ['image',/^https:\/\//.test(form.cover||'')],
 ['headings',(form.chapters||[]).some(c=>c.title?.trim())||/^##\s+/m.test(body)],
 ['body',body.trim().split(/\s+/).length>=200],
 ['credit',!!form.cover_credit?.trim()],
 ['sources',!!form.sourceText?.trim()||(form.sources||[]).length>0]
 ];}
