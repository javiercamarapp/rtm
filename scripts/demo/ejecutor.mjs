// Ejecutor del plan demo. Carga SOLO con las funciones oficiales (api.* y operacion.* / catalogo.* con la identidad de un socio), una transaccion por movimiento,
// con las comprobaciones diferidas del libro forzadas dentro de cada paso (si el libro no cuadra, el paso falla). Nunca un INSERT directo a tablas de negocio.
// Excepcion declarada: (1) el calendario de reglas (catalogo.config) se adelanta para que el demo de 12 semanas tenga reglas vigentes (renta, plazos) desde su inicio;
// (2) las cuentas de acceso se dan de alta como lo hace scripts/acceso/alta-usuarios.mjs (lista de permitidos + usuario de Auth local).
import { spawnSync } from 'node:child_process';
import { sumarDias } from './generador.mjs';

const J = JSON.stringify;

export class Ejecutor {
  constructor(client, plan, { url, log = () => {} } = {}) {
    this.c = client;
    this.plan = plan;
    this.url = url;
    this.log = log;
    this.uuid = {}; // 'A' | 'B' -> uuid del socio
    this.ids = { cliente: new Map(), pedido: new Map(), compra: new Map() };
    this.advertencias = [];
  }

  q(sql, params = []) {
    return this.c.query(sql, params);
  }

  /** Una transaccion con identidad de actor y fecha de negocio. */
  async tx(actor, fecha, fn) {
    const sub = actor === 'A' ? this.uuid.A : actor === 'B' ? this.uuid.B : actor;
    await this.q('begin');
    try {
      await this.q("select set_config('request.jwt.claim.sub', $1, true)", [sub]);
      await this.q("select set_config('rtm.fecha_negocio', $1, true)", [fecha ?? '']);
      const r = await fn();
      await this.q('set constraints all immediate');
      await this.q('commit');
      return r;
    } catch (e) {
      await this.q('rollback').catch(() => {});
      throw e;
    }
  }

  async uno(sql, params) {
    return (await this.q(sql, params)).rows[0].r;
  }

  // ---------------------------------------------------------------- cuentas de acceso
  /** Alta de las cuentas demo. modo 'directo' inserta en auth.users (bases de prueba); 'gotrue' usa la API de administracion del Supabase LOCAL (sin correos). */
  async cuentas({ modo = 'directo', apiUrl, llaveServicio } = {}) {
    for (const u of this.plan.usuarios.filter((x) => x.rol !== 'bodega')) {
      await this.q('insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo, nombre) values ($1,$2,$3,true,$4) on conflict (correo) do nothing', [u.correo, u.rol, u.socio, u.nombre]);
      await this.crearAcceso(u, modo, apiUrl, llaveServicio);
    }
    this.uuid.A = (await this.q("select id from auth.users where email = $1", [this.plan.usuarios[0].correo])).rows[0].id;
    this.uuid.B = (await this.q("select id from auth.users where email = $1", [this.plan.usuarios[1].correo])).rows[0].id;
    // Cuenta de bodega: se crea como la crea un socio desde la pantalla Cuentas (api.cuenta_alta).
    const b = this.plan.usuarios.find((x) => x.rol === 'bodega');
    await this.tx('B', this.plan.meta.inicio, () => this.q('select api.cuenta_alta($1,$2,$3,$4)', ['demo:cuenta:bodega', b.correo, 'bodega', b.nombre]));
    await this.crearAcceso(b, modo, apiUrl, llaveServicio);
  }

  async crearAcceso(u, modo, apiUrl, llaveServicio) {
    const ya = (await this.q('select 1 from auth.users where email = $1', [u.correo])).rowCount;
    if (ya) return;
    if (modo === 'gotrue') {
      const r = await fetch(`${apiUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { apikey: llaveServicio, authorization: `Bearer ${llaveServicio}`, 'content-type': 'application/json' },
        body: J({ email: u.correo, email_confirm: true }),
      });
      if (!r.ok) throw new Error(`alta de acceso de ${u.clave} fallo (${r.status})`);
      return;
    }
    const id = u.id ?? `de000000-0000-4000-8000-0000000000b${this.plan.usuarios.indexOf(u)}`;
    await this.q("insert into auth.users (id, instance_id, aud, role, email) values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)", [id, u.correo]);
    // Campos que GoTrue espera no nulos (igual que scripts/cargador/semilla-local.sql).
    await this.q(`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), created_at = coalesce(created_at, now()), updated_at = coalesce(updated_at, now()),
      encrypted_password = coalesce(encrypted_password, ''), is_super_admin = coalesce(is_super_admin, false), raw_app_meta_data = '{"provider":"email","providers":["email"]}',
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'), confirmation_token = '', recovery_token = '', email_change_token_new = '', email_change = '', email_change_token_current = '',
      reauthentication_token = '', phone_change = '', phone_change_token = '' where email = $1`, [u.correo]).catch(() => {});
  }

  // ---------------------------------------------------------------- catalogo
  async catalogo() {
    const { inicio } = this.plan.meta;
    const desde = sumarDias(inicio, -1);
    // Calendario de reglas: que las reglas de la base (renta de Omar, minimos, plazos) rijan desde antes del inicio del demo.
    await this.q('update catalogo.config set vigente_desde = $1::date where vigente_desde > $1::date', [sumarDias(inicio, -7)]);
    await this.tx('B', desde, async () => {
      await this.q('select api.registrar_persona_bodega($1,(catalogo.asegurar_cliente($2,$3,$4))::bigint)', ['demo:bodega', this.plan.personaBodega, 'Javier', 'credito_interno']);
      for (const m of this.plan.catalogo.modelos) {
        await this.q('select catalogo.asegurar_modelo($1,$2,$3,$4)', [m.marca, m.nombre, m.puffs, 'ambas']);
        for (const s of m.sabores) await this.q('select catalogo.asegurar_sku($1,$2)', [m.nombre, s]);
        for (const [prov, cent] of Object.entries(m.costo)) {
          await this.q('select catalogo.fijar_costo($1,$2,$3,$4,$5::date,$6,$7,false,true)', [`demo:costo:${prov}:${m.nombre}`, prov, m.nombre, cent, desde, 'demo', 'Costo de demostracion (ficticio)']);
        }
      }
      for (const c of this.plan.clientes) {
        const id = await this.uno('select catalogo.asegurar_cliente($1,$2,$3,$4) as r', [c.nombre, c.dueno, c.tipo, c.nota]);
        this.ids.cliente.set(c.nombre, id);
        for (const [modelo, cent] of Object.entries(c.precios)) {
          await this.q('select catalogo.fijar_precio($1,$2,$3,$4,$5::date,$6,$7)', [`demo:precio:${c.nombre}:${modelo}`, c.nombre, modelo, cent, desde, 'chat', 'Tabulador de demostracion (ficticio)']);
        }
      }
    });
  }

  // ---------------------------------------------------------------- operaciones
  /** Ejecuta una operacion; las que declaran alternativa reintentan con ella si la primera falla (por ejemplo, caja insuficiente). */
  async operacion(o) {
    const k = (p) => `demo:${o.n}:${p}`;
    const f = o.fecha;
    switch (o.tipo) {
      case 'aportacion':
        return this.tx(o.actor, f, () => (o.cuenta
          ? this.q('select api.registrar_aportacion($1,$2,$3,$4,$5,$6::date,null,$7)', [k('ap'), o.socio, o.monto, o.concepto, o.intencion, f, o.cuenta])
          : this.q('select api.registrar_aportacion($1,$2,$3,$4,$5,$6::date,null,$7)', [k('ap'), o.socio, o.monto, o.concepto, o.intencion, f, 'Caja de la empresa'])));
      case 'compra':
        return this.tx(o.actor, f, async () => {
          const lineas = o.lineas.map((l) => ({ modelo: l.modelo, sabor: l.sabor, pagadas: l.piezas, costo_cent: l.costo, motivo_costo: 'Costo de la nota del proveedor (demo)' }));
          const cr = await this.uno('select api.crear_compra($1,$2,$3::jsonb,$4,0,$5::date,$6,$7,null,null,$8) as r', [k('c'), o.proveedor, J(lineas), o.guiaCent, f, 'bodega', 'sociedad', 'Compra de demostracion']);
          await this.q('select api.confirmar_compra($1,$2)', [k('cf'), cr.compra_id]);
          await this.q('select api.registrar_guia_compra($1,$2,$3,$4,$5::date,$6::date)', [k('g'), cr.compra_id, o.paqueteria, o.guia, o.llegada, f]);
          this.ids.compra.set(o.ref, cr.compra_id);
        });
      case 'recepcion':
        return this.tx(o.actor, f, async () => {
          const id = this.ids.compra.get(o.ref);
          const comp = this.plan.ops.find((x) => x.tipo === 'compra' && x.ref === o.ref);
          const lin = (await this.q('select id from operacion.compra_linea where compra_id = $1 order by id', [id])).rows;
          const recibido = comp.lineas.map((l, i) => ({ linea_id: lin[i].id, sabor: l.sabor, piezas: l.piezas - (o.faltante && o.faltante.indice === i ? o.faltante.piezas : 0) }));
          await this.q('select api.recibir_compra($1,$2,$3::jsonb,$4::timestamptz)', [k('r'), id, J(recibido), `${f}T12:00:00-06:00`]);
        });
      case 'pago_proveedor': {
        const porSocio = () => this.tx(o.socio === 'Angelo' ? 'A' : 'B', f, () => this.q('select api.pago_proveedor_de_socio($1,$2,$3,$4,$5,$6::date,$7,null,false)', [k('ps'), o.proveedor, o.monto, o.socio, 'dinero_propio', f, 'Pago al proveedor (demo)']));
        if (o.via === 'sociedad') {
          try {
            return await this.tx(o.actor, f, () => this.q('select api.registrar_pago_proveedor_sociedad($1,$2,$3,$4::date,$5,null)', [k('pc'), o.proveedor, o.monto, f, 'Pago desde la caja de la sociedad (demo)']));
          } catch {
            return porSocio();
          }
        }
        return porSocio();
      }
      case 'venta':
        return this.tx(o.actor, f, async () => {
          const cli = this.ids.cliente.get(o.cliente);
          const lineas = o.lineas.map((l) => ({ modelo: l.modelo, sabor: l.sabor, piezas: l.piezas }));
          const cr = await this.uno('select api.crear_pedido($1,$2,$3::jsonb,$4,null,0,0,0,$5::date,$6,$7,$8,$9,null) as r', [k('p'), cli, J(lineas), 'bodega_omar', f, o.excepcion, o.plazo, o.paqueteria, 'Pedido de demostracion']);
          this.ids.pedido.set(o.ref, { id: cr.pedido_id, cliente: cli });
          if (o.estado === 'borrador') return;
          await this.q('select api.confirmar_pedido($1,$2)', [k('cf'), cr.pedido_id]);
          if (o.estado === 'confirmado') return;
          await this.q('select api.enviar_pedido($1,$2,null,$3::jsonb,$4::date,true)', [k('en'), cr.pedido_id, J({ paqueteria: o.paqueteria, numero: o.guia, costo_cent: o.guiaCostoCent }), f]);
          if (o.entregado) await this.q('select api.marcar_entregado($1,$2)', [k('ent'), cr.pedido_id]);
        });
      case 'ds_venta':
        return this.tx(o.actor, f, async () => {
          const cli = this.ids.cliente.get(o.cliente);
          const lineas = o.lineas.map((l) => ({ modelo: l.modelo, sabor: l.sabor, piezas: l.piezas }));
          const cr = await this.uno('select api.ds_crear_pedido($1,$2,$3::jsonb,$4,null,null,$5,$6,null,0,0,$7::date,$8,null,$9::date,null) as r', [
            k('p'), cli, J(lineas), o.origen === 'Isaac' ? 'isaac_directo' : 'karen_directo', o.tipoVenta, o.socio, f, 'Dropshipping de demostracion', o.fechaCompromiso]);
          this.ids.pedido.set(o.ref, { id: cr.pedido_id, cliente: cli });
          await this.q('select api.confirmar_pedido($1,$2)', [k('cf'), cr.pedido_id]);
          await this.q('select api.enviar_pedido($1,$2,null,null,$3::date,true)', [k('en'), cr.pedido_id, f]);
        });
      case 'cobro':
        return this.tx(o.actor, f, () => {
          const p = this.ids.pedido.get(o.ref);
          return this.q('select api.registrar_pago($1,$2,$3,$4,$5::jsonb,true,$6,$7::date,null,$8,null,null,false)', [k('cb'), o.cuenta, o.monto, p.cliente, J([{ pedido_id: p.id, monto_cent: o.monto }]), 'abono', f, 'Cobro de demostracion']);
        });
      case 'ds_cobro':
        return this.tx(o.actor, f, () => {
          const p = this.ids.pedido.get(o.ref);
          return this.q('select api.ds_pagar_proveedor($1,$2,$3,$4,null,$5,$6,$7::date,$8)', [k('dp'), o.proveedor, o.monto, 'cliente_a_proveedor', p.cliente, p.id, f, 'Cobro del cliente depositado en la cuenta del proveedor (demo)']);
        });
      case 'ds_cobro_menudeo':
        return this.tx('A', f, () => this.q('select api.ds_pagar_pedido_menudeo($1,$2,$3,$4,$5::date,$6)', [k('dm'), this.ids.pedido.get(o.ref).id, 'proveedor', o.monto, f, 'Pago del socio al proveedor (demo)']));
      case 'devolucion_cliente':
        return this.tx(o.actor, f, async () => {
          const p = this.ids.pedido.get(o.ref);
          const lin = (await this.q('select id, sku_id from operacion.pedido_linea where pedido_id = $1 order by id', [p.id])).rows[o.indice];
          await this.q('select api.registrar_devolucion_cliente($1,$2,$3::jsonb,$4)', [k('dv'), p.id, J([{ linea_id: lin.id, sku_id: lin.sku_id, piezas: o.piezas }]), o.motivo]);
        });
      case 'devolucion_proveedor':
        return this.tx(o.actor, f, async () => {
          const sku = (await this.q('select k.id from catalogo.sku k join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor s on s.id = k.sabor_id where m.nombre_canonico = $1 and s.nombre_canonico = $2', [o.modelo, o.sabor])).rows[0].id;
          await this.q('select api.devolver_a_proveedor($1,$2,$3::jsonb,$4,$5)', [k('dpv'), o.proveedor, J([{ sku_id: sku, piezas: o.piezas }]), o.motivo, this.ids.compra.get(o.compra)]);
        });
      case 'merma':
        return this.tx(o.actor, f, () => this.q('select operacion.registrar_movimiento($1,$2,$3,$4,$5,$6,null,$7::date,$8)', [k('m'), o.modelo, o.sabor, 'bodega_omar', 'merma', -o.piezas, f, o.motivo]));
      case 'gasto_socio':
        return this.tx(o.actor, f, () => this.q('select api.registrar_gasto_socio($1,$2,$3,$4,$5,$6::date,null,$7,null,true)', [k('g'), o.socio, o.monto, o.categoria, o.naturaleza, f, o.nota]));
      case 'gasto_empresa':
        try {
          return await this.tx(o.actor, f, () => this.q('select api.registrar_gasto_empresa($1,$2,$3,$4,$5::date,$6,$7,null)', [k('g'), o.monto, o.categoria, o.naturaleza, f, 'Caja de la empresa', o.nota]));
        } catch {
          // Caja sin fondos ese dia: lo paga un socio de su bolsillo (queda como reembolso, igual que en la operacion real).
          return this.tx('B', f, () => this.q('select api.registrar_gasto_socio($1,$2,$3,$4,$5,$6::date,null,$7,null,true)', [k('gs'), 'Javier', o.monto, o.categoria, o.naturaleza, f, o.nota]));
        }
      case 'traspaso':
        return this.tx(o.actor, f, () => this.q('select api.registrar_movimiento_efectivo($1,$2,$3,$4,null,$5::date,$6,null)', [k('t'), o.origen, 'traspaso', o.monto, f, o.destino]));
      case 'renta_pago': {
        for (const frac of [1, 0.5, 0.2, 0.05]) {
          try {
            return await this.tx(o.actor, f, () => this.q('select api.registrar_pago_renta($1,$2,$3,$4,$5::date,$6,null,false)', [k(`rn${frac}`), Math.max(200, Math.round((o.monto * frac) / 100) * 100), o.socio, o.via, f, 'Pago de renta de la bodega (demo)']));
          } catch (e) {
            if (frac === 0.05) this.advertencias.push(`pago de renta omitido: ${String(e.message).split('\n')[0]}`);
          }
        }
        return null;
      }
      case 'costos_mes': {
        const r = spawnSync('node', ['scripts/costos/cargar-mes.mjs', '--mes', o.mes, '--aplicar', '--si', '--tc', '18.50', '--claude-usd', '20', '--dominio-anual-usd', '18'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: this.url } });
        if (r.status !== 0) this.advertencias.push(`costos del sistema ${o.mes} no se cargaron: ${(r.stdout + r.stderr).split('\n').filter(Boolean).slice(-2).join(' | ')}`);
        return null;
      }
      case 'acta':
        return this.acta(o);
      default:
        throw new Error(`tipo de operacion desconocido: ${o.tipo}`);
    }
  }

  async acta(o) {
    const k = (p) => `demo:${o.n}:${p}`;
    const id = await this.tx('A', o.fecha, async () => {
      const cas = await this.uno('select operacion.cascada_periodo($1::date,$2::date) as r', [o.ini, o.fin]);
      const disp = (s) => Math.max(Number(cas.por_socio[s].utilidad_cent) - Number(cas.por_socio[s].anticipo_cent), 0);
      const dA = disp('Angelo');
      const dB = disp('Javier');
      const crudo = { Angelo: { retira: dA * 0.6, reinvierte: dA * 0.25 }, Javier: { retira: dB * 0.4, reinvierte: dB * 0.4 } };
      const suma = Object.values(crudo).reduce((t, x) => t + x.retira + x.reinvierte, 0);
      // Lo retirado sale de la caja: nunca mas del 60 % del efectivo disponible, para que el efectivo no quede en negativo.
      const tope = Math.max(Number(cas.efectivo?.disponible_cent ?? 0), 0) * 0.6;
      const f = suma > 0 ? Math.min(1, tope / suma) : 0;
      const dec = Object.fromEntries(Object.entries(crudo).map(([s, x]) => [s, { retira: Math.floor(x.retira * f), reinvierte: Math.floor(x.reinvierte * f) }]));
      const r = await this.uno('select api.proponer_cierre_reparto($1,$2::date,$3::date,$4::jsonb,$5) as r', [k('pr'), o.ini, o.fin, J(dec), `Corte mensual ${o.ini.slice(0, 7)} (demo)`]);
      await this.q('select api.firmar_cierre_reparto($1,$2)', [k('f1'), r.cierre_id]);
      return r.cierre_id;
    });
    await this.tx('B', o.fecha, () => this.q('select api.firmar_cierre_reparto($1,$2)', [k('f2'), id]));
  }

  /** Corre todo el plan en orden cronologico. */
  async correr({ progreso = () => {} } = {}) {
    const total = this.plan.ops.length;
    let i = 0;
    for (const o of this.plan.ops) {
      i += 1;
      try {
        await this.operacion(o);
      } catch (e) {
        e.paso = `${o.n} ${o.tipo} ${o.ref ?? ''} ${o.fecha}`;
        throw e;
      }
      if (i % 25 === 0 || i === total) progreso(i, total);
    }
  }
}
