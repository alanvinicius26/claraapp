import { today } from "./domain";
const d = today();
export const demoStudio = {
  id: "demo",
  name: "Studio Juliana Silva",
  professional: "Juliana",
  slug: "studio-juliana",
  bio: "Um momento de cuidado, pensado só para você.",
  address: "Vila Mariana, São Paulo",
  phone: "",
  active: true,
  min_notice: 120,
  horizon: 30,
  buffer: 15,
};
export const demoServices = [
  {
    id: "s1",
    name: "Manicure clássica",
    category: "Unhas & cuidados",
    price: 45,
    duration: 45,
    description:
      "Cuidado delicado, cutilagem e esmaltação com o seu tom favorito.",
    active: true,
  },
  {
    id: "s2",
    name: "Alongamento em gel",
    category: "Unhas & cuidados",
    price: 130,
    duration: 90,
    description:
      "Estrutura, resistência e um acabamento natural em cada detalhe.",
    active: true,
  },
  {
    id: "s3",
    name: "Design de sobrancelhas",
    category: "Olhar & beleza",
    price: 60,
    duration: 30,
    description: "Um desenho personalizado que valoriza a sua expressão.",
    active: true,
  },
  {
    id: "s4",
    name: "Spa dos pés",
    category: "Bem-estar & spa",
    price: 85,
    duration: 60,
    description: "Esfoliação, hidratação e uma pausa para renovar as energias.",
    allows_parallel: true,
    parallel_limit: 2,
    active: true,
  },
];
export const demoProfessionals = [
  { id: "demo-primary", name: "Juliana", active: true, is_default: true, accepts_parallel: true, parallel_online: false },
  { id: "demo-second", name: "Renata", active: true, is_default: false },
];
export const demoClients = [
  "Mariana Souza",
  "Camila Duarte",
  "Beatriz Ferreira",
  "Fernanda Lima",
  "Larissa Ramos",
].map((name, i) => ({
  id: "c" + i,
  name,
  email: "",
  phone: "",
  notes: i === 2 ? "Prefere formato amendoado e tons naturais." : "",
  created_at: new Date().toISOString(),
}));
export const demoAppointments = [
  ["09:00", 0, 0, "completed"],
  ["10:00", 1, 2, "completed"],
  ["11:00", 2, 1, "confirmed"],
  ["14:00", 3, 0, "confirmed"],
  ["15:00", 4, 3, "confirmed"],
  // Encaixe: Juliana serves a second Spa dos pés together with the 15:00 one.
  ["15:15", 1, 3, "confirmed", 0],
].map(([t, c, s, status, professional], i) => ({
  id: "a" + i,
  studio_id: "demo",
  professional_id: demoProfessionals[professional ?? i % 2].id,
  client_id: "c" + c,
  service_id: demoServices[s].id,
  service_name: demoServices[s].name,
  starts_at: `${d}T${t}:00-03:00`,
  ends_at: new Date(
    new Date(`${d}T${t}:00-03:00`).getTime() + demoServices[s].duration * 60000,
  ).toISOString(),
  price: demoServices[s].price,
  status,
  notes: "",
  clients: demoClients[c],
}));
export const demoPayments = demoAppointments.slice(0, 2).map((a, i) => ({
  id: "p" + i,
  appointment_id: a.id,
  amount: a.price,
  method: i ? "Dinheiro" : "Pix",
}));
