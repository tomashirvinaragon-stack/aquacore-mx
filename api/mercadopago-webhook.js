import { WebhookSignatureValidator, InvalidWebhookSignatureError } from 'mercadopago';

function validateWithSdk({signature,requestId,dataId,secret}){
  if(!signature||!secret) return false;
  try{
    WebhookSignatureValidator.validate({
      xSignature: signature,
      xRequestId: requestId || undefined,
      dataId: dataId || undefined,
      secret: String(secret).trim()
    });
    return true;
  }catch(err){
    if(err instanceof InvalidWebhookSignatureError) return false;
    console.error('Mercado Pago webhook validator error',err);
    return false;
  }
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
      webhookSecretConfigured:Boolean(process.env.MERCADOPAGO_WEBHOOK_SECRET),
      validator:'mercadopago-sdk'
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

  // Mercado Pago documenta validar con data.id del query string.
  // El simulador puede entregar el Data ID dentro del body; si no hay query,
  // validamos contra ese mismo ID usando el SDK oficial.
  const signatureOk =
    validateWithSdk({signature,requestId,dataId:queryDataId,secret}) ||
    (!queryDataId && bodyDataId
      ? validateWithSdk({signature,requestId,dataId:bodyDataId,secret})
      : false);

  if(!signatureOk){
    console.warn('Webhook Mercado Pago rechazado por firma inválida',{
      type,
      hasQueryDataId:Boolean(queryDataId),
      hasBodyDataId:Boolean(bodyDataId),
      hasRequestId:Boolean(requestId),
      hasSignature:Boolean(signature)
    });
    return res.status(401).json({error:'Firma inválida'});
  }

  if(type && type!=='order' && type!=='orders_v2'){
    console.log('Webhook Mercado Pago ignorado por tipo no manejado',{type,orderId});
    return res.status(200).json({ok:true,ignored:true});
  }

  // La simulación de Mercado Pago envía una order completa de ejemplo en data.
  // No intentamos consultar ese ID ficticio en /v1/orders.
  const looksLikeSimulation = Boolean(
    body?.data &&
    typeof body.data==='object' &&
    (
      body.data.status ||
      body.data.status_detail ||
      body.data.total_amount ||
      body.data.transactions ||
      body.data.payments ||
      body.data.external_reference
    )
  );

  if(looksLikeSimulation){
    console.log('AQUACORE_WEBHOOK_SIMULATION',{
      action:body?.action||null,
      type,
      dataId:bodyDataId||queryDataId||null,
      status:body?.data?.status||null,
      statusDetail:body?.data?.status_detail||null
    });
    return res.status(200).json({ok:true,received:true,simulation:true});
  }

  if(!orderId){
    return res.status(400).json({error:'Notificación sin order id'});
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

    return res.status(200).json({
      ok:true,
      received:true,
      status:order.status,
      statusDetail:order.status_detail
    });
  }catch(err){
    console.error('Webhook Mercado Pago: no se pudo consultar la order',err);
    return res.status(500).json({error:'No se pudo validar el estado de la order'});
  }
}
