// Lecturas de solo lectura que la maquina de conversacion usa para PREGUNTAR mejor (rol `servidor`, funciones agente.*): a cual pedido se aplica un cobro, cuanto debe el cliente,
// que pedidos esperan salir y cuales esperan su guia. Sin telefonos ni destinatarios; las cifras salen de SQL.
import type { EntornoConversacion } from '@/aplicacion/agente/conversacion';
import type { PedidoCandidato } from '@/dominio/agente/guias';
import type { Sql } from '@/infra/postgres/servidor';

type FilaPedido = { folio: string; cliente: string; folio_externo: string | null; paqueteria: string | null };

const aCandidato = (p: FilaPedido): PedidoCandidato => ({ folio: p.folio, cliente: p.cliente, folioExterno: p.folio_externo, paqueteria: p.paqueteria });

export function entornoVentasDb(sql: Sql): Omit<EntornoConversacion, 'catalogo'> {
  const f = async <T>(texto: string, params: readonly unknown[]): Promise<T> => (await sql<{ j: T }>(texto, params))[0]!.j;
  return {
    async saldoCliente(clienteId) {
      const v = await f<number | string | null>('select agente.saldo_cliente_agente($1::bigint) as j', [Number(clienteId)]);
      return v === null || v === undefined ? null : BigInt(v);
    },
    async pedidosAbiertos(clienteId) {
      const j = (await f<Array<{ folio: string; saldo_cent: number }> | null>('select agente.pedidos_abiertos_cliente($1::bigint) as j', [Number(clienteId)])) ?? [];
      return j.map((x) => ({ folio: x.folio, saldoCent: BigInt(x.saldo_cent) }));
    },
    async pedidosPorEnviar() {
      return ((await f<FilaPedido[] | null>("select agente.pedidos_para_envio('por_enviar') as j", [])) ?? []).map(aCandidato);
    },
    async pedidosSinGuia() {
      return ((await f<FilaPedido[] | null>("select agente.pedidos_para_envio('sin_guia') as j", [])) ?? []).map(aCandidato);
    },
  };
}
