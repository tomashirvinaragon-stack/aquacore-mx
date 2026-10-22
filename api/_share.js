import fs from 'node:fs';
import path from 'node:path';

// Liga corta para compartir un producto en Facebook / WhatsApp: /p/:id
// Facebook y WhatsApp no ejecutan JavaScript, así que aquí se entregan
// las etiquetas og:* (foto, nombre, precio) ya listas en el HTML y
// el visitante se redirige a la página normal del producto.

const SITE='https://aquacore-mx.vercel.app';
const NO_PRODUCT_IMAGE=new Set([78,80,85]);

const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=n=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(n);

function imageUrl(p){
  if(p.image) return /^https?:\/\//.test(p.image)?p.image:SITE+(p.image.startsWith('/')?'':'/')+p.image;
  if(p.cat==='Blowers') return `${SITE}/assets/products/blower-pulsar.webp`;
  if(NO_PRODUCT_IMAGE.has(Number(p.id))) return `${SITE}/assets/products/splash-cuadrado.jpg`;
  return `${SITE}/api/equipesca-image?name=${encodeURIComponent(p.name)}&code=${encodeURIComponent(p.code||'')}`;
}

export default function handler(req,res){
  const id=Number(String(req.query?.id||'').replace(/\D/g,''));
  let products=[];
  try{
    products=JSON.parse(fs.readFileSync(path.join(process.cwd(),'data','products.json'),'utf8'));
  }catch{}
  const p=products.find(x=>Number(x.id)===id);
  if(!p){
    res.setHeader('location','/#productos');
    return res.status(302).end();
  }

  const target=`/producto?id=${p.id}`;
  const title=`${p.name} | AquaCore MX`;
  const desc=`${fmt(p.price)} · Precio neto. ${p.description||''} Envíos a todo México. Atención por WhatsApp 644 212 7571.`.trim();
  const img=imageUrl(p);

  res.setHeader('content-type','text/html; charset=utf-8');
  res.setHeader('cache-control','public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(`<!doctype html>
<html lang="es-MX"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="AquaCore MX">
<meta property="og:title" content="${esc(p.name)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:url" content="${SITE}/p/${p.id}">
<meta property="product:price:amount" content="${Number(p.price).toFixed(2)}">
<meta property="product:price:currency" content="MXN">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${SITE}${target}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
</head><body>
<script>location.replace(${JSON.stringify(target)});</script>
<p><a href="${esc(target)}">Ver ${esc(p.name)}</a></p>
</body></html>`);
}
