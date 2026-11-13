// Llama api.explicar_cifra con la identidad de un socio para una lista de cifras y reporta las que fallan o devuelven vacio. Solo local.
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
const J = '77777777-7777-7777-7777-7777777777a2';
const cifras = ['cxc:total', 'socios:diferencia', 'socios:cuadre', 'conta:efectivo', 'conta:l01', 'conta:l02', 'conta:v05', 'conta:v06', 'inventario:valor', 'omar:renta-acumulada', 'omar:saldo',
  'conta:saldo:2110', 'conta:saldo:2120', 'conta:saldo:1310', 'conta:saldo:1210', 'conta:saldo:1320', 'conta:saldo:2210', 'conta:utilidad:2026-11-01:2026-11-30:neto', 'cascada:utilidad:2026-11-09:2026-11-13',
  'historial:utilidad:Javier', 'historial:valor:Angelo', 'historial:neta:Javier', 'historial:invertido:Angelo', 'historial:retirado:Javier', 'cxc:cliente:2', 'existencia:modelo:1', 'cobertura:modelo:1',
  'pulso:por_pagar_isaac', 'pulso:por_pagar', 'proveedor:Isaac', 'proveedor:Karen', 'prov:saldo:Isaac', 'prov:saldo:Karen', 'ds:ventas::2026-11-01:2026-11-30', 'dsu:resultado:2026-11-01:2026-11-30'];
let ok = 0; const mal = [];
for (const k of cifras) {
  try {
    await c.query('begin'); await c.query("select set_config('request.jwt.claim.sub',$1,true)", [J]);
    const r = (await c.query('select api.explicar_cifra($1) r', [k])).rows[0].r; await c.query('rollback');
    const vacio = !r || (typeof r === 'object' && Object.keys(r).length === 0);
    if (vacio) mal.push(`${k}: vacio`); else ok += 1;
  } catch (e) { await c.query('rollback'); mal.push(`${k}: ${String(e.message).slice(0, 90)}`); }
}
console.log(`explicar_cifra: ${ok} ok de ${cifras.length}`); for (const m of mal) console.log('  fallo/vacio', m);
await c.end();
