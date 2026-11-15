// Enviador de lotes de notificaciones por Telegram (M2). El texto se rinde AL DESPACHAR con lo que la base entrego; la campana ya mostro el aviso.
// Solo va al chat que la base indica (el grupo de los socios o el privado de Omar). Ni correos, ni telefonos, ni llaves: los textos salen de titulos y campos permitidos del aviso.
import type { AlmacenTokens, EnviadorTelegram } from '@/aplicacion/agente/puertos';
import type { EnviadorCanal, LoteEntrega, MiembroLote, ResultadoEnvio } from '@/aplicacion/notificaciones/despachador';
import { ErrorTelegram } from '@/infra/agente/telegram_api';

const CON_BOTONES_DE_TOMA = new Set(['toma_omar_pendiente']);

/** Texto de un aviso para Telegram: titulo y, si el emisor lo declaro, el cuerpo ya redactado por el servidor. Sin emojis. */
export function textoDeMiembro(m: MiembroLote, urlApp: string | null): string {
  const p = m.payload as { texto?: unknown; clave?: unknown; version?: unknown };
  const base = typeof p.texto === 'string' && p.texto.length > 0 ? p.texto : m.titulo;
  const veces = m.conteo > 1 ? ` (${m.conteo} veces)` : '';
  const enlace = urlApp && typeof p.clave === 'string' && typeof p.version === 'number' ? `\nVer el reporte (con tu sesión): ${urlApp}/reportes/${encodeURIComponent(p.clave)}/${p.version}` : '';
  return `${base}${veces}${enlace}`;
}

export function enviadorTelegramDeLotes(tg: EnviadorTelegram, tokens: AlmacenTokens | null, urlApp: string | null, ahora: () => Date = () => new Date()): EnviadorCanal {
  return {
    async enviar(lote: LoteEntrega): Promise<ResultadoEnvio> {
      if (lote.canal !== 'telegram') return { resultado: '400_formato', codigo: 'canal_no_soportado' };
      if (lote.telegram_chat_id === null) return { resultado: '403', codigo: 'sin_destino' };
      const texto = lote.miembros.length === 1 ? textoDeMiembro(lote.miembros[0]!, urlApp) : `${lote.miembros.length} avisos agrupados\n${lote.miembros.map((m) => `- ${textoDeMiembro(m, urlApp)}`).join('\n')}`;
      let botones;
      const unica = lote.miembros.length === 1 ? lote.miembros[0]! : null;
      if (unica && tokens && CON_BOTONES_DE_TOMA.has(unica.tipo) && typeof (unica.payload as { folio?: unknown }).folio === 'string') {
        const folio = (unica.payload as { folio: string }).folio;
        const caduca = new Date(ahora().getTime() + 72 * 3_600_000);
        const aut = await tokens.emitir({ accion: 'autorizar_toma', rolesPermitidos: ['socio'], chatId: lote.telegram_chat_id, caducaEn: caduca, grupoExclusivo: `toma:${folio}`, payload: { folio } });
        const rec = await tokens.emitir({ accion: 'rechazar_toma', rolesPermitidos: ['socio'], chatId: lote.telegram_chat_id, caducaEn: caduca, grupoExclusivo: `toma:${folio}`, payload: { folio } });
        botones = [[{ texto: 'Autorizar', callbackData: aut }, { texto: 'Rechazar', callbackData: rec }]];
      }
      try {
        const r = await tg.enviar({ chatId: lote.telegram_chat_id, texto, ...(botones ? { botones } : {}), protegido: lote.destino !== 'privado_omar', silencioso: lote.silencioso });
        return { resultado: 'ok', mensajeId: String(r.messageId) };
      } catch (e) {
        if (e instanceof ErrorTelegram) {
          if (e.codigo === 'rate_limit') return { resultado: '429', retryAfter: e.reintentarEnSeg ?? 30 };
          if (e.codigo === 'sin_destino') return { resultado: '403', codigo: 'sin_destino' };
          if (e.codigo === 'migrar' && e.migrarA !== null) return { resultado: '400_migrar', migrarA: e.migrarA };
          if (e.codigo === 'rechazado') return { resultado: '400_formato', codigo: String(e.status) };
          if (e.codigo === 'servidor') return { resultado: '5xx', codigo: String(e.status) };
          return { resultado: 'red', incierto: true };
        }
        return { resultado: 'red', incierto: true };
      }
    },
  };
}
