export class RequestTimeout extends Error {
  constructor() {
    super("A conexão demorou demais. Tente novamente.");
    this.name = "TimeoutError";
  }
}

// One deadline covers headers AND body. Never automatically replay a write.
export function createTimedFetch({
  timeoutMs = 15000,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const external =
      init.signal ||
      (typeof Request !== "undefined" && input instanceof Request
        ? input.signal
        : null);
    const abort = () => controller.abort(external?.reason);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    if (external?.aborted) abort();
    else external?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetchImpl(input, {
        ...init,
        signal: controller.signal,
      });
      const body = await response.arrayBuffer();
      return new Response(
        [101, 204, 205, 304].includes(response.status) ? null : body,
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        },
      );
    } catch (error) {
      if (timedOut) throw new RequestTimeout();
      throw error;
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", abort);
    }
  };
}

export function withDeadline(promise, milliseconds = 20000) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new RequestTimeout()), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function errorMessage(error) {
  const message = String(error?.message || "");
  const code = error?.code;
  if (["40001", "40P01", "55P03"].includes(code))
    return "A agenda mudou durante a confirmação. Atualize os horários e tente novamente.";
  if (/exclusion|23P01|overlap/i.test(message) || code === "23P01")
    return "Esse horário acabou de ser ocupado. Escolha outro horário.";
  if (/duplicate key|23505/i.test(message) || code === "23505")
    return "Esse link ou cadastro já está em uso.";
  if (/Invalid login credentials/i.test(message))
    return "E-mail ou senha incorretos.";
  if (/Email not confirmed/i.test(message))
    return "Confirme seu e-mail antes de entrar.";
  if (
    /expired|invalid.*token|refresh_token_not_found|session_not_found/i.test(
      message + " " + code,
    )
  )
    return "Sua sessão ou link expirou. Entre novamente ou solicite um novo link.";
  if (/weak_password|same_password/i.test(code || ""))
    return "Escolha uma senha nova e mais forte, com pelo menos 8 caracteres.";
  if (/rate.limit|too.many/i.test(message) || error?.status === 429)
    return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  if (
    /fetch|network|timeout|abort|connection|conexão|connect/i.test(
      message + " " + error?.name,
    )
  )
    return "Erro de conexão. Confira sua internet e tente novamente. Se estava salvando, atualize antes de repetir.";
  if (/permission denied|row.level|42501|jwt/i.test(message + " " + code))
    return "Não foi possível autorizar a operação. Entre novamente na sua conta.";
  // Business errors written in Portuguese are safe to show; internal SQL/HTML is not.
  if (
    (code === "P0001" || !code) &&
    /[áàãâéêíóôõúç]|^(Escolha|Informe|Entre|Esse|Essa|Este|Esta|Use|Aguarde|Seu|Sua|O |A )/.test(
      message,
    ) &&
    !/[<>]|\b(select|insert|relation|column|constraint)\b/i.test(message)
  )
    return message.slice(0, 240);
  return "Não foi possível concluir agora. Tente novamente em instantes.";
}
