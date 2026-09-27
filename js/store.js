// Acceso a datos. Dos implementaciones con la misma interfaz:
//  - SupabaseStore: datos compartidos en Supabase (requiere iniciar sesión).
//  - DemoStore: datos de ejemplo guardados solo en este navegador.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { ETAPAS, crearDatosDemo } from './demo.js';
import { hoyISO } from './util.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';

export class ConflictoError extends Error {
  constructor() {
    super('Otra persona modificó o eliminó esta validación mientras la editabas.');
    this.name = 'ConflictoError';
  }
}

export async function crearStore() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const { createClient } = await import(SUPABASE_JS);
    return new SupabaseStore(createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  }
  return new DemoStore();
}

export function mensajeError(error) {
  const texto = error?.message ?? String(error);
  if (/invalid login credentials/i.test(texto)) return 'Email o contraseña incorrectos.';
  if (/email not confirmed/i.test(texto)) return 'El email todavía no fue confirmado.';
  if (/failed to fetch|networkerror|load failed/i.test(texto)) return 'No se pudo conectar con Supabase. Revisá la conexión a internet.';
  if (/jwt expired/i.test(texto)) return 'La sesión expiró. Volvé a iniciar sesión.';
  if (/row-level security|permission denied/i.test(texto)) return 'No tenés permiso para realizar esta acción.';
  return texto;
}

class SupabaseStore {
  modo = 'supabase';

  constructor(cliente) {
    this.db = cliente;
  }

  async usuarioActual() {
    const { data } = await this.db.auth.getSession();
    return data.session?.user ?? null;
  }

  alCambiarSesion(callback) {
    this.db.auth.onAuthStateChange((_evento, sesion) => callback(sesion?.user ?? null));
  }

  async iniciarSesion(email, password) {
    const { error } = await this.db.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async cerrarSesion() {
    this.canal?.unsubscribe();
    this.canal = null;
    await this.db.auth.signOut();
  }

  async cargar() {
    const [etapas, validaciones, observaciones] = await Promise.all([
      this.db.from('etapas').select('*').order('orden'),
      this.db.from('validaciones').select('*').order('producto'),
      this.db.from('observaciones').select('*').order('fecha_registro').order('created_at'),
    ]);
    for (const respuesta of [etapas, validaciones, observaciones]) {
      if (respuesta.error) throw respuesta.error;
    }
    return { etapas: etapas.data, validaciones: validaciones.data, observaciones: observaciones.data };
  }

  // `version` es el updated_at que tenía el registro al abrirlo: si cambió
  // desde entonces, el update no afecta ninguna fila y se avisa del conflicto.
  async guardarValidacion(datos, version) {
    if (!datos.id) {
      const { data, error } = await this.db.from('validaciones').insert(datos).select().single();
      if (error) throw error;
      return data;
    }
    const { id, ...cambios } = datos;
    const { data, error } = await this.db
      .from('validaciones').update(cambios).eq('id', id).eq('updated_at', version).select();
    if (error) throw error;
    if (data.length === 0) throw new ConflictoError();
    return data[0];
  }

  async eliminarValidacion(id) {
    const { error } = await this.db.from('validaciones').delete().eq('id', id);
    if (error) throw error;
  }

  async guardarObservacion(datos) {
    const { id, ...cambios } = datos;
    const consulta = id
      ? this.db.from('observaciones').update(cambios).eq('id', id)
      : this.db.from('observaciones').insert(cambios);
    const { data, error } = await consulta.select().single();
    if (error) throw error;
    return data;
  }

  async eliminarObservacion(id) {
    const { error } = await this.db.from('observaciones').delete().eq('id', id);
    if (error) throw error;
  }

  async historial(validacionId) {
    const { data, error } = await this.db
      .from('historial').select('*').eq('validacion_id', validacionId)
      .order('fecha', { ascending: false }).limit(200);
    if (error) throw error;
    return data;
  }

  suscribir(alCambiar) {
    this.canal?.unsubscribe();
    this.canal = this.db.channel('cambios-validaciones')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'validaciones' }, alCambiar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'observaciones' }, alCambiar)
      .subscribe();
  }
}

const CLAVE_DEMO = 'seguimiento-validaciones:demo:v1';
const USUARIO_DEMO = { email: 'demo@ejemplo.com' };

class DemoStore {
  modo = 'demo';

  constructor() {
    this.datos = this.#leer() ?? crearDatosDemo();
  }

  async usuarioActual() { return USUARIO_DEMO; }
  alCambiarSesion() {}
  async iniciarSesion() {}
  async cerrarSesion() {}
  suscribir() {}

  restablecer() {
    this.datos = crearDatosDemo();
    this.#escribir();
  }

  async cargar() {
    const copia = structuredClone(this.datos);
    return {
      etapas: ETAPAS,
      validaciones: copia.validaciones.sort((a, b) => a.producto.localeCompare(b.producto, 'es')),
      observaciones: copia.observaciones,
    };
  }

  async guardarValidacion(datos, version) {
    const lista = this.datos.validaciones;
    if (!datos.id) {
      const nueva = { ...datos, id: crypto.randomUUID(), created_at: ahoraISO() };
      this.#marcar(nueva);
      lista.push(nueva);
      this.#registrar('validaciones', 'alta', nueva, sinNulos(nueva));
      this.#escribir();
      return structuredClone(nueva);
    }
    const actual = lista.find((v) => v.id === datos.id);
    if (!actual || actual.updated_at !== version) throw new ConflictoError();
    const cambios = diferencias(actual, { ...actual, ...datos });
    Object.assign(actual, datos);
    this.#marcar(actual);
    if (Object.keys(cambios).length) this.#registrar('validaciones', 'modificación', actual, cambios);
    this.#escribir();
    return structuredClone(actual);
  }

  async eliminarValidacion(id) {
    const actual = this.datos.validaciones.find((v) => v.id === id);
    if (!actual) return;
    this.datos.validaciones = this.datos.validaciones.filter((v) => v.id !== id);
    this.datos.observaciones = this.datos.observaciones.filter((o) => o.validacion_id !== id);
    this.#registrar('validaciones', 'baja', actual, sinNulos(actual));
    this.#escribir();
  }

  async guardarObservacion(datos) {
    const lista = this.datos.observaciones;
    const actual = datos.id ? lista.find((o) => o.id === datos.id) : null;
    const resultado = actual
      ? { ...actual, ...datos }
      : { fecha_registro: hoyISO(), estado: 'Abierta', ...datos, id: crypto.randomUUID(), created_at: ahoraISO() };
    // Igual que el trigger de la base: fecha de cierre automática.
    if (resultado.estado === 'Cerrada' && !resultado.fecha_cierre) resultado.fecha_cierre = hoyISO();
    if (resultado.estado === 'Abierta') resultado.fecha_cierre = null;
    this.#marcar(resultado);

    if (actual) {
      const cambios = diferencias(actual, resultado);
      Object.assign(actual, resultado);
      if (Object.keys(cambios).length) this.#registrar('observaciones', 'modificación', actual, cambios);
    } else {
      lista.push(resultado);
      this.#registrar('observaciones', 'alta', resultado, sinNulos(resultado));
    }
    this.#escribir();
    return structuredClone(resultado);
  }

  async eliminarObservacion(id) {
    const actual = this.datos.observaciones.find((o) => o.id === id);
    if (!actual) return;
    this.datos.observaciones = this.datos.observaciones.filter((o) => o.id !== id);
    this.#registrar('observaciones', 'baja', actual, sinNulos(actual));
    this.#escribir();
  }

  async historial(validacionId) {
    return this.datos.historial
      .filter((h) => h.validacion_id === validacionId)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }

  #marcar(registro) {
    registro.updated_at = ahoraISO();
    registro.updated_by = USUARIO_DEMO.email;
  }

  #registrar(tabla, accion, registro, cambios) {
    for (const campo of ['id', 'validacion_id', 'created_at', 'updated_at', 'updated_by']) delete cambios[campo];
    this.datos.historial.push({
      id: crypto.randomUUID(),
      validacion_id: tabla === 'validaciones' ? registro.id : registro.validacion_id,
      tabla,
      registro_id: registro.id,
      accion,
      cambios,
      usuario: USUARIO_DEMO.email,
      fecha: ahoraISO(),
    });
  }

  #leer() {
    try {
      const guardado = localStorage.getItem(CLAVE_DEMO);
      return guardado ? JSON.parse(guardado) : null;
    } catch {
      return null;
    }
  }

  #escribir() {
    try {
      localStorage.setItem(CLAVE_DEMO, JSON.stringify(this.datos));
    } catch {
      // Sin almacenamiento disponible: los cambios duran hasta recargar la página.
    }
  }
}

function diferencias(antes, despues) {
  const cambios = {};
  for (const campo of Object.keys(despues)) {
    if (['updated_at', 'updated_by', 'created_at'].includes(campo)) continue;
    if ((antes[campo] ?? null) !== (despues[campo] ?? null)) {
      cambios[campo] = [antes[campo] ?? null, despues[campo] ?? null];
    }
  }
  return cambios;
}

function sinNulos(registro) {
  return Object.fromEntries(Object.entries(registro).filter(([, valor]) => valor !== null && valor !== ''));
}

function ahoraISO() {
  return new Date().toISOString();
}
