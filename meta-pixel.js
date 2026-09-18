// AquaCore MX - Meta Pixel
(function(w,d){
  const PIXEL_ID='3016758178709736';
  if(w.__aquacoreMetaPixelLoaded) return;
  w.__aquacoreMetaPixelLoaded=true;

  !function(f,b,e,v,n,t,s){
    if(f.fbq)return;
    n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=true;n.version='2.0';n.queue=[];
    t=b.createElement(e);t.async=true;t.src=v;
    s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s);
  }(w,d,'script','https://connect.facebook.net/en_US/fbevents.js');

  w.fbq('init',PIXEL_ID);
  w.fbq('track','PageView');

  w.aquaMeta=function(eventName,params){
    try{
      if(typeof w.fbq==='function') w.fbq('track',eventName,params||{});
    }catch(err){
      console.debug('Meta Pixel event skipped',err);
    }
  };
})(window,document);
