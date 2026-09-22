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

export async function getOrderByFolio(folio){
  if(!folio) return null;
  const rows=await request(`orders?select=*&folio=eq.${encodeURIComponent(String(folio))}&limit=1`);
  return Array.isArray(rows)?rows[0]||null:null;
}

export async function listOrdersAll({from,to,max=20000}={}){
  const pageSize=1000;
  const cap=Math.max(1,Math.min(50000,Number(max)||20000));
  const all=[];
  let offset=0;

  while(all.length<cap){
    let path=`orders?select=*&order=created_at.desc&limit=${pageSize}&offset=${offset}`;
    if(from) path+=`&created_at=gte.${encodeURIComponent(String(from))}`;
    if(to) path+=`&created_at=lt.${encodeURIComponent(String(to))}`;
    const rows=await request(path);
    if(!Array.isArray(rows)||!rows.length) break;
    all.push(...rows);
    if(rows.length<pageSize) break;
    offset+=rows.length;
  }

  return all.slice(0,cap);
}

function inventoryFolio(productId){
  return `INV-${Number(productId)}`;
}

function inventoryRecord(item){
  const now=new Date().toISOString();
  const productId=Number(item.product_id);
  const payload={
    _type:'inventory',
    product_id:productId,
    stock:Math.max(0,Number(item.stock)||0),
    low_stock_threshold:Math.max(0,Number(item.low_stock_threshold)||0),
    managed:Boolean(item.managed),
    source_code:String(item.source_code||'').trim()||null,
    source_description:String(item.source_description||'').trim()||null,
    source_file:String(item.source_file||'').trim()||null,
    source_updated_at:item.source_updated_at||now
  };
  return {
    folio:inventoryFolio(productId),
    mp_order_id:null,
    customer_name:String(item.product_name||'Inventario AquaCore').slice(0,250),
    customer_email:null,
    customer_phone:null,
    address:null,
    city:null,
    state:null,
    zip:null,
    reference:null,
    items:[payload],
    subtotal:0,
    shipping_amount:0,
    shipping_status:'internal',
    payment_status:'inventory',
    payment_status_detail:'equipesca_sync',
    payment_method:null,
    currency:'MXN',
    paid_at:null,
    updated_at:now
  };
}

function inventoryItemFromOrder(row){
  const item=(Array.isArray(row?.items)?row.items:[]).find(x=>x&&x._type==='inventory');
  if(!item) return null;
  return {
    product_id:Number(item.product_id),
    stock:Math.max(0,Number(item.stock)||0),
    low_stock_threshold:Math.max(0,Number(item.low_stock_threshold)||0),
    managed:Boolean(item.managed),
    source_code:item.source_code||null,
    source_description:item.source_description||null,
    source_file:item.source_file||null,
    source_updated_at:item.source_updated_at||row.updated_at||null,
    updated_at:row.updated_at||null
  };
}

export async function listInventory(){
  const rows=await request('orders?select=*&payment_status=eq.inventory&order=folio.asc&limit=1000');
  return (Array.isArray(rows)?rows:[]).map(inventoryItemFromOrder).filter(Boolean);
}

export async function upsertInventoryItem(item){
  const rows=await upsertOrder(inventoryRecord(item));
  return (Array.isArray(rows)?rows:[]).map(inventoryItemFromOrder).filter(Boolean);
}

export async function upsertInventoryItems(items){
  if(!Array.isArray(items)||!items.length) return [];
  const records=items.map(inventoryRecord);
  const rows=await request('orders?on_conflict=folio',{
    method:'POST',
    body:records,
    prefer:'resolution=merge-duplicates,return=representation'
  });
  return (Array.isArray(rows)?rows:[]).map(inventoryItemFromOrder).filter(Boolean);
}

export async function getInventoryByIds(ids){
  const wanted=new Set((Array.isArray(ids)?ids:[]).map(Number).filter(Number.isFinite));
  if(!wanted.size) return [];
  const all=await listInventory();
  return all.filter(x=>wanted.has(Number(x.product_id)));
}

function shippingProfileFolio(productId){
  return `SHIP-${Number(productId)}`;
}

function shippingProfileRecord(item){
  const now=new Date().toISOString();
  const productId=Number(item.product_id);
  const payload={
    _type:'shipping_profile',
    product_id:productId,
    weight_kg:Math.max(0,Number(item.weight_kg)||0),
    length_cm:Math.max(0,Number(item.length_cm)||0),
    width_cm:Math.max(0,Number(item.width_cm)||0),
    height_cm:Math.max(0,Number(item.height_cm)||0),
    units_per_parcel:Math.max(1,Math.floor(Number(item.units_per_parcel)||1)),
    updated_at:now
  };
  return {
    folio:shippingProfileFolio(productId),
    mp_order_id:null,
    customer_name:String(item.product_name||'Empaque AquaCore').slice(0,250),
    customer_email:null,
    customer_phone:null,
    address:null,
    city:null,
    state:null,
    zip:null,
    reference:null,
    items:[payload],
    subtotal:0,
    shipping_amount:0,
    shipping_status:'internal',
    payment_status:'shipping_profile',
    payment_status_detail:'shipping_profile',
    payment_method:null,
    currency:'MXN',
    paid_at:null,
    updated_at:now
  };
}

function shippingProfileFromOrder(row){
  const item=(Array.isArray(row?.items)?row.items:[]).find(x=>x&&x._type==='shipping_profile');
  if(!item) return null;
  return {
    product_id:Number(item.product_id),
    weight_kg:Math.max(0,Number(item.weight_kg)||0),
    length_cm:Math.max(0,Number(item.length_cm)||0),
    width_cm:Math.max(0,Number(item.width_cm)||0),
    height_cm:Math.max(0,Number(item.height_cm)||0),
    units_per_parcel:Math.max(1,Math.floor(Number(item.units_per_parcel)||1)),
    updated_at:item.updated_at||row.updated_at||null
  };
}

export async function listShippingProfiles(){
  const rows=await request('orders?select=*&payment_status=eq.shipping_profile&order=folio.asc&limit=1000');
  return (Array.isArray(rows)?rows:[]).map(shippingProfileFromOrder).filter(Boolean);
}

export async function upsertShippingProfile(item){
  const rows=await upsertOrder(shippingProfileRecord(item));
  return (Array.isArray(rows)?rows:[]).map(shippingProfileFromOrder).filter(Boolean);
}

export async function getShippingProfilesByIds(ids){
  const wanted=new Set((Array.isArray(ids)?ids:[]).map(Number).filter(Number.isFinite));
  if(!wanted.size) return [];
  const all=await listShippingProfiles();
  return all.filter(x=>wanted.has(Number(x.product_id)));
}

export async function commitOrderInventory(folio){
  if(!folio) return null;
  const orders=await request(`orders?select=*&folio=eq.${encodeURIComponent(String(folio))}&limit=1`);
  const order=Array.isArray(orders)?orders[0]:null;
  if(!order) return {ok:false,code:'ORDER_NOT_FOUND'};

  const items=Array.isArray(order.items)?order.items:[];
  if(items.some(x=>x&&x._type==='inventory_committed')){
    return {ok:true,already_committed:true};
  }

  const productLines=items.filter(x=>x&&!x._type&&Number.isFinite(Number(x.id)));
  const inventory=await getInventoryByIds(productLines.map(x=>x.id));
  const byId=new Map(inventory.map(x=>[Number(x.product_id),x]));

  for(const line of productLines){
    const inv=byId.get(Number(line.id));
    const qty=Math.max(1,Number(line.qty)||1);
    if(inv?.managed && Number(inv.stock)<qty){
      return {
        ok:false,
        code:'INSUFFICIENT_STOCK',
        product_id:Number(line.id),
        available:Number(inv.stock||0),
        requested:qty
      };
    }
  }

  for(const line of productLines){
    const inv=byId.get(Number(line.id));
    const qty=Math.max(1,Number(line.qty)||1);
    if(!inv?.managed) continue;
    await upsertInventoryItem({
      ...inv,
      stock:Math.max(0,Number(inv.stock)-qty),
      source_updated_at:inv.source_updated_at||new Date().toISOString()
    });
  }

  const marker={_type:'inventory_committed',committed_at:new Date().toISOString()};
  await updateOrderByFolio(String(folio),{items:[...items,marker]});
  return {ok:true,already_committed:false};
}
