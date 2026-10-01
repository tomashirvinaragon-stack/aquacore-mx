const q=new URLSearchParams(location.search),folio=q.get('folio')||'';
const title=document.querySelector('h1'),copy=document.querySelector('h1+p');
const link=document.querySelector('#tracking');
if(link)link.href='/tracking?folio='+encodeURIComponent(folio);
const folioNode=document.querySelector('#folio');
if(folioNode)folioNode.textContent=folio?'Folio: '+folio:'';
try{
  const last=JSON.parse(localStorage.getItem('aquacore-last-order')||'null');
  if(!last||last.id!==folio||!last.d?.email)throw new Error('lookup');
  const response=await fetch('/api/order-status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({folio,email:last.d.email})});
  const out=await response.json();
  if(!response.ok)throw new Error('lookup');
  const paid=['approved','paid','processed'].includes(out.order.payment_status);
  title.textContent=paid?'Pago confirmado':out.order.payment_status==='failed'?'Pago no completado':'Pago pendiente de confirmación';
  if(copy)copy.textContent=paid?'Tu pedido está registrado. Puedes consultar su preparación y rastreo.':'Consulta Mis pedidos para ver el estado confirmado antes de intentar otro pago.';
  if(paid){
    const current=JSON.parse(localStorage.getItem('aquacore-cart-v2')||'{}');
    for(const line of last.lines||[]){current[line.id]=Math.max(0,(Number(current[line.id])||0)-Number(line.qty));if(!current[line.id])delete current[line.id]}
    const key='aquacore-confirmed-'+folio;
    if(!localStorage.getItem(key)){localStorage.setItem('aquacore-cart-v2',JSON.stringify(current));localStorage.setItem(key,'1')}
  }
}catch{
  title.textContent='Consulta el estado de tu pedido';
  if(copy)copy.textContent='Usa tu folio y correo en Mis pedidos para verificar el pago y el envío.';
}
