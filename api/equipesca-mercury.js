import fs from 'node:fs';
import path from 'node:path';

function norm(s=''){
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();
}

const INVENTORY_SNAPSHOT_AT='2026-09-18T11:31:11-07:00';
const ZERO_STOCK_EQUIPESCA_CODES=new Set(['54405','44734','55618','27417']);

function loadMercury(){
  const file=path.join(process.cwd(),'data','products.json');
  const products=JSON.parse(fs.readFileSync(file,'utf8'));
  return products.filter(p=>p.cat==='Motores Mercury');
}

function sourceAvailable(product){
  if(typeof product?.available==='boolean') return product.available;
  if(Array.isArray(product?.variants)){
    const known=product.variants.filter(v=>typeof v?.available==='boolean');
    if(known.length) return known.some(v=>v.available);
  }
  return null;
}

export default async function handler(req,res){
  res.setHeader('cache-control','public, s-maxage=300, stale-while-revalidate=900');
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});

  try{
    const catalog=loadMercury();
    const r=await fetch('https://equipesca.com/collections/motores-marinos/products.json?limit=250',{
      headers:{accept:'application/json','user-agent':'Mozilla/5.0 AquaCoreMX/1.0'}
    });
    if(!r.ok) throw new Error(`Equipesca HTTP ${r.status}`);
    const json=await r.json();
    const source=Array.isArray(json?.products)?json.products:[];

    const availability=catalog.map(p=>{
      const code=norm(p.code);
      const match=source.find(x=>code && norm(x?.title||'').includes(code));
      const shopAvailable=sourceAvailable(match);
      const equipescaCode=String(p?.equipesca_code||'').trim();

      // Snapshot real de existencias compartido por Equipesca el 18-sep-2026 11:31.
      // El inventario SQL administrado tiene prioridad en el frontend cuando existe.
      // Este endpoint funciona únicamente como respaldo.
      const snapshotAvailable=equipescaCode
        ? !ZERO_STOCK_EQUIPESCA_CODES.has(equipescaCode)
        : null;

      return {
        product_id:Number(p.id),
        available:typeof snapshotAvailable==='boolean'
          ? snapshotAvailable
          : (typeof shopAvailable==='boolean'?shopAvailable:null),
        snapshot_at:INVENTORY_SNAPSHOT_AT,
        equipesca_code:equipescaCode||null,
        matched:Boolean(match),
        matched_title:match?.title||null
      };
    });

    return res.status(200).json({
      ok:true,
      source:'Existencias Equipesca 2026-09-18 11:31 · respaldo Shopify',
      snapshot_at:INVENTORY_SNAPSHOT_AT,
      availability
    });
  }catch(err){
    console.error('Equipesca Mercury availability error',err);
    return res.status(200).json({
      ok:false,
      source:'Equipesca Shopify · motores-marinos',
      availability:[],
      error:String(err?.message||err).slice(0,300)
    });
  }
}
