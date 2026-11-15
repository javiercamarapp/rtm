// Verificacion de solo lectura del libro demo: libro conciliado y comprobaciones C1..C24 y CU1..CU3 sin rojas.
export async function verificarLibro(client, uuidSocio) {
  await client.query('begin read only');
  try {
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [uuidSocio]);
    const j = async (sql) => (await client.query(sql)).rows[0].r;
    const cuadre = await j('select operacion.cuadre_socios() as r');
    const compro = await j('select api.conta_comprobaciones() as r');
    const balance = await j('select api.conta_balance(null) as r');
    const comprob = compro.comprobaciones ?? [];
    const rojas = comprob.filter((x) => !x.ok).map((x) => x.codigo);
    const verifRojas = (cuadre.verificaciones ?? []).filter((x) => !x.ok).map((x) => x.codigo ?? x.nombre);
    const lineas = [
      { ok: cuadre.libro_conciliado === true && verifRojas.length === 0, texto: `Libro conciliado (cuadre de socios); verificaciones rojas: ${verifRojas.join(',') || 'ninguna'}` },
      { ok: comprob.length >= 27 && rojas.length === 0, texto: `Comprobaciones C1..C24 y CU1..CU3 (${comprob.length}); rojas: ${rojas.join(',') || 'ninguna'}` },
      { ok: balance.cuadra === true, texto: 'Balance general cuadra (activo = pasivo + capital + utilidad)' },
      { ok: (compro.auxiliares ?? []).every((x) => x.ok), texto: `Auxiliares contra mayor (${(compro.auxiliares ?? []).length})` },
    ];
    const inter = (await client.query("select clave from seguridad.interruptor where activo")).rows.map((x) => x.clave);
    lineas.push({ ok: inter.length === 0, texto: `Interruptores de envio y bot de Telegram APAGADOS${inter.length ? ` (encendidos: ${inter.join(', ')})` : ''}` });
    const caja = Number((await client.query('select operacion.saldo_efectivo() as n')).rows[0].n);
    lineas.push({ ok: caja >= 0, texto: 'Efectivo de la sociedad no negativo' });
    return { ok: lineas.every((l) => l.ok), lineas };
  } finally {
    await client.query('rollback');
  }
}
