export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
  const accessToken=process.env.MERCADOPAGO_ACCESS_TOKEN;
  if(!accessToken)return res.status(503).json({error:'Pago en línea no configurado'});
  const orderId=req.query?.order_id;
  if(!orderId||typeof orderId!=='string')return res.status(400).json({error:'order_id requerido'});
  try{
    const r=await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`,{headers:{authorization:`Bearer ${accessToken}`,accept:'application/json'}});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)return res.status(r.status).json({error:data?.message||'No se pudo consultar la orden'});
    return res.status(200).json({id:data.id,status:data.status,status_detail:data.status_detail,external_reference:data.external_reference,total_amount:data.total_amount,total_paid_amount:data.total_paid_amount,currency:data.currency});
  }catch(err){console.error(err);return res.status(500).json({error:'Error al consultar la orden'});}
}
