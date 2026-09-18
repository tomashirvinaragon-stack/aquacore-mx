const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const PHONE='526442127571', FREE_SHIPPING=5000;
let PRODUCTS=[],activeCat='Todos',search='',sort='featured',pendingWhatsApp='';
let cart=JSON.parse(localStorage.getItem('aquacore-cart-v2')||'{}');
const fmt=n=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(n);
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const catIcon={Blowers:'🌀',Aireadores:'🌊',Difusores:'⚫','Calidad de agua':'🧪','Redes y mallas':'🕸️',Procesamiento:'🔪',Protección:'🦺',Refacciones:'⚙️'};
const imagePath=p=>p.image||`/api/equipesca-image?name=${encodeURIComponent(p.name)}&code=${encodeURIComponent(p.code||'')}&v=20260917b`;
function productImage(p,detail=false){
  const cls=detail?'product-detail-photo':'product-photo';
  const fallback=detail?'product-detail-fallback':'symbol';
  return `<img class="${cls}" src="${esc(imagePath(p))}" alt="${esc(p.name)}" loading="lazy" decoding="async" onerror="this.style.display='none'"><span class="${fallback}">${p.icon||catIcon[p.cat]||'•'}</span>`;
}

function toast(t){const x=$('#toast');x.textContent=t;x.classList.add('show');setTimeout(()=>x.classList.remove('show'),1800)}
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
  return `<article class="product-card"><div class="product-visual" data-cat="${esc(p.cat)}">${p.featured?'<span class="badge">DESTACADO</span>':''}${productImage(p)}</div><div class="product-body"><span class="product-category">${esc(p.cat)}</span><div class="product-title">${esc(p.name)}</div><div class="product-code">${esc(p.code||'')}</div><div class="price">${fmt(p.price)}</div><div class="net-price">Precio neto</div><div class="product-actions"><button class="add-btn" data-add="${p.id}">Agregar al carrito</button><button class="wa-btn" data-wa="${p.id}" aria-label="WhatsApp">WA</button><button class="detail-btn" data-detail="${p.id}">Ver detalles</button></div></div></article>`;
}
function renderProducts(){
  const a=filtered();
  $('#resultCount').textContent=`${a.length} producto(s)`;
  $('#productGrid').innerHTML=a.map(card).join('');
  $('#emptyState').hidden=!!a.length;
  $$('[data-add]').forEach(b=>b.onclick=()=>add(+b.dataset.add));
  $$('[data-wa]').forEach(b=>b.onclick=()=>ask(+b.dataset.wa));
  $$('[data-detail]').forEach(b=>b.onclick=()=>detail(+b.dataset.detail));
}
function ask(id){
  const p=PRODUCTS.find(x=>x.id===id);
  window.open(`https://wa.me/${PHONE}?text=${encodeURIComponent(`Hola AquaCore MX. Me interesa: ${p.name} (${p.code||'sin código'}) - ${fmt(p.price)}.`)}`,'_blank');
}
function detail(id){
  const p=PRODUCTS.find(x=>x.id===id);
  $('#productDialogBody').innerHTML=`<div class="product-detail"><div class="product-detail-visual">${productImage(p,true)}</div><div><span class="detail-kicker">${esc(p.cat)}</span><h2>${esc(p.name)}</h2><div class="detail-code">${esc(p.code||'')}</div><div class="detail-price">${fmt(p.price)}</div><ul class="detail-list"><li>Precio neto</li><li>Envíos a todo México</li><li>Envío gratis desde $5,000 MXN</li><li>Disponibilidad sujeta a confirmación</li></ul><div class="product-detail-actions"><button class="btn primary" data-modal-add="${p.id}">Agregar al carrito</button><button class="btn secondary" data-modal-wa="${p.id}">Consultar por WhatsApp</button></div></div></div>`;
  $('#productDialog').showModal();
  $('[data-modal-add]').onclick=()=>{add(id,false);$('#productDialog').close()};
  $('[data-modal-wa]').onclick=()=>ask(id);
}
function lines(){return Object.entries(cart).map(([id,qty])=>({p:PRODUCTS.find(x=>x.id===+id),qty})).filter(x=>x.p)}
function subtotal(){return lines().reduce((s,x)=>s+x.p.price*x.qty,0)}
function save(){localStorage.setItem('aquacore-cart-v2',JSON.stringify(cart));renderCart()}
function add(id,open=true){cart[id]=(cart[id]||0)+1;save();toast('Producto agregado al carrito');if(open)openCart()}
function qty(id,d){cart[id]=(cart[id]||0)+d;if(cart[id]<=0)delete cart[id];save()}
function renderCart(){
  const l=lines(),sub=subtotal(),count=l.reduce((s,x)=>s+x.qty,0);
  $('#cartCount').textContent=count;
  $('#cartItems').innerHTML=l.length?l.map(({p,qty:q})=>`<div class="cart-item"><div><b>${esc(p.name)}</b><small>${fmt(p.price)} c/u</small><div class="qty"><button data-dec="${p.id}">−</button><span>${q}</span><button data-inc="${p.id}">+</button><button class="remove" data-rm="${p.id}">Eliminar</button></div></div><strong>${fmt(p.price*q)}</strong></div>`).join(''):'<div style="padding:45px 0;text-align:center;color:#617487">Tu carrito está vacío.</div>';
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
  shipping:'<span class="eyebrow">POLÍTICA</span><h2>Envíos</h2><p>Envío gratis en compras de $5,000 MXN o más. En pedidos menores, el costo se confirma según destino, peso y volumen.</p>',
  privacy:'<span class="eyebrow">POLÍTICA</span><h2>Privacidad</h2><p>Los datos se usan para preparar el pedido y contacto. AquaCore MX no almacena datos bancarios ni de tarjeta en este sitio.</p>',
  terms:'<span class="eyebrow">POLÍTICA</span><h2>Términos de compra</h2><p>Los precios se muestran en MXN como precios netos. Disponibilidad sujeta a confirmación.</p>'
};

async function init(){
  PRODUCTS=await fetch('data/products.json').then(r=>r.json());
  renderCategories();renderFilters();renderProducts();renderCart();toggleShape();
  $('#cartButton').onclick=openCart;
  $('#closeCart').onclick=closeCart;
  $('#drawerBackdrop').onclick=closeCart;
  $('#searchInput').oninput=e=>{search=e.target.value;renderProducts()};
  $('#sortSelect').onchange=e=>{sort=e.target.value;renderProducts()};
  $('#checkoutBtn').onclick=()=>{
    closeCart();
    $('#orderMini').innerHTML=`<strong>${lines().reduce((s,x)=>s+x.qty,0)} artículo(s) · ${fmt(subtotal())}</strong><br>${subtotal()>=FREE_SHIPPING?'Envío gratis':'Envío por calcular'}`;
    $('#checkoutDialog').showModal();
  };

  $('#checkoutForm').onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget,btn=$('#submitOrderBtn'),d=Object.fromEntries(new FormData(form)),id=folio(),sub=subtotal();
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
        const detail=[out.providerStatus?`HTTP ${out.providerStatus}`:'',out.providerCode||'',out.details||out.error||'Pago no disponible'].filter(Boolean).join(' · ');
        throw new Error(detail);
      }
      location.href=out.checkoutUrl;
    }catch(err){
      console.error('Checkout Mercado Pago:',err);
      $('#checkoutDialog').close();
      $('#successTitle').textContent='Error de Mercado Pago';
      $('#successCopy').textContent=`No se pudo abrir el checkout. Detalle: ${err.message}`;
      $('#successWa').textContent='Continuar por WhatsApp';
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
