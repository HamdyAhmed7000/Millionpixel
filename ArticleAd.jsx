import {useEffect,useRef,useState} from 'react';
const CLIENT='ca-pub-9584447884932139';
let tagPromise;
function loadAdSense(){
 if(tagPromise)return tagPromise;
 tagPromise=new Promise((resolve,reject)=>{
  const existing=document.querySelector('script[data-celltalk-adsense]');
  if(existing){resolve();return;}
  const script=document.createElement('script');script.async=true;script.crossOrigin='anonymous';script.dataset.celltalkAdsense='true';
  script.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client='+CLIENT;
  script.onload=resolve;script.onerror=reject;document.head.appendChild(script);
 });return tagPromise;
}
export default function ArticleAd({lang}){
 const ref=useRef(null),requested=useRef(false),[hidden,setHidden]=useState(false);
 const enabled=location.hostname==='celltalk.info'||location.hostname==='www.celltalk.info';
 useEffect(()=>{
  if(!enabled)return;const node=ref.current;if(!node)return;let alive=true,near=false,ready=false;
  const request=()=>{if(!alive||!near||!ready||requested.current||!node.isConnected||node.getBoundingClientRect().width<250)return;requested.current=true;try{(window.adsbygoogle=window.adsbygoogle||[]).push({});}catch{setHidden(true);}};
  const resize=new ResizeObserver(request);resize.observe(node);
  const observer=new IntersectionObserver(entries=>{near=entries.some(e=>e.isIntersecting);request();},{rootMargin:'300px'});observer.observe(node);
  const status=new MutationObserver(()=>{if(node.getAttribute('data-ad-status')==='unfilled')setHidden(true);});status.observe(node,{attributes:true,attributeFilter:['data-ad-status']});
  loadAdSense().then(()=>{ready=true;request();}).catch(()=>{if(alive)setHidden(true);});
  return()=>{alive=false;resize.disconnect();observer.disconnect();status.disconnect();};
 },[enabled]);
 if(!enabled)return null;
 return <aside className="celltalk-article-ad" aria-label={lang==='ar'?'إعلان':'Advertisement'} hidden={hidden}><small>{lang==='ar'?'إعلان':'Advertisement'}</small><ins ref={ref} className="adsbygoogle" style={{display:'block',width:'100%'}} data-ad-client={CLIENT} data-ad-slot="8338057889" data-ad-format="auto" data-full-width-responsive="true"/></aside>;
}
