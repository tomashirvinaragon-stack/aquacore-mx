import crypto from 'node:crypto';

function parseSignature(header=''){
  const out={};
  for(const part of String(header).split(',')){
    const i=part.indexOf('=');
    if(i>0) out[part.slice(0,i).trim()]=part.slice(i+1).trim();
  }
  return out;
}

function safeEqualHex(a,b){
  if(!/^[a-f0-9]+$/i.test(a||'')||!/^[a-f0-9]+$/i.test(b||'')) return false;
  const aa=Buffer.from(a,'hex'),bb=Buffer.from(b,'hex');
  if(aa.length!==bb.length) return false;
  return crypto.timingSafeEqual(aa,bb);
}

function verifySignature({signature,requestId,dataId,secret}){
  const {ts,v1}=parseSignature(signature);
  if(!ts||!v1||!secret) return false;

  // Mercado Pago firma únicamente los pares presentes. Para IDs alfanuméricos
  // recomienda usar data.id en minúsculas durante la validación.
  let manifest='';
  if(dataId) manifest+=`id:${String(dataId).toLowerCase()};`;
  if(requestId) manifest+=`request-id:${requestId};`;
  manifest+=`ts:${ts};`;

  const expected=crypto.createHmac('sha256',secret).update(manifest).digest('hex');
  return safeEqualHex(expected,v1);
}

async function fetchOrder(orderId,accessToken){
  const r=await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`,{
    headers:{authorization:`Bearer ${accessToken}`,accept:'application/json'}
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data?.message||data?.error||`Mercado Pago HTTP ${r.status}`);
  return data;
}

export default async function handler(req,res){
  if(req.method==='GET'){
    return res.status(200).json({
      ok:true,
      endpoint:'mercadopago-webhook',
      accessTokenConfigured:Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN),
      webhookSecretConfigured:Boolean(process.env.MERCADOPAGO_WEBHOOK_SECRET)
    });
  }

  if(req.method!=='POST') return res.status(405).json({error:'Método no permitido'});

  const accessToken=process.env.MERCADOPAGO_ACCESS_TOKEN;
  const secret=process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if(!accessToken||!secret){
    console.error('Webhook Mercado Pago sin credenciales completas');
    return res.status(503).json({error:'Webhook no configurado'});
  }

  const body=req.body||{};
  const queryDataId=String(req.query?.['data.id']||req.query?.data_id||'');
  const bodyDataId=String(body?.data?.id||'');
  const orderId=queryDataId||bodyDataId;
  const type=String(req.query?.type||body?.type||'');
  const signature=String(req.headers['x-signature']||'');
  const requestId=String(req.headers['x-request-id']||'');

  // La firma se valida con data.id del query string, tal como lo documenta Mercado Pago.
  if(!verifySignature({signature,requestId,dataId:queryDataId,secret})){
    console.warn('Webhook Mercado Pago rechazado por firma inválida',{
      type,
      hasQueryDataId:Boolean(queryDataId),
      hasBodyDataId:Boolean(bodyDataId),
      hasRequestId:Boolean(requestId)
    });
    return res.status(401).json({error:'Firma inválida'});
  }

  if(type && type!=='order' && type!=='orders_v2'){
    console.log('Webhook Mercado Pago ignorado por tipo no manejado',{type,orderId});
    return res.status(200).json({ok:true,ignored:true});
  }

  // El simulador puede enviar un ID de ejemplo solamente en el body. Una vez
  // validada la firma, lo reconocemos sin intentar consultar una orden inexistente.
  if(!queryDataId){
    console.log('AQUACORE_WEBHOOK_SIMULATION',{action:body?.action||null,type,bodyDataId:bodyDataId||null});
    return res.status(200).json({ok:true,received:true,simulation:true});
  }

  try{
    const order=await fetchOrder(orderId,accessToken);
    const summary={
      eventId:body?.id||null,
      action:body?.action||null,
      liveMode:body?.live_mode??null,
      orderId:order.id,
      externalReference:order.external_reference||null,
      status:order.status||null,
      statusDetail:order.status_detail||null,
      totalAmount:order.total_amount||null,
      totalPaidAmount:order.total_paid_amount||null,
      currency:order.currency||null
    };

    if(order.status==='processed' && order.status_detail==='accredited'){
      console.log('AQUACORE_PAYMENT_APPROVED',summary);
    }else if(order.status==='failed'||order.status==='canceled'||order.status==='refunded'){
      console.log('AQUACORE_PAYMENT_FINAL_STATE',summary);
    }else{
      console.log('AQUACORE_PAYMENT_UPDATE',summary);
    }

    return res.status(200).json({ok:true,received:true,status:order.status,statusDetail:order.status_detail});
  }catch(err){
    console.error('Webhook Mercado Pago: no se pudo consultar la order',err);
    return res.status(500).json({error:'No se pudo validar el estado de la order'});
  }
}
