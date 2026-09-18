function norm(s=''){
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();
}

function scoreProduct(p,name,code){
  const title=norm(p?.title||'');
  const n=norm(name), c=norm(code);
  let score=0;
  if(c && title.includes(c)) score+=100;
  const codeTokens=c.split(' ').filter(x=>x.length>=3);
  score+=codeTokens.filter(t=>title.includes(t)).length*20;
  const nameTokens=n.split(' ').filter(x=>x.length>=4);
  score+=nameTokens.filter(t=>title.includes(t)).length*3;
  if(n && title===n) score+=50;
  return score;
}

function imageFromProduct(p){
  const f=p?.featured_image;
  let url=
    (typeof f==='string'?f:null) ||
    f?.url || f?.src ||
    p?.image || p?.image_url || '';
  if(url?.startsWith('//')) url='https:'+url;
  return url||'';
}

async function searchEquipesca(q){
  const u=new URL('https://equipesca.com/search/suggest.json');
  u.searchParams.set('q',q);
  u.searchParams.set('resources[type]','product');
  u.searchParams.set('resources[limit]','10');
  const r=await fetch(u,{
    headers:{
      accept:'application/json',
      'user-agent':'Mozilla/5.0 AquaCoreMX/1.0'
    }
  });
  if(!r.ok) throw new Error(`Equipesca search HTTP ${r.status}`);
  const j=await r.json();
  return j?.resources?.results?.products||[];
}

async function ogImage(productUrl){
  if(!productUrl) return '';
  const url=productUrl.startsWith('http')?productUrl:`https://equipesca.com${productUrl}`;
  const r=await fetch(url,{
    headers:{'user-agent':'Mozilla/5.0 AquaCoreMX/1.0'}
  });
  if(!r.ok) return '';
  const html=await r.text();
  const patterns=[
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i
  ];
  for(const re of patterns){
    const m=html.match(re);
    if(m?.[1]) return m[1].replaceAll('&amp;','&');
  }
  return '';
}

export default async function handler(req,res){
  res.setHeader('cache-control','public, s-maxage=86400, stale-while-revalidate=604800');
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});

  const name=String(req.query?.name||'').trim();
  const code=String(req.query?.code||'').trim();
  const debug=String(req.query?.debug||'')==='1';
  if(!name&&!code) return res.status(400).json({error:'Falta producto'});

  try{
    const queries=[];
    if(code) queries.push(code.replaceAll('/',' '));
    if(name) queries.push(name);
    if(name&&code) queries.push(`${name} ${code}`);
    let products=[];

    for(const q of queries){
      try{
        const found=await searchEquipesca(q);
        products.push(...found);
        if(found.length) break;
      }catch{}
    }

    const unique=[...new Map(products.map(p=>[String(p?.id||p?.url||p?.title),p])).values()];
    unique.sort((a,b)=>scoreProduct(b,name,code)-scoreProduct(a,name,code));
    const best=unique[0];

    let image=imageFromProduct(best);
    if(!image) image=await ogImage(best?.url);

    if(debug){
      return res.status(image?200:404).json({
        ok:Boolean(image),
        query:{name,code},
        matchedTitle:best?.title||null,
        productUrl:best?.url||null,
        image:image||null,
        candidates:unique.slice(0,5).map(p=>({title:p.title,url:p.url,score:scoreProduct(p,name,code)}))
      });
    }

    if(!image) return res.status(404).end();
    return res.redirect(302,image);
  }catch(err){
    if(debug) return res.status(500).json({error:String(err?.message||err)});
    return res.status(404).end();
  }
}
