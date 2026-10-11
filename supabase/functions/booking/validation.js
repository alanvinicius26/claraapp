// PostgreSQL accepts offset-less timestamptz using its session zone. The public
// contract intentionally requires an explicit offset or Z, with a real date.
export function validStart(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const day = value.slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day
    && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60
    && Number(value.slice(17, 19)) < 60 && Number.isFinite(Date.parse(value));
}

export function bookingError(error) {
  const code = error?.code;
  if (code === "23P01") return { status: 409, code, message: "Esse horário acabou de ser ocupado para a profissional, sala ou maca. Escolha outro horário." };
  if (["40001", "40P01", "55P03"].includes(code)) return { status: 409, code, message: "A agenda mudou durante a confirmação. Atualize os horários e tente novamente." };
  if (code === "P0001") return {
    status: /não cabe|não está mais disponível|expediente|acabou de ser ocupado|sem cobertura|sala ou maca necessária/i.test(error.message) ? 409 : 400,
    code, message: error.message,
  };
  return { status: 400, message: "Não foi possível concluir. Confira os dados e tente novamente." };
}
