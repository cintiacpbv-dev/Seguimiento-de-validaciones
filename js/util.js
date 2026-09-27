// Utilidades de fechas y texto. Las fechas se manejan como 'AAAA-MM-DD'
// en horario local para evitar corrimientos por zona horaria.

const MS_POR_DIA = 86_400_000;

export function hoyISO() {
  return aISO(new Date());
}

export function sumarDias(fechaISO, dias) {
  const fecha = aFecha(fechaISO);
  fecha.setDate(fecha.getDate() + dias);
  return aISO(fecha);
}

export function diasHasta(fechaISO) {
  if (!fechaISO) return null;
  return Math.round((aFecha(fechaISO) - aFecha(hoyISO())) / MS_POR_DIA);
}

export function formatoFecha(fechaISO) {
  if (!fechaISO) return '';
  const [anio, mes, dia] = fechaISO.slice(0, 10).split('-');
  return `${dia}/${mes}/${anio}`;
}

export function formatoFechaHora(marcaISO) {
  if (!marcaISO) return '';
  return new Date(marcaISO).toLocaleString('es', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function plural(n, singular, pluralTexto = `${singular}s`) {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}

export function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function aFecha(fechaISO) {
  const [anio, mes, dia] = fechaISO.slice(0, 10).split('-').map(Number);
  return new Date(anio, mes - 1, dia);
}

function aISO(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}
