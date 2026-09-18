import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dbConfigured, listInventory, upsertInventoryItem } from './_db.js';

function loadProducts(){
  const file=path.join(process.cwd(),'data','products.json');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}

function getAdminPassword(){
  return (
    process.env.AQUACORE_ADMIN_PASSWORD ||
    process.env['CONTRASEÑA_DE_ADMINISTRADOR_DE_AQUACORE'] ||
    process.env['CONTRASENA_DE_ADMINISTRADOR_DE_AQUACORE'] ||
    process.env['CONTRASEÑA_DE_ADMINISTRADOR_DE_AQUACORE_MX'] ||
    process.env['CONTRASENA_DE_ADMINISTRADOR_DE_AQUACORE_MX'] ||
    ''
  );
}

function same(a,b){
  const ha=crypto.createHash('sha256').update(String(a||'')).digest();
  const hb=crypto.createHash('sha256').update(String(b||'')).digest();
  return crypto.timingSafeEqual(ha,hb);
}

function authorized(req){
  const expected=getAdminPassword();
  const supplied=req.headers['x-admin-password'];
  return Boolean(expected&&supplied&&same(expected,supplied));
}

function merge(products,rows){
  const byId=new Map((Array.isArray(rows)?rows:[]).map(x=>[Number(x.product_id),x]));
  return products.map(p=>{
    const x=byId.get(Number(p.id));
    return {
      id:Number(p.id),
      cat:p.cat,
      name:p.name,
      code:p.code||'',
      price:Number(p.price||0),
      stock:x?Number(x.stock||0):0,
      low_stock_threshold:x?Number(x.low_stock_threshold||0):2,
      managed:x?Boolean(x.managed):false,
      source_code:x?.source_code||'',
      source_description:x?.source_description||'',
      source_file:x?.source_file||'',
      source_updated_at:x?.source_updated_at||null,
      updated_at:x?.updated_at||null
    };
  });
}

export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  if(!getAdminPassword()) return res.status(503).json({error:'Panel administrativo no configurado'});
  if(!authorized(req)) return res.status(401).json({error:'Contraseña incorrecta'});
  if(!dbConfigured()) return res.status(503).json({error:'Base de datos no configurada'});

  try{
    if(req.method==='GET'){
      const [products,rows]=await Promise.all([Promise.resolve(loadProducts()),listInventory()]);
      return res.status(200).json({ok:true,products:merge(products,rows)});
    }

    if(req.method==='POST'){
      const id=Number(req.body?.product_id);
      if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:'Producto inválido'});

      const products=loadProducts();
      const p=products.find(x=>Number(x.id)===id);
      if(!p) return res.status(404).json({error:'Producto no encontrado'});

      let stock=Math.max(0,Number(req.body?.stock)||0);
      const threshold=Math.max(0,Math.floor(Number(req.body?.low_stock_threshold)||0));
      const managed=Boolean(req.body?.managed);

      if(req.body?.action==='adjust'){
        const rows=await listInventory();
        const current=(Array.isArray(rows)?rows:[]).find(x=>Number(x.product_id)===id);
        stock=Math.max(0,Number(current?.stock||0)+Number(req.body?.delta||0));
      }

      const rows=await upsertInventoryItem({
        product_id:id,
        stock,
        low_stock_threshold:threshold,
        managed,
        source_code:String(req.body?.source_code||'').trim()||null,
        updated_at:new Date().toISOString()
      });
      return res.status(200).json({ok:true,item:Array.isArray(rows)?rows[0]:rows});
    }

    return res.status(405).json({error:'Método no permitido'});
  }catch(err){
    console.error('Admin inventory error',err);
    return res.status(500).json({
      error:'No se pudo actualizar el inventario',
      details:String(err?.message||'Error desconocido').slice(0,500)
    });
  }
}
