let cachedToken=null;
let cachedTokenExpiresAt=0;

const API_BASE=(process.env.SKYDROPX_API_BASE_URL||'https://api-pro.skydropx.com').replace(/\/$/,'');
const CLIENT_ID=()=>process.env.SKYDROPX_CLIENT_ID||'';
const CLIENT_SECRET=()=>process.env.SKYDROPX_CLIENT_SECRET||'';

export function skydropxConfigured(){
  return Boolean(CLIENT_ID()&&CLIENT_SECRET()&&process.env.SKYDROPX_ORIGIN_TEMPLATE_ID);
}

async function getToken(){
  const now=Date.now();
  if(cachedToken && now<cachedTokenExpiresAt-60000) return cachedToken;

  const body=new URLSearchParams({
    grant_type:'client_credentials',
    client_id:CLIENT_ID(),
    client_secret:CLIENT_SECRET()
  });

  const r=await fetch(`${API_BASE}/api/v1/oauth/token`,{
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body
  });

  const out=await r.json().catch(()=>({}));
  if(!r.ok||!out.access_token){
    const err=new Error(out.error_description||out.error||'No fue posible autenticar con Skydropx');
    err.status=r.status;
    throw err;
  }

  cachedToken=out.access_token;
  cachedTokenExpiresAt=now+Math.max(60,Number(out.expires_in)||7200)*1000;
  return cachedToken;
}

async function api(path,options={}){
  const token=await getToken();
  const r=await fetch(`${API_BASE}${path}`,{
    ...options,
    headers:{
      accept:'application/json',
      'content-type':'application/json',
      authorization:`Bearer ${token}`,
      ...(options.headers||{})
    }
  });
  const out=await r.json().catch(()=>({}));
  if(!r.ok){
    const err=new Error(out.error_description||out.error||out.message||`Skydropx HTTP ${r.status}`);
    err.status=r.status;
    err.payload=out;
    throw err;
  }
  return out;
}

export async function createQuotation(quotation){
  return api('/api/v1/quotations',{method:'POST',body:JSON.stringify({quotation})});
}

export async function getQuotation(id){
  return api(`/api/v1/quotations/${encodeURIComponent(id)}`,{method:'GET'});
}

export async function getCompletedQuotation(id,initial){
  let quote=initial;
  for(let i=0;i<4 && !quote?.is_completed;i++){
    await new Promise(r=>setTimeout(r,500));
    quote=await getQuotation(id);
  }
  return quote;
}

export function normalizeRates(quote){
  const rates=Array.isArray(quote?.rates)?quote.rates:[];
  return rates
    .filter(r=>r?.id && Number(r.total||r.amount)>0 && !['no_coverage','not_applicable','tariff_price_not_found'].includes(String(r.status||'')))
    .map(r=>({
      quotationId:String(quote.id||''),
      rateId:String(r.id),
      carrier:String(r.provider_display_name||r.provider_name||'Paquetería'),
      service:String(r.provider_service_name||r.provider_service_code||'Servicio'),
      days:Number.isFinite(Number(r.days))?Number(r.days):null,
      amount:Number(Number(r.total||r.amount).toFixed(2)),
      currency:String(r.currency_code||'MXN')
    }))
    .sort((a,b)=>a.amount-b.amount);
}

export async function validateRate(quotationId,rateId){
  const quote=await getQuotation(quotationId);
  const rate=normalizeRates(quote).find(x=>x.rateId===String(rateId));
  if(!rate){
    const err=new Error('La tarifa de envío ya no está disponible');
    err.code='SHIPPING_RATE_INVALID';
    throw err;
  }
  return rate;
}
