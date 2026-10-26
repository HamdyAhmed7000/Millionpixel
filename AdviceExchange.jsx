import SocialShare from './SocialShare.jsx';
import {useCallback,useEffect,useRef,useState} from 'react';
import {messages,adviceLocale,adviceError} from './messages.js';
import './advice.css';

const SIZE=12;
const normalize=value=>value.normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي');
export default function AdviceExchange({supabase,session,profile}){
 const [lang,setLang]=useState(adviceLocale),t=messages[lang],ar=lang==='ar';
 const [tab,setTab]=useState('market'),[rows,setRows]=useState([]),[ranks,setRanks]=useState([]),[activity,setActivity]=useState([]),[me,setMe]=useState(null),[votes,setVotes]=useState({}),[saved,setSaved]=useState(new Set()),[contests,setContests]=useState([]),[reports,setReports]=useState([]);
 const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[category,setCategory]=useState(''),[contentLang,setContentLang]=useState(''),[sort,setSort]=useState('newest'),[since,setSince]=useState(''),[page,setPage]=useState(0),[more,setMore]=useState(false);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[dialog,setDialog]=useState(null),[selected,setSelected]=useState(null),[history,setHistory]=useState([]),[viewUser,setViewUser]=useState(null),[checked,setChecked]=useState(null);
 const [draft,setDraft]=useState({title:'',body:'',category:'useful',language:lang,tags:''}),[handle,setHandle]=useState(''),[reason,setReason]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[signup,setSignup]=useState(false);
 const request=useRef(0),noteTimer=useRef(null),section=useRef(null),dialogRef=useRef(null),opener=useRef(null);
 const number=value=>new Intl.NumberFormat(ar?'ar-EG':'en-US').format(value||0);
 const date=value=>new Date(value).toLocaleString(ar?'ar-EG':'en-US');
 const flash=value=>{setNote(value);clearTimeout(noteTimer.current);noteTimer.current=setTimeout(()=>setNote(''),7000);};
 const setForm=(key,value)=>setDraft(old=>({...old,[key]:value}));
 const showDialog=value=>{opener.current=document.activeElement;setReason('');setDialog(value);};
 const authNeeded=()=>{if(!session?.user){showDialog('auth');return true;}if(!me){showDialog('handle');return true;}return false;};
 useEffect(()=>{const timer=setTimeout(()=>{setSearch(query.trim());setPage(0);},350);return()=>clearTimeout(timer);},[query]);
 useEffect(()=>{setPage(0);},[category,contentLang,sort,since,tab,viewUser]);
 useEffect(()=>()=>clearTimeout(noteTimer.current),[]);
 useEffect(()=>{if(!dialog)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';dialogRef.current?.querySelector('input,button,textarea')?.focus();const key=event=>{if(event.key==='Escape'){setDialog(null);const url=new URL(location.href);url.searchParams.delete('advice');window.history.replaceState(null,'',url);}if(event.key==='Tab'){const nodes=[...dialogRef.current.querySelectorAll('button,input,textarea,select,a[href]')].filter(node=>!node.disabled);const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',key);opener.current?.focus();};},[dialog]);
 const load=useCallback(async()=>{
  const version=++request.current;
  if(!supabase){setError(t.unavailable);setLoading(false);return;}
  try{
   let q=supabase.from(tab==='mine'||tab==='admin'?'advice_posts':'advice_market').select(tab==='mine'||tab==='admin'?'*,advice_profiles!advice_posts_user_id_fkey(handle)':'*');
   if(tab==='mine')q=q.eq('user_id',session?.user?.id||'00000000-0000-0000-0000-000000000000');
   if(tab==='admin')q=q.eq('status','pending');
   if(viewUser)q=q.eq('user_id',viewUser);
   if(category)q=q.eq('category',category);
   if(contentLang)q=q.eq('language',contentLang);
   if(since)q=q.gte('published_at',new Date(`${since}T00:00:00`).toISOString());
   if(search){
    const safe=search.replace(/[%,().\\]/g,' ').trim().slice(0,100);
    if(safe.startsWith('@')){const found=await supabase.from('advice_profiles').select('user_id').ilike('handle',`%${safe.slice(1)}%`).limit(100);if(found.error)throw found.error;q=q.in('user_id',(found.data||[]).map(x=>x.user_id));}
    else if(safe.startsWith('#'))q=q.contains('tags',[safe.slice(1)]);
    else q=q.ilike('search_text',`%${normalize(safe)}%`);
   }
   if(tab==='saved'){
    if(session?.user){const b=await supabase.from('advice_bookmarks').select('post_id').eq('user_id',session.user.id).order('created_at',{ascending:false}).range(page*SIZE,(page+1)*SIZE);if(b.error)throw b.error;q=q.in('id',b.data.map(x=>x.post_id));}else q=q.in('id',[]);
   }
   const order={newest:'created_at',highest:'price',rising:'day_change',falling:'day_change',weekly:'week_change',trending:'upvotes'}[sort];
   const column=(tab==='mine'||tab==='admin')&&order.endsWith('change')?'price':order;
   q=q.order(column,{ascending:sort==='falling'}).order('id').range(tab==='saved'?0:page*SIZE,tab==='saved'?SIZE:(page+1)*SIZE);
   const results=await Promise.all([
    q,
    supabase.rpc('advice_leaderboard'),
    supabase.from('advice_market').select('id,title,handle,price,published_at').order('published_at',{ascending:false}).limit(5),
    session?.user?supabase.from('advice_profiles').select('*').eq('user_id',session.user.id).maybeSingle():Promise.resolve({data:null}),
    supabase.from('advice_contests').select('*').neq('status','draft').order('starts_at',{ascending:false}).limit(10),
    tab==='admin'&&profile?.is_admin?supabase.from('advice_reports').select('*').eq('resolved',false).order('created_at').limit(50):Promise.resolve({data:[]})
   ]);
   for(const result of results)if(result.error)throw result.error;
   if(version!==request.current)return;
   const list=results[0].data||[];
   setRows(list.slice(0,SIZE).map(x=>({...x,handle:x.handle||x.advice_profiles?.handle})));setMore(list.length>SIZE);setRanks(results[1].data||[]);setActivity(results[2].data||[]);setMe(results[3].data);setContests(results[4].data||[]);setReports(results[5].data||[]);setChecked(new Date());setError('');
   if(session?.user&&list.length){
    const ids=list.map(x=>x.id);
    const [v,b]=await Promise.all([supabase.from('advice_votes').select('post_id,value').eq('user_id',session.user.id).in('post_id',ids),supabase.from('advice_bookmarks').select('post_id').eq('user_id',session.user.id).in('post_id',ids)]);
    if(v.error||b.error)throw v.error||b.error;
    if(version===request.current){setVotes(Object.fromEntries(v.data.map(x=>[x.post_id,x.value])));setSaved(new Set(b.data.map(x=>x.post_id)));}
   }else{setVotes({});setSaved(new Set());}
  }catch(err){if(version===request.current)setError(t.refreshFailed);}
  finally{if(version===request.current)setLoading(false);}
 },[supabase,session?.user?.id,profile?.is_admin,tab,search,category,contentLang,sort,since,page,viewUser,t]);
 useEffect(()=>{setLoading(true);load();const timer=setInterval(()=>{if(!document.hidden)load();},30000);return()=>{clearInterval(timer);request.current++;};},[load]);
 useEffect(()=>{if(me?.user_id&&supabase)supabase.rpc('advice_command',{p_action:'visit',p_data:{}}).then(({error})=>{if(error)console.error('Advice visit failed',error.code);});},[me?.user_id,supabase]);
 const act=async(action,data,success)=>{
  if(busy)return false; if(!(['review','resolve','suspend'].includes(action)&&profile?.is_admin&&session?.user)&&authNeeded())return false;
  setBusy(true);
  try{const {error}=await supabase.rpc('advice_command',{p_action:action,p_data:data});if(error)throw error;if(success)flash(success);await load();return true;}
  catch(err){flash(adviceError(err,t));return false;}finally{setBusy(false);}
 };
 const openPost=useCallback(async id=>{
  if(!supabase)return;
  const [post,snapshots]=await Promise.all([supabase.from('advice_market').select('*').eq('id',id).maybeSingle(),supabase.from('advice_price_snapshots').select('price,recorded_at,id').eq('post_id',id).order('recorded_at',{ascending:false}).order('id',{ascending:false}).limit(100)]);
  if(post.error||snapshots.error){flash(adviceError(post.error||snapshots.error,t));return;}
  if(!post.data){flash(t.failed);return;}
  setSelected(post.data);setHistory((snapshots.data||[]).reverse());showDialog('detail');
  const url=new URL(location.href);url.searchParams.set('advice',id);historyReplace(url);
 },[supabase,t]);
 useEffect(()=>{const id=new URLSearchParams(location.search).get('advice');if(id&&/^[\da-f-]{36}$/i.test(id))openPost(id);},[openPost]);
 const historyReplace=url=>window.history.replaceState(null,'',url);
 const closeDialog=()=>{setDialog(null);setSelected(null);const url=new URL(location.href);url.searchParams.delete('advice');historyReplace(url);};
 const changeLang=()=>{const next=ar?'en':'ar';setLang(next);try{localStorage.setItem('advice-language',next);}catch{}const url=new URL(location.href);url.pathname=`/${next}/advice`;url.hash='advice-exchange';window.location.assign(url.href);};
 useEffect(()=>{if(/^\/(ar|en)\/advice/.test(location.pathname))setTimeout(()=>section.current?.scrollIntoView(),100);},[]);
 const share=async post=>{const url=new URL(location.origin+`/${lang}/advice`);url.searchParams.set('advice',post.id);url.hash='advice-exchange';try{if(navigator.share)await navigator.share({title:post.title,url:url.href});else{await navigator.clipboard.writeText(url.href);flash(t.copied);}}catch(err){if(err.name!=='AbortError')flash(t.failed);}};
 const myRank=ranks.find(x=>x.user_id===session?.user?.id);
 const profileRank=ranks.find(x=>x.user_id===viewUser);
 const card=post=><article className="ax-card" key={post.id} lang={post.language}>
  <div className="ax-card-top"><span className={`ax-category ax-${post.category}`}>{t[post.category]}</span><span className="ax-symbol">AX · {post.id.slice(0,6).toUpperCase()}</span></div>
  <button className="ax-post-title" onClick={()=>post.status==='published'?openPost(post.id):null} disabled={post.status!=='published'} dir="auto">{post.title}</button>
  <p className="ax-body" dir="auto">{post.body}</p><div className="ax-tags">{post.tags.map(tag=><button key={tag} onClick={()=>{setQuery(`#${tag}`);setTab('market');}}>#{tag}</button>)}</div>
  <div className="ax-price"><strong>{number(post.price)}</strong><span>{t.coins}</span>{post.status==='published'&&typeof post.day_change==='number'&&<span className={post.day_change<0?'ax-loss':'ax-gain'}>{post.day_change>=0?'↗ +':'↘ '}{number(Math.abs(post.day_change||0))} <small>{t.today}</small></span>}</div>
  <div className="ax-author"><button onClick={()=>{setViewUser(post.user_id);setTab('market');setPage(0);}}><bdi>@{post.handle}</bdi></button><time>{date(post.published_at||post.created_at)}</time></div>
  {post.status!=='published'&&<span className="ax-status">{t[post.status]}</span>}
  {post.status==='published'&&<div className="ax-card-actions"><button aria-label={t.up} aria-pressed={votes[post.id]===1} disabled={busy||session?.user?.id===post.user_id} onClick={()=>act('vote',{id:post.id,value:votes[post.id]===1?0:1})}>↑ {number(post.upvotes)}</button><button aria-label={t.down} aria-pressed={votes[post.id]===-1} disabled={busy||session?.user?.id===post.user_id} onClick={()=>act('vote',{id:post.id,value:votes[post.id]===-1?0:-1})}>↓ {number(post.downvotes)}</button><button aria-label={saved.has(post.id)?t.unsave:t.bookmark} aria-pressed={saved.has(post.id)} disabled={busy} onClick={()=>act('bookmark',{id:post.id})}>{saved.has(post.id)?'★':'☆'}</button><button onClick={()=>share(post)}>{t.share} ↗</button><button onClick={()=>{if(!authNeeded()){setSelected(post);showDialog('report');}}}>{t.report}</button></div>}
  {tab==='admin'&&profile?.is_admin&&<form className="ax-review" onSubmit={e=>e.preventDefault()}><label>{t.reason}<input required minLength={3} maxLength={500} name="reason" /></label>{['published','rejected'].map(status=><button type="button" key={status} disabled={busy} onClick={e=>{const input=e.currentTarget.form.elements.reason;if(status!=='published'&&!input.reportValidity())return;act('review',{id:post.id,status,reason:input.value.trim().length>=3?input.value.trim():(ar?'تمت مراجعة النص والموافقة':'Approved after content review')},t.success);}}>{status==='published'?t.approve:t.reject}</button>)}</form>}
 </article>;
 return <section id="advice-exchange" ref={section} className="advice-exchange" dir={ar?'rtl':'ltr'} lang={lang} aria-label={t.title}>
  <div className="ax-topline"><a href="/">← CellTalk</a><span>AX / 01</span><button onClick={changeLang}>{t.language} ⇄</button></div>
  <header className="ax-hero"><div><div className="ax-eyebrow">{t.eyebrow}</div><h2>{t.title}</h2><h3>{t.headline}</h3><p>{t.intro}</p><div className="ax-hero-buttons"><button className="ax-primary" onClick={()=>{if(!authNeeded())showDialog('publish');}}>{t.publish} <span>↗</span></button><button onClick={()=>setTab('help')}>{t.help}</button></div></div><div className="ax-hero-art" aria-hidden="true"><span>ADVICE<br/>EXCHANGE</span><svg viewBox="0 0 300 120"><path d="M0 100L35 88L58 97L94 63L125 75L156 43L184 60L226 22L251 36L290 4" fill="none" stroke="currentColor" strokeWidth="5"/><path d="M265 4H290V29" fill="none" stroke="currentColor" strokeWidth="5"/></svg><b>100 <small>AX</small></b><em>+10 / −10</em></div></header>
  <p className="ax-disclaimer">ⓘ {t.disclaimer}</p>
  <div className="ax-ticker"><strong>● {t.latest}</strong>{activity.length?activity.map(post=><button key={post.id} onClick={()=>openPost(post.id)}><bdi>@{post.handle}</bdi><span dir="auto">{post.title}</span><b>{number(post.price)} AX</b></button>):<span>{t.noActivity}</span>}</div>
  <nav className="ax-tabs" aria-label={t.title}>{['market','leaders','mine','saved','contest','help',...(profile?.is_admin?['admin']:[])].map(name=><button key={name} aria-current={tab===name?'page':undefined} onClick={()=>{if(['mine','saved','admin'].includes(name)&&!session?.user){showDialog('auth');return;}setViewUser(null);setTab(name);setPage(0);}}>{t[name]}</button>)}<button className="ax-refresh" onClick={load} disabled={loading||busy}>↻ {t.refresh}</button></nav>
  <div className="ax-market-head"><span>{t.updated}{checked&&<> · {t.lastChecked}: {checked.toLocaleTimeString(ar?'ar-EG':'en-US')}</>}</span>{session?.user?<div><bdi>{me?'@'+me.handle:t.profileNeeded}</bdi> · {t.streak}: {number(me?.streak)} {t.days}<button onClick={()=>{setHandle(me?.handle||'');showDialog('handle');}}>{t.profileSave}</button></div>:<button onClick={()=>showDialog('auth')}>{t.signin}</button>}</div>
  {note&&<p className="ax-notice" role="status">{note}</p>}{error&&<p className="ax-error" role="alert">{error} <button onClick={load}>{t.retry}</button></p>}
  {['market','mine','saved','admin'].includes(tab)&&<>
   {viewUser&&<div className="ax-profile-banner"><div><span>{t.profile}</span><h3><bdi>@{profileRank?.handle||rows[0]?.handle||'—'}</bdi></h3><p>{t.valuationHelp}</p></div><strong>{number(profileRank?.valuation||rows.reduce((sum,p)=>sum+p.price,0))} AX</strong><button onClick={()=>setViewUser(null)}>{t.back}</button></div>}
   {tab==='mine'&&<div className="ax-profile-banner"><div><h3>{t.valuation}: {number(myRank?.valuation)} AX</h3><p>{t.valuationHelp}</p><div className="ax-badges">{myRank?.posts>0&&<span>✦ {t.badgeFirst}</span>}{myRank?.upvotes>=10&&<span>✦ {t.badge10}</span>}{myRank?.upvotes>=100&&<span>✦ {t.badge100}</span>}</div></div></div>}
   {tab!=='admin'&&<div className="ax-filters"><input aria-label={t.search} placeholder={t.search} value={query} onChange={e=>setQuery(e.target.value)} /><select aria-label={t.category} value={category} onChange={e=>setCategory(e.target.value)}><option value="">{t.all}</option>{['useful','funny','both'].map(x=><option key={x} value={x}>{t[x]}</option>)}</select><select aria-label={t.allLanguages} value={contentLang} onChange={e=>setContentLang(e.target.value)}><option value="">{t.allLanguages}</option><option value="ar">{t.ar}</option><option value="en">{t.en}</option></select><select aria-label={t.market} value={sort} onChange={e=>setSort(e.target.value)}>{['newest','highest','trending','rising','falling','weekly'].map(x=><option key={x} value={x}>{t[x]}</option>)}</select><label>{t.since}<input type="date" value={since} onChange={e=>setSince(e.target.value)} /></label></div>}
   {tab==='admin'&&<p>{t.adminHelp}</p>}
   {loading?<p role="status" className="ax-empty">{t.loading}</p>:rows.length?<div className="ax-grid">{rows.map(card)}</div>:!error&&<div className="ax-empty"><span>↗</span><h3>{tab==='admin'?t.noPending:t.empty}</h3><p>{t.emptyText}</p><button className="ax-primary" onClick={()=>{if(!authNeeded())showDialog('publish');}}>{t.publish}</button></div>}
   <div className="ax-pages"><button disabled={page===0||loading} onClick={()=>setPage(p=>p-1)}>{t.previous}</button><span>{number(page+1)}</span><button disabled={!more||loading} onClick={()=>setPage(p=>p+1)}>{t.next}</button></div>
   {tab==='admin'&&<div className="ax-reports"><h3>{t.reports}</h3>{reports.length?reports.map(report=><article key={report.id}><p dir="auto">{report.reason}</p><small>{date(report.created_at)}</small><button onClick={()=>openPost(report.post_id)}>{t.story}</button><button disabled={busy} onClick={()=>act('resolve',{id:report.id},t.success)}>{t.resolve}</button></article>):<p>{t.noReports}</p>}</div>}
  </>}
  {tab==='leaders'&&<><p>{t.valuationHelp}</p><ol className="ax-ranks">{ranks.map((person,index)=><li key={person.user_id}><span>{number(index+1)}</span><button onClick={()=>{setViewUser(person.user_id);setTab('market');}}><bdi>@{person.handle}</bdi><small>{number(person.posts)} {t.posts} · {number(person.upvotes)} {t.votes}</small></button><strong>{number(person.valuation)}<small>{t.coins}</small></strong></li>)}</ol>{!ranks.length&&<p className="ax-empty">{t.emptyText}</p>}</>}
  {tab==='contest'&&<div className="ax-contest"><span>✦</span><h3>{t.noContest}</h3><p>{t.contestText}</p>{contests.map(c=><article key={c.id}><h4>{c[`title_${lang}`]}</h4><p>{t.sponsor}: {c.sponsor}</p><p>{t.prize}: {c[`prize_${lang}`]}</p><p>{t.starts}: {date(c.starts_at)} · {t.ends}: {date(c.ends_at)}</p><details><summary>{t.rules}</summary><p>{c[`rules_${lang}`]}</p></details></article>)}</div>}
  {tab==='help'&&<div className="ax-help">{[1,2,3].map(i=><article key={i}><span>0{i}</span><h3>{t[`how${i}`]}</h3><p>{t[`how${i}Text`]}</p></article>)}<p className="ax-formula">{t.formula}</p></div>}
  <footer className="ax-footer"><span>CellTalk × Advice Exchange</span><span>{t.privacy}</span></footer>
  {dialog&&<div className="ax-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)closeDialog();}}><div className="ax-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label={dialog==='detail'?selected?.title:t[dialog==='publish'?'publish':dialog==='handle'?'profileNeeded':dialog==='report'?'report':'signin']}><button className="ax-close" onClick={closeDialog} aria-label={t.close}>×</button>
   {dialog==='auth'&&<form onSubmit={async e=>{e.preventDefault();if(busy||!supabase)return;setBusy(true);const {error,data}=signup?await supabase.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:location.origin+`/${lang}/advice`}}):await supabase.auth.signInWithPassword({email:email.trim(),password});setBusy(false);if(error)flash(t.authFailed);else{flash(data.session?t.signedIn:t.confirmEmail);if(data.session){setDialog(null);setPassword('');}}}}><h3>{signup?t.signup:t.signin}</h3><p>{t.authNotice}</p><label>{t.email}<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label><label>{t.password}<input type="password" autoComplete={signup?'new-password':'current-password'} required minLength={signup?8:1} value={password} onChange={e=>setPassword(e.target.value)} /></label><button className="ax-primary" disabled={busy}>{busy?t.busy:signup?t.signup:t.signin}</button><button type="button" onClick={()=>setSignup(x=>!x)}>{signup?t.signin:t.signup}</button></form>}
   {dialog==='handle'&&<form onSubmit={async e=>{e.preventDefault();if(busy||!supabase)return;setBusy(true);const {error}=await supabase.rpc('advice_command',{p_action:'profile',p_data:{handle}});setBusy(false);if(error)flash(adviceError(error,t));else{await load();setDialog(null);flash(t.success);}}}><h3>{t.profileNeeded}</h3><label>{t.handle}<input dir="ltr" required pattern="[a-zA-Z0-9_]{3,30}" minLength={3} maxLength={30} value={handle} onChange={e=>setHandle(e.target.value)} /></label><p>{t.handleHelp}</p><button className="ax-primary" disabled={busy}>{busy?t.busy:t.profileSave}</button></form>}
   {dialog==='publish'&&<form onSubmit={async e=>{e.preventDefault();const tags=draft.tags.split(/[,،]/).map(x=>x.trim()).filter(Boolean);if(tags.length>3||tags.some(x=>x.length>24)){flash(t.invalidForm);return;}if(await act('submit',{...draft,tags},t.submitted)){setDialog(null);setDraft({...draft,title:'',body:'',tags:''});setTab('mine');}}}><h3>{t.publish}</h3><p>{t.reviewNotice}</p><label>{t.titleLabel}<input dir="auto" required minLength={3} maxLength={100} value={draft.title} onChange={e=>setForm('title',e.target.value)} /></label><label>{t.story}<textarea dir="auto" required minLength={5} maxLength={280} rows={4} value={draft.body} onChange={e=>setForm('body',e.target.value)} /><small>{number(draft.body.length)} / {number(280)}</small></label><p>{t.bodyHelp}</p><label>{t.category}<select value={draft.category} onChange={e=>setForm('category',e.target.value)}>{['useful','funny','both'].map(x=><option key={x} value={x}>{t[x]}</option>)}</select></label><label>{t.allLanguages}<select value={draft.language} onChange={e=>setForm('language',e.target.value)}><option value="ar">{t.ar}</option><option value="en">{t.en}</option></select></label><label>{t.tags}<input dir="auto" maxLength={74} value={draft.tags} onChange={e=>setForm('tags',e.target.value)} /></label><details><summary>{t.preview}</summary><h4 dir="auto">{draft.title}</h4><p dir="auto">{draft.body}</p><strong>{number(100)} {t.coins}</strong></details><button className="ax-primary" disabled={busy}>{busy?t.busy:t.publish}</button></form>}
   {dialog==='report'&&<form onSubmit={async e=>{e.preventDefault();if(await act('report',{id:selected.id,reason},t.reportSent))setDialog(null);}}><h3>{t.report}</h3><label>{t.reportReason}<textarea required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} /></label><button disabled={busy} className="ax-primary">{t.send}</button></form>}
   {dialog==='detail'&&selected&&<><span className={`ax-category ax-${selected.category}`}>{t[selected.category]}</span><h3 dir="auto">{selected.title}</h3><p className="ax-detail-body" dir="auto">{selected.body}</p><p><bdi>@{selected.handle}</bdi> · {date(selected.published_at)}</p><div className="ax-price"><strong>{number(selected.price)}</strong><span>{t.coins}</span></div><p>{t.disclaimer}</p><h4>{t.history}</h4>{history.length>1?<PriceChart points={history} label={t.history} number={number}/>:<p>{t.noHistory}</p>}<small>{t.moreHistory}</small><SocialShare lang={lang} title={selected.title} url={location.origin+`/${lang}/advice?advice=${selected.id}`}/><button onClick={()=>{setViewUser(selected.user_id);setTab('market');closeDialog();}}>{t.profile}</button>{profile?.is_admin&&<form onSubmit={e=>e.preventDefault()}><label>{t.reason}<input name="reason" required minLength={3} maxLength={500}/></label><button disabled={busy} onClick={async e=>{const input=e.currentTarget.form.elements.reason;if(input.reportValidity()&&await act('review',{id:selected.id,status:'removed',reason:input.value},t.success))closeDialog();}}>{t.remove}</button><button disabled={busy} onClick={async()=>{if(window.confirm(t.suspendConfirm)&&await act('suspend',{id:selected.user_id},t.success))closeDialog();}}>{t.suspend}</button></form>}</>}
   {note&&<p className="ax-notice" role="status">{note}</p>}
  </div></div>}
 </section>;
}
function PriceChart({points,label,number}){
 const prices=points.map(p=>p.price),min=Math.min(...prices)-10,max=Math.max(...prices)+10;
 const start=new Date(points[0].recorded_at).getTime(),end=new Date(points.at(-1).recorded_at).getTime();
 const path=points.map(p=>`${25+((new Date(p.recorded_at).getTime()-start)/Math.max(1,end-start))*550},${155-(p.price-min)/(max-min)*125}`).join(' ');
 return <svg className="ax-chart" viewBox="0 0 610 180" role="img" aria-label={label}><title>{label}: {number(prices[0])} → {number(prices.at(-1))}</title><path d="M25 20V155H575" stroke="currentColor" opacity=".25" fill="none"/><polyline points={path} stroke="currentColor" strokeWidth="3" fill="none"/><text x="30" y="175">{number(prices[0])}</text><text x="530" y="175">{number(prices.at(-1))}</text></svg>;
}
