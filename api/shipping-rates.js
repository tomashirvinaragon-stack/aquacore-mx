import fs from 'node:fs';
import path from 'node:path';
import { skydropxConfigured, createQuotation, getCompletedQuotation, normalizeRates } from './_skydropx.js';

function loadProducts(){
  return JSON.parse(fs.readFileSync(path.join(process.cwd(),'data','products.json'),'utf8'));
}

function loadShippingProfiles(){
  return JSON.parse(fs.readFileSync(path.join(process.cwd(),'data','shipping-profiles.json'),'utf8'));
}

function cleanZip(value){
  return String(value||'').replace(/\D/g,'').slice(0,5);
}

function buildParcels(lines,products,profiles){
  const byId=new Map(products.map(p=>[Number(p.id),p]));
  const parcels=[];
  const missing=[];

  for(const line of lines){
    const id=Number(line.id);
    const qty=Math.max(1,Math.min(99,Number(line.qty)||1));
    const product=byId.get(id);
    if(!product) throw Object.assign(new Error(`Producto inválido: ${id}`),{code:'INVALID_PRODUCT'});
    const profile=profiles[String(id)];
    if(!profile){
      missing.push({id,name:product.name,code:product.code||null});
      continue;
    }

    const unitsPerParcel=Math.max(1,Number(profile.units_per_parcel)||1);
    const unitWeight=Math.max(0.01,Number(profile.weight_kg)||0);
    const length=Math.ceil(Math.max(1,Number(profile.length_cm)||0));
    const width=Math.ceil(Math.max(1,Number(profile.width_cm)||0));
    const height=Math.ceil(Math.max(1,Number(profile.height_cm)||0));

    if(!unitWeight||!length||!width||!height){
      missing.push({id,name:product.name,code:product.code||null});
      continue;
    }

    let remaining=qty;
    while(remaining>0){
      const packed=Math.min(unitsPerParcel,remaining);
      parcels.push({
        length,
        width,
        height,
        weight:Number((unitWeight*packed).toFixed(3)),
        package_protected:false,
        declared_value:Number((Number(product.price||0)*packed).toFixed(2))
      });
      remaining-=packed;
    }
  }

  return {parcels,missing};
}

export default async function handler(req,res){
  if(req.method==='GET'){
    return res.status(200).json({
      ok:true,
      provider:'skydropx',
      configured:skydropxConfigured()
    });
  }
  if(req.method!=='POST') return res.status(405).json({error:'Método no permitido'});

  try{
    if(!skydropxConfigured()){
      return res.status(503).json({
        error:'El cotizador de envíos todavía no tiene credenciales configuradas.',
        code:'SHIPPING_NOT_CONFIGURED'
      });
    }

    const {customer,lines}=req.body||{};
    const zip=cleanZip(customer?.zip);
    const state=String(customer?.state||'').trim();
    const city=String(customer?.city||'').trim();
    const neighborhood=String(customer?.neighborhood||'').trim();

    if(zip.length!==5||!state||!city||!neighborhood||!Array.isArray(lines)||!lines.length){
      return res.status(400).json({
        error:'Faltan datos de destino para cotizar el envío.',
        code:'SHIPPING_ADDRESS_INCOMPLETE'
      });
    }

    const products=loadProducts();
    const profiles=loadShippingProfiles();
    const {parcels,missing}=buildParcels(lines,products,profiles);

    if(missing.length){
      return res.status(409).json({
        error:'Faltan peso o medidas de empaque para uno o más productos.',
        code:'MISSING_SHIPPING_PROFILE',
        products:missing
      });
    }

    const quotation={
      address_from:{
        address_template_id:String(process.env.SKYDROPX_ORIGIN_TEMPLATE_ID),
        country_code:'MX'
      },
      address_to:{
        country_code:'MX',
        postal_code:zip,
        area_level1:state,
        area_level2:city,
        area_level3:neighborhood
      },
      parcels
    };

    const created=await createQuotation(quotation);
    const quote=await getCompletedQuotation(created.id,created);
    const rates=normalizeRates(quote).slice(0,8);

    if(!rates.length){
      return res.status(404).json({
        error:'No encontramos una tarifa disponible para este destino.',
        code:'NO_SHIPPING_RATES'
      });
    }

    return res.status(200).json({
      quotationId:String(quote.id||created.id),
      rates,
      completed:Boolean(quote.is_completed)
    });
  }catch(err){
    console.error('Shipping quote error',err);
    return res.status(err.status&&err.status<500?err.status:502).json({
      error:err.message||'No fue posible cotizar el envío',
      code:err.code||'SHIPPING_PROVIDER_ERROR'
    });
  }
}
