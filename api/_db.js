const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;

export function dbConfigured(){
  return Boolean(SUPABASE_URL&&SUPABASE_KEY);
}

async function request(path,{method='GET',body,prefer}={}){
  if(!dbConfigured()) throw new Error('Base de datos no configurada');
  const url=`${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/${path}`;
  const headers={
    apikey:SUPABASE_KEY,
    accept:'application/json'
  };
  if(body!==undefined) headers['content-type']='application/json';
  if(prefer) headers.prefer=prefer;
  const r=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();
  let data=null;
  if(text){try{data=JSON.parse(text)}catch{data=text}}
  if(!r.ok){
    const msg=typeof data==='object'&&(data?.message||data?.hint||data?.details)||String(data||`HTTP ${r.status}`);
    throw new Error(`Supabase ${r.status}: ${msg}`);
  }
  return data;
}

export async function upsertOrder(order){
  return request('orders?on_conflict=folio',{
    method:'POST',
    body:order,
    prefer:'resolution=merge-duplicates,return=representation'
  });
}

export async function updateOrderByFolio(folio,patch){
  if(!folio) return null;
  return request(`orders?folio=eq.${encodeURIComponent(folio)}`,{
    method:'PATCH',
    body:{...patch,updated_at:new Date().toISOString()},
    prefer:'return=representation'
  });
}

export async function updateOrderByMpOrderId(orderId,patch){
  if(!orderId) return null;
  return request(`orders?mp_order_id=eq.${encodeURIComponent(String(orderId))}`,{
    method:'PATCH',
    body:{...patch,updated_at:new Date().toISOString()},
    prefer:'return=representation'
  });
}

export async function listOrders(limit=500){
  const n=Math.max(1,Math.min(1000,Number(limit)||500));
  return request(`orders?select=*&order=created_at.desc&limit=${n}`);
}


export async function listInventory(){
  return request('inventory?select=*&order=product_id.asc');
}

export async function upsertInventoryItem(item){
  return request('inventory?on_conflict=product_id',{
    method:'POST',
    body:item,
    prefer:'resolution=merge-duplicates,return=representation'
  });
}

export async function upsertInventoryItems(items){
  if(!Array.isArray(items)||!items.length) return [];
  return request('inventory?on_conflict=product_id',{
    method:'POST',
    body:items,
    prefer:'resolution=merge-duplicates,return=representation'
  });
}

export async function getInventoryByIds(ids){
  const clean=[...new Set((Array.isArray(ids)?ids:[]).map(Number).filter(Number.isInteger))];
  if(!clean.length) return [];
  return request(`inventory?select=*&product_id=in.(${clean.join(',')})`);
}

export async function commitOrderInventory(folio){
  if(!folio) return null;
  return request('rpc/commit_order_inventory',{
    method:'POST',
    body:{p_folio:String(folio)}
  });
}
