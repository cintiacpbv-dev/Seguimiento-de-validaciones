import { crearStore, mensajeError, ConflictoError } from './store.js';
import { hoyISO, diasHasta, formatoFecha, formatoFechaHora, plural, escapar } from './util.js';

const TIPOS_SUGERIDOS = ['Proceso', 'Limpieza', 'Método analítico', 'Calificación de equipos', 'Sistemas computarizados', 'Transporte'];
const ESTADOS = ['En curso', 'En espera', 'Bloqueada', 'Cancelada'];
const DIAS_AVISO = 14;          // una fecha objetivo a 14 días o menos se marca "por vencer"
const DIAS_REVALIDACION = 90;   // ventana de "próximas revalidaciones"

const CAMPOS_FORMULARIO = [
  'producto', 'presentacion', 'tipo_validacion', 'prioridad', 'responsable',
  'codigo_protocolo', 'codigo_informe', 'enlace_documentos',
  'etapa', 'estado', 'lotes_requeridos', 'lotes_ejecutados', 'lotes', 'proxima_accion',
  'fecha_inicio', 'fecha_aprobacion_protocolo', 'fecha_objetivo', 'fecha_cierre', 'fecha_revalidacion',
  'notas',
];
const CAMPOS_NUMERICOS = new Set(['lotes_requeridos', 'lotes_ejecutados']);

const ETIQUETAS = {
  producto: 'Producto', presentacion: 'Presentación', tipo_validacion: 'Tipo de validación',
  codigo_protocolo: 'Código de protocolo', codigo_informe: 'Código de informe', etapa: 'Etapa',
  estado: 'Estado', prioridad: 'Prioridad', responsable: 'Responsable',
  lotes_requeridos: 'Lotes requeridos', lotes_ejecutados: 'Lotes ejecutados', lotes: 'Números de lote',
  fecha_inicio: 'Inicio', fecha_aprobacion_protocolo: 'Aprobación del protocolo',
  fecha_objetivo: 'Fecha objetivo', fecha_cierre: 'Cierre', fecha_revalidacion: 'Próxima revalidación',
  proxima_accion: 'Próxima acción', enlace_documentos: 'Enlace a documentos', notas: 'Notas',
  descripcion: 'Descripción', fecha_compromiso: 'Fecha compromiso', fecha_registro: 'Fecha de registro',
};

const FILTROS_ESPECIALES = {
  activas: (v) => estaActiva(v),
  vencidas: (v) => estaActiva(v) && v.fecha_objetivo && diasHasta(v.fecha_objetivo) < 0,
  observaciones: (v) => pendientesDe(v.id).length > 0,
  cerradas: (v) => estaCerrada(v) && v.fecha_cierre?.startsWith(String(new Date().getFullYear())),
  revalidacion: (v) => v.fecha_revalidacion && diasHasta(v.fecha_revalidacion) <= DIAS_REVALIDACION,
};

const $ = (selector) => document.querySelector(selector);
const panel = $('#panel');
const formulario = $('#form-validacion');

const estado = {
  store: null,
  usuario: null,
  etapas: [],
  validaciones: [],
  observaciones: [],
  pendientes: new Map(),   // validacion_id → observaciones abiertas
  filtros: { texto: '', tipo: '', etapa: '', estado: '', responsable: '', cerradas: true, especial: '' },
  orden: { campo: 'producto', sentido: 1 },
  panel: { id: null, version: null, original: null, pestana: 'datos' },
  obsEditando: null,
  ultimaCarga: null,
};

// ---------------------------------------------------------------------
//  Inicio, sesión y carga de datos
// ---------------------------------------------------------------------

async function iniciar() {
  try {
    estado.store = await crearStore();
  } catch (error) {
    $('#sincronizacion').textContent = `No se pudo cargar la conexión con Supabase: ${mensajeError(error)}`;
    return;
  }
  conectarEventos();
  $('#aviso-demo').hidden = estado.store.modo !== 'demo';
  await cambiarUsuario(await estado.store.usuarioActual());
  // Cierre de sesión en otra pestaña, sesión vencida, etc.
  estado.store.alCambiarSesion((usuario) => {
    // Diferido: supabase-js no admite llamadas a la base dentro de este callback.
    setTimeout(() => {
      if ((usuario?.id ?? null) !== (estado.usuario?.id ?? null)) cambiarUsuario(usuario);
    });
  });
}

async function cambiarUsuario(usuario) {
  estado.usuario = usuario;
  const conSesion = Boolean(usuario);
  $('#login').hidden = conSesion;
  $('#app').hidden = !conSesion;
  $('#acciones').hidden = !conSesion;
  $('#usuario').hidden = !conSesion || estado.store.modo === 'demo';
  $('#usuario-email').textContent = usuario?.email ?? '';
  if (!conSesion) {
    if (panel.open) panel.close();
    $('#sincronizacion').textContent = 'Iniciá sesión para ver las validaciones.';
    $('#form-login [name=email]').focus();
    return;
  }
  await recargar();
  estado.store.suscribir(programarRecarga);
}

async function recargar() {
  try {
    const datos = await estado.store.cargar();
    estado.etapas = datos.etapas;
    estado.validaciones = datos.validaciones;
    estado.observaciones = datos.observaciones;
    estado.ultimaCarga = new Date();
    renderizar();
    refrescarPanel();
  } catch (error) {
    $('#sincronizacion').textContent = 'No se pudieron cargar los datos.';
    avisar(mensajeError(error), 'error');
  }
}

let temporizadorRecarga;
function programarRecarga() {
  clearTimeout(temporizadorRecarga);
  temporizadorRecarga = setTimeout(recargar, 400);
}

// ---------------------------------------------------------------------
//  Reglas derivadas
// ---------------------------------------------------------------------

const etapaFinal = () => estado.etapas.at(-1)?.nombre;
const indiceEtapa = (nombre) => estado.etapas.findIndex((e) => e.nombre === nombre);
const estaCerrada = (v) => v.etapa === etapaFinal();
const estaActiva = (v) => !estaCerrada(v) && v.estado !== 'Cancelada';
const pendientesDe = (id) => estado.pendientes.get(id) ?? [];
const observacionVencida = (o) => o.estado === 'Abierta' && o.fecha_compromiso && diasHasta(o.fecha_compromiso) < 0;

function agruparPendientes() {
  const mapa = new Map();
  const abiertas = estado.observaciones
    .filter((o) => o.estado === 'Abierta')
    .sort((a, b) => compararNulosAlFinal(a.fecha_compromiso, b.fecha_compromiso));
  for (const o of abiertas) {
    if (!mapa.has(o.validacion_id)) mapa.set(o.validacion_id, []);
    mapa.get(o.validacion_id).push(o);
  }
  estado.pendientes = mapa;
}

function plazo(v) {
  if (!estaActiva(v) || !v.fecha_objetivo) return null;
  const dias = diasHasta(v.fecha_objetivo);
  if (dias < 0) return { clase: 'peligro', texto: `Vencida hace ${plural(-dias, 'día')}` };
  if (dias === 0) return { clase: 'peligro', texto: 'Vence hoy' };
  if (dias <= DIAS_AVISO) return { clase: 'alerta', texto: `Vence en ${plural(dias, 'día')}` };
  return { clase: 'suave', texto: `Faltan ${plural(dias, 'día')}` };
}

function normalizarTexto(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function compararNulosAlFinal(a, b, sentido = 1) {
  const vacioA = a === null || a === undefined || a === '';
  const vacioB = b === null || b === undefined || b === '';
  if (vacioA || vacioB) return vacioA === vacioB ? 0 : vacioA ? 1 : -1;
  return (a < b ? -1 : a > b ? 1 : 0) * sentido;
}

// ---------------------------------------------------------------------
//  Vista principal
// ---------------------------------------------------------------------

function renderizar() {
  agruparPendientes();
  actualizarListas();
  renderKpis();
  renderEtapas();
  renderTabla();
  actualizarSincronizacion();
}

function actualizarSincronizacion() {
  const hora = estado.ultimaCarga?.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) ?? '';
  const total = plural(estado.validaciones.length, 'validación', 'validaciones');
  $('#sincronizacion').textContent = estado.store.modo === 'demo'
    ? `${total} · datos de ejemplo`
    : `${total} · actualizado a las ${hora}`;
}

function valoresUnicos(campo, extras = []) {
  const valores = new Set(extras);
  for (const v of estado.validaciones) if (v[campo]) valores.add(v[campo]);
  return [...valores].sort((a, b) => a.localeCompare(b, 'es'));
}

function actualizarListas() {
  const nombresEtapas = estado.etapas.map((e) => e.nombre);
  llenarSelect($('#f-tipo'), valoresUnicos('tipo_validacion'), 'Todos los tipos', 'tipo');
  llenarSelect($('#f-etapa'), nombresEtapas, 'Todas las etapas', 'etapa');
  llenarSelect($('#f-estado'), ['Cerrada', ...ESTADOS], 'Todos los estados', 'estado');
  llenarSelect($('#f-responsable'), valoresUnicos('responsable'), 'Todos los responsables', 'responsable');

  const selectEtapa = formulario.elements.etapa;
  const etapaElegida = selectEtapa.value;
  selectEtapa.innerHTML = nombresEtapas.map((n) => `<option>${escapar(n)}</option>`).join('');
  if (nombresEtapas.includes(etapaElegida)) selectEtapa.value = etapaElegida;

  const responsables = new Set([...valoresUnicos('responsable'), ...estado.observaciones.map((o) => o.responsable).filter(Boolean)]);
  $('#lista-productos').innerHTML = opcionesDatalist(valoresUnicos('producto'));
  $('#lista-tipos').innerHTML = opcionesDatalist(valoresUnicos('tipo_validacion', TIPOS_SUGERIDOS));
  $('#lista-responsables').innerHTML = opcionesDatalist([...responsables].sort((a, b) => a.localeCompare(b, 'es')));
}

function llenarSelect(select, valores, textoTodos, filtro) {
  select.innerHTML = `<option value="">${textoTodos}</option>`
    + valores.map((v) => `<option value="${escapar(v)}">${escapar(v)}</option>`).join('');
  if (!valores.includes(estado.filtros[filtro])) estado.filtros[filtro] = '';
  select.value = estado.filtros[filtro];
}

const opcionesDatalist = (valores) => valores.map((v) => `<option value="${escapar(v)}"></option>`).join('');

function renderKpis() {
  const activas = estado.validaciones.filter(estaActiva);
  const vencidas = activas.filter((v) => v.fecha_objetivo && diasHasta(v.fecha_objetivo) < 0).length;
  const porVencer = activas.filter((v) => {
    const dias = diasHasta(v.fecha_objetivo);
    return dias !== null && dias >= 0 && dias <= DIAS_AVISO;
  }).length;
  const obsAbiertas = estado.observaciones.filter((o) => o.estado === 'Abierta');
  const obsVencidas = obsAbiertas.filter(observacionVencida).length;
  const conObservaciones = estado.pendientes.size;
  const anio = new Date().getFullYear();
  const cerradasAnio = estado.validaciones.filter(FILTROS_ESPECIALES.cerradas).length;
  const revalidaciones = estado.validaciones.filter(FILTROS_ESPECIALES.revalidacion);
  const revalidacionesVencidas = revalidaciones.filter((v) => diasHasta(v.fecha_revalidacion) < 0).length;
  const enEspera = activas.filter((v) => v.estado !== 'En curso').length;

  const tarjetas = [
    { clave: 'activas', valor: activas.length, etiqueta: 'Validaciones activas',
      detalle: enEspera ? `${enEspera} en espera o bloqueadas` : 'Todas en curso', tono: '' },
    { clave: 'vencidas', valor: vencidas, etiqueta: 'Fuera de plazo',
      detalle: porVencer ? `${plural(porVencer, 'vence', 'vencen')} en ≤ ${DIAS_AVISO} días` : `Ninguna vence en ≤ ${DIAS_AVISO} días`,
      tono: vencidas ? 'peligro' : porVencer ? 'alerta' : '' },
    { clave: 'observaciones', valor: obsAbiertas.length, etiqueta: 'Observaciones pendientes',
      detalle: !obsAbiertas.length ? 'Nada pendiente'
        : obsVencidas ? `${plural(obsVencidas, 'vencida', 'vencidas')} · en ${plural(conObservaciones, 'validación', 'validaciones')}`
        : `En ${plural(conObservaciones, 'validación', 'validaciones')}`,
      tono: obsVencidas ? 'peligro' : obsAbiertas.length ? 'alerta' : '' },
    { clave: 'cerradas', valor: cerradasAnio, etiqueta: `Cerradas en ${anio}`, detalle: 'Informe aprobado', tono: cerradasAnio ? 'ok' : '' },
    { clave: 'revalidacion', valor: revalidaciones.length, etiqueta: 'Revalidaciones próximas',
      detalle: revalidacionesVencidas ? `${revalidacionesVencidas} ya vencida${revalidacionesVencidas === 1 ? '' : 's'}` : `En los próximos ${DIAS_REVALIDACION} días`,
      tono: revalidacionesVencidas ? 'peligro' : '' },
  ];

  $('#kpis').innerHTML = tarjetas.map((t) => `
    <button type="button" class="kpi ${t.tono ? `kpi-${t.tono}` : ''}" data-especial="${t.clave}"
      aria-pressed="${estado.filtros.especial === t.clave}" title="Filtrar la tabla">
      <span class="kpi-valor">${t.valor}</span>
      <span class="kpi-etiqueta">${t.etiqueta}</span>
      <span class="kpi-detalle">${t.detalle}</span>
    </button>`).join('');
}

function renderEtapas() {
  const vigentes = estado.validaciones.filter((v) => v.estado !== 'Cancelada');
  const ultima = estado.etapas.length - 1;
  $('#etapas-flujo').innerHTML = estado.etapas.map((e, i) => {
    const cantidad = vigentes.filter((v) => v.etapa === e.nombre).length;
    const clases = ['etapa-paso', cantidad ? 'con-datos' : '', i === ultima ? 'final' : ''].join(' ');
    return `<button type="button" class="${clases}" data-etapa="${escapar(e.nombre)}"
        aria-pressed="${estado.filtros.etapa === e.nombre}" title="${escapar(e.descripcion ?? '')}">
      <span class="etapa-cantidad">${cantidad}</span>
      <span class="etapa-nombre">${escapar(e.nombre)}</span>
    </button>`;
  }).join('');
}

function filtrar() {
  const f = estado.filtros;
  const texto = normalizarTexto(f.texto);
  return estado.validaciones.filter((v) => {
    if (!f.cerradas && estaCerrada(v)) return false;
    if (f.tipo && v.tipo_validacion !== f.tipo) return false;
    if (f.etapa && v.etapa !== f.etapa) return false;
    if (f.estado && (f.estado === 'Cerrada' ? !estaCerrada(v) : estaCerrada(v) || v.estado !== f.estado)) return false;
    if (f.responsable && v.responsable !== f.responsable) return false;
    if (f.especial && !FILTROS_ESPECIALES[f.especial](v)) return false;
    if (texto) {
      const contenido = [
        v.producto, v.presentacion, v.tipo_validacion, v.codigo_protocolo, v.codigo_informe,
        v.responsable, v.lotes, v.proxima_accion, v.notas,
        ...pendientesDe(v.id).map((o) => `${o.descripcion} ${o.responsable ?? ''}`),
      ].join(' ');
      if (!normalizarTexto(contenido).includes(texto)) return false;
    }
    return true;
  });
}

function ordenar(lista) {
  const { campo, sentido } = estado.orden;
  const valor = (v) => {
    switch (campo) {
      case 'etapa': return indiceEtapa(v.etapa);
      case 'observaciones': return pendientesDe(v.id).length;
      case 'fecha_objetivo': return estaActiva(v) ? v.fecha_objetivo : null;
      case 'estado': return estaCerrada(v) ? 'zz' : normalizarTexto(v.estado);
      default: return normalizarTexto(v[campo]) || null;
    }
  };
  return [...lista].sort((a, b) =>
    compararNulosAlFinal(valor(a), valor(b), sentido)
    || normalizarTexto(a.producto).localeCompare(normalizarTexto(b.producto))
    || normalizarTexto(a.tipo_validacion).localeCompare(normalizarTexto(b.tipo_validacion)));
}

function renderTabla() {
  const filas = ordenar(filtrar());
  const hayFiltros = Object.entries(estado.filtros).some(([k, v]) => (k === 'cerradas' ? !v : Boolean(v)));
  $('#btn-limpiar').hidden = !hayFiltros;
  $('#resultado').textContent = hayFiltros
    ? `Mostrando ${filas.length} de ${plural(estado.validaciones.length, 'validación', 'validaciones')}`
    : '';

  for (const th of document.querySelectorAll('#tabla th')) {
    const boton = th.querySelector('[data-orden]');
    const activo = boton?.dataset.orden === estado.orden.campo;
    if (activo) th.setAttribute('aria-sort', estado.orden.sentido === 1 ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  }

  if (!filas.length) {
    const mensaje = estado.validaciones.length
      ? 'Ninguna validación coincide con los filtros.'
      : 'Todavía no hay validaciones cargadas. Usá “+ Nueva validación” para agregar la primera.';
    $('#tabla-cuerpo').innerHTML = `<tr class="vacio"><td colspan="8">${mensaje}</td></tr>`;
    return;
  }
  $('#tabla-cuerpo').innerHTML = filas.map(filaHTML).join('');
}

function filaHTML(v) {
  const indice = indiceEtapa(v.etapa);
  const total = estado.etapas.length;
  const cerrada = estaCerrada(v);
  const descripcion = [v.tipo_validacion, v.presentacion].filter(Boolean).join(' · ');
  const clases = [v.estado === 'Cancelada' ? 'cancelada' : '', cerrada ? 'cerrada' : ''].join(' ');
  // Cada celda envuelve su contenido en un único div para que, en pantallas
  // chicas, la fila se muestre como tarjeta con "etiqueta | contenido".
  const celda = (etiqueta, contenido, atributos = '') =>
    `<td data-etiqueta="${etiqueta}" ${atributos}><div class="celda">${contenido}</div></td>`;
  return `
    <tr data-id="${escapar(v.id)}" class="${clases}">
      ${celda('Producto', `
        <button type="button" class="producto" data-abrir="datos">${escapar(v.producto)}</button>
        ${v.prioridad === 'Alta' && estaActiva(v) ? '<span class="etiqueta-prioridad">Prioridad alta</span>' : ''}
        <div class="texto-suave">${escapar(descripcion)}</div>`)}
      ${celda('Protocolo', `
        ${v.codigo_protocolo ? `<span class="codigo">${escapar(v.codigo_protocolo)}</span>` : '<span class="texto-suave">Sin asignar</span>'}
        ${v.codigo_informe ? `<div class="texto-suave">Informe <span class="codigo">${escapar(v.codigo_informe)}</span></div>` : ''}
        ${enlaceDocumentos(v.enlace_documentos)}`)}
      ${celda('Etapa', `
        <div class="etapa-actual">${escapar(v.etapa)} <span class="texto-suave">${indice + 1}/${total}</span></div>
        <div class="progreso ${cerrada ? 'completo' : ''}" aria-hidden="true">
          ${estado.etapas.map((_, i) => `<span class="${i <= indice ? 'lleno' : ''}"></span>`).join('')}
        </div>
        ${v.proxima_accion && !cerrada ? `<div class="proxima-accion">→ ${escapar(v.proxima_accion)}</div>` : ''}`)}
      ${celda('Lotes', lotesHTML(v))}
      ${celda('Observaciones pendientes', observacionesHTML(pendientesDe(v.id)), 'data-abrir="observaciones" class="celda-obs"')}
      ${celda('Fechas', fechasHTML(v))}
      ${celda('Responsable', v.responsable ? escapar(v.responsable) : '<span class="texto-suave">—</span>')}
      ${celda('Estado', chipEstado(v))}
    </tr>`;
}

function enlaceDocumentos(url) {
  if (!url || !/^https?:\/\//i.test(url)) return '';
  return `<div><a class="enlace-docs" href="${escapar(url)}" target="_blank" rel="noopener noreferrer">Documentos ↗</a></div>`;
}

function lotesHTML(v) {
  if (!v.lotes_requeridos) return '<span class="texto-suave">No aplica</span>';
  const puntos = Array.from({ length: Math.min(v.lotes_requeridos, 10) },
    (_, i) => `<span class="${i < v.lotes_ejecutados ? 'lleno' : ''}"></span>`).join('');
  return `
    <div class="lotes"><span class="lotes-puntos" aria-hidden="true">${puntos}</span>${v.lotes_ejecutados}/${v.lotes_requeridos}</div>
    ${v.lotes ? `<div class="texto-suave lotes-numeros">${escapar(v.lotes)}</div>` : ''}`;
}

function observacionesHTML(pendientes) {
  if (!pendientes.length) return '<span class="sin-pendientes">Sin pendientes</span>';
  const vencidas = pendientes.filter(observacionVencida).length;
  const primeras = pendientes.slice(0, 2).map((o) => {
    const vencida = observacionVencida(o);
    const fecha = o.fecha_compromiso ? ` <span class="obs-fecha">${vencida ? 'venció' : 'para el'} ${formatoFecha(o.fecha_compromiso)}</span>` : '';
    return `<li class="${vencida ? 'vencida' : ''}">${escapar(o.descripcion)}${fecha}</li>`;
  }).join('');
  const resto = pendientes.length > 2 ? `<li class="texto-suave">y ${pendientes.length - 2} más…</li>` : '';
  return `
    <div class="obs-resumen">
      <span class="contador ${vencidas ? 'contador-peligro' : 'contador-alerta'}" title="${plural(pendientes.length, 'pendiente')}">${pendientes.length}</span>
      <ul>${primeras}${resto}</ul>
    </div>`;
}

function fechasHTML(v) {
  const filas = [];
  if (v.fecha_inicio) filas.push(['Inicio', formatoFecha(v.fecha_inicio)]);
  if (v.fecha_aprobacion_protocolo) filas.push(['Protocolo', formatoFecha(v.fecha_aprobacion_protocolo)]);
  if (estaCerrada(v)) {
    if (v.fecha_cierre) filas.push(['Cierre', formatoFecha(v.fecha_cierre)]);
  } else if (v.fecha_objetivo) {
    filas.push(['Objetivo', formatoFecha(v.fecha_objetivo)]);
  }
  if (v.fecha_revalidacion) filas.push(['Revalidación', formatoFecha(v.fecha_revalidacion)]);

  const avisoPlazo = plazo(v);
  const diasReval = diasHasta(v.fecha_revalidacion);
  const avisoReval = diasReval !== null && diasReval <= DIAS_REVALIDACION
    ? `<span class="plazo plazo-${diasReval < 0 ? 'peligro' : 'alerta'}">${diasReval < 0 ? 'Revalidación vencida' : `Revalidar en ${plural(diasReval, 'día')}`}</span>`
    : '';
  if (!filas.length) return '<span class="texto-suave">—</span>';
  return `
    <dl class="fechas">${filas.map(([k, f]) => `<dt>${k}</dt><dd>${f}</dd>`).join('')}</dl>
    ${avisoPlazo ? `<span class="plazo plazo-${avisoPlazo.clase}">${avisoPlazo.texto}</span>` : ''}
    ${avisoReval}`;
}

function chipEstado(v) {
  if (estaCerrada(v)) return '<span class="chip chip-ok">Cerrada</span>';
  const tono = { 'En curso': 'info', 'En espera': 'alerta', Bloqueada: 'peligro', Cancelada: 'neutro' }[v.estado] ?? 'neutro';
  return `<span class="chip chip-${tono}">${escapar(v.estado)}</span>`;
}

// ---------------------------------------------------------------------
//  Panel de detalle: datos
// ---------------------------------------------------------------------

function datosDeValidacion(v) {
  return Object.fromEntries(CAMPOS_FORMULARIO.map((campo) => {
    const valor = v[campo];
    if (CAMPOS_NUMERICOS.has(campo)) return [campo, Number(valor) || 0];
    return [campo, valor === undefined || valor === null || String(valor).trim() === '' ? null : String(valor).trim()];
  }));
}

function leerFormulario() {
  const valores = {};
  for (const campo of CAMPOS_FORMULARIO) valores[campo] = formulario.elements[campo].value;
  return datosDeValidacion(valores);
}

function llenarFormulario(v) {
  for (const campo of CAMPOS_FORMULARIO) formulario.elements[campo].value = v[campo] ?? '';
}

const hayCambiosSinGuardar = () =>
  panel.open && JSON.stringify(leerFormulario()) !== JSON.stringify(estado.panel.original);

function valoresNuevos() {
  return {
    tipo_validacion: 'Proceso', etapa: estado.etapas[0]?.nombre, estado: 'En curso',
    prioridad: 'Media', lotes_requeridos: 3, lotes_ejecutados: 0,
  };
}

function abrirPanel(id, pestana = 'datos') {
  const v = id ? estado.validaciones.find((x) => x.id === id) : null;
  estado.panel = { id: v?.id ?? null, version: v?.updated_at ?? null, original: null, pestana };
  estado.obsEditando = null;
  llenarFormulario(v ?? valoresNuevos());
  estado.panel.original = leerFormulario();
  actualizarCabeceraPanel(v);
  $('#pestanas').hidden = !v;
  $('#btn-eliminar').hidden = !v;
  $('#form-error').hidden = true;
  $('#form-observacion').reset();
  $('#historial').innerHTML = '';
  if (!panel.open) panel.showModal();
  mostrarPestana(v ? pestana : 'datos');
  if (!v) formulario.elements.producto.focus();
}

function actualizarCabeceraPanel(v) {
  $('#panel-titulo').textContent = v ? v.producto : 'Nueva validación';
  $('#panel-subtitulo').textContent = v
    ? [v.tipo_validacion, v.codigo_protocolo ?? 'sin código de protocolo'].join(' · ')
    : 'Completá los datos y guardá. Las observaciones se agregan después.';
  $('#pestana-obs-n').textContent = v ? pendientesDe(v.id).length || '' : '';
  $('#ultima-modificacion').textContent = v?.updated_at
    ? `Última modificación: ${formatoFechaHora(v.updated_at)}${v.updated_by ? ` por ${v.updated_by}` : ''}`
    : '';
}

function cerrarPanel() {
  if (hayCambiosSinGuardar() && !confirm('Hay cambios sin guardar. ¿Descartarlos?')) return;
  panel.close();
}

// Tras una recarga (propia o de otro usuario), actualiza el panel abierto
// sin pisar lo que se está escribiendo.
function refrescarPanel() {
  if (!panel.open || !estado.panel.id) return;
  const v = estado.validaciones.find((x) => x.id === estado.panel.id);
  if (!v) {
    panel.close();
    avisar('La validación que tenías abierta fue eliminada.', 'error');
    return;
  }
  if (v.updated_at !== estado.panel.version && !hayCambiosSinGuardar()) {
    llenarFormulario(v);
    estado.panel.original = leerFormulario();
    estado.panel.version = v.updated_at;
  }
  actualizarCabeceraPanel(v);
  if (estado.panel.pestana === 'observaciones' && !estado.obsEditando) renderObservacionesPanel();
  if (estado.panel.pestana === 'historial') cargarHistorial();
}

function mostrarPestana(nombre) {
  estado.panel.pestana = nombre;
  for (const boton of document.querySelectorAll('#pestanas [data-pestana]')) {
    boton.setAttribute('aria-selected', String(boton.dataset.pestana === nombre));
  }
  for (const seccion of document.querySelectorAll('[data-pestana-contenido]')) {
    seccion.hidden = seccion.dataset.pestanaContenido !== nombre;
  }
  if (nombre === 'observaciones') renderObservacionesPanel();
  if (nombre === 'historial') cargarHistorial();
}

function validarFormulario(datos) {
  if (!datos.producto) return 'Indicá el nombre del producto.';
  if (!datos.tipo_validacion) return 'Indicá el tipo de validación.';
  if (!datos.etapa) return 'Elegí una etapa.';
  for (const campo of CAMPOS_NUMERICOS) {
    if (!Number.isInteger(datos[campo]) || datos[campo] < 0 || datos[campo] > 99) {
      return `${ETIQUETAS[campo]} debe ser un número entero entre 0 y 99.`;
    }
  }
  if (datos.enlace_documentos && !/^https?:\/\//i.test(datos.enlace_documentos)) {
    return 'El enlace a documentos debe empezar con http:// o https://';
  }
  if (datos.fecha_inicio && datos.fecha_cierre && datos.fecha_cierre < datos.fecha_inicio) {
    return 'La fecha de cierre no puede ser anterior a la de inicio.';
  }
  return null;
}

function mostrarErrorFormulario(mensaje) {
  const error = $('#form-error');
  error.textContent = mensaje;
  error.hidden = !mensaje;
  if (mensaje) error.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

const camposDistintos = (a, b) => CAMPOS_FORMULARIO.filter((campo) => a[campo] !== b[campo]);
const nombresCampos = (campos) => campos.map((campo) => ETIQUETAS[campo]).join(', ');

async function guardarValidacion(evento) {
  evento.preventDefault();
  const datos = leerFormulario();
  const error = validarFormulario(datos);
  if (error) return mostrarErrorFormulario(error);
  const esNueva = !estado.panel.id;
  // Solo se envían los campos que cambió el usuario, para no pisar lo que
  // otra persona haya modificado en otros campos.
  const propios = camposDistintos(datos, estado.panel.original);
  if (!esNueva && !propios.length) return avisar('No hay cambios para guardar.');

  const boton = formulario.querySelector('[type=submit]');
  boton.disabled = true;
  mostrarErrorFormulario('');
  try {
    await enviarValidacion(datos, propios);
    if (esNueva) abrirPanel(estado.panel.id, 'observaciones');
    avisar(esNueva ? 'Validación creada. Ya podés agregarle observaciones.' : 'Cambios guardados.');
  } catch (e) {
    if (e instanceof ConflictoError) await resolverConflicto(datos, propios);
    else mostrarErrorFormulario(mensajeError(e));
  } finally {
    boton.disabled = false;
  }
}

async function enviarValidacion(datos, campos) {
  const cambios = estado.panel.id
    ? { id: estado.panel.id, ...Object.fromEntries(campos.map((campo) => [campo, datos[campo]])) }
    : datos;
  const guardada = await estado.store.guardarValidacion(cambios, estado.panel.version);
  reemplazarEnLista(estado.validaciones, guardada);
  estado.panel.id = guardada.id;
  estado.panel.version = guardada.updated_at;
  estado.panel.original = datosDeValidacion(guardada);
  renderizar();
  actualizarCabeceraPanel(guardada);
}

// Otra persona guardó esta validación mientras se editaba. Se incorporan sus
// cambios al formulario; si tocó campos distintos se guarda de nuevo solo, y
// si cambió los mismos campos se le pregunta al usuario.
async function resolverConflicto(datos, propios) {
  const original = estado.panel.original;
  await recargar();
  const actual = estado.validaciones.find((v) => v.id === estado.panel.id);
  if (!actual) return; // refrescarPanel ya cerró el panel y avisó
  const servidor = datosDeValidacion(actual);
  const ajenos = camposDistintos(servidor, original);
  const superpuestos = propios.filter((campo) => ajenos.includes(campo) && servidor[campo] !== datos[campo]);
  for (const campo of ajenos) {
    if (!propios.includes(campo)) formulario.elements[campo].value = actual[campo] ?? '';
  }
  estado.panel.original = servidor;
  estado.panel.version = actual.updated_at;
  actualizarCabeceraPanel(actual);

  if (superpuestos.length) {
    mostrarErrorFormulario(
      `Mientras editabas, otra persona también cambió: ${nombresCampos(superpuestos)}. `
      + 'El formulario conserva tus valores; si volvés a guardar, reemplazan a los suyos.');
    return;
  }
  try {
    const pendientes = camposDistintos(leerFormulario(), servidor);
    if (pendientes.length) await enviarValidacion(leerFormulario(), pendientes);
    avisar(`Cambios guardados. También se incorporaron cambios de otra persona${ajenos.length ? ` (${nombresCampos(ajenos)})` : ''}.`);
  } catch (e) {
    mostrarErrorFormulario(mensajeError(e));
  }
}

async function eliminarValidacion() {
  const v = estado.validaciones.find((x) => x.id === estado.panel.id);
  if (!v) return;
  const obs = estado.observaciones.filter((o) => o.validacion_id === v.id).length;
  const aviso = `¿Eliminar la validación de ${v.producto} (${v.tipo_validacion})?`
    + (obs ? `\nTambién se eliminarán sus ${plural(obs, 'observación', 'observaciones')}.` : '')
    + '\nEsta acción no se puede deshacer.';
  if (!confirm(aviso)) return;
  try {
    await estado.store.eliminarValidacion(v.id);
    estado.validaciones = estado.validaciones.filter((x) => x.id !== v.id);
    estado.observaciones = estado.observaciones.filter((o) => o.validacion_id !== v.id);
    panel.close();
    renderizar();
    avisar('Validación eliminada.');
  } catch (e) {
    mostrarErrorFormulario(mensajeError(e));
  }
}

function reemplazarEnLista(lista, registro) {
  const indice = lista.findIndex((x) => x.id === registro.id);
  if (indice === -1) lista.push(registro);
  else lista[indice] = registro;
}

// ---------------------------------------------------------------------
//  Panel de detalle: observaciones
// ---------------------------------------------------------------------

function renderObservacionesPanel() {
  const todas = estado.observaciones.filter((o) => o.validacion_id === estado.panel.id);
  const abiertas = todas.filter((o) => o.estado === 'Abierta')
    .sort((a, b) => compararNulosAlFinal(a.fecha_compromiso, b.fecha_compromiso));
  const cerradas = todas.filter((o) => o.estado === 'Cerrada')
    .sort((a, b) => compararNulosAlFinal(a.fecha_cierre, b.fecha_cierre, -1));
  $('#pestana-obs-n').textContent = abiertas.length || '';

  if (!todas.length) {
    $('#obs-lista').innerHTML = '<li class="vacio">Sin observaciones registradas.</li>';
    return;
  }
  $('#obs-lista').innerHTML = [
    ...abiertas.map(observacionItemHTML),
    abiertas.length ? '' : '<li class="vacio">No quedan observaciones pendientes.</li>',
    cerradas.length ? `<li class="obs-separador">Resueltas (${cerradas.length})</li>` : '',
    ...cerradas.map(observacionItemHTML),
  ].join('');
}

function observacionItemHTML(o) {
  if (estado.obsEditando === o.id) {
    return `
      <li class="obs-item editando" data-obs="${escapar(o.id)}">
        <form class="obs-edicion">
          <textarea name="descripcion" rows="2" required aria-label="Descripción">${escapar(o.descripcion)}</textarea>
          <div class="grilla">
            <label>Responsable <input name="responsable" list="lista-responsables" value="${escapar(o.responsable ?? '')}"></label>
            <label>Fecha compromiso <input name="fecha_compromiso" type="date" value="${escapar(o.fecha_compromiso ?? '')}"></label>
          </div>
          <div class="acciones-derecha">
            <button type="button" class="boton boton-secundario" data-accion="cancelar-edicion">Cancelar</button>
            <button type="submit" class="boton boton-primario">Guardar</button>
          </div>
        </form>
      </li>`;
  }
  const cerrada = o.estado === 'Cerrada';
  const vencida = observacionVencida(o);
  const detalles = [
    o.responsable && escapar(o.responsable),
    o.fecha_compromiso && !cerrada && `<span class="${vencida ? 'texto-peligro' : ''}">${vencida ? 'Venció' : 'Compromiso'} ${formatoFecha(o.fecha_compromiso)}</span>`,
    `Registrada ${formatoFecha(o.fecha_registro)}`,
    cerrada && o.fecha_cierre && `Resuelta ${formatoFecha(o.fecha_cierre)}`,
  ].filter(Boolean).join(' · ');
  return `
    <li class="obs-item ${cerrada ? 'cerrada' : ''} ${vencida ? 'vencida' : ''}" data-obs="${escapar(o.id)}">
      <button type="button" class="obs-marca" data-accion="alternar"
        aria-label="${cerrada ? 'Reabrir observación' : 'Marcar como resuelta'}"
        title="${cerrada ? 'Reabrir' : 'Marcar como resuelta'}">${cerrada ? '✓' : ''}</button>
      <div class="obs-texto">
        <p>${escapar(o.descripcion)}</p>
        <p class="texto-suave">${detalles}</p>
      </div>
      <div class="obs-acciones">
        <button type="button" class="boton-enlace" data-accion="editar">Editar</button>
        <button type="button" class="boton-enlace texto-peligro" data-accion="eliminar">Eliminar</button>
      </div>
    </li>`;
}

async function guardarObservacion(datos, mensaje) {
  try {
    const guardada = await estado.store.guardarObservacion(datos);
    reemplazarEnLista(estado.observaciones, guardada);
    estado.obsEditando = null;
    renderizar();
    renderObservacionesPanel();
    avisar(mensaje);
    return true;
  } catch (e) {
    avisar(mensajeError(e), 'error');
    return false;
  }
}

async function agregarObservacion(evento) {
  evento.preventDefault();
  const form = evento.target;
  const descripcion = form.elements.descripcion.value.trim();
  if (!descripcion) return form.elements.descripcion.focus();
  const boton = form.querySelector('[type=submit]');
  boton.disabled = true;
  const ok = await guardarObservacion({
    validacion_id: estado.panel.id,
    descripcion,
    responsable: form.elements.responsable.value.trim() || null,
    fecha_compromiso: form.elements.fecha_compromiso.value || null,
  }, 'Observación agregada.');
  boton.disabled = false;
  if (ok) form.reset();
}

async function accionObservacion(evento) {
  const boton = evento.target.closest('[data-accion]');
  const item = evento.target.closest('[data-obs]');
  if (!boton || !item) return;
  const o = estado.observaciones.find((x) => x.id === item.dataset.obs);
  if (!o) return;

  switch (boton.dataset.accion) {
    case 'alternar': {
      const cerrar = o.estado === 'Abierta';
      await guardarObservacion({ id: o.id, estado: cerrar ? 'Cerrada' : 'Abierta' },
        cerrar ? 'Observación resuelta.' : 'Observación reabierta.');
      break;
    }
    case 'editar':
      estado.obsEditando = o.id;
      renderObservacionesPanel();
      $('#obs-lista').querySelector(`[data-obs="${CSS.escape(o.id)}"] textarea`)?.focus();
      break;
    case 'cancelar-edicion':
      estado.obsEditando = null;
      renderObservacionesPanel();
      break;
    case 'eliminar':
      if (!confirm(`¿Eliminar la observación?\n\n“${o.descripcion}”`)) return;
      try {
        await estado.store.eliminarObservacion(o.id);
        estado.observaciones = estado.observaciones.filter((x) => x.id !== o.id);
        renderizar();
        renderObservacionesPanel();
        avisar('Observación eliminada.');
      } catch (e) {
        avisar(mensajeError(e), 'error');
      }
      break;
  }
}

async function editarObservacion(evento) {
  evento.preventDefault();
  const form = evento.target;
  const id = form.closest('[data-obs]').dataset.obs;
  const descripcion = form.elements.descripcion.value.trim();
  if (!descripcion) return form.elements.descripcion.focus();
  await guardarObservacion({
    id,
    descripcion,
    responsable: form.elements.responsable.value.trim() || null,
    fecha_compromiso: form.elements.fecha_compromiso.value || null,
  }, 'Observación actualizada.');
}

// ---------------------------------------------------------------------
//  Panel de detalle: historial
// ---------------------------------------------------------------------

async function cargarHistorial() {
  const id = estado.panel.id;
  const lista = $('#historial');
  if (!lista.children.length) lista.innerHTML = '<li class="vacio">Cargando…</li>';
  try {
    const registros = await estado.store.historial(id);
    if (estado.panel.id !== id) return;
    lista.innerHTML = registros.length
      ? registros.map(historialHTML).join('')
      : '<li class="vacio">Sin cambios registrados.</li>';
  } catch (e) {
    lista.innerHTML = `<li class="vacio">No se pudo cargar el historial: ${escapar(mensajeError(e))}</li>`;
  }
}

function historialHTML(h) {
  let titulo;
  let detalle = '';
  if (h.tabla === 'validaciones') {
    titulo = { alta: 'Creó la validación', baja: 'Eliminó la validación' }[h.accion] ?? 'Modificó la validación';
    if (h.accion === 'modificación') detalle = listaCambios(h.cambios);
  } else {
    const actual = estado.observaciones.find((o) => o.id === h.registro_id);
    const descripcion = typeof h.cambios.descripcion === 'string'
      ? h.cambios.descripcion
      : h.cambios.descripcion?.[1] ?? actual?.descripcion ?? '';
    const cita = descripcion ? `<p class="cita">“${escapar(recortar(descripcion))}”</p>` : '';
    if (h.accion === 'alta') {
      titulo = 'Agregó una observación';
      detalle = cita;
    } else if (h.accion === 'baja') {
      titulo = 'Eliminó una observación';
      detalle = cita;
    } else if (h.cambios.estado) {
      titulo = h.cambios.estado[1] === 'Cerrada' ? 'Resolvió una observación' : 'Reabrió una observación';
      detalle = cita;
    } else {
      titulo = 'Editó una observación';
      detalle = (h.cambios.descripcion ? '' : cita) + listaCambios(h.cambios);
    }
  }
  return `
    <li>
      <div class="historial-meta">${formatoFechaHora(h.fecha)}${h.usuario ? ` · ${escapar(h.usuario)}` : ''}</div>
      <div class="historial-titulo">${titulo}</div>
      ${detalle}
    </li>`;
}

function listaCambios(cambios) {
  const filas = Object.entries(cambios).map(([campo, [antes, despues]]) => `
    <li><span class="campo">${escapar(ETIQUETAS[campo] ?? campo)}:</span>
      ${valorHistorial(campo, antes)} <span aria-label="cambió a">→</span> ${valorHistorial(campo, despues)}</li>`);
  return filas.length ? `<ul class="cambios">${filas.join('')}</ul>` : '';
}

function valorHistorial(campo, valor) {
  if (valor === null || valor === undefined || valor === '') return '<em class="texto-suave">vacío</em>';
  if (campo.startsWith('fecha_')) return formatoFecha(String(valor));
  return `<strong>${escapar(recortar(String(valor)))}</strong>`;
}

const recortar = (texto, max = 140) => (texto.length > max ? `${texto.slice(0, max - 1)}…` : texto);

// ---------------------------------------------------------------------
//  Exportación
// ---------------------------------------------------------------------

function exportarCSV() {
  const encabezados = [
    'Producto', 'Presentación', 'Tipo de validación', 'Código de protocolo', 'Código de informe',
    'Etapa', 'Estado', 'Prioridad', 'Responsable', 'Lotes ejecutados', 'Lotes requeridos', 'Números de lote',
    'Observaciones pendientes', 'Inicio', 'Aprobación del protocolo', 'Fecha objetivo', 'Cierre',
    'Próxima revalidación', 'Próxima acción', 'Enlace a documentos',
  ];
  const filas = ordenar(filtrar()).map((v) => [
    v.producto, v.presentacion, v.tipo_validacion, v.codigo_protocolo, v.codigo_informe,
    v.etapa, estaCerrada(v) ? 'Cerrada' : v.estado, v.prioridad, v.responsable,
    v.lotes_ejecutados, v.lotes_requeridos, v.lotes,
    pendientesDe(v.id).map((o) => o.descripcion + (o.fecha_compromiso ? ` (${formatoFecha(o.fecha_compromiso)})` : '')).join(' | '),
    formatoFecha(v.fecha_inicio), formatoFecha(v.fecha_aprobacion_protocolo), formatoFecha(v.fecha_objetivo),
    formatoFecha(v.fecha_cierre), formatoFecha(v.fecha_revalidacion), v.proxima_accion, v.enlace_documentos,
  ]);
  // Separador ";" y BOM: Excel en español lo abre directamente con acentos correctos.
  const csv = '﻿' + [encabezados, ...filas].map((fila) => fila.map(celdaCSV).join(';')).join('\r\n');
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  enlace.download = `seguimiento-validaciones-${hoyISO()}.csv`;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
}

function celdaCSV(valor) {
  let texto = String(valor ?? '');
  if (/^[=+@]/.test(texto)) texto = `'${texto}`;
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

// ---------------------------------------------------------------------
//  Avisos
// ---------------------------------------------------------------------

let temporizadorAviso;
function avisar(texto, tipo = 'ok') {
  const aviso = $('#aviso-flotante');
  // Con el panel abierto, el aviso tiene que vivir dentro del diálogo para verse por encima.
  const contenedor = panel.open ? panel : document.body;
  if (aviso.parentElement !== contenedor) contenedor.append(aviso);
  aviso.textContent = texto;
  aviso.className = `aviso-flotante aviso-${tipo}`;
  aviso.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { aviso.hidden = true; }, tipo === 'error' ? 7000 : 3500);
}

// ---------------------------------------------------------------------
//  Eventos
// ---------------------------------------------------------------------

function conectarEventos() {
  $('#form-login').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const form = evento.target;
    const error = $('#login-error');
    const boton = form.querySelector('[type=submit]');
    error.hidden = true;
    boton.disabled = true;
    try {
      await estado.store.iniciarSesion(form.elements.email.value.trim(), form.elements.password.value);
      form.reset();
      await cambiarUsuario(await estado.store.usuarioActual());
    } catch (e) {
      error.textContent = mensajeError(e);
      error.hidden = false;
    } finally {
      boton.disabled = false;
    }
  });

  $('#btn-salir').addEventListener('click', async () => {
    await estado.store.cerrarSesion();
    cambiarUsuario(null);
  });

  $('#btn-restablecer').addEventListener('click', () => {
    if (!confirm('¿Volver a los datos de ejemplo? Se pierden los cambios hechos en el modo demostración.')) return;
    estado.store.restablecer();
    recargar();
  });

  $('#btn-nueva').addEventListener('click', () => abrirPanel(null));
  $('#btn-exportar').addEventListener('click', exportarCSV);

  // Filtros
  const enlazarFiltro = (selector, filtro, evento = 'change', leer = (el) => el.value) => {
    $(selector).addEventListener(evento, (e) => {
      estado.filtros[filtro] = leer(e.target);
      renderKpis();
      renderEtapas();
      renderTabla();
    });
  };
  enlazarFiltro('#f-texto', 'texto', 'input');
  enlazarFiltro('#f-tipo', 'tipo');
  enlazarFiltro('#f-etapa', 'etapa');
  enlazarFiltro('#f-estado', 'estado');
  enlazarFiltro('#f-responsable', 'responsable');
  enlazarFiltro('#f-cerradas', 'cerradas', 'change', (el) => el.checked);

  $('#btn-limpiar').addEventListener('click', () => {
    estado.filtros = { texto: '', tipo: '', etapa: '', estado: '', responsable: '', cerradas: true, especial: '' };
    $('#f-texto').value = '';
    $('#f-cerradas').checked = true;
    renderizar();
  });

  $('#kpis').addEventListener('click', (e) => {
    const kpi = e.target.closest('[data-especial]');
    if (!kpi) return;
    const clave = kpi.dataset.especial;
    estado.filtros.especial = estado.filtros.especial === clave ? '' : clave;
    if (['cerradas', 'revalidacion'].includes(estado.filtros.especial) && !estado.filtros.cerradas) {
      estado.filtros.cerradas = true;
      $('#f-cerradas').checked = true;
    }
    renderKpis();
    renderTabla();
  });

  $('#etapas-flujo').addEventListener('click', (e) => {
    const paso = e.target.closest('[data-etapa]');
    if (!paso) return;
    estado.filtros.etapa = estado.filtros.etapa === paso.dataset.etapa ? '' : paso.dataset.etapa;
    $('#f-etapa').value = estado.filtros.etapa;
    renderEtapas();
    renderTabla();
  });

  document.querySelector('#tabla thead').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-orden]');
    if (!boton) return;
    const campo = boton.dataset.orden;
    estado.orden = { campo, sentido: estado.orden.campo === campo ? -estado.orden.sentido : 1 };
    renderTabla();
  });

  $('#tabla-cuerpo').addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const fila = e.target.closest('tr[data-id]');
    if (!fila) return;
    abrirPanel(fila.dataset.id, e.target.closest('[data-abrir]')?.dataset.abrir ?? 'datos');
  });

  // Panel
  $('#btn-cerrar-panel').addEventListener('click', cerrarPanel);
  $('#btn-cancelar').addEventListener('click', cerrarPanel);
  $('#btn-eliminar').addEventListener('click', eliminarValidacion);
  panel.addEventListener('cancel', (e) => {
    e.preventDefault();
    cerrarPanel();
  });
  panel.addEventListener('click', (e) => {
    if (e.target === panel) cerrarPanel();   // clic en el fondo oscurecido
  });
  $('#pestanas').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-pestana]');
    if (boton) mostrarPestana(boton.dataset.pestana);
  });
  formulario.addEventListener('submit', guardarValidacion);
  formulario.elements.etapa.addEventListener('change', () => {
    if (formulario.elements.etapa.value === etapaFinal() && !formulario.elements.fecha_cierre.value) {
      formulario.elements.fecha_cierre.value = hoyISO();
    }
  });

  $('#form-observacion').addEventListener('submit', agregarObservacion);
  $('#obs-lista').addEventListener('click', accionObservacion);
  $('#obs-lista').addEventListener('submit', editarObservacion);

  window.addEventListener('beforeunload', (e) => {
    if (hayCambiosSinGuardar()) e.preventDefault();
  });
}

iniciar();
