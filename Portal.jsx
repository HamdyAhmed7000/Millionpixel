import AdminContent from './AdminContent.jsx';
import {useEffect,useState} from 'react';
import {supabase} from './supabase.js';
import App from './App.jsx';
import LiveAuctions from './LiveAuctions.jsx';
import SocialShare from './SocialShare.jsx';
import AdviceExchange from './AdviceExchange.jsx';
import ComedyWill from './ComedyWill.jsx';
import DreamCemetery from './DreamCemetery.jsx';
import './community.css';
import './auctionCyber.css';
export default function Portal(){
 const path=location.pathname,lang=path.startsWith('/en/')?'en':'ar',ar=lang==='ar';
 const page=/\/admin\/?$/.test(path)?'admin':/\/auctions\/?$/.test(path)?'auctions':/\/advice\/?$/.test(path)?'advice':/\/comedy-will\/?$/.test(path)?'will':/\/dreams\/?$/.test(path)?'dreams':'home';
 const [session,setSession]=useState(null),[profile,setProfile]=useState(null);
 useEffect(()=>{if(!supabase)return;let alive=true;supabase.auth.getSession().then(({data})=>{if(alive)setSession(data.session);});const {data}=supabase.auth.onAuthStateChange((_event,s)=>setSession(s));return()=>{alive=false;data.subscription.unsubscribe();};},[]);
 useEffect(()=>{let alive=true;setProfile(null);if(session)supabase.from('profiles').select('is_admin').eq('user_id',session.user.id).maybeSingle().then(({data})=>{if(alive)setProfile(data);});return()=>{alive=false;};},[session?.user?.id]);
 const names=ar?{home:'الصور والكانفاس',advice:'بورصة النصائح',will:'الوصايا الكوميدية',dreams:'مقبرة الأحلام',auctions:'المزاد',admin:'إدارة المحتوى'}:{home:'Canvas & photos',advice:'Advice Exchange',will:'Comedy Wills',dreams:'Dream Cemetery',auctions:'Auctions',admin:'Manage content'};
 const urls={home:'/',advice:`/${lang}/advice`,will:`/${lang}/comedy-will`,dreams:`/${lang}/dreams`,auctions:`/${lang}/auctions`,admin:`/${lang}/admin`};
 useEffect(()=>{document.title=page==='home'?'CellTalk':names[page]+' | CellTalk';},[page,lang]);
 return <><header className="hub-navigation" dir={ar?'rtl':'ltr'}><a className="hub-brand" href="/">C<span>CellTalk</span></a><nav aria-label={ar?'أقسام الموقع':'Site sections'}>{Object.keys(names).filter(key=>key!=='admin'||profile?.is_admin).map(key=><a key={key} href={urls[key]} aria-current={page===key?'page':undefined}>{names[key]}</a>)}</nav>{page!=='home'&&<a className="hub-language" href={`/${ar?'en':'ar'}/${page==='will'?'comedy-will':page}`}>{ar?'English':'العربية'}</a>}</header>{page==='home'?<div className="site-home-frame"><App/></div>:<main className="hub-page">{page==='admin'?<AdminContent supabase={supabase} session={session} profile={profile} lang={lang}/>:page==='auctions'?<LiveAuctions lang={lang} session={session} profile={profile} supabase={supabase}/>:page==='advice'?<AdviceExchange supabase={supabase} session={session} profile={profile}/>:page==='will'?<ComedyWill lang={lang}/>:<DreamCemetery lang={lang} session={session} profile={profile} supabase={supabase}/>}</main>}{page!=='auctions'&&page!=='admin'&&<footer className="portal-share" dir={ar?'rtl':'ltr'}><SocialShare lang={lang} title={names[page]+' | CellTalk'}/></footer>}</>;
}
