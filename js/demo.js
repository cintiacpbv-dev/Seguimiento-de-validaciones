// Datos para el modo demostración (cuando Supabase no está configurado).
// Son ilustrativos: códigos, lotes y observaciones son inventados.

import { hoyISO, sumarDias } from './util.js';

// Mismas etapas que carga supabase/schema.sql.
export const ETAPAS = [
  { orden: 1, nombre: 'Planificación', descripcion: 'Alcance, recursos y cronograma definidos' },
  { orden: 2, nombre: 'Protocolo en elaboración', descripcion: 'Redacción del protocolo' },
  { orden: 3, nombre: 'Protocolo en revisión', descripcion: 'Revisión por Garantía de Calidad / áreas involucradas' },
  { orden: 4, nombre: 'Protocolo aprobado', descripcion: 'Protocolo firmado, listo para ejecutar' },
  { orden: 5, nombre: 'Ejecución', descripcion: 'Fabricación, muestreo y ensayos de los lotes' },
  { orden: 6, nombre: 'Análisis de resultados', descripcion: 'Evaluación estadística y de criterios de aceptación' },
  { orden: 7, nombre: 'Informe en elaboración', descripcion: 'Redacción del informe final' },
  { orden: 8, nombre: 'Informe en revisión', descripcion: 'Revisión del informe por Garantía de Calidad' },
  { orden: 9, nombre: 'Cerrada', descripcion: 'Informe aprobado, validación concluida' },
];

export function crearDatosDemo() {
  const hoy = hoyISO();
  const d = (dias) => sumarDias(hoy, dias);
  const creada = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const base = {
    presentacion: null, codigo_informe: null, estado: 'En curso', prioridad: 'Media',
    responsable: null, lotes_requeridos: 3, lotes_ejecutados: 0, lotes: null,
    fecha_inicio: null, fecha_aprobacion_protocolo: null, fecha_objetivo: null,
    fecha_cierre: null, fecha_revalidacion: null, proxima_accion: null,
    enlace_documentos: null, notas: null,
    created_at: creada, updated_at: creada, updated_by: 'demo@ejemplo.com',
  };

  const validaciones = [
    {
      ...base, id: 'demo-doloral-proceso', producto: 'Doloral', presentacion: 'Comprimidos recubiertos',
      tipo_validacion: 'Proceso', codigo_protocolo: 'PV-DOL-001', etapa: 'Ejecución', prioridad: 'Alta',
      responsable: 'M. Gómez', lotes_ejecutados: 2, lotes: 'D24051, D24052',
      fecha_inicio: d(-95), fecha_aprobacion_protocolo: d(-60), fecha_objetivo: d(25),
      proxima_accion: 'Fabricar el tercer lote de validación',
    },
    {
      ...base, id: 'demo-doloral-limpieza', producto: 'Doloral', presentacion: 'Comprimidos recubiertos',
      tipo_validacion: 'Limpieza', codigo_protocolo: 'VL-DOL-001', etapa: 'Planificación',
      responsable: 'L. Benítez', fecha_objetivo: d(150), proxima_accion: 'Definir el peor caso de limpieza',
    },
    {
      ...base, id: 'demo-prostasil-proceso', producto: 'Prostasil', presentacion: 'Cápsulas blandas',
      tipo_validacion: 'Proceso', codigo_protocolo: 'PV-PRS-002', etapa: 'Protocolo en revisión',
      responsable: 'A. Rojas', fecha_inicio: d(-30), fecha_objetivo: d(70),
      proxima_accion: 'Incorporar comentarios de Garantía de Calidad',
    },
    {
      ...base, id: 'demo-soluna-limpieza', producto: 'Soluna', presentacion: 'Solución oral',
      tipo_validacion: 'Limpieza', codigo_protocolo: 'VL-SOL-001', etapa: 'Informe en elaboración', prioridad: 'Alta',
      responsable: 'M. Gómez', lotes_ejecutados: 3, lotes: 'S24110, S24111, S24112',
      fecha_inicio: d(-140), fecha_aprobacion_protocolo: d(-110), fecha_objetivo: d(-8),
      proxima_accion: 'Enviar borrador del informe a revisión',
    },
    {
      ...base, id: 'demo-sitiderm-proceso', producto: 'Sitiderm', presentacion: 'Crema',
      tipo_validacion: 'Proceso', codigo_protocolo: 'PV-SIT-001', etapa: 'Análisis de resultados', estado: 'En espera',
      responsable: 'C. Duarte', lotes_ejecutados: 3, lotes: 'T2401, T2402, T2403',
      fecha_inicio: d(-120), fecha_aprobacion_protocolo: d(-90), fecha_objetivo: d(10),
      proxima_accion: 'Esperar el cierre de la investigación de viscosidad',
    },
    {
      ...base, id: 'demo-fluixx-metodo', producto: 'Fluixx', presentacion: 'Suspensión oral',
      tipo_validacion: 'Método analítico', codigo_protocolo: 'VM-FLX-001', codigo_informe: 'IVM-FLX-001',
      etapa: 'Cerrada', prioridad: 'Baja', responsable: 'A. Rojas', lotes_requeridos: 0,
      fecha_inicio: d(-200), fecha_aprobacion_protocolo: d(-170), fecha_objetivo: d(-45),
      fecha_cierre: d(-40), fecha_revalidacion: d(50),
    },
    {
      ...base, id: 'demo-nistazinc-proceso', producto: 'Nistazinc', presentacion: 'Pomada',
      tipo_validacion: 'Proceso', codigo_protocolo: 'PV-NTZ-001', etapa: 'Protocolo en elaboración', prioridad: 'Baja',
      responsable: 'C. Duarte', fecha_inicio: d(-10), fecha_objetivo: d(120),
      proxima_accion: 'Completar la matriz de parámetros críticos',
    },
  ];

  const obs = (id, validacion_id, descripcion, extra = {}) => ({
    id, validacion_id, descripcion, responsable: null, fecha_registro: d(-12),
    fecha_compromiso: null, estado: 'Abierta', fecha_cierre: null,
    created_at: creada, updated_at: creada, updated_by: 'demo@ejemplo.com', ...extra,
  });

  const observaciones = [
    obs('demo-obs-1', 'demo-doloral-proceso', 'Completar el registro de temperatura de secado del lote D24052',
      { responsable: 'Producción', fecha_compromiso: d(5) }),
    obs('demo-obs-2', 'demo-doloral-proceso', 'Adjuntar el certificado de calibración de la balanza B-03',
      { responsable: 'Mantenimiento', fecha_compromiso: d(-3) }),
    obs('demo-obs-3', 'demo-prostasil-proceso', 'Definir el criterio de aceptación para uniformidad de contenido',
      { responsable: 'A. Rojas', fecha_compromiso: d(14) }),
    obs('demo-obs-4', 'demo-sitiderm-proceso', 'Investigar resultado fuera de tendencia en viscosidad (lote T2403)',
      { responsable: 'Control de Calidad', fecha_compromiso: d(7) }),
    obs('demo-obs-5', 'demo-soluna-limpieza', 'Corregir la numeración de anexos del protocolo',
      { estado: 'Cerrada', fecha_cierre: d(-20), fecha_registro: d(-60) }),
  ];

  const historial = validaciones.map((v) => ({
    id: `demo-hist-${v.id}`, validacion_id: v.id, tabla: 'validaciones', registro_id: v.id,
    accion: 'alta', cambios: {}, usuario: 'demo@ejemplo.com', fecha: creada,
  }));

  return { validaciones, observaciones, historial };
}
