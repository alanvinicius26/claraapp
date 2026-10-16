import { today, shiftDate } from "./domain";
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
  change_notice_hours: 2,
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
  {
    id: "s5",
    name: "Escova modelada",
    category: "Cabelo & estilo",
    price: 70,
    duration: 50,
    description: "Movimento, brilho e um acabamento que dura a semana toda.",
    active: true,
  },
  {
    id: "s6",
    name: "Maquiagem social",
    category: "Maquiagem & produção",
    price: 160,
    duration: 60,
    description: "Pele iluminada e olhar marcante para o seu grande momento.",
    active: true,
  },
];
export const demoProfessionals = [
  { id: "demo-primary", name: "Juliana", active: true, is_default: true, accepts_parallel: true, parallel_online: false },
  { id: "demo-second", name: "Renata", active: true, is_default: false },
];
// Fictitious contacts in the unassigned 90000-0xxx range.
export const demoClients = [
  "Mariana Souza",
  "Camila Duarte",
  "Beatriz Ferreira",
  "Fernanda Lima",
  "Larissa Ramos",
  "Aline Costa",
  "Bruna Nogueira",
  "Carolina Mendes",
  "Daniela Rocha",
  "Gabriela Pires",
  "Isabela Martins",
  "Letícia Andrade",
].map((name, i) => ({
  id: "c" + i,
  name,
  email: "",
  phone: `(11) 90000-0${String(101 + i * 7).padStart(3, "0")}`,
  notes: i === 2 ? "Prefere formato amendoado e tons naturais." : "",
  created_at: new Date(Date.now() - (120 - i * 9) * 86400000).toISOString(),
}));
// Same person booked online with another name variant: shows duplicate detection.
demoClients.push({
  id: "c12",
  name: "Mariana S.",
  email: "mariana@exemplo.invalid",
  phone: "11900000101",
  notes: "",
  created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
});
const appointment = (id, date, t, c, s, status, professional, source = "studio") => ({
  id,
  studio_id: "demo",
  professional_id: demoProfessionals[professional].id,
  client_id: "c" + c,
  service_id: demoServices[s].id,
  service_name: demoServices[s].name,
  starts_at: `${date}T${t}:00-03:00`,
  ends_at: new Date(
    new Date(`${date}T${t}:00-03:00`).getTime() + demoServices[s].duration * 60000,
  ).toISOString(),
  price: demoServices[s].price,
  status,
  source,
  notes: "",
  clients: demoClients[c],
});
const todays = [
  ["09:00", 0, 0, "completed"],
  ["10:00", 1, 2, "completed"],
  ["11:00", 2, 1, "confirmed"],
  ["14:00", 3, 0, "confirmed"],
  ["15:00", 4, 3, "confirmed"],
  // Encaixe: Juliana serves a second Spa dos pés together with the 15:00 one.
  ["15:15", 1, 3, "confirmed", 0],
].map(([t, c, s, status, professional], i) =>
  appointment("a" + i, d, t, c, s, status, professional ?? i % 2),
);
// Deterministic history and upcoming days so the demo always tells the
// same story: a busy studio with returning clients and online bookings.
let seed = 3;
const rand = (n) => {
  seed = (seed * 9301 + 49297) % 233280;
  return Math.floor((seed / 233280) * n);
};
const slots = ["09:00", "10:00", "11:00", "13:30", "14:30", "16:00", "17:00"];
const spread = [];
for (let offset = -27; offset <= 6; offset++) {
  if (!offset) continue;
  const date = shiftDate(d, offset);
  if (new Date(date + "T12:00:00Z").getUTCDay() === 0) continue;
  // Gentle growth over the month keeps the demo trend realistic.
  const total = offset < 0 ? 2 + rand(3) + Math.round((offset + 27) / 13) : 2 + rand(3);
  const start = rand(2);
  for (let k = 0; k < total; k++) {
    const status = offset < 0 ? (rand(14) === 0 ? "cancelled" : "completed") : "confirmed";
    spread.push(
      appointment(
        `h${offset}-${k}`,
        date,
        slots[start + k],
        rand(10) + (rand(8) === 0 ? 2 : 0),
        rand(demoServices.length),
        status,
        k % 2,
        rand(3) === 0 ? "online" : "studio",
      ),
    );
  }
}
export const demoAppointments = [...todays, ...spread];
const methods = ["Pix", "Pix", "Cartão", "Dinheiro"];
export const demoPayments = [
  ...todays.slice(0, 2).map((a, i) => ({
    id: "p" + i,
    appointment_id: a.id,
    amount: a.price,
    method: i ? "Dinheiro" : "Pix",
  })),
  ...spread
    .filter((a) => a.status === "completed")
    .map((a, i) => ({
      id: "ph" + i,
      appointment_id: a.id,
      amount: a.price,
      method: methods[i % methods.length],
    })),
];
