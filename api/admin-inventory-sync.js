import crypto from 'node:crypto';
import { dbConfigured, listInventory } from './_db.js';
import {
  equipescaSqlConfigured,
  equipescaSqlMissing,
  lastAutomaticSync,
  syncEquipescaInventory
} from './_equipesca-stock.js';

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

export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  if(!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Método no permitido'});
  if(!getAdminPassword()) return res.status(503).json({error:'Panel administrativo no configurado'});
  if(!authorized(req)) return res.status(401).json({error:'Contraseña incorrecta'});
  if(!dbConfigured()) return res.status(503).json({error:'Base de datos no configurada'});

  try{
    if(req.method==='GET'){
      const rows=await listInventory();
      return res.status(200).json({
        ok:true,
        configured:equipescaSqlConfigured(),
        missing:equipescaSqlMissing(),
        lastSync:lastAutomaticSync(rows)
      });
    }

    if(!equipescaSqlConfigured()){
      return res.status(503).json({
        error:'Conexión automática con Equipesca pendiente de configurar',
        missing:equipescaSqlMissing()
      });
    }

    const out=await syncEquipescaInventory();
    return res.status(200).json(out);
  }catch(err){
    console.error('Equipesca automatic inventory sync error',err);
    return res.status(500).json({
      error:'No se pudo sincronizar automáticamente con Equipesca',
      details:String(err?.message||'Error desconocido').slice(0,500)
    });
  }
}
