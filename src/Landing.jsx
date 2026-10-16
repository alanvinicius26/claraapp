import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  Check,
  Clock3,
  Globe,
  HeartHandshake,
  LockKeyhole,
  Menu,
  MessageCircle,
  QrCode,
  Repeat2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { BrandLogo, BrandMark } from "./Brand";
import ClaraArt from "./ClaraArt";
import { PLANS, formatAmount } from "./billing";
import "./landing.css";

const segments = [
  "Manicure e nail designer",
  "Cabeleireira",
  "Maquiadora",
  "Designer de sobrancelhas",
  "Lash designer",
  "Esteticista",
  "Podóloga",
  "Depiladora",
];

const features = [
  [
    CalendarCheck,
    "Agenda sem conflitos",
    "Cada horário respeita expediente, almoço e intervalo de limpeza. Duas clientes nunca caem no mesmo horário, a não ser que você libere um encaixe.",
  ],
  [
    Globe,
    "Seu link de reservas 24h",
    "Coloque na bio do Instagram ou mande no WhatsApp. A cliente escolhe o serviço, vê só horários livres e confirma sozinha.",
  ],
  [
    HeartHandshake,
    "Ficha de cada cliente",
    "Histórico de atendimentos, preferências, observações internas e o WhatsApp a um toque. Atendimento de quem lembra de tudo.",
  ],
  [
    Users,
    "Equipe com agendas próprias",
    "Até cinco profissionais, cada uma com seu expediente. A cliente escolhe com quem quer ser atendida.",
  ],
  [
    Wallet,
    "Recebimentos sob controle",
    "Pix, cartão ou dinheiro: veja o que já entrou, o que falta receber e exporte o mês em planilha.",
  ],
  [
    Sparkles,
    "Clara, sua assistente",
    "Pergunte quem você atende amanhã, peça para remarcar uma cliente ou tire dúvidas sobre o sistema. Ela responde na hora.",
  ],
];

const steps = [
  ["01", "Crie seu espaço", "Cadastre seus serviços, valores e o seu expediente. Leva poucos minutos."],
  ["02", "Compartilhe seu link", "Na bio, no WhatsApp ou com o QR Code impresso no balcão."],
  ["03", "Atenda com tranquilidade", "As reservas entram na sua agenda. Você cuida, a Clara organiza o resto."],
];

const faq = [
  ["Preciso de cartão de crédito para testar?", "Não. Você usa a Clara completa por sete dias sem cadastrar cartão. A mensalidade só começa se você decidir contratar."],
  ["Minhas clientes precisam baixar algum aplicativo?", "Não. Elas reservam pelo seu link, direto no navegador do celular, e recebem um link próprio para remarcar ou cancelar."],
  ["Funciona no celular?", "Sim. A Clara foi desenhada para o dia a dia no celular, entre um atendimento e outro, e também funciona no computador."],
  ["Posso trocar de plano ou cancelar?", "Sim. Os planos são mensais e sem fidelidade. Você ajusta o plano conforme a equipe cresce e cancela quando quiser."],
  ["Meus dados e os das minhas clientes ficam seguros?", "Sim. Cada conta acessa apenas os próprios dados, com conexão criptografada. Pagamentos de assinatura são processados pela Stripe."],
];

function AgendaMock() {
  const rows = [
    ["09:00", "Mariana S.", "Manicure clássica", "done"],
    ["10:30", "Camila D.", "Design de sobrancelhas", "done"],
    ["13:30", "Beatriz F.", "Alongamento em gel", "now"],
    ["15:00", "Larissa R.", "Escova modelada", "next"],
  ];
  return (
    <div className="lp-mock" aria-hidden="true">
      <div className="lp-mock-bar">
        <span />
        <span />
        <span />
        <em>minhaclara.com</em>
      </div>
      <div className="lp-mock-body">
        <div className="lp-mock-head">
          <div>
            <small>Hoje</small>
            <strong>Bom dia, Juliana.</strong>
          </div>
          <span className="lp-mock-chip">6 atendimentos</span>
        </div>
        <div className="lp-mock-stats">
          <div>
            <small>Recebido</small>
            <strong>R$ 385</strong>
          </div>
          <div>
            <small>A receber</small>
            <strong>R$ 420</strong>
          </div>
          <div>
            <small>Online</small>
            <strong>3 reservas</strong>
          </div>
        </div>
        <ul className="lp-mock-list">
          {rows.map(([t, n, s, state]) => (
            <li key={t} className={state}>
              <b>{t}</b>
              <span>
                {n}
                <small>{s}</small>
              </span>
              <i>{state === "done" ? "Concluído" : state === "now" ? "Agora" : "Confirmado"}</i>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function Landing() {
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const go = (id) => (e) => {
    e.preventDefault();
    setMenu(false);
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };
  const links = [
    ["recursos", "Recursos"],
    ["como-funciona", "Como funciona"],
    ["planos", "Planos"],
    ["duvidas", "Dúvidas"],
  ];
  return (
    <div className="landing">
      <header className={`lp-nav ${scrolled ? "is-scrolled" : ""}`}>
        <div className="lp-wrap lp-nav-inner">
          <a className="brand" href="#/" aria-label="Clara — início">
            <BrandLogo />
          </a>
          <nav className={menu ? "is-open" : ""} aria-label="Seções da página">
            {links.map(([id, label]) => (
              <a key={id} href={`#/`} onClick={go(id)}>
                {label}
              </a>
            ))}
            <a className="lp-nav-login" href="#/entrar">
              Entrar
            </a>
          </nav>
          <div className="lp-nav-cta">
            <a className="lp-link-login" href="#/entrar">
              Entrar
            </a>
            <a className="button primary" href="#/cadastro">
              Começar grátis
            </a>
            <button
              className="lp-menu"
              aria-label={menu ? "Fechar menu" : "Abrir menu"}
              aria-expanded={menu}
              onClick={() => setMenu((v) => !v)}
            >
              {menu ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-copy">
              <span className="lp-kicker">
                <Sparkles size={15} /> Gestão para profissionais da beleza
              </span>
              <h1>
                Você cuida.
                <br />A Clara <em>organiza.</em>
              </h1>
              <p className="lp-lead">
                Agenda, link de reservas, clientes, equipe e recebimentos em um
                só lugar, com uma assistente que conversa com você. Menos tempo
                no celular respondendo “tem horário?”, mais tempo fazendo o que
                você ama.
              </p>
              <div className="lp-hero-actions">
                <a className="button primary lp-big" href="#/cadastro">
                  Começar 7 dias grátis <ArrowRight size={18} />
                </a>
                <a className="button secondary lp-big" href="#/demo/agenda">
                  Ver demonstração <ArrowUpRight size={18} />
                </a>
              </div>
              <ul className="lp-trust">
                <li><Check size={16} /> Sem cartão para testar</li>
                <li><Check size={16} /> Pronta em minutos</li>
                <li><Check size={16} /> Feita para o celular</li>
              </ul>
            </div>
            <div className="lp-hero-visual">
              <div className="lp-glow" aria-hidden="true" />
              <AgendaMock />
              <ClaraArt className="lp-hero-clara" pose="presenting" fetchPriority="high" />
              <div className="lp-float lp-float-booking" aria-hidden="true">
                <span className="lp-float-icon"><Globe size={16} /></span>
                <span>
                  <strong>Nova reserva online</strong>
                  <small>Aline · Spa dos pés · 16:00</small>
                </span>
              </div>
              <div className="lp-float lp-float-paid" aria-hidden="true">
                <span className="lp-float-icon green"><Wallet size={16} /></span>
                <span>
                  <strong>Pagamento registrado</strong>
                  <small>Pix · R$ 130,00</small>
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-segments" aria-label="Para quem é a Clara">
          <div className="lp-wrap">
            <p>Feita para quem transforma cuidado em profissão</p>
            <ul>
              {segments.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section lp-problem">
          <div className="lp-wrap lp-split">
            <div>
              <span className="lp-eyebrow">O DIA A DIA REAL</span>
              <h2>Seu talento não deveria disputar espaço com a planilha.</h2>
              <p>
                Agenda no caderno, horários confirmados de madrugada no
                WhatsApp, cliente que esqueceu, pagamento que ninguém anotou.
                A Clara tira esse peso das suas costas para você focar no
                atendimento e no crescimento do seu negócio.
              </p>
            </div>
            <ul className="lp-compare">
              {[
                ["“Tem horário amanhã?” às 23h", "Link de reservas que responde por você, 24 horas"],
                ["Dois horários marcados juntos", "Agenda que bloqueia conflitos automaticamente"],
                ["“Quanto entrou esse mês?”", "Recebimentos e pendências em um painel claro"],
                ["Preferências esquecidas", "Ficha da cliente com histórico e observações"],
              ].map(([before, after]) => (
                <li key={before}>
                  <span className="lp-before">
                    <X size={15} /> {before}
                  </span>
                  <span className="lp-after">
                    <Check size={15} /> {after}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section" id="recursos">
          <div className="lp-wrap">
            <div className="lp-head">
              <span className="lp-eyebrow">RECURSOS</span>
              <h2>Tudo o que o seu estúdio precisa. Nada que complique.</h2>
              <p>
                Um sistema completo, com a delicadeza de quem entende o ritmo
                de um salão.
              </p>
            </div>
            <div className="lp-features">
              {features.map(([Icon, title, text]) => (
                <article key={title}>
                  <span className="lp-feature-icon">
                    <Icon size={22} />
                  </span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section lp-assistant">
          <div className="lp-wrap lp-split">
            <div className="lp-chat" aria-label="Exemplo de conversa com a Clara">
              <div className="lp-chat-head">
                <ClaraArt className="lp-chat-avatar" pose="welcome" loading="lazy" />
                <span>
                  <strong>Clara</strong>
                  <small>Sua assistente</small>
                </span>
              </div>
              <p className="lp-bubble me">Clara, quem eu atendo amanhã de manhã?</p>
              <p className="lp-bubble">
                Amanhã de manhã você tem 3 atendimentos: Mariana às 9h
                (manicure), Camila às 10h (sobrancelhas) e Beatriz às 11h
                (alongamento em gel).
              </p>
              <p className="lp-bubble me">Passa a Camila para sexta no mesmo horário?</p>
              <p className="lp-bubble">
                Sexta às 10h está livre. Posso confirmar a remarcação da Camila?
              </p>
            </div>
            <div>
              <span className="lp-eyebrow">ASSISTENTE CLARA</span>
              <h2>Uma assistente que conhece a sua agenda.</h2>
              <p>
                Pergunte como você perguntaria para uma secretária. A Clara
                consulta seus horários, encontra janelas livres e conduz
                remarcações, sempre pedindo a sua confirmação antes de mudar
                qualquer coisa.
              </p>
              <ul className="lp-checks">
                <li><Check size={16} /> Consulta a agenda do dia, da semana ou de uma cliente</li>
                <li><Check size={16} /> Remarca atendimentos com a sua confirmação</li>
                <li><Check size={16} /> Prepara mensagens para enviar no WhatsApp</li>
                <li><Check size={16} /> Ensina a usar cada recurso do sistema</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="lp-section" id="como-funciona">
          <div className="lp-wrap">
            <div className="lp-head">
              <span className="lp-eyebrow">COMO FUNCIONA</span>
              <h2>Do cadastro à primeira reserva em uma tarde.</h2>
            </div>
            <ol className="lp-steps">
              {steps.map(([n, title, text]) => (
                <li key={n}>
                  <span>{n}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </li>
              ))}
            </ol>
            <div className="lp-pillars">
              <div><Smartphone size={20} /> Sem aplicativo para a cliente baixar</div>
              <div><QrCode size={20} /> QR Code pronto para imprimir</div>
              <div><MessageCircle size={20} /> Compartilhamento direto no WhatsApp</div>
              <div><Clock3 size={20} /> Remarcação pela cliente no prazo que você escolher</div>
            </div>
          </div>
        </section>

        <section className="lp-section lp-pricing" id="planos">
          <div className="lp-wrap">
            <div className="lp-head">
              <span className="lp-eyebrow">PLANOS</span>
              <h2>Um preço justo, que cresce junto com a sua equipe.</h2>
              <p>
                Todos os recursos em todos os planos. Sete dias grátis, sem
                cartão. Mensal e sem fidelidade.
              </p>
            </div>
            <div className="lp-plans">
              {PLANS.map((plan) => {
                const featured = plan.id === "solo";
                const [reais, cents] = formatAmount(plan.amount)
                  .replace(/^R\$\s?/, "")
                  .split(",");
                return (
                  <article key={plan.id} className={featured ? "featured" : ""}>
                    {featured && <span className="lp-plan-tag">Ideal para quem atende sozinha</span>}
                    <h3>{plan.limit === 1 ? "Solo" : plan.limit === 3 ? "Dupla ou trio" : `Equipe ${plan.limit}`}</h3>
                    <p>{plan.label}</p>
                    <div className="lp-price">
                      <small>R$</small>
                      <strong>{reais}</strong>
                      <span>,{cents}<br />/mês</span>
                    </div>
                    <a className={`button ${featured ? "primary" : "secondary"} full`} href="#/cadastro">
                      Testar grátis
                    </a>
                  </article>
                );
              })}
            </div>
            <ul className="lp-included">
              {[
                "Agenda e reservas online",
                "Clientes e histórico",
                "Serviços e encaixes",
                "Recebimentos e exportação",
                "Assistente Clara",
                "QR Code e link personalizado",
              ].map((x) => (
                <li key={x}><Check size={15} /> {x}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section" id="duvidas">
          <div className="lp-wrap lp-faq-grid">
            <div className="lp-head left">
              <span className="lp-eyebrow">DÚVIDAS</span>
              <h2>Perguntas frequentes</h2>
              <p>
                Ainda ficou alguma dúvida? Explore a demonstração: ela mostra o
                sistema completo, com dados fictícios.
              </p>
              <a className="button secondary" href="#/demo/agenda">
                Explorar demonstração <ArrowUpRight size={17} />
              </a>
            </div>
            <div className="lp-faq">
              {faq.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-cta">
          <div className="lp-wrap lp-cta-inner">
            <div>
              <h2>
                Seu tempo vale ouro.
                <br />
                <em>Deixe a organização com a Clara.</em>
              </h2>
              <p>Comece hoje. Em poucos minutos o seu link de reservas está no ar.</p>
              <div className="lp-hero-actions">
                <a className="button lp-light lp-big" href="#/cadastro">
                  Criar meu espaço grátis <ArrowRight size={18} />
                </a>
                <a className="button lp-ghost lp-big" href="#/entrar">
                  Já tenho conta
                </a>
              </div>
            </div>
            <ClaraArt className="lp-cta-clara" pose="celebrating" loading="lazy" />
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-inner">
          <div>
            <BrandMark size={28} />
            <p>Clara · Feito para quem transforma cuidado em profissão.</p>
          </div>
          <p className="lp-secure">
            <ShieldCheck size={16} /> Dados protegidos · <LockKeyhole size={14} /> Conexão segura ·{" "}
            <Repeat2 size={14} /> Sem fidelidade
          </p>
        </div>
      </footer>
    </div>
  );
}
