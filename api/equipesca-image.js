import shareHandler from './_share.js';
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

// Códigos de AquaCore que en equipesca.com aparecen con otro nombre
const CODE_ALIASES={
  TAS8S:'as8s'
};

// Medidas que deben coincidir exactamente (hp, pulgadas, mm) para aceptar una foto.
// Evita mostrar, por ejemplo, la foto de un motor de 15 hp en uno de 150 hp.
function measures(s=''){
  const t=String(s).toLowerCase().replace(/,/g,'.');
  const out=new Set();
  const re=/(\d+(?:\.\d+)?)\s*(hp|pulg|mm|")/g;
  let m;
  while((m=re.exec(t))){
    const unit=m[2]==='"'?'pulg':m[2];
    out.add(`${Number(m[1])}${unit}`);
  }
  return out;
}

function compatible(p,name){
  const need=measures(name);
  if(!need.size) return true;
  const have=measures(p?.title||'');
  for(const x of need){
    const unit=x.replace(/^[\d.]+/,'');
    const sameUnit=[...have].filter(h=>h.endsWith(unit));
    // Si el producto de Equipesca declara esa unidad, debe incluir el mismo valor.
    if(sameUnit.length && !have.has(x)) return false;
    // Para hp la medida es obligatoria: sin hp en el título no se acepta.
    if(unit==='hp' && !have.has(x)) return false;
    // Para pulgadas, el número debe aparecer en el título aunque no diga "pulg".
    if(unit==='pulg'){
      const nums=new Set(String(p?.title||'').toLowerCase().replace(/,/g,'.')
        .split(/[^0-9.]+/).filter(Boolean).map(v=>String(Number(v))));
      if(!nums.has(String(Number(x.replace(/pulg$/,''))))) return false;
    }
  }
  return true;
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
  // Liga corta de producto para Facebook/WhatsApp: /p/:id → ?share=:id
  if(req.query?.share) return shareHandler({...req,query:{id:req.query.share}},res);
  // Foto externa (Mercury) servida desde nuestro dominio y guardada en caché
  if(req.query?.src){
    const src=String(req.query.src);
    let u;try{u=new URL(src)}catch{return res.status(400).end()}
    if(!['shop.mercurymarine.com','www.mercruiserparts.com','equipesca.com','cdn.shopify.com'].includes(u.hostname)) return res.status(403).end();
    try{
      const r=await fetch(u,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',accept:'image/avif,image/webp,image/*,*/*'}});
      const type=r.headers.get('content-type')||'';
      if(!r.ok||!type.startsWith('image/')) return res.redirect(302,src);
      const buf=Buffer.from(await r.arrayBuffer());
      res.setHeader('content-type',type);
      res.setHeader('cache-control','public, max-age=604800, s-maxage=31536000, immutable');
      return res.status(200).send(buf);
    }catch{return res.redirect(302,src)}
  }
  res.setHeader('cache-control','public, s-maxage=86400, stale-while-revalidate=604800');
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});

  const name=String(req.query?.name||'').trim();
  const code=String(req.query?.code||'').trim();
  const debug=String(req.query?.debug||'')==='1';
  if(!name&&!code) return res.status(400).json({error:'Falta producto'});

  try{
    const queries=[];
    const alias=CODE_ALIASES[code.toUpperCase()];
    if(alias) queries.push(alias);
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
    const best=unique.find(p=>compatible(p,name));

    let image=imageFromProduct(best);
    if(!image) image=await ogImage(best?.url);

    if(debug){
      return res.status(image?200:404).json({
        ok:Boolean(image),
        query:{name,code},
        matchedTitle:best?.title||null,
        productUrl:best?.url||null,
        image:image||null,
        candidates:unique.slice(0,5).map(p=>({title:p.title,url:p.url,score:scoreProduct(p,name,code),compatible:compatible(p,name)}))
      });
    }

    if(!image) return res.status(404).end();
    return res.redirect(302,image);
  }catch(err){
    if(debug) return res.status(500).json({error:String(err?.message||err)});
    return res.status(404).end();
  }
}
