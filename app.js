const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const PHONE='526442127571', FREE_SHIPPING=5000;
let PRODUCTS=[],activeCat='Todos',search='',sort='featured',pendingWhatsApp='';
let cart=JSON.parse(localStorage.getItem('aquacore-cart-v2')||'{}');
const fmt=n=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(n);
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const slugify=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
const productUrl=p=>`${location.origin}/producto?id=${p.id}`;
const catIcon={Blowers:'🌀',Aireadores:'🌊',Difusores:'⚫','Calidad de agua':'🧪','Redes y mallas':'🕸️',Procesamiento:'🔪',Protección:'🦺',Refacciones:'⚙️','Motores Mercury':'🚤'};
const NO_PRODUCT_IMAGE=new Set([78,80,85]);
const imagePath=p=>p.image||(p.cat==='Blowers'?'/assets/products/blower-pulsar.webp':`/api/equipesca-image?name=${encodeURIComponent(p.name)}&code=${encodeURIComponent(p.code||'')}&v=20260917b`);
function productImage(p,detail=false){
  const cls=detail?'product-detail-photo':'product-photo';
  const fallback=detail?'product-detail-fallback':'symbol';
  if(NO_PRODUCT_IMAGE.has(Number(p.id))) return `<span class="${fallback}">${p.icon||catIcon[p.cat]||'•'}</span>`;
  return `<img class="${cls}" src="${esc(imagePath(p))}" alt="${esc(p.name)}" loading="lazy" decoding="async" onerror="this.style.display='none'"><span class="${fallback}">${p.icon||catIcon[p.cat]||'•'}</span>`;
}

function toast(t){const x=$('#toast');x.textContent=t;x.classList.add('show');setTimeout(()=>x.classList.remove('show'),1800)}
function stockInfo(p){
  if(p.stockManaged){
    if(Number(p.stock)<=0)return{className:'stock-out',label:'Agotado'};
    if(Number(p.stock)<=Number(p.lowStockThreshold||0))return{className:'stock-low',label:'Pocas piezas'};
    return{className:'stock-ok',label:'Disponible'};
  }
  if(p.availabilityKnown)return p.shopAvailable
    ?{className:'stock-ok',label:'Disponible'}
    :{className:'stock-out',label:'Agotado'};
  return{className:'stock-unknown',label:'Disponibilidad por confirmar'};
}
function isSoldOut(p){
  return p.stockManaged
    ? Number(p.stock)<=0
    : Boolean(p.availabilityKnown&&!p.shopAvailable);
}
function cats(){return [...new Set(PRODUCTS.map(p=>p.cat))]}
function renderCategories(){
  $('#categoryGrid').innerHTML=cats().map(c=>`<button class="category-card" data-cat="${esc(c)}"><span class="category-icon">${catIcon[c]||'•'}</span><b>${esc(c)}</b><span>${PRODUCTS.filter(p=>p.cat===c).length} productos</span></button>`).join('');
  $$('#categoryGrid [data-cat]').forEach(b=>b.onclick=()=>{activeCat=b.dataset.cat;renderFilters();renderProducts();location.hash='productos'});
}
function renderFilters(){
  const all=['Todos',...cats()];
  $('#filters').innerHTML=all.map(c=>`<button class="filter-chip ${c===activeCat?'active':''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  $$('#filters [data-cat]').forEach(b=>b.onclick=()=>{activeCat=b.dataset.cat;renderFilters();renderProducts()});
}
function filtered(){
  let a=PRODUCTS.filter(p=>(activeCat==='Todos'||p.cat===activeCat)&&(`${p.name} ${p.code} ${p.cat}`.toLowerCase().includes(search.toLowerCase())));
  if(sort==='price-asc')a.sort((a,b)=>a.price-b.price);
  else if(sort==='price-desc')a.sort((a,b)=>b.price-a.price);
  else if(sort==='name')a.sort((a,b)=>a.name.localeCompare(b.name));
  else a.sort((a,b)=>(b.featured?1:0)-(a.featured?1:0)||a.id-b.id);
  return a;
}
function card(p){
  const st=stockInfo(p),soldOut=isSoldOut(p);
  return `<article class="product-card"><div class="product-visual" data-cat="${esc(p.cat)}">${p.featured?'<span class="badge">DESTACADO</span>':''}${productImage(p)}</div><div class="product-body"><span class="product-category">${esc(p.cat)}</span><div class="product-title">${esc(p.name)}</div><div class="product-code">${esc(p.code||'')}</div><div class="price">${fmt(p.price)}</div><div class="net-price">Precio neto</div><div class="stock-pill ${st.className}">${st.label}</div><div class="product-actions"><button class="add-btn" data-add="${p.id}" ${soldOut?'disabled':''}>${soldOut?'Agotado':'Agregar al carrito'}</button><button class="wa-btn" data-wa="${p.id}" aria-label="WhatsApp">WA</button><button class="detail-btn" data-detail="${p.id}">Ver detalles</button></div></div></article>`;
}
function renderProducts(){
  const a=filtered();
  $('#resultCount').textContent=`${a.length} producto(s)`;
  $('#productGrid').innerHTML=a.map(card).join('');
  $('#emptyState').hidden=!!a.length;
  $$('[data-add]').forEach(b=>b.onclick=()=>add(+b.dataset.add));
  $$('[data-wa]').forEach(b=>b.onclick=()=>ask(+b.dataset.wa));
  $$('[data-detail]').forEach(b=>b.onclick=()=>{const p=PRODUCTS.find(x=>x.id===+b.dataset.detail);if(p)location.href=productUrl(p)});
}
function ask(id){
  const p=PRODUCTS.find(x=>x.id===id);
  window.open(`https://wa.me/${PHONE}?text=${encodeURIComponent(`Hola AquaCore MX. Me interesa: ${p.name} (${p.code||'sin código'}) - ${fmt(p.price)}.\n${productUrl(p)}`)}`,'_blank');
}
function detail(id){
  const p=PRODUCTS.find(x=>x.id===id);
  const specs=Array.isArray(p.specs)?p.specs:[];
  const uses=Array.isArray(p.uses)?p.uses:[];
  const extra=(p.description||specs.length||uses.length)?`
    <div class="detail-extra">
      ${p.description?`<div class="detail-description">${esc(p.description)}</div>`:''}
      ${specs.length?`<div class="detail-section"><h3>Ficha técnica</h3><div class="spec-grid">${specs.map(s=>`<div class="spec-item">${esc(s)}</div>`).join('')}</div></div>`:''}
      ${uses.length?`<div class="detail-section"><h3>Aplicaciones</h3><ul class="detail-list compact">${uses.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></div>`:''}
    </div>`:'';
  const st=stockInfo(p),soldOut=isSoldOut(p);
  $('#productDialogBody').innerHTML=`<div class="product-detail"><div class="product-detail-visual">${productImage(p,true)}</div><div><span class="detail-kicker">${esc(p.cat)}</span><h2>${esc(p.name)}</h2><div class="detail-code">${esc(p.code||'')}</div><div class="detail-price">${fmt(p.price)}</div><div class="stock-pill ${st.className}">${st.label}</div><ul class="detail-list"><li>Precio neto</li><li>Envíos a todo México</li><li>Envío gratis desde $5,000 MXN</li></ul>${extra}<div class="product-detail-actions"><button class="btn primary" data-modal-add="${p.id}" ${soldOut?'disabled':''}>${soldOut?'Agotado':'Agregar al carrito'}</button><button class="btn secondary" data-modal-wa="${p.id}">Consultar por WhatsApp</button></div></div></div>`;
  $('#productDialog').showModal();
  $('[data-modal-add]').onclick=()=>{add(id,false);$('#productDialog').close()};
  $('[data-modal-wa]').onclick=()=>ask(id);
}
function lines(){return Object.entries(cart).map(([id,qty])=>({p:PRODUCTS.find(x=>x.id===+id),qty})).filter(x=>x.p)}
function subtotal(){return lines().reduce((s,x)=>s+x.p.price*x.qty,0)}
function save(){localStorage.setItem('aquacore-cart-v2',JSON.stringify(cart));renderCart()}
function add(id,open=true){
  const p=PRODUCTS.find(x=>x.id===id);
  if(!p)return;
  const current=Number(cart[id]||0);
  if(isSoldOut(p)){toast('Producto agotado');return}
  if(p.stockManaged&&current>=Number(p.stock||0)){toast('No hay más piezas disponibles');return}
  cart[id]=current+1;save();
  window.aquaMeta?.('AddToCart',{content_ids:[String(p.id)],content_name:p.name,content_type:'product',value:Number(p.price),currency:'MXN'});
  toast('Producto agregado al carrito');if(open)openCart()
}
function qty(id,d){
  const p=PRODUCTS.find(x=>x.id===id),current=Number(cart[id]||0);
  if(d>0&&p?.stockManaged&&current>=Number(p.stock||0)){toast('No hay más piezas disponibles');return}
  cart[id]=current+d;if(cart[id]<=0)delete cart[id];save()
}
function renderCart(){
  const l=lines(),sub=subtotal(),count=l.reduce((s,x)=>s+x.qty,0);
  $('#cartCount').textContent=count;
  $('#cartItems').innerHTML=l.length?l.map(({p,qty:q})=>`<div class="cart-item"><div><b>${esc(p.name)}</b><small>${fmt(p.price)} c/u</small><div class="qty"><button data-dec="${p.id}">−</button><span>${q}</span><button data-inc="${p.id}" ${p.stockManaged&&q>=Number(p.stock||0)?'disabled':''}>+</button><button class="remove" data-rm="${p.id}">Eliminar</button></div></div><strong>${fmt(p.price*q)}</strong></div>`).join(''):'<div style="padding:45px 0;text-align:center;color:#617487">Tu carrito está vacío.</div>';
  $('#subtotal').textContent=fmt(sub);
  $('#total').textContent=fmt(sub);
  $('#shipping').textContent=sub>=FREE_SHIPPING?'GRATIS':'Por calcular';
  $('#progressText').textContent=sub>=FREE_SHIPPING?'✓ ¡Tu pedido ya tiene envío gratis!':`Agrega ${fmt(Math.max(0,FREE_SHIPPING-sub))} más para obtener envío gratis`;
  $('#progressBar').style.width=Math.min(100,sub/FREE_SHIPPING*100)+'%';
  $('#checkoutBtn').disabled=!l.length;
  $$('[data-inc]').forEach(b=>b.onclick=()=>qty(+b.dataset.inc,1));
  $$('[data-dec]').forEach(b=>b.onclick=()=>qty(+b.dataset.dec,-1));
  $$('[data-rm]').forEach(b=>b.onclick=()=>{delete cart[b.dataset.rm];save()});
}
function openCart(){$('#cartDrawer').classList.add('open');$('#drawerBackdrop').classList.add('open');$('#cartDrawer').setAttribute('aria-hidden','false')}
function closeCart(){$('#cartDrawer').classList.remove('open');$('#drawerBackdrop').classList.remove('open');$('#cartDrawer').setAttribute('aria-hidden','true')}
function folio(){const d=new Date(),ymd=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;return `ACMX-${ymd}-${Math.random().toString(36).slice(2,6).toUpperCase()}`}
function orderMsg(d,id){
  let m=`PEDIDO AQUACORE MX\nFolio: ${id}\n\nCLIENTE\nNombre: ${d.name}\nTel: ${d.phone}\nCorreo: ${d.email}\nEntrega: ${d.address}, ${d.city}, ${d.state}, C.P. ${d.zip}\nReferencia: ${d.reference||'-'}\n\nPRODUCTOS\n`;
  lines().forEach(({p,qty})=>m+=`• ${qty} x ${p.name} — ${fmt(p.price*qty)}\n`);
  if(d.invoice_required==='yes'){
    m+=`\nFACTURACIÓN\nRFC: ${d.invoice_rfc||'-'}\nRazón social: ${d.invoice_name||'-'}\nRégimen fiscal: ${d.invoice_tax_regime||'-'}\nUso CFDI: ${d.invoice_cfdi_use||'-'}\nC.P. fiscal: ${d.invoice_zip||'-'}\n`;
  }
  m+=`\nSubtotal: ${fmt(subtotal())}\nEnvío: ${subtotal()>=FREE_SHIPPING?'GRATIS':'Por calcular'}\n\nDeseo confirmar disponibilidad y recibir instrucciones de pago.`;
  return m;
}
function volume(){
  const f=new FormData($('#airForm')),shape=f.get('shape'),depth=+f.get('depth')||0,ponds=+f.get('ponds')||1;
  let one=0;
  if(shape==='round'){const d=+f.get('diameter')||0;one=Math.PI*(d/2)**2*depth}
  else one=(+f.get('length')||0)*(+f.get('width')||0)*depth;
  const total=one*ponds;
  $('#calcResult strong').textContent=total?`${total.toFixed(1)} m³`:'—';
  return{one,total};
}
function toggleShape(){const r=$('#shapeSelect').value==='round';$$('.round-field').forEach(x=>x.hidden=!r);$$('.rect-field').forEach(x=>x.hidden=r);volume()}
const POLICIES={
  shipping:'<span class="eyebrow">POLÍTICA</span><h2>Envíos</h2><p><strong>Envío gratis:</strong> aplica en compras de $5,000 MXN o más dentro de la política comercial vigente. En pedidos menores, el costo se calcula antes de cobrar según destino, peso y volumen.</p><p>El punto de surtido se determina con base en existencia, destino y logística. Cuando el pedido sea enviado, puede registrarse la paquetería y el número de guía o referencia de entrega.</p><p>Los tiempos de tránsito dependen del destino y del transportista. La disponibilidad del producto se confirma al procesar el pedido.</p>',
  warranty:'<span class="eyebrow">POLÍTICA</span><h2>Garantías</h2><p>La cobertura y el plazo de garantía pueden variar según marca, fabricante, tipo de producto y condiciones de uso. Conserva tu folio, comprobante de compra y, cuando aplique, número de serie.</p><p>Si detectas una falla, contacta a AquaCore MX antes de intervenir, desmontar o enviar el producto. Te ayudaremos a revisar la información necesaria y a canalizar el caso conforme al procedimiento aplicable del fabricante o proveedor.</p><p>Esta información no limita los derechos que correspondan al consumidor conforme a la legislación aplicable.</p>',
  returns:'<span class="eyebrow">POLÍTICA</span><h2>Devoluciones</h2><p>Antes de devolver un producto, solicita autorización y revisión del caso por WhatsApp al 644 212 7571. El procedimiento depende del tipo de artículo, su estado y el motivo de la devolución.</p><p>Se recomienda conservar empaque, accesorios, manuales y comprobante de compra. Productos cortados, configurados, fabricados sobre medida o solicitados especialmente pueden tener condiciones distintas, por lo que conviene confirmarlas antes de comprar.</p><p>Si el producto llegó con daño visible o existe un error en el surtido, repórtalo tan pronto como sea posible con fotografías del empaque y del artículo para facilitar la revisión.</p>',
  privacy:'<span class="eyebrow">POLÍTICA</span><h2>Privacidad</h2><p>Los datos proporcionados se utilizan para preparar, cobrar, facturar, enviar y dar seguimiento al pedido, así como para atender consultas relacionadas con la compra.</p><p>AquaCore MX no almacena en este sitio los datos bancarios o de tarjeta ingresados en Mercado Pago. Los datos fiscales se utilizan únicamente para gestionar la facturación solicitada.</p><p>El sitio utiliza herramientas de medición y publicidad, incluido Meta Pixel, para conocer de forma agregada visitas, productos consultados, carritos y conversiones, y para medir el rendimiento de campañas publicitarias.</p>',
  terms:'<span class="eyebrow">POLÍTICA</span><h2>Términos de compra</h2><p>Los precios publicados se muestran en MXN como precios netos. La disponibilidad está sujeta a confirmación y puede depender del punto de distribución.</p><p>En pedidos de $5,000 MXN o más, el checkout puede continuar a Mercado Pago con envío gratis conforme a la política comercial vigente. En pedidos menores se calcula el flete antes de cobrar.</p><p>Las especificaciones mostradas buscan facilitar la selección del producto; para aplicaciones críticas, compatibilidad de equipos o dimensionamiento de aireación, se recomienda confirmar con un asesor antes de comprar.</p>'
};

async function init(){
  const [catalog,inventoryOut,mercuryOut]=await Promise.all([
    fetch('data/products.json',{cache:'no-store'}).then(r=>r.json()),
    fetch('/api/inventory',{cache:'no-store'}).then(r=>r.ok?r.json():({inventory:[]})).catch(()=>({inventory:[]})),
    fetch('/api/equipesca-mercury',{cache:'no-store'}).then(r=>r.ok?r.json():({availability:[]})).catch(()=>({availability:[]}))
  ]);
  const byInventory=new Map((Array.isArray(inventoryOut?.inventory)?inventoryOut.inventory:[]).map(x=>[Number(x.product_id),x]));
  const byMercury=new Map((Array.isArray(mercuryOut?.availability)?mercuryOut.availability:[]).map(x=>[Number(x.product_id),x]));
  PRODUCTS=catalog.map(p=>{
    const inv=byInventory.get(Number(p.id));
    const mercury=byMercury.get(Number(p.id));
    const stockManaged=Boolean(inv?.managed);
    const availabilityKnown=!stockManaged&&typeof mercury?.available==='boolean';
    return {
      ...p,
      stockManaged,
      stock:Number(inv?.stock||0),
      lowStockThreshold:Number(inv?.low_stock_threshold||0),
      availabilityKnown,
      shopAvailable:availabilityKnown?Boolean(mercury.available):null
    };
  });
  renderCategories();renderFilters();renderProducts();renderCart();toggleShape();
  $('#cartButton').onclick=openCart;
  $('#closeCart').onclick=closeCart;
  $('#drawerBackdrop').onclick=closeCart;
  $('#searchInput').oninput=e=>{search=e.target.value;renderProducts()};
  $('#sortSelect').onchange=e=>{sort=e.target.value;renderProducts()};
  const invoiceRequired=$('#invoiceRequired'),invoiceFields=$('#invoiceFields');
  const toggleInvoice=()=>{
    const on=!!invoiceRequired?.checked;
    if(invoiceFields) invoiceFields.hidden=!on;
    if(invoiceFields) invoiceFields.querySelectorAll('input').forEach(input=>{input.disabled=!on;input.required=on});
  };
  if(invoiceRequired){invoiceRequired.onchange=toggleInvoice;toggleInvoice();}
  $('#checkoutBtn').onclick=()=>{
    closeCart();
    const checkoutLines=lines(),checkoutValue=Number(subtotal().toFixed(2));
    $('#orderMini').innerHTML=`<strong>${checkoutLines.reduce((s,x)=>s+x.qty,0)} artículo(s) · ${fmt(checkoutValue)}</strong><br>${checkoutValue>=FREE_SHIPPING?'Envío gratis':'Envío por calcular'}`;
    window.aquaMeta?.('InitiateCheckout',{
      content_ids:checkoutLines.map(x=>String(x.p.id)),
      contents:checkoutLines.map(x=>({id:String(x.p.id),quantity:Number(x.qty),item_price:Number(x.p.price)})),
      content_type:'product',
      num_items:checkoutLines.reduce((s,x)=>s+Number(x.qty),0),
      value:checkoutValue,
      currency:'MXN'
    });
    $('#checkoutDialog').showModal();
  };

  $('#checkoutForm').onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget,btn=$('#submitOrderBtn'),d=Object.fromEntries(new FormData(form)),id=folio(),sub=subtotal();
    d.invoice_required=d.invoice_required==='yes'?'yes':'no';
    if(d.invoice_required==='yes'){
      d.invoice_rfc=String(d.invoice_rfc||'').trim().toUpperCase();
      d.invoice_name=String(d.invoice_name||'').trim();
      d.invoice_tax_regime=String(d.invoice_tax_regime||'').trim();
      d.invoice_cfdi_use=String(d.invoice_cfdi_use||'').trim();
      d.invoice_zip=String(d.invoice_zip||'').trim();
    }
    pendingWhatsApp=`https://wa.me/${PHONE}?text=${encodeURIComponent(orderMsg(d,id))}`;
    localStorage.setItem('aquacore-last-order',JSON.stringify({id,d,lines:lines().map(x=>({id:x.p.id,qty:x.qty})),sub}));

    if(sub<FREE_SHIPPING){
      $('#checkoutDialog').close();
      $('#successTitle').textContent='Falta calcular el envío';
      $('#successCopy').textContent=`Tu folio es ${id}. Tu compra es de ${fmt(sub)}. Te ayudamos a calcular el flete antes de cobrar.`;
      $('#successWa').textContent='Cotizar envío por WhatsApp';
      $('#successDialog').showModal();
      return;
    }

    btn.disabled=true;
    btn.textContent='Conectando con Mercado Pago…';
    try{
      const r=await fetch('/api/create-order',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({orderId:id,customer:d,lines:lines().map(x=>({id:x.p.id,qty:x.qty}))})
      });
      const out=await r.json().catch(()=>({}));
      if(!r.ok||!out.checkoutUrl){
        if(out.code==='OUT_OF_STOCK'){
          const available=Number.isFinite(Number(out.available))?` Disponibles: ${Number(out.available)}.`:'';
          const stockErr=new Error(`${out.error||'La existencia cambió antes del pago.'}${available}`);
          stockErr.code='OUT_OF_STOCK';
          throw stockErr;
        }
        if(out.code==='STOCK_VALIDATION_UNAVAILABLE'){
          const stockErr=new Error(out.error||'No se pudo confirmar la existencia en este momento.');
          stockErr.code='STOCK_VALIDATION_UNAVAILABLE';
          throw stockErr;
        }
        const detail=[out.providerStatus?`HTTP ${out.providerStatus}`:'',out.providerCode||'',out.details||out.error||'Pago no disponible'].filter(Boolean).join(' · ');
        throw new Error(detail);
      }
      location.href=out.checkoutUrl;
    }catch(err){
      console.error('Checkout:',err);
      $('#checkoutDialog').close();
      if(err.code==='OUT_OF_STOCK'){
        $('#successTitle').textContent='Inventario actualizado';
        $('#successCopy').textContent=`${err.message} Ajusta tu carrito antes de continuar.`;
        $('#successWa').textContent='Consultar disponibilidad por WhatsApp';
      }else if(err.code==='STOCK_VALIDATION_UNAVAILABLE'){
        $('#successTitle').textContent='No pudimos confirmar existencia';
        $('#successCopy').textContent=`${err.message} No se realizó ningún cobro.`;
        $('#successWa').textContent='Consultar por WhatsApp';
      }else{
        $('#successTitle').textContent='Error de Mercado Pago';
        $('#successCopy').textContent=`No se pudo abrir el checkout. Detalle: ${err.message}`;
        $('#successWa').textContent='Continuar por WhatsApp';
      }
      $('#successDialog').showModal();
    }finally{
      btn.disabled=false;
      btn.textContent='Continuar al pago';
    }
  };

  $('#successWa').onclick=()=>pendingWhatsApp&&window.open(pendingWhatsApp,'_blank');
  $$('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).close());
  $$('[data-policy]').forEach(b=>b.onclick=()=>{$('#policyBody').innerHTML=POLICIES[b.dataset.policy];$('#policyDialog').showModal()});
  $('#shapeSelect').onchange=toggleShape;
  $$('#airForm input,#airForm select').forEach(x=>x.oninput=volume);
  $('#airForm').onsubmit=e=>{
    e.preventDefault();
    const d=Object.fromEntries(new FormData(e.currentTarget)),v=volume(),dims=d.shape==='round'?`Diámetro: ${d.diameter} m`:`Largo: ${d.length} m · Ancho: ${d.width} m`;
    const m=`Hola AquaCore MX. Quiero dimensionar un sistema de aireación.\n\nEspecie: ${d.species}\nTipo: ${d.shape==='round'?'Circular':'Rectangular'}\n${dims}\nProfundidad: ${d.depth} m\nNo. estanques: ${d.ponds}\nVolumen aprox. por estanque: ${v.one.toFixed(1)} m³\nVolumen total: ${v.total.toFixed(1)} m³\nDensidad/biomasa: ${d.density||'No indicada'}`;
    window.open(`https://wa.me/${PHONE}?text=${encodeURIComponent(m)}`,'_blank');
  };
  $('#mobileMenu').onclick=()=>{const n=$('#mainNav');n.classList.toggle('open')};
  $$('#mainNav a').forEach(a=>a.onclick=()=>$('#mainNav').classList.remove('open'));
}

init().catch(err=>{console.error(err);$('#productGrid').innerHTML='<p>No se pudo cargar el catálogo. Intenta recargar la página.</p>'});
