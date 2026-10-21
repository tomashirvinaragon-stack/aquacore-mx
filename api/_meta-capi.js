// AquaCore MX - Meta Conversions API (servidor)
// Envía el evento Purchase cuando Mercado Pago confirma un pago.
// Variables de entorno en Vercel:
//   META_CAPI_ACCESS_TOKEN  (obligatoria) token generado en el Administrador de eventos
//   META_PIXEL_ID           (opcional)    por defecto el pixel AquaCore MX
//   META_TEST_EVENT_CODE    (opcional)    solo para pruebas en "Probar eventos"
import { createHash } from 'node:crypto';

const GRAPH_VERSION='v21.0';
const DEFAULT_PIXEL_ID='3016758178709736';

export function metaCapiConfigured(){
  return Boolean(process.env.META_CAPI_ACCESS_TOKEN);
}

const sha256=v=>createHash('sha256').update(v).digest('hex');
const plain=v=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
const hashed=v=>{const s=plain(v);return s?[sha256(s)]:undefined};

function hashedPhone(phone){
  let d=String(phone??'').replace(/\D/g,'');
  if(!d) return undefined;
  if(d.length===10) d='52'+d;               // número mexicano sin lada de país
  if(d.length===13&&d.startsWith('521')) d='52'+d.slice(3); // formato antiguo móvil
  return [sha256(d)];
}

function hashedCompact(v){
  const s=plain(v).replace(/[^a-z0-9]/g,'');
  return s?[sha256(s)]:undefined;
}

function splitName(full){
  const parts=plain(full).split(/\s+/).filter(Boolean);
  if(!parts.length) return {};
  return {fn:[sha256(parts[0])],ln:parts.length>1?[sha256(parts[parts.length-1])]:undefined};
}

export function trackingFromRequest(req,clientMeta){
  const fwd=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();
  const clean=v=>{const s=String(v??'').trim();return s&&s.length<=500?s:null};
  return {
    _type:'meta_tracking',
    client_ip:clean(fwd||req.headers['x-real-ip']),
    client_user_agent:clean(req.headers['user-agent']),
    fbp:clean(clientMeta?.fbp),
    fbc:clean(clientMeta?.fbc)
  };
}

// row: fila de la tabla orders (Supabase)
export async function sendPurchaseFromOrder(row,{baseUrl}={}){
  const token=process.env.META_CAPI_ACCESS_TOKEN;
  if(!token||!row?.folio) return {skipped:true};
  const pixelId=process.env.META_PIXEL_ID||DEFAULT_PIXEL_ID;
  const items=Array.isArray(row.items)?row.items:[];
  const tracking=items.find(x=>x&&x._type==='meta_tracking')||{};
  const products=items.filter(x=>x&&!x._type&&Number.isFinite(Number(x.id)));
  const name=splitName(row.customer_name);

  const user_data={
    em:hashed(row.customer_email),
    ph:hashedPhone(row.customer_phone),
    fn:name.fn,
    ln:name.ln,
    ct:hashedCompact(row.city),
    st:hashedCompact(row.state),
    zp:hashedCompact(row.zip),
    country:[sha256('mx')],
    external_id:[sha256(String(row.folio))],
    client_ip_address:tracking.client_ip||undefined,
    client_user_agent:tracking.client_user_agent||undefined,
    fbp:tracking.fbp||undefined,
    fbc:tracking.fbc||undefined
  };
  Object.keys(user_data).forEach(k=>user_data[k]===undefined&&delete user_data[k]);

  const paidAt=row.paid_at?Date.parse(row.paid_at):Date.now();
  const site=(baseUrl||process.env.PUBLIC_SITE_URL||'https://aquacore-mx.vercel.app').replace(/\/$/,'');
  const event={
    event_name:'Purchase',
    event_time:Math.floor((Number.isFinite(paidAt)?paidAt:Date.now())/1000),
    event_id:`purchase-${row.folio}`,           // mismo ID que el navegador (deduplicación)
    action_source:'website',
    event_source_url:`${site}/success.html`,
    user_data,
    custom_data:{
      currency:String(row.currency||'MXN'),
      value:Number(row.subtotal||0),
      order_id:String(row.folio),
      content_type:'product',
      content_ids:products.map(x=>String(x.id)),
      contents:products.map(x=>({id:String(x.id),quantity:Number(x.qty||1),item_price:Number(x.unit_price||0)})),
      num_items:products.reduce((s,x)=>s+Number(x.qty||1),0)
    }
  };

  const payload={data:[event]};
  if(process.env.META_TEST_EVENT_CODE) payload.test_event_code=process.env.META_TEST_EVENT_CODE;

  const r=await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(payload)
  });
  const out=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`Meta CAPI ${r.status}: ${out?.error?.message||'error'}`);
  return {ok:true,eventsReceived:out?.events_received??null,fbtraceId:out?.fbtrace_id??null};
}
