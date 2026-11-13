import pg from 'pg'; const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
const J='77777777-7777-7777-7777-7777777777a2';
async function como(sql,p){ await c.query('begin'); await c.query("select set_config('request.jwt.claim.sub',$1,true)",[J]); const r=await c.query(sql,p); await c.query('commit'); return r.rows[0]; }
const s=Date.now().toString(36);
for (const [cli,lin] of [[6,[{modelo:'Nexa Ultra 50K',sabor:'Mango Oasis',piezas:12,precio_cent:15000},{modelo:'Nexa Ultra 50K',sabor:'Miami Mint',piezas:6,precio_cent:15000}]],[7,[{modelo:'Nexa Ultra 50K',sabor:'Strawberry Ice',piezas:30,precio_cent:15000}]]]) {
  const cr=(await como("select api.crear_pedido($1,$2,$3::jsonb,'bodega_omar',null,0,0,0,'2026-11-13',null,null,null,'maestro bodega') r",[`prep:${s}:${cli}`,cli,JSON.stringify(lin)])).r;
  await como('select api.confirmar_pedido($1,$2)',[`prepc:${s}:${cli}`,cr.pedido_id]);
}
await c.end(); console.log('2 pedidos confirmados');
