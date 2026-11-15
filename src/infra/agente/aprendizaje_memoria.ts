// Puerto de aprendizaje EN MEMORIA (transporte falso: ninguna base, ninguna red). Emula las reglas de las funciones SQL agente.* del carril para las conversaciones simuladas:
// una pregunta abierta por chat, alias solo con confirmacion, negativos, ventana de 10 minutos, parecidos de altas con la misma deteccion que el catalogo (dominio/catalogo/duplicados.ts).
// La verdad de las reglas esta en SQL (pgTAP c5_001); esto solo permite probar el flujo conversacional de punta a punta.
import { RechazoAprendizaje, type PuertoAprendizaje, type RespSql, type SiNo, type TipoPregunta } from '@/aplicacion/agente/aprendizaje';
import { VACIO, type ClaseAprendida, type ContextoAprendido, type ResumenAprendizaje } from '@/dominio/agente/aprendizaje';
import { normalizar } from '@/dominio/catalogo/normalizar';
import { compararNombres } from '@/dominio/catalogo/duplicados';
import type { Miembro } from '@/dominio/agente/tipos';

interface Pregunta { id: number; chat: number; tipo: TipoPregunta; texto: string; datos: Record<string, unknown> }
interface AliasMem { clase: ClaseAprendida; alias: string; oficial: string; por: string; en: number; revertido: boolean }

export class PuertoAprendizajeMemoria implements PuertoAprendizaje {
  ahora = (): number => Date.now();
  escrituraActiva = true;
  clientes: Array<{ nombre: string; duenio: string; tipo: string; plazo: number | null }> = [{ nombre: 'Guillermo Torres', duenio: 'javier', tipo: 'mayoreo', plazo: null }, { nombre: 'Ariel Gomez', duenio: 'angelo', tipo: 'mayoreo', plazo: null }];
  modelos: Array<{ nombre: string; marca: string; puffs: number | null; costos: Record<string, number> }> = [{ nombre: 'Nexa Ultra 50K', marca: 'Nexa', puffs: 50000, costos: {} }];
  sabores = new Map<string, string[]>([['Nexa Ultra 50K', ['Mango', 'Passion Fruit']]]);
  marcas = ['Nexa'];
  aliases: AliasMem[] = [];
  negativos = new Set<string>();
  preguntas: Pregunta[] = [];
  /** Cola de sabores parecidos (pares) que esperan respuesta. */
  colaSabores: Array<{ id: number; a: string; b: string; estado: 'pendiente' | 'unido' | 'distinto' }> = [];
  uniones: Array<{ id: number; a: string; b: string; en: number; deshecha: boolean }> = [];
  ejemplos: Array<{ operacion: string; texto: string; folio: string | null }> = [];
  correcciones = new Map<string, number>();
  jerga: Array<{ termino: string; significado: string }> = [{ termino: 'ya cayo', significado: 'llego el pago de un cliente (cobro)' }];
  pedidosConAtraso = new Map<string, { cliente: string; duenio: string; semanas: number; pendienteTexto: string; aplicado: boolean }>();
  llamadas: string[] = [];
  private seq = 1;

  private exigirEscritura(): void {
    if (!this.escrituraActiva) throw new RechazoAprendizaje('el agente esta en solo lectura: un socio lo reactiva con /escritura', 'P0463');
  }
  private abrir(chat: number, tipo: TipoPregunta, texto: string, datos: Record<string, unknown> = {}): Pregunta {
    this.preguntas = this.preguntas.filter((p) => p.chat !== chat);
    const p = { id: this.seq++, chat, tipo, texto, datos };
    this.preguntas.push(p);
    return p;
  }
  private oficialDe(clase: ClaseAprendida, texto: string): string | null {
    const n = normalizar(texto);
    const lista: string[] = clase === 'cliente' ? this.clientes.map((c) => c.nombre) : clase === 'modelo' ? this.modelos.map((m) => m.nombre) : clase === 'marca' ? this.marcas : clase === 'sabor' ? [...new Set([...this.sabores.values()].flat())] : ['Isaac', 'Karen'];
    const directo = lista.find((x) => normalizar(x) === n);
    if (directo) return directo;
    const a = this.aliases.find((x) => x.clase === clase && !x.revertido && normalizar(x.alias) === n);
    return a ? a.oficial : null;
  }
  private mostrar(clase: ClaseAprendida, t: string): string { return ['sabor', 'modelo', 'marca'].includes(clase) ? t.toUpperCase() : t; }

  async preguntaVigente(chat: number) {
    const p = this.preguntas.find((x) => x.chat === chat);
    return p ? { tipo: p.tipo, texto: p.texto } : null;
  }

  async aliasProponer(_c: string, autor: Miembro, chat: number, clase: ClaseAprendida, alias: string, oficial: string): Promise<RespSql> {
    this.llamadas.push('aliasProponer');
    this.exigirEscritura();
    const dest = this.oficialDe(clase, oficial);
    if (dest === null) return { estado: 'oficial_desconocido', texto: `No encontre "${this.mostrar(clase, oficial)}" en el catalogo. No guarde nada.` };
    const n = normalizar(alias);
    if (this.oficialDe(clase, alias) !== null) return { estado: 'ya_existe', texto: `"${alias}" ya existe en el catalogo.` };
    if (this.negativos.has(`${clase}|${n}|${dest}`)) return { estado: 'negado_antes', texto: `Un socio ya dijo que "${alias}" no es lo mismo que ${dest}. No lo vuelvo a preguntar.` };
    const texto = `¿"${this.mostrar(clase, alias)}" es lo mismo que ${this.mostrar(clase, dest)}? Si respondes que si, lo recordare como otro nombre de ${this.mostrar(clase, dest)}. Responde si o no.`;
    this.abrir(chat, 'alias', texto, { clase, alias, dest, por: autor.persona });
    return { estado: 'pregunta', texto };
  }

  async aliasResponder(_c: string, autor: Miembro, chat: number, respuesta: SiNo): Promise<RespSql> {
    this.llamadas.push('aliasResponder');
    this.exigirEscritura();
    const p = this.preguntas.find((x) => x.chat === chat && x.tipo === 'alias');
    if (!p) throw new RechazoAprendizaje('no hay una pregunta de alias pendiente en este chat', 'P0460');
    this.preguntas = this.preguntas.filter((x) => x !== p);
    const { clase, alias, dest } = p.datos as { clase: ClaseAprendida; alias: string; dest: string };
    if (respuesta === 'no') {
      this.negativos.add(`${clase}|${normalizar(alias)}|${dest}`);
      return { estado: 'negado', aviso_grupo: `${cap(autor.persona)} dijo que "${alias}" no es lo mismo que ${dest}. No lo vuelvo a preguntar.` };
    }
    this.aliases.push({ clase, alias, oficial: dest, por: autor.persona, en: this.ahora(), revertido: false });
    return { estado: 'guardado', aviso_grupo: `${cap(autor.persona)} confirmo: "${alias}" queda como otro nombre de ${dest}. Para deshacerlo en los proximos 10 minutos escribe "deshacer alias".` };
  }

  async aliasDeshacer(_c: string, autor: Miembro): Promise<RespSql> {
    const a = [...this.aliases].reverse().find((x) => !x.revertido);
    if (!a) return { estado: 'nada', aviso_grupo: 'No hay ningun alias reciente que deshacer.' };
    if (this.ahora() - a.en > 10 * 60_000) return { estado: 'fuera_de_ventana', aviso_grupo: 'Ya pasaron mas de 10 minutos desde que se guardo ese alias: se quita desde el software.' };
    a.revertido = true;
    return { estado: 'deshecho', aviso_grupo: `${cap(autor.persona)} deshizo el alias "${a.alias}".` };
  }

  async saborPreguntar(_c: string, chat: number): Promise<RespSql> {
    const q = this.colaSabores.find((x) => x.estado === 'pendiente');
    if (!q) return { estado: 'sin_pendientes', texto: 'No hay sabores por revisar.' };
    const n = this.colaSabores.filter((x) => x.estado === 'pendiente').length;
    const texto = `¿"${q.a.toUpperCase()}" es lo mismo que "${q.b.toUpperCase()}"? Responde si o no.${n > 1 ? ` (Hay ${n - 1} mas por revisar.)` : ''}`;
    this.abrir(chat, 'sabor_duplicado', texto, { id: q.id });
    return { estado: 'pregunta', texto, pendientes: n };
  }

  async saborResponder(_c: string, autor: Miembro, chat: number, respuesta: SiNo): Promise<RespSql> {
    this.exigirEscritura();
    const p = this.preguntas.find((x) => x.chat === chat && x.tipo === 'sabor_duplicado');
    if (!p) throw new RechazoAprendizaje('no hay una pregunta de sabores pendiente en este chat', 'P0460');
    this.preguntas = this.preguntas.filter((x) => x !== p);
    const q = this.colaSabores.find((x) => x.id === (p.datos.id as number))!;
    if (respuesta === 'no') {
      q.estado = 'distinto';
      return { estado: 'distinto', aviso_grupo: `${cap(autor.persona)} confirmó que "${q.a}" y "${q.b}" son sabores distintos. No se vuelve a preguntar.` };
    }
    q.estado = 'unido';
    const destino = q.a.split(' ').length >= q.b.split(' ').length ? q.a : q.b;
    this.uniones.push({ id: this.seq++, a: q.a, b: q.b, en: this.ahora(), deshecha: false });
    return { estado: 'unificado', destino, aviso_grupo: `${cap(autor.persona)} unió los sabores "${q.a}" y "${q.b}": queda "${destino}". Para deshacerlo: "deshacer unión".` };
  }

  async saborDeshacer(_c: string, autor: Miembro): Promise<RespSql> {
    const u = [...this.uniones].reverse().find((x) => !x.deshecha);
    if (!u) throw new RechazoAprendizaje('no hay una union que deshacer', 'P0460');
    if (this.ahora() - u.en > 10 * 60_000) throw new RechazoAprendizaje('pasaron mas de 10 minutos desde esa union: ya no se deshace desde Telegram, se hace desde el software', 'P0464');
    u.deshecha = true;
    const q = this.colaSabores.find((x) => x.a === u.a && x.b === u.b);
    if (q) q.estado = 'pendiente';
    return { estado: 'deshecha', aviso_grupo: `${cap(autor.persona)} deshizo la unión: "${u.b}" vuelve a ser un sabor aparte.` };
  }

  async recargoPreguntar(_c: string, _a: Miembro, chat: number, d: { pedidoFolio: string | null; clienteId: string | null }): Promise<RespSql> {
    this.exigirEscritura();
    const folio = d.pedidoFolio ?? [...this.pedidosConAtraso.keys()][0] ?? null;
    const p = folio === null ? undefined : this.pedidosConAtraso.get(folio.toUpperCase());
    if (!p || p.semanas < 1 || p.aplicado) return { estado: 'sin_recargo', texto: 'Ese pedido todavia no tiene recargo que sugerir.' };
    const texto = `El pedido ${folio} de ${p.cliente} lleva ${p.semanas} semanas completas de atraso. Recargo sugerido: $${p.pendienteTexto} (10 % simple por semana; pendiente de aplicar). Lo decide ${cap(p.duenio)}, dueno del cliente. ¿Lo aplico? Responde si o no.`;
    this.abrir(chat, 'recargo', texto, { folio, duenio: p.duenio });
    return { estado: 'pregunta', texto };
  }

  async recargoResponder(_c: string, autor: Miembro, chat: number, respuesta: SiNo): Promise<RespSql> {
    this.exigirEscritura();
    const q = this.preguntas.find((x) => x.chat === chat && x.tipo === 'recargo');
    if (!q) throw new RechazoAprendizaje('no hay una pregunta de recargo pendiente en este chat', 'P0460');
    const { folio, duenio } = q.datos as { folio: string; duenio: string };
    if (autor.persona !== duenio) throw new RechazoAprendizaje(`el recargo lo decide ${cap(duenio)} (dueno del cliente); la pregunta sigue abierta`, 'P0460');
    this.preguntas = this.preguntas.filter((x) => x !== q);
    if (respuesta === 'no') return { estado: 'rechazado', aviso_grupo: `${cap(autor.persona)} decidio no aplicar el recargo por ahora.` };
    const p = this.pedidosConAtraso.get(folio)!;
    p.aplicado = true;
    return { estado: 'aplicado', aviso_grupo: `${cap(autor.persona)} aplico el recargo del pedido ${folio}: $${p.pendienteTexto} en total (${p.semanas} semanas completas de atraso, 10 % simple por semana).` };
  }

  async contexto(texto: string): Promise<ContextoAprendido> {
    const t = ` ${normalizar(texto)} `;
    const alias = this.aliases.filter((a) => !a.revertido && t.includes(` ${normalizar(a.alias)} `)).map((a) => ({ clase: a.clase, alias: normalizar(a.alias), oficial: a.oficial }));
    const jerga = this.jerga.filter((j) => t.includes(` ${normalizar(j.termino)} `)).map((j) => ({ termino: j.termino, tipo: 'jerga', significado: j.significado }));
    const ejemplos = this.ejemplos.slice(-4).map((e) => ({ operacion: e.operacion, texto: e.texto }));
    return { ...VACIO, alias, jerga, ejemplos };
  }

  async ejemploRegistrar(_c: string, _a: Miembro, operacion: string, texto: string, folio: string | null) {
    if (/[0-9@]/.test(texto)) throw new RechazoAprendizaje('el ejemplo no esta anonimizado', 'P0460');
    this.ejemplos.push({ operacion, texto, folio });
  }

  async correccionRegistrar(_c: string, _a: Miembro, clase: ClaseAprendida, dicho: string, correcto: string): Promise<RespSql> {
    const dest = this.oficialDe(clase, correcto);
    if (dest === null || this.oficialDe(clase, dicho) !== null) return { estado: 'ignorada', sugerir_alias: false };
    const k = `${clase}|${normalizar(dicho)}|${dest}`;
    const v = (this.correcciones.get(k) ?? 0) + 1;
    this.correcciones.set(k, v);
    return { estado: 'registrada', veces: v, oficial: dest, sugerir_alias: v >= 2 && !this.negativos.has(k) };
  }

  async jergaAgregar(_c: string, autor: Miembro, termino: string, significado: string): Promise<RespSql> {
    this.exigirEscritura();
    this.jerga.push({ termino, significado });
    return { estado: 'guardado', aviso_grupo: `${cap(autor.persona)} enseno: "${termino}" significa ${significado}.` };
  }

  private parecidos(tipo: 'cliente' | 'modelo' | 'sabor', nombre: string, lista: string[]): Array<{ nombre: string; puntaje: number }> {
    return lista.map((n) => ({ nombre: n, puntaje: compararNombres(tipo, nombre, n).puntaje })).filter((x) => x.puntaje >= 80).sort((a, b) => b.puntaje - a.puntaje);
  }

  async altaCliente(_c: string, autor: Miembro, a: { nombre: string; tipo: string; duenio: string; plazoDias: number | null; confirmar: boolean }): Promise<RespSql> {
    this.exigirEscritura();
    if (this.clientes.some((c) => normalizar(c.nombre) === normalizar(a.nombre))) return { estado: 'existente', texto: `El cliente "${a.nombre}" ya existe. No cree otro: usa su nombre para venderle.` };
    const par = this.parecidos('cliente', a.nombre, this.clientes.map((c) => c.nombre));
    if (par.length > 0 && !a.confirmar) {
      return { estado: 'parecidos', parecidos: par, texto: `Ya existe "${par[0]!.nombre}", muy parecido a "${a.nombre}". ¿Es otro cliente distinto y lo creo? Responde si para crearlo o no para cancelar. Si es la misma persona, cancela y dime "${a.nombre} es ${par[0]!.nombre}" para guardarlo como otro nombre.` };
    }
    this.clientes.push({ nombre: a.nombre, duenio: a.duenio, tipo: a.tipo, plazo: a.plazoDias });
    const plazo = a.plazoDias === null ? '' : a.plazoDias === 0 ? ', paga de contado' : `, plazo habitual ${a.plazoDias} dias`;
    return { estado: 'creado', folio: `CL-${this.clientes.length}`, aviso_grupo: `${cap(autor.persona)} dio de alta al cliente "${a.nombre}" (${a.tipo}, de ${cap(a.duenio)}${plazo}).` };
  }

  async altaSabor(_c: string, autor: Miembro, a: { modelo: string; sabor: string; confirmar: boolean }): Promise<RespSql> {
    this.exigirEscritura();
    const m = this.oficialDe('modelo', a.modelo);
    if (m === null) return { estado: 'modelo_desconocido', texto: `No encontre el modelo "${a.modelo.toUpperCase()}" en el catalogo. Si es un modelo nuevo, dalo de alta primero.` };
    const lista = this.sabores.get(m) ?? [];
    if (lista.some((s) => normalizar(s) === normalizar(a.sabor))) return { estado: 'existente', texto: `El sabor ${a.sabor.toUpperCase()} ya existe en ${m.toUpperCase()}.` };
    const todos = [...new Set([...this.sabores.values()].flat())];
    const par = this.parecidos('sabor', a.sabor, todos);
    if (par.length > 0 && !a.confirmar) return { estado: 'parecidos', parecidos: par, texto: `El sabor "${a.sabor.toUpperCase()}" se parece a "${par[0]!.nombre.toUpperCase()}". ¿Es otro sabor distinto y lo creo? Responde si para crearlo o no para cancelar.` };
    this.sabores.set(m, [...lista, a.sabor]);
    return { estado: 'creado', folio: `SB-${lista.length + 1}`, aviso_grupo: `${cap(autor.persona)} dio de alta el sabor ${a.sabor.toUpperCase()} para ${m.toUpperCase()}. El modelo aun no tiene costo de lista.` };
  }

  async altaModelo(_c: string, autor: Miembro, a: { nombre: string; marca: string; puffs: number | null; proveedorCosto: string; costoCent: number | null; confirmar: boolean }): Promise<RespSql> {
    this.exigirEscritura();
    if (a.proveedorCosto !== 'ninguno' && (a.costoCent === null || a.costoCent <= 0)) throw new RechazoAprendizaje('falta el costo de lista que dio el socio', 'P0460');
    if (this.modelos.some((m) => normalizar(m.nombre) === normalizar(a.nombre))) return { estado: 'existente', texto: `El modelo ${a.nombre.toUpperCase()} ya existe. No cree otro.` };
    const par = this.parecidos('modelo', a.nombre, this.modelos.map((m) => m.nombre));
    if (par.length > 0 && !a.confirmar) return { estado: 'parecidos', parecidos: par, texto: `El modelo ${a.nombre.toUpperCase()} se parece mucho a ${par[0]!.nombre.toUpperCase()}. ¿Es otro modelo distinto y lo creo? Responde si para crearlo o no para cancelar.` };
    this.modelos.push({ nombre: a.nombre, marca: a.marca, puffs: a.puffs, costos: a.proveedorCosto === 'ninguno' ? {} : { [a.proveedorCosto]: a.costoCent! } });
    if (!this.marcas.some((x) => normalizar(x) === normalizar(a.marca))) this.marcas.push(a.marca);
    return { estado: 'creado', folio: `MD-${this.modelos.length}`, aviso_grupo: `${cap(autor.persona)} dio de alta el modelo ${a.nombre.toUpperCase()} (marca ${a.marca.toUpperCase()}${a.puffs ? `, ${a.puffs} puffs` : ''}). ${a.proveedorCosto === 'ninguno' ? 'Sin costo de lista: hay que fijarlo antes de venderlo.' : `Costo de lista con ${cap(a.proveedorCosto)}: lo dio el socio.`}` };
  }

  async resumenSemanal(): Promise<ResumenAprendizaje> {
    return {
      alias_nuevos: this.aliases.filter((x) => !x.revertido).map((x) => ({ clase: x.clase, alias: normalizar(x.alias), confirmo: x.por })), alias_negados: this.negativos.size, jerga_nueva: [],
      correcciones_repetidas: [...this.correcciones].filter(([, v]) => v >= 2).map(([k, v]) => ({ clase: k.split('|')[0]!, dicho: k.split('|')[1]!, veces: v })),
      ejemplos_nuevos: this.ejemplos.length, sabores_unidos: this.uniones.filter((u) => !u.deshecha).length, duplicados_pendientes: { sabor: this.colaSabores.filter((x) => x.estado === 'pendiente').length, cliente: 0, modelo: 0 },
    };
  }
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
