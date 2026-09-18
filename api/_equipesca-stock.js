import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import { listInventory, upsertInventoryItems } from './_db.js';

const SOURCE_NAME='Equipesca SQL · dbo.VW_ProductsByPriceStock';

function env(name){
  return String(process.env[name]||'').trim();
}

function loadProducts(){
  const file=path.join(process.cwd(),'data','products.json');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}

function codeKeys(value){
  const raw=String(value??'').trim();
  if(!raw) return [];
  const keys=[raw.toUpperCase()];
  if(/^\d+$/.test(raw)) keys.push(String(Number(raw)));
  return [...new Set(keys)];
}

function numberValue(value){
  if(typeof value==='number'&&Number.isFinite(value)) return value;
  const n=Number(String(value??'').replaceAll(',','').trim());
  return Number.isFinite(n)?n:0;
}

export function equipescaSqlConfigured(){
  if(env('EQUIPESCA_SQL_CONNECTION')) return true;
  return Boolean(
    env('EQUIPESCA_SQL_SERVER')&&
    env('EQUIPESCA_SQL_DATABASE')&&
    env('EQUIPESCA_SQL_USER')&&
    env('EQUIPESCA_SQL_PASSWORD')
  );
}

export function equipescaSqlMissing(){
  if(env('EQUIPESCA_SQL_CONNECTION')) return [];
  const required=['EQUIPESCA_SQL_SERVER','EQUIPESCA_SQL_DATABASE','EQUIPESCA_SQL_USER','EQUIPESCA_SQL_PASSWORD'];
  return required.filter(name=>!env(name));
}

function connectionConfig(){
  const connectionString=env('EQUIPESCA_SQL_CONNECTION');
  if(connectionString) return connectionString;

  const rawServer=env('EQUIPESCA_SQL_SERVER');
  let server=rawServer;
  let instanceName=env('EQUIPESCA_SQL_INSTANCE');
  if(rawServer.includes('\\')){
    const parts=rawServer.split('\\');
    server=parts.shift()||rawServer;
    if(!instanceName) instanceName=parts.join('\\');
  }

  const port=Number(env('EQUIPESCA_SQL_PORT'));
  const config={
    user:env('EQUIPESCA_SQL_USER'),
    password:env('EQUIPESCA_SQL_PASSWORD'),
    server,
    database:env('EQUIPESCA_SQL_DATABASE'),
    connectionTimeout:5000,
    requestTimeout:10000,
    pool:{max:2,min:0,idleTimeoutMillis:5000},
    options:{
      encrypt:false,
      trustServerCertificate:true,
      enableArithAbort:true
    }
  };
  if(Number.isInteger(port)&&port>0) config.port=port;
  else if(instanceName) config.options.instanceName=instanceName;
  return config;
}

async function readSourceRows(){
  if(!equipescaSqlConfigured()){
    const err=new Error('La conexión automática con Equipesca aún no tiene credenciales configuradas');
    err.code='EQUIPESCA_SQL_NOT_CONFIGURED';
    throw err;
  }

  const pool=new sql.ConnectionPool(connectionConfig());
  try{
    await pool.connect();
    const result=await pool.request().query(
      'SELECT CAST([Codigo] AS nvarchar(100)) AS [code], '+
      'CAST([Descripcion] AS nvarchar(1000)) AS [description], '+
      '[Inventario] AS [inventory] '+
      'FROM [dbo].[VW_ProductsByPriceStock]'
    );
    return Array.isArray(result?.recordset)?result.recordset:[];
  }finally{
    await pool.close().catch(()=>{});
  }
}

export function lastAutomaticSync(rows){
  let latest=0;
  for(const row of Array.isArray(rows)?rows:[]){
    if(String(row?.source_file||'')!==SOURCE_NAME) continue;
    const t=Date.parse(row?.source_updated_at||row?.updated_at||'');
    if(Number.isFinite(t)&&t>latest) latest=t;
  }
  return latest?new Date(latest).toISOString():null;
}

export async function syncEquipescaInventory(){
  const [products,currentRows,sourceRows]=await Promise.all([
    Promise.resolve(loadProducts()),
    listInventory(),
    readSourceRows()
  ]);

  const currentById=new Map((Array.isArray(currentRows)?currentRows:[]).map(row=>[Number(row.product_id),row]));
  const byCode=new Map();
  for(const row of sourceRows){
    for(const key of codeKeys(row?.code)){
      if(!byCode.has(key)) byCode.set(key,row);
    }
  }

  const now=new Date().toISOString();
  const updates=[];
  const unmatched=[];

  for(const product of products){
    const existing=currentById.get(Number(product.id));
    const mapped=String(existing?.source_code||product?.equipesca_code||'').trim();
    if(!mapped){
      unmatched.push({id:Number(product.id),name:product.name,reason:'sin_codigo_equipesca'});
      continue;
    }

    let source=null;
    for(const key of codeKeys(mapped)){
      if(byCode.has(key)){source=byCode.get(key);break}
    }
    if(!source){
      unmatched.push({id:Number(product.id),name:product.name,source_code:mapped,reason:'codigo_no_encontrado'});
      continue;
    }

    updates.push({
      product_id:Number(product.id),
      stock:Math.max(0,numberValue(source.inventory)),
      low_stock_threshold:Math.max(0,Number(existing?.low_stock_threshold??2)),
      managed:true,
      source_code:String(source.code||mapped).trim()||mapped,
      source_description:String(source.description||'').trim()||null,
      source_file:SOURCE_NAME,
      source_updated_at:now,
      updated_at:now
    });
  }

  if(updates.length) await upsertInventoryItems(updates);

  return {
    ok:true,
    source:SOURCE_NAME,
    sourceRows:sourceRows.length,
    updated:updates.length,
    unmatched:unmatched.length,
    unmatchedProducts:unmatched,
    syncedAt:now
  };
}
