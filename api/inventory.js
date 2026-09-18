import fs from 'node:fs';
import path from 'node:path';
import { dbConfigured, listInventory } from './_db.js';
import {
  equipescaSqlConfigured,
  lastAutomaticSync,
  syncEquipescaInventory
} from './_equipesca-stock.js';

let activeSync=null;
let lastAttemptAt=0;

function syncIntervalMs(){
  const raw=Number(process.env.EQUIPESCA_SYNC_MINUTES||15);
  const minutes=Number.isFinite(raw)?Math.max(5,Math.min(1440,raw)):15;
  return minutes*60*1000;
}

function catalogNeedsSync(rows){
  try{
    const file=path.join(process.cwd(),'data','products.json');
    const products=JSON.parse(fs.readFileSync(file,'utf8'));
    const managedIds=new Set(
      (Array.isArray(rows)?rows:[])
        .filter(row=>Boolean(row?.managed))
        .map(row=>Number(row.product_id))
    );

    return products.some(product=>
      String(product?.equipesca_code||'').trim() &&
      !managedIds.has(Number(product.id))
    );
  }catch(err){
    console.error('Catalog inventory coverage check failed',err);
    return false;
  }
}

async function refreshIfNeeded(rows){
  if(!equipescaSqlConfigured()) return {rows,sync:'not_configured'};

  const missingMappedProducts=catalogNeedsSync(rows);
  const last=lastAutomaticSync(rows);
  const lastMs=last?Date.parse(last):0;

  // A product newly added to the catalog must not wait for the normal
  // refresh interval. Force a sync when its Equipesca mapping exists but
  // there is still no managed inventory row for it.
  if(!missingMappedProducts && lastMs && Date.now()-lastMs<syncIntervalMs()){
    return {rows,sync:'fresh'};
  }

  if(Date.now()-lastAttemptAt<60_000) return {rows,sync:'cooldown'};
  lastAttemptAt=Date.now();

  try{
    if(!activeSync){
      activeSync=syncEquipescaInventory().finally(()=>{activeSync=null});
    }
    await activeSync;
    return {rows:await listInventory(),sync:missingMappedProducts?'catalog_updated':'updated'};
  }catch(err){
    console.error('Automatic inventory refresh skipped',err);
    return {rows,sync:'cached'};
  }
}

export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});

  if(!dbConfigured()){
    return res.status(200).json({ok:true,configured:false,inventory:[]});
  }

  try{
    const current=await listInventory();
    const refreshed=await refreshIfNeeded(current);
    return res.status(200).json({
      ok:true,
      configured:true,
      sync:refreshed.sync,
      inventory:(Array.isArray(refreshed.rows)?refreshed.rows:[]).map(x=>({
        product_id:Number(x.product_id),
        stock:Number(x.stock||0),
        low_stock_threshold:Number(x.low_stock_threshold||0),
        managed:Boolean(x.managed),
        updated_at:x.updated_at||null
      }))
    });
  }catch(err){
    console.error('Public inventory error',err);
    return res.status(200).json({ok:true,configured:false,inventory:[]});
  }
}
