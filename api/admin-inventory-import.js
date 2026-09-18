import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { dbConfigured, listInventory, upsertInventoryItems } from './_db.js';

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

function norm(s=''){
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,' ')
    .trim()
    .replace(/\s+/g,' ');
}

function words(s=''){
  const stop=new Set(['para','con','sin','del','las','los','una','uno','pulg','pulgadas','marca','precio','pieza','pzas','modelo']);
  return norm(s).split(' ').filter(x=>x.length>=3&&!stop.has(x));
}

function modelParts(s=''){
  return String(s||'')
    .split(/[\/;,|]+/)
    .map(norm)
    .filter(x=>x.replaceAll(' ','').length>=3);
}

function numberValue(v){
  if(typeof v==='number' && Number.isFinite(v)) return v;
  const n=Number(String(v??'').replaceAll(',','').trim());
  return Number.isFinite(n)?n:0;
}

function locateReportRows(workbook){
  const sheet=workbook.Sheets[workbook.SheetNames[0]];
  if(!sheet) throw new Error('El archivo no contiene hojas');
  const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:null,raw:true});
  let headerIndex=-1, headers=[];
  for(let i=0;i<Math.min(matrix.length,30);i++){
    const row=(matrix[i]||[]).map(x=>String(x??'').trim());
    const hasCode=row.some(x=>norm(x)==='codigo');
    const hasDesc=row.some(x=>norm(x)==='descripcion');
    const hasTotal=row.some(x=>norm(x)==='total');
    if(hasCode&&hasDesc&&hasTotal){headerIndex=i;headers=row;break}
  }
  if(headerIndex<0) throw new Error('No encontré las columnas Código, Descripción y Total');

  const codeCol=headers.findIndex(x=>norm(x)==='codigo');
  const descCol=headers.findIndex(x=>norm(x)==='descripcion');
  const totalCol=headers.findIndex(x=>norm(x)==='total');
  const rows=[];

  for(let i=headerIndex+1;i<matrix.length;i++){
    const r=matrix[i]||[];
    const code=String(r[codeCol]??'').trim();
    const description=String(r[descCol]??'').trim();
    if(!code&&!description) continue;
    rows.push({
      code,
      description,
      descriptionNorm:norm(description),
      total:Math.max(0,numberValue(r[totalCol]))
    });
  }
  return rows;
}

function score(product,row){
  const pName=norm(product.name);
  const pWords=words(product.name);
  const parts=modelParts(product.code);
  let value=0;

  if(pName && row.descriptionNorm===pName) value+=240;
  else if(pName && row.descriptionNorm.includes(pName)) value+=180;

  for(const part of parts){
    if(row.descriptionNorm.includes(part)) value+=95;
  }

  const overlap=pWords.filter(w=>row.descriptionNorm.includes(w)).length;
  value+=overlap*8;

  const ratio=pWords.length?overlap/pWords.length:0;
  if(ratio>=0.8) value+=50;
  else if(ratio>=0.6) value+=25;

  return value;
}

function findMatch(product,existing,rows,byCode){
  const mapped=String(existing?.source_code||product?.equipesca_code||'').trim();
  if(mapped){
    const row=byCode.get(mapped);
    return row?{row,method:'source_code',score:1000}:{row:null,method:'source_code_missing',score:0};
  }

  const productCode=String(product.code||'').trim();
  if(/^\d+$/.test(productCode) && byCode.has(productCode)){
    return {row:byCode.get(productCode),method:'numeric_code',score:900};
  }

  let best=null,second=null;
  for(const row of rows){
    const s=score(product,row);
    if(!best||s>best.score){second=best;best={row,score:s}}
    else if(!second||s>second.score){second={row,score:s}}
  }

  if(!best) return {row:null,method:'no_match',score:0};

  const parts=modelParts(product.code);
  const hasModel=parts.some(part=>best.row.descriptionNorm.includes(part));
  const strongName=best.score>=170;
  const enough=hasModel?best.score>=95:strongName;
  const margin=best.score-(second?.score||0);

  if(enough && (margin>=12 || best.score>=220)){
    return {row:best.row,method:'auto',score:best.score};
  }

  return {
    row:null,
    method:'ambiguous',
    score:best.score,
    candidate:{code:best.row.code,description:best.row.description,total:best.row.total,margin}
  };
}

export default async function handler(req,res){
  res.setHeader('cache-control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'Método no permitido'});
  if(!getAdminPassword()) return res.status(503).json({error:'Panel administrativo no configurado'});
  if(!authorized(req)) return res.status(401).json({error:'Contraseña incorrecta'});
  if(!dbConfigured()) return res.status(503).json({error:'Base de datos no configurada'});

  try{
    const filename=String(req.body?.filename||'Existencias_Equipesca.xlsx').slice(0,180);
    const base64=String(req.body?.base64||'');
    if(!base64) return res.status(400).json({error:'No se recibió el archivo de existencias'});
    if(base64.length>7_000_000) return res.status(413).json({error:'El archivo es demasiado grande'});

    const buffer=Buffer.from(base64,'base64');
    const workbook=XLSX.read(buffer,{type:'buffer',cellDates:false});
    const reportRows=locateReportRows(workbook);
    const byCode=new Map(reportRows.map(r=>[String(r.code),r]));
    const [products,currentRows]=await Promise.all([Promise.resolve(loadProducts()),listInventory()]);
    const currentById=new Map((Array.isArray(currentRows)?currentRows:[]).map(x=>[Number(x.product_id),x]));

    const now=new Date().toISOString();
    const updates=[];
    const matched=[];
    const unmatched=[];

    for(const product of products){
      const existing=currentById.get(Number(product.id));
      const match=findMatch(product,existing,reportRows,byCode);

      if(match.row){
        updates.push({
          product_id:Number(product.id),
          stock:Number(match.row.total||0),
          low_stock_threshold:Math.max(0,Number(existing?.low_stock_threshold??2)),
          managed:true,
          source_code:String(match.row.code||'')||null,
          source_description:String(match.row.description||'')||null,
          source_file:filename,
          source_updated_at:now,
          updated_at:now
        });
        matched.push({
          id:Number(product.id),
          name:product.name,
          source_code:match.row.code,
          source_description:match.row.description,
          stock:Number(match.row.total||0),
          method:match.method
        });
      }else{
        unmatched.push({
          id:Number(product.id),
          name:product.name,
          code:product.code||'',
          reason:match.method,
          candidate:match.candidate||null
        });
      }
    }

    if(updates.length) await upsertInventoryItems(updates);

    return res.status(200).json({
      ok:true,
      filename,
      reportRows:reportRows.length,
      updated:updates.length,
      unmatched:unmatched.length,
      matched,
      unmatchedProducts:unmatched
    });
  }catch(err){
    console.error('Equipesca inventory import error',err);
    return res.status(500).json({
      error:'No se pudo importar el archivo de existencias',
      details:String(err?.message||'Error desconocido').slice(0,500)
    });
  }
}
