import CinemaPages from './CinemaPages.jsx';
import MemberNotice from './MemberNotice.jsx';
import PageTracker from './PageTracker.jsx';
import Frequencies from './Frequencies.jsx';
import SiteFooter from './SiteFooter.jsx';
import AdminContent from './AdminContent.jsx';
import {useEffect,useState} from 'react';
import {supabase} from './supabase.js';
import App from './App.jsx';
import LiveAuctions from './LiveAuctions.jsx';
import AdviceExchange from './AdviceExchange.jsx';
import ComedyWill from './ComedyWill.jsx';
import DreamCemetery from './DreamCemetery.jsx';
import './community.css';
import './auctionCyber.css';
export default function Portal(){
 const [route,setRoute]=useState(()=>location.pathname+location.search);
 useEffect(()=>{const update=()=>setRoute(location.pathname+location.search);window.addEventListener('popstate',update);return()=>window.removeEventListener('popstate',update);},[]);
 const path=route.split('?')[0],lang=path.startsWith('/en/')?'en':'ar',ar=lang==='ar';
 const page=/\/(movie-stories|latest-news)(?:\/[^/]+)?\/?$/.test(path)?(path.includes('/movie-stories')?'movies':'news'):/\/frequencies(?:\/[^/]+)?\/?$/.test(path)?'frequencies':/\/admin\/?$/.test(path)?'admin':/\/auctions\/?$/.test(path)?'auctions':/\/advice\/?$/.test(path)?'advice':/\/comedy-will\/?$/.test(path)?'will':/\/dreams\/?$/.test(path)?'dreams':'home';
 const [session,setSession]=useState(null),[profile,setProfile]=useState(null);
 useEffect(()=>{if(!supabase)return;let alive=true;supabase.auth.getSession().then(({data})=>{if(alive)setSession(data.session);});const {data}=supabase.auth.onAuthStateChange((_event,s)=>setSession(s));return()=>{alive=false;data.subscription.unsubscribe();};},[]);
 useEffect(()=>{let alive=true;setProfile(null);if(session)supabase.rpc('admin_suite',{p_action:'access',p_data:{}}).then(({data,error})=>{if(alive&&!error)setProfile(data);});return()=>{alive=false;};},[session?.user?.id]);
 const names=ar?{home:'الصور والكانفاس',advice:'بورصة النصائح',will:'الوصايا الكوميدية',dreams:'مقبرة الأحلام',auctions:'المزاد',frequencies:'ترددات عشوائية',movies:'قصص الأفلام',news:'آخر الأخبار',admin:'إدارة المحتوى'}:{home:'Canvas & photos',advice:'Advice Exchange',will:'Comedy Wills',dreams:'Dream Cemetery',auctions:'Auctions',frequencies:'Random Frequencies',movies:'Movie Stories',news:'Latest News',admin:'Manage content'};
 const urls={movies:`/${lang}/movie-stories`,news:`/${lang}/latest-news`,frequencies:`/${lang}/frequencies`,home:'/',advice:`/${lang}/advice`,will:`/${lang}/comedy-will`,dreams:`/${lang}/dreams`,auctions:`/${lang}/auctions`,admin:`/${lang}/admin`};
 useEffect(()=>{document.title=page==='home'?'CellTalk':names[page]+' | CellTalk';},[page,lang]);
 const publicProfile=profile?{...profile,is_admin:profile.is_admin&&profile.is_owner!==false}:null;
 return <><PageTracker key={path} supabase={supabase}/><header className="hub-navigation" dir={ar?'rtl':'ltr'}><a className="hub-brand" href="/">C<span>CellTalk</span></a><nav aria-label={ar?'أقسام الموقع':'Site sections'}>{Object.keys(names).filter(key=>key!=='admin'||profile?.is_admin).map(key=><a key={key} href={urls[key]} aria-current={page===key?'page':undefined}>{names[key]}</a>)}</nav>{page!=='home'&&<a className="hub-language" href={`/${ar?'en':'ar'}/${page==='will'?'comedy-will':page==='movies'?'movie-stories':page==='news'?'latest-news':page}`}>{ar?'English':'العربية'}</a>}</header>{page==='home'?<div className="site-home-frame"><App/></div>:<main className="hub-page">{(page==='movies'||page==='news')?<CinemaPages key={route} kind={page==='movies'?'movie':'news'} lang={lang} supabase={supabase} session={session} profile={publicProfile}/>:page==='frequencies'?<Frequencies key={route} lang={lang} supabase={supabase} session={session} profile={publicProfile}/>:page==='admin'?<AdminContent supabase={supabase} session={session} profile={profile} lang={lang}/>:page==='auctions'?<LiveAuctions lang={lang} session={session} profile={publicProfile} supabase={supabase}/>:page==='advice'?<AdviceExchange supabase={supabase} session={session} profile={publicProfile}/>:page==='will'?<ComedyWill lang={lang}/>:<DreamCemetery lang={lang} session={session} profile={publicProfile} supabase={supabase}/>}</main>}<MemberNotice supabase={supabase} session={session} lang={lang}/><SiteFooter lang={lang}/></>;
}
