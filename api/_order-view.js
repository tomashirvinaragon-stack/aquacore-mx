export function safeTrackingUrl(value){
  try{
    const url=new URL(String(value||''));
    return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';
  }catch{return ''}
}

export function customerOrder(order){
  const items=Array.isArray(order.items)?order.items:[];
  const fulfillment=items.find(x=>x?._type==='fulfillment')||{};
  const payment=String(order.payment_status||'pending').toLowerCase();
  const paid=['approved','paid','processed'].includes(payment);
  let status='payment_pending';
  if(order.admin_status==='canceled')status='canceled';
  else if(['refunded','charged_back'].includes(payment))status='refunded';
  else if(['failed','canceled','cancelled','rejected'].includes(payment))status='payment_issue';
  else if(order.shipping_status==='quote_pending')status='shipping_quote';
  else if(paid)status=fulfillment.status||'to_fulfill';
  return {
    folio:order.folio,status,payment_status:payment,
    city:order.city||'',state:order.state||'',
    carrier:fulfillment.carrier||'',tracking_number:fulfillment.tracking_number||'',
    tracking_url:safeTrackingUrl(fulfillment.tracking_url),updated_at:order.updated_at||null,
    total:Number((Number(order.subtotal||0)+Number(order.shipping_amount||0)).toFixed(2)),
    shipping_status:order.shipping_status||'',
    items:items.filter(x=>x&&!x._type).map(x=>({name:x.name,code:x.code||'',qty:x.qty}))
  };
}
