export type Tratamiento = {
  id_tratamiento: number;
  nombre: string;
  descripcion: string;
  duracion_dias: number;
  imagen: number;
};

export type Cuidado = {
  id_cuidado: number;
  titulo: string;
  instruccion: string;
  hecho: 0 | 1 | boolean;
};

export type PlanPaciente = {
  id_plan: number;
  tratamiento: string;
  fecha_procedimiento: string;
  dia_actual: number;
  plan_dias: number;
  etapa: string | null;
};

export type Paciente = {
  id_paciente: number;
  nombre: string;
  idioma: string;
  hora_recordatorio_1: string;
  hora_recordatorio_2: string;
  notif_importantes: boolean | 0 | 1;
};

export type FotoPaciente = {
  id: string;
  id_plan: number;
  fecha: string;
};

// Este dato solo conserva el saludo del chat de prototipo, que queda fuera de esta integración.
export const pacienteDemo: Paciente = {
  id_paciente: 1,
  nombre: "Mariana",
  idioma: "es",
  hora_recordatorio_1: "09:00:00",
  hora_recordatorio_2: "20:00:00",
  notif_importantes: true,
};
