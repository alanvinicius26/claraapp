import OwnerSlots from "./OwnerSlots";
import { ResourceField } from "./Resources";
import { ServiceParallelFields, parallelServiceData, sharedAppointmentIds } from "./ParallelService";
import { studioInstant, hasSlot } from "./scheduling";
import { rescheduleMessage } from "./clara-whatsapp";
import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import ErrorBoundary from "./ErrorBoundary";
import Subscription from "./Subscription";
import { whatsappEnabled } from "./features";
import Admin, { AdminLink } from "./Admin";
import { observeSession, recoveryUser } from "./session.js";
import { rememberedEmail, rememberEmail } from "./remembered-login.js";
import { createDashboardLoader, indexClientVisits } from "./dashboard-data.js";
import Brand, { BrandLogo, BrandMark } from "./Brand";
import Landing from "./Landing";
import ClientMerge from "./ClientMerge";
import { DuplicatesPanel, DuplicateSuggestion, AppointmentDuplicateHint } from "./ClientDuplicates";
import { duplicateGroups, groupOf } from "./client-duplicates";
import Team from "./Team";
import ClaraChat from "./ClaraChat";
import ClaraDayCard from "./ClaraDayCard";
import { ClaraEmptyState, ClaraMilestone } from "./ClaraPresence";
import { claraMilestoneFor, claimClaraMilestone } from "./clara-milestones";
import ClaraArt from "./ClaraArt";
import HoursEditor from "./HoursEditor";
import { BusinessPulse, PeriodInsights, localDay } from "./Insights";
import BookingAlerts from "./BookingAlerts";
import AccessNotice from "./AccessNotice";
import { demoAlerts } from "./booking-alerts";
// Standby service: only bundled and routed when explicitly enabled at build time.
// The condition is inlined (not `whatsappEnabled`) so the bundler drops the chunk when off.
const WhatsApp = import.meta.env.VITE_WHATSAPP_ENABLED === "true" ? React.lazy(() => import("./WhatsApp")) : null;
import StudioLinkField from "./StudioLinkField";
import { canShareLinks, sharingUnavailable } from "./sharing";
import { createRoot } from "react-dom/client";
import {
  CalendarDays,
  Users,
  Flower2,
  Wallet,
  Store,
  CreditCard,
  ArrowUpRight,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Check,
  X,
  Clock3,
  Copy,
  Link2,
  Settings2,
  LogOut,
  Menu,
  LockKeyhole,
  CircleCheck,
  MoreHorizontal,
  Download,
  MessageCircle,
  Pencil,
  Ban,
  RefreshCw,
  Sparkles,
  Leaf,
  Coffee,
  MapPin,
  Mail,
  ShieldCheck,
  LoaderCircle,
  AlertCircle,
  ExternalLink,
  Scissors,
  Gem,
  Brush,
  Eye,
} from "lucide-react";
import { supabase, rpc, query, errorMessage } from "./lib";
import {
  money,
  today,
  time,
  dateLabel,
  initials,
  shiftDate,
  slugify,
  totals,
  csv,
  download,
} from "./domain";
import {
  demoStudio,
  demoServices,
  demoClients,
  demoAppointments,
  demoPayments,
  demoProfessionals,
} from "./demo";
import "./styles.css";
import "./enhancements.css";
import "./redesign.css";
import "./account-exit.css";
import "./polish.css";
import {
  MobileNav,
  WeekStrip,
  CatalogLink,
  AppointmentFocus,
} from "./redesign";
import MediaUpload from "./MediaUpload";
import QRButton from "./QRButton";
import { Booking, Manage } from "./booking";
import {
  ServicePicker,
  SelectionSummary,
  ServiceBreakdown,
} from "./ServiceSelection";

function useRoute() {
  const [path, setPath] = useState(location.hash.slice(1) || "/");
  useEffect(() => {
    const fn = () => setPath(location.hash.slice(1) || "/");
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  return path;
}
const navigate = (path) => {
  location.hash = path;
};
function decodeRouteSegment(value = "") {
  try { return decodeURIComponent(value); } catch { return ""; }
}
const fieldData = (e) => Object.fromEntries(new FormData(e.currentTarget));
function Button({ children, icon: Icon, className = "", busy, ...props }) {
  return (
    <button
      className={`button ${className}`}
      disabled={busy || props.disabled}
      {...props}
    >
      {busy ? (
        <LoaderCircle className="spin" size={17} />
      ) : (
        Icon && <Icon size={17} />
      )}{" "}
      {children}
    </button>
  );
}
function Field({ label, children, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children || <input {...props} />}
    </label>
  );
}
function Empty({ icon: Icon = CalendarDays, title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={28} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" /> Preparando seu espaço...
    </div>
  );
}
function Modal({ title, subtitle, children, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header>
        <div>
          <span className="eyebrow">SEU ESTÚDIO, ORGANIZADO</span>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Fechar">
          <X />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function Avatar({ name, large = false }) {
  return (
    <span className={`avatar ${large ? "large" : ""}`}>{initials(name)}</span>
  );
}
function Status({ status }) {
  return (
    <span className={`badge ${status}`}>
      {{
        confirmed: "Confirmado",
        completed: "Concluído",
        cancelled: "Cancelado",
        blocked: "Bloqueado",
      }[status] || status}
    </span>
  );
}
function App() {
  const path = useRoute();
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [authFailure, setAuthFailure] = useState(false);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [toast, setToast] = useState(null);
  const timer = useRef();
  const notify = useCallback((message, error = false) => {
    setToast({ message, error });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 6000);
  }, []);
  useEffect(() => {
    setReady(false); setAuthFailure(false);
    return observeSession(supabase.auth, {
      onSession: s => {
        setSession(s); setReady(true); setAuthFailure(false);
        if (!s) { setRecovery(false); recoveryUser(null); }
        else setRecovery(recoveryUser() === s.user.id);
      },
      onRecovery: s => { recoveryUser(s?.user.id); setRecovery(true); },
      onError: err => { setAuthFailure(true); setReady(true); notify(errorMessage(err), true); },
    });
  }, [notify, authAttempt]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has("error") || params.has("error_code")) {
      notify("Este link de acesso expirou ou já foi usado. Solicite um novo link.", true);
      history.replaceState(null, "", location.pathname + location.search + "#/entrar");
    }
  }, [notify]);
  return (
    <>
      {path.startsWith("/booking/") ? (
        <Booking
          slug={decodeRouteSegment(path.split("/")[2])}
          notify={notify}
        />
      ) : path.startsWith("/manage/") ? (
        <Manage token={path.split("/")[2]} notify={notify} />
      ) : !ready ? (
        <Loading />
      ) : authFailure ? (
        <Empty title="Não foi possível verificar seu acesso" action={<Button onClick={() => setAuthAttempt(n => n + 1)}>Tentar novamente</Button>}>Confira sua conexão. Sua conta continua protegida.</Empty>
      ) : recovery ? (
        <Auth
          key="recovery"
          recovery
          onRecovered={() => {
            setRecovery(false);
            recoveryUser(null);
            navigate("/app/agenda");
          }}
          notify={notify}
        />
      ) : path.startsWith("/demo") ? (
        <Dashboard key="demo" demo path={path} notify={notify} />
      ) : session ? (
        path === "/admin" ? <Admin key={session.user.id} notify={notify} /> : <Dashboard key={session.user.id} session={session} path={path} notify={notify} />
      ) : path === "/" || path === "/inicio" ? (
        <Landing />
      ) : (
        <Auth key={path === "/cadastro" ? "signup" : "login"} initialMode={path === "/cadastro" ? "signup" : "login"} notify={notify} />
      )}{" "}
      {toast && (
        <div role="status" className={`toast ${toast.error ? "error" : ""}`}>
          {toast.error ? <AlertCircle size={19} /> : <CircleCheck size={19} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} aria-label="Fechar aviso">
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
function Auth({ notify, recovery, onRecovered, initialMode = "login" }) {
  const [mode, setMode] = useState(recovery ? "recover" : initialMode);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const loginStorage = useMemo(() => { try { return window.localStorage; } catch { return null; } }, []);
  const [email, setEmail] = useState(() => (recovery ? "" : rememberedEmail(loginStorage)));
  const [remember, setRemember] = useState(true);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const sending = useRef(false);
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    if (!resendAt) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= resendAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  function markEmailSent() {
    const time = Date.now();
    setNow(time);
    setResendAt(time + 60000);
    setSent(true);
  }
  async function sendEmail(address) {
    if (mode === "forgot") {
      await query(supabase.auth.resetPasswordForEmail(address, { redirectTo: location.origin }));
    } else {
      await query(supabase.auth.resend({
        type: "signup",
        email: address,
        options: { emailRedirectTo: location.origin },
      }));
    }
    markEmailSent();
  }
  async function resendEmail() {
    if (sending.current || Date.now() < resendAt) return;
    sending.current = true;
    setBusy(true);
    try {
      await sendEmail(email.trim());
    } catch (err) {
      notify(errorMessage(err), true);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    if (sending.current) return;
    const f = fieldData(e);
    if (["resend", "forgot"].includes(mode) && Date.now() < resendAt) return;
    sending.current = true;
    setBusy(true);
    try {
      if (["signup", "recover"].includes(mode) && f.password !== f.confirm_password) throw new Error("As senhas não coincidem.");
      if (mode === "recover") {
        await query(supabase.auth.updateUser({ password: f.password }));
        notify("Senha atualizada.");
        onRecovered();
        return;
      }
      if (["forgot", "resend"].includes(mode)) {
        await sendEmail(f.email.trim());
      } else if (mode === "signup") {
        const data = await query(
          supabase.auth.signUp({
            email: f.email.trim(),
            password: f.password,
            options: { emailRedirectTo: location.origin },
          }),
        );
        if (!data.session) markEmailSent();
      } else {
        await query(
          supabase.auth.signInWithPassword({
            email: f.email.trim(),
            password: f.password,
          }),
        );
        rememberEmail(loginStorage, f.email, remember);
        navigate("/app/agenda");
      }
    } catch (err) {
      notify(errorMessage(err), true);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div className="auth-copy">
          <span className="eyebrow">MAIS TEMPO PARA O QUE VOCÊ AMA</span>
          <ClaraArt
            className="auth-clara"
            pose={sent ? "approval" : mode === "login" ? "down" : mode === "signup" ? "welcome" : "confident"}
            fetchPriority="high"
            decoding="async"
          />
          <h1>
            <span className="auth-headline-lead">
              Você cuida.
            </span>
            <span className="auth-headline-end">A Clara <em>organiza.</em></span>
          </h1>
          <p>
            Uma rotina mais leve começa com uma agenda organizada. Seu estúdio
            inteiro, em um só lugar.
          </p>
          <div className="auth-feature">
            <CalendarDays /> Agenda e reservas online <span>01</span>
          </div>
          <div className="auth-feature">
            <Users /> Cada cliente, um cuidado especial <span>02</span>
          </div>
          <div className="auth-feature">
            <Wallet /> Seus recebimentos sob controle <span>03</span>
          </div>
        </div>
        <footer>
          <BrandMark size={22} /> Feito para quem transforma cuidado em profissão.
        </footer>
      </section>
      <section className="auth-main">
        <div className="auth-top">
          {recovery ? <span>Seu próximo capítulo começa aqui.</span> : (
            <a className="auth-back" href="#/">
              <ChevronLeft size={16} /> Conhecer a Clara
            </a>
          )}
          <Leaf size={22} />
        </div>
        <div className="auth-card">
          <span className="small-icon">
            <BrandMark size={42} />
          </span>
          <h2>
            {mode === "login"
              ? "Bom ter você por aqui."
              : mode === "signup"
                ? "Seu espaço começa aqui."
                : mode === "recover"
                  ? "Uma nova senha."
                  : mode === "resend"
                    ? "Vamos confirmar seu e-mail."
                    : "Vamos recuperar seu acesso."}
          </h2>
          <p>
            {mode === "login"
              ? "Entre para cuidar da sua agenda e do seu negócio."
              : mode === "signup"
                ? "Crie sua conta e organize o seu estúdio."
                : mode === "resend"
                  ? "Receba novamente o link de confirmação da sua conta."
                  : "Volte à sua rotina com tranquilidade."}
          </p>
          {sent ? (
            <div className="notice">
              <Mail />
              <div>
                <strong>Confira seu e-mail</strong>
                <p>
                  Se o endereço estiver apto, você receberá um link para{" "}
                  {mode === "forgot"
                    ? "recuperar o acesso"
                    : "confirmar sua conta"}
                  . Confira também o spam.
                </p>
                <Button
                  type="button"
                  className="secondary full"
                  busy={busy}
                  disabled={busy || remaining > 0}
                  onClick={resendEmail}
                >
                  {remaining > 0 ? `Reenviar em ${remaining}s` : "Reenviar e-mail"}
                </Button>
                <Button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setSent(false);
                    setMode("login");
                  }}
                >
                  Voltar para entrar
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit}>
              {mode !== "recover" && (
                <Field
                  label="Seu e-mail"
                  name="email"
                  type="email"
                  autoComplete={mode === "login" ? "username" : "email"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@seuestudio.com"
                  required
                />
              )}
              {!["forgot", "resend"].includes(mode) && (
                <Field
                  label="Senha"
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  minLength={mode === "login" ? 1 : 8}
                  placeholder={mode === "login" ? "Sua senha" : "Pelo menos 8 caracteres"}
                  required
                />
              )}
              {mode === "login" && (
                <label className="check-field remember-login">
                  <input type="checkbox" checked={remember} onChange={(e) => { setRemember(e.target.checked); if (!e.target.checked) rememberEmail(loginStorage, "", false); }} />
                  Lembrar meu e-mail neste aparelho
                </label>
              )}
              {mode === "login" && (
                <button
                  type="button"
                  className="text-button forgot"
                  disabled={busy}
                  onClick={() => setMode("forgot")}
                >
                  Esqueci minha senha
                </button>
              )}
              {["signup", "recover"].includes(mode) && <Field label="Confirme a senha" name="confirm_password" type="password" autoComplete="new-password" minLength={8} required />}
              <Button busy={busy} disabled={busy || (["forgot", "resend"].includes(mode) && remaining > 0)} className="primary full" icon={ArrowRight}>
                {mode === "login"
                  ? "Entrar no meu espaço"
                  : mode === "signup"
                    ? "Criar minha conta"
                    : mode === "recover"
                      ? "Salvar nova senha"
                      : remaining > 0
                        ? `Reenviar em ${remaining}s`
                        : mode === "resend"
                          ? "Reenviar confirmação"
                          : "Enviar link de recuperação"}
              </Button>
            </form>
          )}
          {!recovery && (
            <>
              <p className="auth-switch">
                {mode === "login"
                  ? "Ainda não tem uma conta?"
                  : "Já tem sua conta?"}{" "}
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setSent(false);
                    setMode(mode === "login" ? "signup" : "login");
                  }}
                >
                  {mode === "login" ? "Começar agora" : "Entrar"}
                </button>
              </p>
              {mode === "login" && (
                <p className="auth-switch">
                  Não recebeu a confirmação?{" "}
                  <button type="button" className="text-button" disabled={busy} onClick={() => { setSent(false); setMode("resend"); }}>
                    Reenviar e-mail
                  </button>
                </p>
              )}
              <div className="divider-text">CONHEÇA A CLARA</div>
              <a className="button secondary full" href="#/demo/agenda">
                Explorar demonstração <ArrowUpRight size={17} />
              </a>
              <p className="micro center">
                Demonstração com dados fictícios. Nenhum cadastro necessário.
              </p>
            </>
          )}
        </div>
        <footer className="auth-foot">
          <ShieldCheck size={15} /> Um espaço seguro para o seu negócio.
        </footer>
      </section>
    </div>
  );
}
function Onboarding({ onDone, notify }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const f = fieldData(e);
    try {
      await rpc("setup_studio", {
        p_name: f.name,
        p_professional: f.professional,
        p_slug: f.slug,
      });
      onDone();
    } catch (err) {
      notify(errorMessage(err), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="onboarding">
      <Brand />
      <div className="panel">
        <ClaraArt className="clara-onboarding-art" pose="presenting" />
        <span className="eyebrow">BEM-VINDA AO SEU NOVO ESPAÇO</span>
        <h1>Vamos dar a sua cara?</h1>
        <p>Comece com o básico. Depois, você pode ajustar cada detalhe.</p>
        <form onSubmit={submit}>
          <Field
            label="Nome do estúdio"
            name="name"
            required
            minLength={2}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Studio Juliana Silva"
          />
          <Field
            label="Seu nome profissional"
            name="professional"
            required
            minLength={2}
            maxLength={100}
            placeholder="Juliana Silva"
          />
          <StudioLinkField
            key={slugify(name)}
            initialValue={slugify(name)}
          />
          <Button className="primary full" busy={busy} icon={ArrowRight}>
            Criar meu espaço
          </Button>
        </form>
      </div>
      <button className="text-button" onClick={async () => { try { await query(supabase.auth.signOut()); } catch (e) { notify(errorMessage(e), true); } }}>
        Sair da conta
      </button>
    </div>
  );
}
const nav = [
  ["agenda", "Minha agenda", CalendarDays],
  ["clientes", "Clientes", Users],
  ["equipe", "Equipe", Users],
  ...(whatsappEnabled ? [["conversas", "Conversas WhatsApp", MessageCircle]] : []),
  ["servicos", "Serviços", Flower2],
  ["recebimentos", "Recebimentos", Wallet],
  ["espaco", "Meu espaço", Store],
  ["online", "Agendamento online", Link2],
  ["assinatura", "Minha assinatura", CreditCard],
];
function Dashboard({ session, demo, path, notify }) {
  const [professionals, setProfessionals] = useState(demo ? demoProfessionals : []);
  const [professionalFilter, setProfessionalFilter] = useState("");
  const [studio, setStudio] = useState(demo ? demoStudio : null);
  const [clients, setClients] = useState(demo ? demoClients : []);
  const [services, setServices] = useState(demo ? demoServices : []);
  const [appointments, setAppointments] = useState(
    demo ? demoAppointments : [],
  );
  const [payments, setPayments] = useState(demo ? demoPayments : []);
  const [loading, setLoading] = useState(!demo);
  const [failure, setFailure] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [modal, setModal] = useState(null);
  const [claraNotice, setClaraNotice] = useState(null);
  const [claraOpenRequest, setClaraOpenRequest] = useState(0);
  const [claraMoment, setClaraMoment] = useState(null);
  const [agendaJump, setAgendaJump] = useState(null);
  const [saving, setSaving] = useState(false);
  const mutationBusy = useRef(false);
  const [day, setDay] = useState(today());
  const [focusedId, setFocusedId] = useState(null);
  useEffect(() => {
    if (!agendaJump) return;
    const target = document.getElementById(`appointment-${agendaJump}`);
    if (target) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      setAgendaJump(null);
    }
  }, [agendaJump, day, appointments]);
  const page = nav.some((n) => n[0] === path.split("/")[2])
    ? path.split("/")[2]
    : "agenda";
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    setMobile(false);
  }, [page]);
  const loader = useMemo(() => demo ? null : createDashboardLoader({ supabase, query, rpc, ownerId: session.user.id }), [demo, session?.user.id]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const reload = useCallback(async (quiet = false, force = true) => {
    if (demo) return;
    if (!quiet) setLoading(true);
    try {
      const data = await loader.load(force);
      if (!mounted.current) return;
      if (data) {
        setStudio(data.studio);
        setClients(data.clients || []); setServices(data.services || []);
        setAppointments(data.appointments || []); setPayments(data.payments || []);
        setProfessionals(data.professionals || []);
      }
      setFailure(false);
    } catch (err) {
      if (mounted.current) { setFailure(true); if (!quiet || force) notify(errorMessage(err), true); }
    } finally { if (mounted.current) setLoading(false); }
  }, [demo, loader, notify]);
  const refreshAfterAlert = useCallback(() => reload(true, true), [reload]);
  useEffect(() => {
    reload();
    if (demo) return;
    let stopped = false, timer;
    const poll = async () => {
      if (!document.hidden && navigator.onLine) await reload(true, false);
      if (!stopped) timer = setTimeout(poll, 55000 + Math.random() * 10000);
    };
    timer = setTimeout(poll, 55000 + Math.random() * 10000);
    const focus = () => { if (!document.hidden && navigator.onLine) reload(true, false); };
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      stopped = true; clearTimeout(timer);
      window.removeEventListener("focus", focus); window.removeEventListener("online", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [reload, demo]);
  const protect = (fn) => {
    if (demo) {
      notify(
        "Este é um exemplo. Crie sua conta para salvar seus próprios dados.",
      );
      return;
    }
    return fn();
  };
  const open = (type, item) => protect(() => setModal({ type, item }));
  async function mutate(fn, message, onSuccess, event) {
    if (mutationBusy.current) return;
    mutationBusy.current = true;
    setSaving(true);
    try {
      const result = await fn();
      onSuccess?.(result);
      const milestone = claraMilestoneFor(event, { services, appointments });
      let storage;
      try { storage = window.localStorage; } catch { /* The celebration can work in memory. */ }
      if (claimClaraMilestone(studio?.id, milestone, storage)) setClaraMoment(milestone);
      else notify(message);
      setModal(null);
      await reload(true);
    } catch (err) {
      notify(errorMessage(err), true);
    } finally {
      mutationBusy.current = false;
      setSaving(false);
    }
  }
  async function copyLink() {
    if (!canShareLinks) {
      notify(sharingUnavailable);
      return;
    }
    if (demo) {
      notify("O link ficará disponível depois que você criar seu espaço.");
      return;
    }
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/#/booking/${studio.slug}`,
      );
      notify("Link copiado!");
    } catch {
      notify("Não foi possível copiar o link neste navegador.", true);
    }
  }
  function leaveAccount() {
    if (demo) navigate("/");
    else query(supabase.auth.signOut()).catch(e => notify(errorMessage(e), true));
  }
  if (loading) return <Loading />;
  if (failure && !studio)
    return (
      <Empty
        title="Não foi possível carregar"
        action={
          <Button onClick={() => reload()} icon={RefreshCw}>
            Tentar novamente
          </Button>
        }
      >
        Confira sua conexão.
      </Empty>
    );
  if (!studio) return <Onboarding onDone={reload} notify={notify} />;
  const selectedDay = appointments.filter(
    (a) =>
      (!professionalFilter || a.professional_id === professionalFilter) &&
      new Date(a.starts_at).toLocaleDateString("en-CA", {
        timeZone: "America/Sao_Paulo",
      }) === day,
  );
  const sharedIds = sharedAppointmentIds(selectedDay);
  const paid = (id) => payments.find((p) => p.appointment_id === id);
  const stats = totals(
    selectedDay,
    payments.filter((p) => selectedDay.some((a) => a.id === p.appointment_id)),
  );
  const prefix = demo ? "/demo/" : "/app/";
  const pageProps = {
    onClara: () => setClaraOpenRequest(value => value + 1),
    professionals,
    professionalFilter,
    studio,
    clients,
    services,
    appointments,
    payments,
    paid,
    open,
    protect,
    mutate,
    notify,
    reload,
    saving,
    demo,
    copyLink,
  };
  return (
    <div className={`app-layout page-${page}`}>
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-only"
            aria-label="Fechar menu"
            onClick={() => setMobile(false)}
          >
            <X />
          </button>
        </div>
        <span className="workspace-label">SEU ESPAÇO DE CUIDADO</span>
        <div className="studio-label">
          <span className="online-dot" />
          {studio.name}
        </div>
        <a
          className="public-link"
          href={demo ? "#/demo/online" : `#/booking/${studio.slug}`}
          target={demo ? undefined : "_blank"}
          rel="noreferrer"
        >
          <span>
            <Link2 size={16} /> Minha página de reservas
          </span>
          <ArrowUpRight size={16} />
        </a>
        <div className="nav-label">MEU NEGÓCIO</div>
        <nav>
          {nav.map(([key, label, Icon]) => (
            <a
              key={key}
              className={page === key ? "active" : ""}
              href={"#" + prefix + key}
              onClick={() => setMobile(false)}
            >
              <Icon size={20} />
              <span>{label}</span>
              {key === "clientes" && clients.length > 0 && (
                <small>{clients.length}</small>
              )}
            </a>
          ))}
          {!demo && <AdminLink />}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Sparkles size={20} />
            <strong>Seu talento merece tempo.</strong>
            <p>A organização fica com a gente.</p>
          </div>
          <div className="profile">
            <Avatar name={studio.professional} />
            <div>
              <strong>{studio.professional}</strong>
              <span>{demo ? "Espaço de demonstração" : "Meu estúdio"}</span>
            </div>
            <button
              type="button"
              className="account-exit"
              aria-label={demo ? "Sair da demonstração" : "Sair da conta"}
              onClick={leaveAccount}
            >
              <LogOut size={17} />
              <span>{demo ? "Sair da demonstração" : "Sair da conta"}</span>
            </button>
          </div>
        </div>
      </aside>
      {mobile && (
        <div className="menu-scrim" onClick={() => setMobile(false)} />
      )}
      <div className="app-main">
        <header className="topbar">
          <a className="mobile-studio" href={"#" + prefix + "espaco"}>
            <Avatar name={studio.professional} />
            <span>
              <strong>{studio.name}</strong>
              <small>Seu espaço de cuidado</small>
            </span>
          </a>
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              aria-label="Abrir menu"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </button>
            <span>Meu estúdio</span>
            <ChevronRight size={14} />
            <strong>{nav.find((n) => n[0] === page)[1]}</strong>
          </div>
          <div className="topbar-right">
            {studio?.id && (
              <BookingAlerts
                key={demo ? "demo" : studio.id}
                studioId={studio.id}
                demoItems={demo ? demoAlerts(appointments) : undefined}
                notify={notify}
                onChange={refreshAfterAlert}
                onOpen={(alert) => {
                  if (alert.payload?.starts_at) setDay(localDay(alert.payload.starts_at));
                  if (alert.appointment_id) { setFocusedId(alert.appointment_id); setAgendaJump(alert.appointment_id); }
                  location.hash = "#" + prefix + "agenda";
                }}
              />
            )}
            <button
              className="icon-button"
              onClick={copyLink}
              aria-label="Copiar link de agendamento"
            >
              <Copy size={19} />
            </button>
            <span className="micro">
              <span className="online-dot" />
              {demo ? "Prévia do seu espaço" : "Conectado ao seu espaço"}
            </span>
            <button
              className="icon-button"
              onClick={() => reload()}
              title="Atualizar dados"
              aria-label="Atualizar dados"
            >
              <RefreshCw size={16} />
            </button>
            <Avatar name={studio.professional} />
            <button
              type="button"
              className="account-exit"
              aria-label={demo ? "Sair da demonstração" : "Sair da conta"}
              title={demo ? "Sair da demonstração" : "Sair da conta"}
              onClick={leaveAccount}
            >
              <LogOut size={17} />
              <span>Sair</span>
            </button>
          </div>
        </header>
        {demo && (
          <div className="demo-bar">
            <span>
              <Sparkles size={15} /> Você está explorando uma demonstração com
              dados fictícios.
            </span>
            <a href="#/cadastro">
              Criar meu espaço <ArrowRight size={15} />
            </a>
          </div>
        )}
        {!demo && studio?.id && <AccessNotice ownerId={session.user.id} page={page} prefix={prefix} />}
        {import.meta.env.DEV && demo && location.search.includes("aviso-acesso") && (
          <AccessNotice ownerId="demo-preview" page={page} prefix={prefix}
            previewStatus={{ can_use: false, billing_enabled: true, has_subscription: false, status: "trial", trial_ends_at: new Date(Date.now() - 36e5).toISOString() }} />
        )}
        {failure && (
          <div className="notice error">
            Não foi possível atualizar os dados.{" "}
            <button onClick={() => reload()}>Tentar novamente</button>
          </div>
        )}
        <main className="content">
          {page === "agenda" && (
            <>
              <div className="page-title">
                <div>
                  <span className="eyebrow">
                    CADA HORÁRIO, UMA POSSIBILIDADE
                  </span>
                  <h1>Minha agenda<span className="greeting-dot">.</span></h1>
                  <p>
                    Veja seus próximos atendimentos. Seu dia, com mais leveza.
                  </p>
                </div>
                <Button
                  className="primary"
                  icon={Plus}
                  onClick={() => open("appointment")}
                >
                  Novo agendamento
                </Button>
              </div>
              <ClaraDayCard
                appointments={appointments}
                day={day}
                professionalId={professionalFilter}
                professionalName={professionals.find(p => p.id === professionalFilter)?.name}
                name={studio.professional}
                unavailable={failure}
                onRefresh={() => reload(true)}
                onNext={(appointment, date) => { setDay(date); setFocusedId(appointment.id); setAgendaJump(appointment.id); }}
                onChat={() => setClaraOpenRequest(value => value + 1)}
              />
              <div className="stats-grid">
                <Metric
                  label="Atendimentos do dia"
                  value={String(stats.count).padStart(2, "0")}
                  icon={CalendarDays}
                  detail={`${selectedDay.filter((a) => a.status === "completed").length} concluídos · no seu ritmo`}
                  accent
                />
                <Metric
                  label="Recebido e confirmado"
                  value={money(stats.received)}
                  icon={Wallet}
                  detail="Pagamentos registrados por você"
                />
                <Metric
                  label="Ainda a receber"
                  value={money(stats.pending)}
                  icon={Clock3}
                  detail="Cuidados que se transformam em resultado"
                />
              </div>
              <div className="agenda-grid">
                <section className="panel schedule">
                  <div className="section-head">
                    <div>
                      <h2>
                        Sua agenda{" "}
                        <span className="tiny-count">{stats.count}</span>
                      </h2>
                      <p>Um olhar para os seus próximos encontros.</p>
                    </div>
                    <Button
                      className="secondary compact"
                      icon={LockKeyhole}
                      onClick={() => open("block")}
                    >
                      Bloquear horário
                    </Button>
                  </div>
                  <div className="date-toolbar">
                    <div className="date-controls">
                      <button
                        className="icon-button"
                        aria-label="Dia anterior"
                        onClick={() => setDay(shiftDate(day, -1))}
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <label className="date-picker">
                        <CalendarDays size={16} />
                        <input
                          aria-label="Data da agenda"
                          type="date"
                          value={day}
                          onChange={(e) =>
                            e.target.value && setDay(e.target.value)
                          }
                        />
                      </label>
                      <button
                        className="icon-button"
                        aria-label="Próximo dia"
                        onClick={() => setDay(shiftDate(day, 1))}
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>
                    <div className="toolbar-end">
                      <label className="pro-filter">
                        <Users size={16} aria-hidden="true" />
                        <select aria-label="Agenda da profissional" value={professionalFilter} onChange={(e) => { setProfessionalFilter(e.target.value); setFocusedId(null); }}>
                          <option value="">Todas as profissionais</option>
                          {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : " (inativa)"}</option>)}
                        </select>
                      </label>
                      <button
                        className="today-button"
                        onClick={() => setDay(today())}
                      >
                        Hoje
                      </button>
                    </div>
                  </div>
                  <WeekStrip
                    day={day}
                    setDay={setDay}
                    appointments={appointments.filter((a) => !professionalFilter || a.professional_id === professionalFilter)}
                  />
                  <div className="day-caption">
                    {dateLabel(day)}
                    <a className="text-button" href={`#${prefix}equipe`}>Gerenciar equipe e expedientes</a>
                  </div>
                  {selectedDay.length === 0 ? (
                    <ClaraEmptyState
                      pose="agenda"
                      title={appointments.length === 0 ? "Seu primeiro horário começa aqui" : "Um espaço para o próximo encontro"}
                      actionLabel={day < today() ? "Ver agenda de hoje" : "Agendar um horário"}
                      onAction={() => day < today() ? setDay(today()) : open("appointment")}
                      onHelp={pageProps.onClara}
                    >
                      {professionalFilter ? "Não há atendimentos nesta data para a profissional selecionada." : "Não há atendimentos nesta data."} Quando você adicionar um horário, eu te ajudo a acompanhar tudo por aqui.
                    </ClaraEmptyState>
                  ) : (
                    <div className="appointment-list">
                      {selectedDay.map((a) => (
                        <button
                          className={`appointment ${a.status} ${focusedId === a.id ? "focused" : ""}`}
                          id={`appointment-${a.id}`}
                          key={a.id}
                          onClick={() => {
                            setFocusedId(a.id);
                            if (window.matchMedia("(max-width: 767px)").matches)
                              open("detail", a);
                          }}
                        >
                          <div className="appointment-time">
                            <strong>{time(a.starts_at)}</strong>
                            <span>{time(a.ends_at)}</span>
                          </div>
                          <div className="appointment-mark" />
                          <div className="appointment-body">
                            <div className="appointment-name">
                              {a.status === "blocked" ? (
                                <>
                                  <Coffee size={16} />{" "}
                                  {a.notes || "Pausa para você"}
                                </>
                              ) : (
                                a.clients?.name
                              )}
                              <Status status={a.status} />
                            </div>
                            <p>{a.service_name}</p>
                            <span className="micro">{professionals.find((p) => p.id === a.professional_id)?.name || (demo ? studio.professional : "")} · </span>
                            <span className="micro">
                              {a.source === "online"
                                ? "Reserva online"
                                : "Agendamento do estúdio"}
                            </span>
                            {sharedIds.has(a.id) && <span className="micro"> · Encaixe</span>}
                          </div>
                          {a.status !== "blocked" && (
                            <div className="appointment-price">
                              <strong>{money(a.price)}</strong>
                              <span
                                className={paid(a.id) ? "success-text" : ""}
                              >
                                {paid(a.id)
                                  ? "✓ Recebido"
                                  : a.status === "cancelled"
                                    ? "Cancelado"
                                    : "A receber"}
                              </span>
                            </div>
                          )}
                          <ChevronRight
                            className="appointment-arrow"
                            size={17}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </section>
                <aside className="agenda-side">
                  <AppointmentFocus
                    appointment={
                      selectedDay.find((a) => a.id === focusedId) ||
                      selectedDay.find((a) => a.status === "confirmed") ||
                      selectedDay[0]
                    }
                    {...pageProps}
                    onComplete={(a) =>
                      protect(() =>
                        mutate(
                          () =>
                            query(
                              supabase
                                .from("appointments")
                                .update({ status: "completed" })
                                .eq("id", a.id).eq("status", "confirmed").select("id").single(),
                            ),
                          "Atendimento concluído.",
                          undefined,
                          "appointment-completed",
                        ),
                      )
                    }
                  />
                  <div className="today-note">
                    <span className="online-dot" />
                    {demo
                      ? "Exemplo ilustrativo"
                      : "Agenda atualizada automaticamente"}
                  </div>
                  <BusinessPulse appointments={appointments} />
                </aside>
              </div>
            </>
          )}
          {page === "clientes" && <Clients {...pageProps} />}
          {page === "equipe" && <Team {...pageProps} />}
          {WhatsApp && page === "conversas" && <React.Suspense fallback={null}><WhatsApp studio={studio} demo={demo} notify={notify} /></React.Suspense>}
          {page === "servicos" && <Services {...pageProps} />}
          {page === "recebimentos" && <Receipts {...pageProps} />}
          {page === "espaco" && <Space {...pageProps} />}
          {page === "online" && <Online {...pageProps} />}
          {page === "assinatura" && <Subscription demo={demo} notify={notify} professionals={professionals} />}
          <footer className="content-footer">
            <BrandMark size={22} /> Clara · Feito para o seu tempo render mais.
            <span>Com cuidado, em cada detalhe.</span>
          </footer>
        </main>
      </div>
      <MobileNav page={page} prefix={prefix} />
      {claraMoment && <ClaraMilestone kind={claraMoment} onClose={() => setClaraMoment(null)} />}
      <ClaraChat key={demo ? 'demo' : session?.user?.id} demo={demo} userId={session?.user?.id} notice={claraNotice} openRequest={claraOpenRequest} onOpenHandled={() => setClaraOpenRequest(0)} onRescheduled={() => reload(true)} />
      {modal && (
        <Editor
          key={modal.type + (modal.item?.id || "")}
          modal={modal}
          onRescheduled={setClaraNotice}
          {...pageProps}
          day={day}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
function Metric({ label, value, icon: Icon, detail, accent }) {
  return (
    <div className={`metric ${accent ? "accent" : ""}`}>
      <div>
        <span>{label}</span>
        <span className="metric-icon">
          <Icon size={20} />
        </span>
      </div>
      <strong>{value}</strong>
      <p>
        {accent ? <span className="online-dot" /> : <Check size={13} />}{" "}
        {detail}
      </p>
    </div>
  );
}
function PageTitle({ eyebrow, title, description, action }) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function Clients({ clients, appointments, open, protect, mutate, saving, onClara }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const detailRef = useRef(null);
  const [filter, setFilter] = useState("all");
  const [shown, setShown] = useState(50);
  const [historyShown, setHistoryShown] = useState(30);
  useEffect(() => { setShown(50); }, [search, filter]);
  useEffect(() => { setHistoryShown(30); }, [selected]);
  const visitIndex = useMemo(() => indexClientVisits(appointments), [appointments]);
  const visits = c => visitIndex.get(c.id)?.completed || [];
  const nextVisit = c => visitIndex.get(c.id)?.next;
  // Same WhatsApp in more than one record (online bookings always create one).
  const duplicates = useMemo(() => duplicateGroups(clients, visitIndex), [clients, visitIndex]);
  const mergeGroup = (target, sources) =>
    protect(() => mutate(
      () => rpc("merge_client_group", { p_target: target, p_sources: sources }),
      "Cadastros unificados. Histórico preservado.",
      () => setSelected(target),
    ));
  const filtered = clients.filter(
    (c) =>
      (filter === "all" ||
        (filter === "frequent"
          ? visits(c).length >= 3
          : filter === "new"
            ? visits(c).length === 0
            : visits(c).length > 0 && !nextVisit(c))) &&
      (c.name + " " + c.phone + " " + c.email)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const client = filtered.find((c) => c.id === selected) || filtered[0];
  const history = appointments
    .filter((a) => a.client_id === client?.id)
    // Most recent first up to now; upcoming ones follow in date order.
    .sort((a, b) => {
      const now = new Date().toISOString();
      const af = new Date(a.starts_at).toISOString() > now;
      const bf = new Date(b.starts_at).toISOString() > now;
      if (af !== bf) return af ? 1 : -1;
      return af
        ? a.starts_at.localeCompare(b.starts_at)
        : b.starts_at.localeCompare(a.starts_at);
    });
  return (
    <>
      <PageTitle
        eyebrow="CADA CLIENTE, UMA HISTÓRIA"
        title="Minhas clientes"
        description={`${clients.length} clientes e muitas histórias de cuidado.`}
        action={
          <Button
            className="primary"
            icon={Plus}
            onClick={() => open("client")}
          >
            Nova cliente
          </Button>
        }
      />
      <div className="search-field">
        <Search size={18} />
        <input
          aria-label="Buscar cliente"
          placeholder="Buscar por nome, e-mail ou telefone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span>{filtered.length} clientes</span>
      </div>
      <div className="tabs client-filters" aria-label="Filtrar clientes">
        {[
          ["all", "Todas"],
          ["frequent", "Frequentes"],
          ["return", "Sem retorno agendado"],
          ["new", "Novas"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={filter === key ? "active" : ""}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <DuplicatesPanel
        groups={duplicates}
        visits={(c) => visits(c).length}
        onMerge={mergeGroup}
        saving={saving}
        onSelect={(id) => { setSearch(""); setFilter("all"); setSelected(id); }}
      />
      {!filtered.length ? (
        <ClaraEmptyState
          pose={clients.length ? "thinking" : "notes"}
          title={clients.length ? "Vamos procurar de outro jeito?" : "Vamos conhecer sua primeira cliente?"}
          actionLabel={clients.length ? "Limpar busca e filtros" : "Cadastrar primeira cliente"}
          onAction={() => clients.length ? (setSearch(""), setFilter("all")) : open("client")}
          onHelp={onClara}
        >{clients.length ? "Nenhuma cliente corresponde à busca e aos filtros atuais. Seus cadastros continuam guardados." : "Comece pelo nome e contato. As preferências e os próximos encontros ganham seu lugar aqui."}</ClaraEmptyState>
      ) : (
        <div className="clients-grid">
          <section className="client-list">
            {filtered.slice(0, shown).map((c) => (
              <button
                key={c.id}
                className={`client-item ${client?.id === c.id ? "selected" : ""}`}
                onClick={() => {
                  setSelected(c.id);
                  if (window.matchMedia("(max-width: 767px)").matches)
                    requestAnimationFrame(() =>
                      detailRef.current?.scrollIntoView({
                        block: "start",
                        behavior: window.matchMedia(
                          "(prefers-reduced-motion: reduce)",
                        ).matches
                          ? "auto"
                          : "smooth",
                      }),
                    );
                }}
              >
                <Avatar name={c.name} />
                <div>
                  <strong>{c.name}</strong>
                  <p>{c.phone || c.email || "Contato não informado"}</p>
                  <span className="client-visit-meta">
                    {visits(c).length} {visits(c).length === 1 ? "visita concluída" : "visitas concluídas"}
                    {nextVisit(c)
                      ? ` · Próximo: ${new Date(nextVisit(c).starts_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                      : " · Sem próximo horário"}
                  </span>
                </div>
                <ChevronRight size={17} />
              </button>
            ))}
            {filtered.length > shown && <Button className="secondary" onClick={() => setShown(n => n + 50)}>Mostrar mais clientes</Button>}
          </section>
          {client && (
            <section className="panel client-detail" ref={detailRef}>
              <div className="section-head">
                <div className="client-identity">
                  <Avatar large name={client.name} />
                  <div>
                    <h2>{client.name}</h2>
                    <p>{[client.phone, client.email].filter(Boolean).join(" · ") || "Contato não informado"}</p>
                  </div>
                </div>
                <Button
                  className="secondary compact"
                  icon={Pencil}
                  onClick={() => open("client", client)}
                >
                  Editar
                </Button>
              </div>
              <div className="client-summary">
                <div>
                  <span>Atendimentos</span>
                  <strong>
                    {history.filter((a) => a.status === "completed").length}
                  </strong>
                </div>
                <div>
                  <span>Em serviços concluídos</span>
                  <strong>
                    {money(
                      history
                        .filter((a) => a.status === "completed")
                        .reduce((sum, a) => sum + Number(a.price), 0),
                    )}
                  </strong>
                </div>
                <div>
                  <span>Última visita</span>
                  <strong>
                    {history.find((a) => a.status === "completed")
                      ? new Date(history.find((a) => a.status === "completed").starts_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "short" })
                      : "—"}
                  </strong>
                </div>
              </div>
              <DuplicateSuggestion
                group={groupOf(duplicates, client.id)}
                client={client}
                visits={(c) => visits(c).length}
                onMerge={mergeGroup}
                saving={saving}
              />
              <div className="note-box">
                <h3>
                  <LockKeyhole size={15} /> Observações internas
                </h3>
                <p>
                  {client.notes ||
                    "Adicione preferências e detalhes importantes no cadastro da cliente."}
                </p>
              </div>
              <div className="button-row client-quick-actions">
                <Button
                  className="primary"
                  icon={CalendarDays}
                  onClick={() => open("appointment", { client_id: client.id })}
                >
                  Agendar horário
                </Button>
                {client.phone && (
                  <a
                    className="button secondary"
                    target="_blank"
                    rel="noreferrer"
                    href={`https://wa.me/55${client.phone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "")}`}
                  >
                    <MessageCircle size={17} /> WhatsApp
                  </a>
                )}
              </div>
              <h3>Histórico de cuidados</h3>
              {history.length ? (
                history.slice(0, historyShown).map((a) => (
                  <button
                    className="history-item"
                    key={a.id}
                    onClick={() => open("detail", a)}
                  >
                    <div>
                      <strong>{a.service_name}</strong>
                      <p>
                        {new Date(a.starts_at).toLocaleDateString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                        })}{" "}
                        · {time(a.starts_at)}
                      </p>
                    </div>
                    <Status status={a.status} />
                    <strong>{money(a.price)}</strong>
                  </button>
                ))
              ) : (
                <p className="muted">Os atendimentos aparecerão aqui.</p>
              )}
              {history.length > historyShown && <Button className="secondary" onClick={() => setHistoryShown(n => n + 30)}>Mostrar mais atendimentos</Button>}
              <ClientMerge key={client.id} client={client} clients={clients} protect={protect} mutate={mutate} saving={saving} />
            </section>
          )}
        </div>
      )}
    </>
  );
}
const categoryLooks = [
  [/unha|manicure|p[eé]s/i, Gem, 0],
  [/cabelo|escova|corte/i, Scissors, 2],
  [/maquiagem|make/i, Brush, 1],
  [/olhar|sobrancelha|c[ií]lio/i, Eye, 2],
  [/spa|bem-estar|est[eé]tica|depila/i, Flower2, 3],
];
const categoryIcon = (category = "") =>
  categoryLooks.find(([pattern]) => pattern.test(category))?.[1] || Leaf;
const categoryTone = (category = "", index) =>
  categoryLooks.find(([pattern]) => pattern.test(category))?.[2] ?? index % 4;
function Services({ services, open, protect, mutate, studio, copyLink, demo, onClara }) {
  const [filter, setFilter] = useState("active");
  const [search, setSearch] = useState("");
  const list = services.filter(
    (s) =>
      (filter === "all" || (filter === "active" ? s.active : !s.active)) &&
      s.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageTitle
        eyebrow="SEU TALENTO EM CADA DETALHE"
        title="Meus serviços"
        description="Serviços que levam a sua assinatura, do primeiro ao último detalhe."
        action={
          <Button
            className="primary"
            icon={Plus}
            onClick={() => open("service")}
          >
            Novo serviço
          </Button>
        }
      />
      <CatalogLink studio={studio} copyLink={copyLink} demo={demo} />
      <div className="filter-bar">
        <div className="tabs">
          {[
            ["active", "Disponíveis"],
            ["archived", "Arquivados"],
            ["all", "Todos"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={filter === v ? "active" : ""}
              onClick={() => setFilter(v)}
            >
              {l} {v === "all" && <small>{services.length}</small>}
            </button>
          ))}
        </div>
        <div className="search-field small">
          <Search size={17} />
          <input
            aria-label="Buscar serviço"
            placeholder="Encontre um serviço..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {!list.length ? (
        <ClaraEmptyState
          pose={services.length ? "thinking" : "idea"}
          title={services.length ? "Seu cuidado pode estar em outro filtro" : "Vamos dar espaço ao seu talento?"}
          actionLabel={services.length ? "Ver todos os serviços" : "Criar primeiro serviço"}
          onAction={() => services.length ? (setSearch(""), setFilter("all")) : open("service")}
          onHelp={onClara}
        >{services.length ? "Não encontrei serviços com essa busca e esses filtros. Vamos olhar o catálogo completo?" : "Adicione nome, valor e duração. Eu te acompanho no primeiro passo do seu catálogo."}</ClaraEmptyState>
      ) : (
        <div className="services-grid">
          {list.map((s, i) => (
            <article
              className={`service-card ${!s.active ? "archived" : ""}`}
              key={s.id}
            >
              <div className={`service-art art-${categoryTone(s.category, i)}`}>
                <span className="category-pill">{s.category}</span>
                {s.image_url && (
                  <img
                    className="service-photo" loading="lazy" decoding="async"
                    src={s.image_url}
                    alt={s.name}
                  />
                )}
                {React.createElement(categoryIcon(s.category))}
                <span className="service-duration">
                  <Clock3 size={13} />
                  {s.duration} min
                </span>
                <strong>{money(s.price)}</strong>
              </div>
              <div className="service-info">
                <h3>{s.name}</h3>
                <span className="service-timing">
                  <Clock3 size={14} />
                  {s.duration} min de atendimento · {studio.buffer} min de
                  intervalo
                </span>
                {s.allows_parallel && (
                  <span className="service-timing">
                    <Users size={14} />
                    Encaixe: até {s.parallel_limit} pessoas ao mesmo tempo
                  </span>
                )}
                <p>
                  {s.description ||
                    "Um cuidado especial para as suas clientes."}
                </p>
                <div className="service-actions">
                  <button
                    className="toggle-label"
                    onClick={() =>
                      protect(() =>
                        mutate(
                          () =>
                            query(
                              supabase
                                .from("services")
                                .update({ active: !s.active })
                                .eq("id", s.id),
                            ),
                          s.active
                            ? "Serviço arquivado."
                            : "Serviço disponível.",
                        ),
                      )
                    }
                  >
                    <span className={`toggle ${s.active ? "on" : ""}`} />
                    {s.active ? "Visível online" : "Arquivado"}
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Editar ${s.name}`}
                    onClick={() => open("service", s)}
                  >
                    <Pencil size={17} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
function Receipts({ appointments, payments, paid, open }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [filter, setFilter] = useState("all");
  const [period, setPeriod] = useState("month");
  const [rows, setRows] = useState(30);
  useEffect(() => { setRows(30); }, [month, period, filter]);
  const weekStart = shiftDate(
    today(),
    -((new Date(today() + "T12:00:00Z").getUTCDay() + 6) % 7),
  );
  const selected = appointments.filter(
    (a) =>
      new Date(a.starts_at)
        .toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
        .startsWith(period === "month" ? month : "") &&
      (period === "month" ||
        (period === "today"
          ? new Date(a.starts_at).toLocaleDateString("en-CA", {
              timeZone: "America/Sao_Paulo",
            }) === today()
          : new Date(a.starts_at).toLocaleDateString("en-CA", {
              timeZone: "America/Sao_Paulo",
            }) >= weekStart &&
            new Date(a.starts_at).toLocaleDateString("en-CA", {
              timeZone: "America/Sao_Paulo",
            }) <= shiftDate(weekStart, 6))) &&
      !["blocked", "cancelled"].includes(a.status),
  );
  const stats = totals(
    selected,
    payments.filter((p) => selected.some((a) => a.id === p.appointment_id)),
  );
  const visible = selected
    .filter(
      (a) => filter === "all" || (filter === "paid" ? paid(a.id) : !paid(a.id)),
    )
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const range =
    period === "month"
      ? [month + "-01", month + "-" + String(lastDay).padStart(2, "0")]
      : period === "today"
        ? [today(), today()]
        : [weekStart, shiftDate(weekStart, 6)];
  function exportCsv() {
    download(
      `recebimentos-${month}.csv`,
      csv([
        ["Data", "Cliente", "Serviço", "Valor", "Situação", "Forma"],
        ...visible.map((a) => [
          new Date(a.starts_at).toLocaleDateString("pt-BR"),
          a.clients?.name,
          a.service_name,
          a.price,
          paid(a.id) ? "Recebido" : "Pendente",
          paid(a.id)?.method || "",
        ]),
      ]),
    );
  }
  return (
    <>
      <PageTitle
        eyebrow="CLAREZA PARA CRESCER"
        title="Recebimentos"
        description="Acompanhe os pagamentos dos atendimentos de cada período."
        action={
          <Button className="secondary" icon={Download} onClick={exportCsv}>
            Exportar CSV
          </Button>
        }
      />
      <div className="notice">
        <Wallet size={19} />
        <span>
          Controle manual dos atendimentos. Registre o pagamento quando receber
          da cliente.
        </span>
        <label>
          <input
            aria-label="Mês dos recebimentos"
            type="month"
            value={month}
            onChange={(e) => {
              if (e.target.value) {
                setMonth(e.target.value);
                setPeriod("month");
              }
            }}
          />
        </label>
      </div>
      <div className="tabs period-tabs">
        {[
          ["today", "Hoje"],
          ["week", "Esta semana"],
          ["month", "Mês selecionado"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={period === key}
            className={period === key ? "active" : ""}
            onClick={() => setPeriod(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="stats-grid">
        <Metric
          label="Total previsto"
          value={money(stats.expected)}
          icon={Wallet}
          detail={`${stats.count} atendimentos no período`}
          accent
        />
        <Metric
          label="Recebido"
          value={money(stats.received)}
          icon={CircleCheck}
          detail="Pagamentos confirmados por você"
        />
        <Metric
          label="A receber"
          value={money(stats.pending)}
          icon={Clock3}
          detail="Valores ainda não registrados"
        />
      </div>
      <PeriodInsights
        appointments={selected}
        all={appointments}
        payments={payments}
        from={range[0]}
        to={range[1]}
      />
      <div className="panel">
        <div className="section-head">
          <h2>Atendimentos do período</h2>
          <div className="tabs">
            {[
              ["all", "Todos"],
              ["paid", "Recebidos"],
              ["pending", "Pendentes"],
            ].map(([v, l]) => (
              <button
                key={v}
                className={filter === v ? "active" : ""}
                onClick={() => setFilter(v)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        {visible.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data / horário</th>
                  <th>Cliente / serviço</th>
                  <th>Forma</th>
                  <th>Situação</th>
                  <th>Valor</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, rows).map((a) => (
                  <tr key={a.id}>
                    <td>
                      {new Date(a.starts_at).toLocaleDateString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                      })}
                      <small>{time(a.starts_at)}</small>
                    </td>
                    <td>
                      <strong>{a.clients?.name}</strong>
                      <small>{a.service_name}</small>
                    </td>
                    <td>{paid(a.id)?.method || "—"}</td>
                    <td>
                      <span
                        className={`badge ${paid(a.id) ? "completed" : "pending"}`}
                      >
                        {paid(a.id) ? "Recebido" : "Pendente"}
                      </span>
                    </td>
                    <td>
                      <strong>{money(a.price)}</strong>
                    </td>
                    <td>
                      <Button
                        className={
                          paid(a.id) ? "secondary compact" : "primary compact"
                        }
                        onClick={() =>
                          open(paid(a.id) ? "detail" : "payment", a)
                        }
                      >
                        {paid(a.id) ? "Detalhes" : "Registrar"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length > rows && (
              <div className="table-more">
                <Button className="secondary" onClick={() => setRows((n) => n + 30)}>
                  Mostrar mais {Math.min(30, visible.length - rows)} de {visible.length - rows}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Empty icon={Wallet} title="Tudo começa com um atendimento">
            Os valores da sua agenda aparecerão neste período.
          </Empty>
        )}
      </div>
    </>
  );
}
function Space({ studio, protect, mutate, notify, demo, copyLink }) {
  const [hours, setHours] = useState([]);
  const [hoursError, setHoursError] = useState(false);
  const [hoursAttempt, setHoursAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setHoursError(false);
    if (demo) {
      setHours(
        Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          enabled: weekday > 0,
          opens: "09:00",
          closes: "18:00",
          break_start: "12:00",
          break_end: "13:00",
        })),
      );
      return;
    }
    query(
      supabase
        .from("working_hours")
        .select("*")
        .eq("studio_id", studio.id)
        .order("weekday"),
    )
      .then(result => { if (current) setHours(result); })
      .catch((e) => { if (current) { setHoursError(true); notify(errorMessage(e), true); } });
    return () => { current = false; };
  }, [studio.id, demo, notify, hoursAttempt]);
  function save(e) {
    e.preventDefault();
    const f = fieldData(e);
    protect(() =>
      mutate(
        () =>
          query(
            supabase
              .from("studios")
              .update({
                name: f.name,
                professional: f.professional,
                bio: f.bio,
                image_url: f.image_url || "",
                phone: f.phone,
                address: f.address,
                slug: f.slug,
                active: f.active === "on",
                min_notice: Number(f.min_notice),
                horizon: Number(f.horizon),
                buffer: Number(f.buffer),
              })
              .eq("id", studio.id),
          ),
        "Seu espaço foi atualizado.",
      ),
    );
  }
  const change = (day, key, value) =>
    setHours((h) =>
      h.map((x) => (x.weekday === day ? { ...x, [key]: value } : x)),
    );
  return (
    <>
      <PageTitle
        eyebrow="COM A SUA IDENTIDADE"
        title="Meu espaço"
        description="Os detalhes que acolhem suas clientes e organizam sua rotina."
      />
      {hoursError && <div role="alert" className="notice"><span>Não foi possível carregar o expediente.</span><Button className="secondary" onClick={() => setHoursAttempt(n => n + 1)}>Tentar novamente</Button></div>}
      <CatalogLink studio={studio} copyLink={copyLink} demo={demo} />
      <div className="profile-links">
        <a href={demo ? "#/demo/online" : "#/app/online"}>
          <Link2 size={18} /> Página de agendamento <ChevronRight size={16} />
        </a>
        <a href={demo ? "#/demo/assinatura" : "#/app/assinatura"}>
          <CreditCard size={18} /> Minha assinatura <ChevronRight size={16} />
        </a>
      </div>
      <div className="settings-grid">
        <form className="panel" onSubmit={save}>
          <div className="section-head">
            <h2>
              <Store size={20} /> Identidade do estúdio
            </h2>
            <span className="badge completed">Sua marca</span>
          </div>
          <div className="identity-banner">
            <Avatar large name={studio.name} />
            <div>
              <strong>{studio.name}</strong>
              <p>Um espaço de cuidado com a sua assinatura.</p>
            </div>
          </div>
          <MediaUpload
            initial={studio.image_url}
            notify={notify}
            disabled={demo}
          />
          <Field
            label="Nome do espaço"
            name="name"
            defaultValue={studio.name}
            required
            minLength={2}
            maxLength={100}
          />
          <div className="form-row">
            <Field
              label="Profissional responsável"
              name="professional"
              defaultValue={studio.professional}
              required
              maxLength={100}
            />
            <Field
              label="WhatsApp profissional"
              name="phone"
              defaultValue={studio.phone}
              maxLength={30}
              placeholder="11999999999"
            />
          </div>
          <Field label="Uma apresentação acolhedora">
            <textarea
              name="bio"
              defaultValue={studio.bio}
              rows={3}
              maxLength={300}
            />
          </Field>
          <Field
            label="Endereço"
            name="address"
            defaultValue={studio.address}
            maxLength={300}
          />
          <StudioLinkField key={studio.slug} initialValue={studio.slug} demo={demo} />
          <p className="micro">
            Ao alterar o endereço, os links e QR Codes anteriores continuam funcionando e permanecem reservados para seu estúdio.
          </p>
          <label className="check-field">
            <input
              type="checkbox"
              name="active"
              defaultChecked={studio.active}
            />{" "}
            Receber agendamentos online
          </label>
          <h3 className="form-section">Regras da agenda</h3>
          <div className="form-row">
            <Field label="Antecedência mínima">
              <select name="min_notice" defaultValue={studio.min_notice}>
                <option value="0">Sem antecedência</option>
                <option value="60">1 hora</option>
                <option value="120">2 horas</option>
                <option value="240">4 horas</option>
                <option value="1440">24 horas</option>
              </select>
            </Field>
            <Field label="Janela de reservas">
              <select name="horizon" defaultValue={studio.horizon}>
                <option value="15">15 dias</option>
                <option value="30">30 dias</option>
                <option value="60">60 dias</option>
                <option value="90">90 dias</option>
              </select>
            </Field>
          </div>
          <Field label="Intervalo após cada atendimento">
            <select name="buffer" defaultValue={studio.buffer}>
              {[0, 5, 10, 15, 20, 30, 60].map((n) => (
                <option key={n} value={n}>
                  {n} minutos
                </option>
              ))}
            </select>
          </Field>
          <div className="note-box">
            <ShieldCheck size={17} /> As clientes podem cancelar ou remarcar até
            2 horas antes. Os horários consideram o fuso de São Paulo.
          </div>
          <Button className="primary" icon={Check}>
            Salvar alterações
          </Button>
        </form>
        <div>
          <form
            className="panel hours-panel"
            onSubmit={(e) => {
              e.preventDefault();
              protect(() =>
                mutate(
                  () =>
                    rpc("save_hours", { p_studio: studio.id, p_hours: hours }),
                  "Expediente atualizado.",
                ),
              );
            }}
          >
            <div className="section-head">
              <h2>
                <Clock3 size={20} /> Seu expediente
              </h2>
            </div>
            <p className="muted">Horários de atendimento e pausas da semana.</p>
            <button
              className="button secondary full copy-hours"
              type="button"
              disabled={hours.length !== 7}
              onClick={() => {
                const monday = hours.find((h) => h.weekday === 1);
                if (monday)
                  setHours(
                    hours.map((h) =>
                      h.weekday >= 2 && h.weekday <= 5
                        ? {
                            ...h,
                            enabled: monday.enabled,
                            opens: monday.opens,
                            closes: monday.closes,
                            break_start: monday.break_start,
                            break_end: monday.break_end,
                          }
                        : h,
                    ),
                  );
              }}
            >
              <Copy size={16} /> Repetir segunda de terça a sexta
            </button>
            <HoursEditor hours={hours} change={change} breakLabel="Pausa durante o dia" />
            <Button
              className="primary full"
              icon={Check}
              disabled={hours.length !== 7}
            >
              Salvar expediente
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}
function Online({ studio, services, demo, copyLink, notify }) {
  const link = `${location.origin}/#/booking/${studio.slug}`;
  return (
    <>
      <PageTitle
        eyebrow="SEU ESTÚDIO DE PORTAS ABERTAS"
        title="Minha página de agendamento"
        description="Suas clientes agendam com autonomia, enquanto você faz o que ama."
        action={
          !demo && (
            <a
              className="button secondary"
              href={link}
              target="_blank"
              rel="noreferrer"
            >
              Ver como cliente <ArrowUpRight size={17} />
            </a>
          )
        }
      />
      <div className="online-grid">
        <div>
          <div className="panel clara-sharing-panel">
            <div className="clara-sharing-heading">
              <div>
                <span className="badge completed">
                  {studio.active ? "Reservas online ativas" : "Reservas pausadas"}
                </span>
                <h2>Seu endereço de cuidado.</h2>
              </div>
              <ClaraArt className="clara-sharing-art" pose="left" loading="lazy" />
            </div>
            <p>
              Coloque na bio do Instagram, compartilhe no WhatsApp ou envie
              depois de um atendimento.
            </p>
            <div className="link-display">
              <Link2 size={20} />
              <span>{demo ? `${location.host}/#/booking/${studio.slug}` : link}</span>
            </div>
            <div className="button-row">
              <Button className="primary" icon={Copy} onClick={copyLink}>
                Copiar link
              </Button>
              <QRButton link={link} demo={demo} notify={notify} />
              {!demo && canShareLinks && (
                <a
                  className="button secondary"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://wa.me/?text=${encodeURIComponent("Olá! Escolha seu próximo horário no meu estúdio: " + link)}`}
                >
                  <MessageCircle size={18} /> Compartilhar
                </a>
              )}
            </div>
            {!canShareLinks && <p role="note">{sharingUnavailable}</p>}
          </div>
          <div className="panel online-how">
            <h2>Simples para você e para ela.</h2>
            {[
              [
                "01",
                "Ela escolhe o cuidado",
                "Seu catálogo apresenta valor e duração de cada serviço.",
              ],
              [
                "02",
                "Encontra o melhor horário",
                "Só aparecem horários livres, respeitando seu expediente.",
              ],
              [
                "03",
                "Pronto. Está na sua agenda.",
                "A reserva é confirmada no site, com um link para gerenciar.",
              ],
            ].map(([n, t, p]) => (
              <div key={n}>
                <span>{n}</span>
                <section>
                  <h3>{t}</h3>
                  <p>{p}</p>
                </section>
              </div>
            ))}
          </div>
          <div className="notice">
            <ShieldCheck size={22} />
            <p>
              Horários protegidos contra sobreposição. Cancelamento e remarcação
              até 2 horas antes do atendimento.
            </p>
          </div>
        </div>
        <div className="phone-preview">
          <div className="phone-notch" />
          <div className="preview-top">
            <BrandLogo /> <LockKeyhole size={12} />
          </div>
          <div className="preview-profile">
            {studio.image_url ? (
              <img loading="lazy" decoding="async" src={studio.image_url} alt={studio.name} />
            ) : demo ? (
              <img loading="lazy" decoding="async" src="/studio-portrait.png" alt="Imagem de demonstração" />
            ) : (
              <Avatar large name={studio.name} />
            )}
            <h2>{studio.name}</h2>
            <p>{studio.bio || "Escolha seu próximo momento de cuidado."}</p>
            <span>
              <MapPin size={12} /> {studio.address || "Seu endereço"}
            </span>
          </div>
          <h3>Escolha seu cuidado</h3>
          {services
            .filter((s) => s.active)
            .slice(0, 3)
            .map((s) => (
              <div className="preview-service" key={s.id}>
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {s.duration} min · {money(s.price)}
                  </small>
                </span>
                <Plus size={16} />
              </div>
            ))}
          {!services.length && <p>Seus serviços aparecerão aqui.</p>}
          <div className="preview-bottom">
            Uma rotina mais leve começa aqui. <BrandMark size={24} />
          </div>
        </div>
      </div>
    </>
  );
}
function Editor({
  onRescheduled,
  modal,
  professionals,
  professionalFilter,
  studio,
  clients,
  services,
  appointments,
  payments,
  paid,
  day,
  onClose,
  mutate,
  saving,
  open,
  notify,
}) {
  const { type, item } = modal;
  const [method, setMethod] = useState("Pix");
  const [action, setAction] = useState(null);
  const [serviceIds, setServiceIds] = useState(
    item?.service_ids?.length
      ? item.service_ids
      : item?.service_id
        ? [item.service_id]
        : [],
  );
  const [appointmentTime, setAppointmentTime] = useState("");
  const [slotRefresh, setSlotRefresh] = useState(0);
  const [scheduleError, setScheduleError] = useState("");
  const [editorProfessional, setEditorProfessional] = useState(item?.professional_id || professionals.find((p) => p.id === professionalFilter && p.active)?.id || professionals.find((p) => p.active)?.id || "");
  const [appointmentDate, setAppointmentDate] = useState(day);
  const selectedServices = serviceIds
    .map((id) => {
      const catalog = services.find((s) => s.id === id);
      const unchanged =
        type === "appointmentServices" &&
        JSON.stringify(serviceIds) === JSON.stringify(item?.service_ids);
      const original =
        unchanged && item?.service_items?.find((s) => s.id === id);
      return original ? { ...catalog, ...original } : catalog;
    })
    .filter(Boolean);
  const titles = {
    client: item ? "Editar cliente" : "Uma nova conexão",
    service: item ? "Editar serviço" : "Um novo cuidado",
    appointment: "Novo agendamento",
    appointmentServices: "Ajustar serviços do atendimento",
    block: "Um tempo para você",
    detail: "Detalhes do atendimento",
    payment: "Registrar recebimento",
  };
  async function checkedAppointmentWrite(write, ids, start, professionalId, appointmentId) {
    setScheduleError("");
    try {
      const slots = await rpc("owner_available_slots", { p_studio: studio.id, p_professional: professionalId,
        p_services: ids, p_date: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(start)),
        p_appointment: appointmentId || null });
      if (!hasSlot(slots, start)) throw new Error("Esse horário não está mais disponível para o atendimento completo. Escolha outro horário.");
      return await write();
    } catch (error) {
      setScheduleError(errorMessage(error)); setAppointmentTime(""); setSlotRefresh((n) => n + 1); throw error;
    }
  }
  async function save(e) {
    e.preventDefault();
    const f = fieldData(e);
    if (type === "appointmentServices")
      return mutate(
        () => checkedAppointmentWrite(() => query(supabase.from("appointments")
          .update({ service_ids: serviceIds }).eq("id", item.id).eq("starts_at", item.starts_at).select("id").single()),
          serviceIds, item.starts_at, item.professional_id, item.id),
        "Serviços e horário final atualizados.",
      );
    if (type === "client")
      return mutate(
        () =>
          query(
            item
              ? supabase
                  .from("clients")
                  .update({
                    name: f.name,
                    email: f.email,
                    phone: f.phone,
                    notes: f.notes,
                  })
                  .eq("id", item.id)
              : supabase.from("clients").insert({ ...f, studio_id: studio.id }),
          ),
        "Cliente salva.",
      );
    if (type === "service") {
      const data = {
        name: f.name,
        description: f.description,
        image_url: f.image_url || "",
        category: f.category,
        price: Number(f.price),
        duration: Number(f.duration),
        resource_id: f.resource_id === "none" ? null : f.resource_id,
        ...parallelServiceData(f, item),
        active: f.active === "on",
      };
      return mutate(
        () =>
          query(
            item
              ? supabase.from("services").update(data).eq("id", item.id)
              : supabase
                  .from("services")
                  .insert({ ...data, studio_id: studio.id }),
          ),
        "Serviço salvo.",
        undefined,
        item ? undefined : "service-created",
      );
    }
    if (type === "appointment" || type === "block") {
      if (!f.time) { notify("Selecione um horário livre.", true); return; }
      const start = studioInstant(f.date, f.time);
      const data = {
        studio_id: studio.id,
        professional_id: f.professional_id,
        starts_at: start,
        ends_at:
          type === "block"
            ? studioInstant(f.date, f.end)
            : new Date(new Date(start).getTime() + 60000).toISOString(),
        status: type === "block" ? "blocked" : "confirmed",
        notes: f.notes || "",
        ...(type === "appointment"
          ? { service_ids: serviceIds, client_id: f.client_id }
          : {}),
      };
      return mutate(
        () => type === "block" ? query(supabase.from("appointments").insert(data)) :
          checkedAppointmentWrite(() => query(supabase.from("appointments").insert(data)), serviceIds, start, f.professional_id),
        type === "block" ? "Horário bloqueado." : "Agendamento confirmado.",
      );
    }
    if (type === "payment")
      return mutate(
        () =>
          query(
            supabase.from("payments").insert({
              studio_id: studio.id,
              appointment_id: item.id,
              amount: item.price,
              method,
            }),
          ),
        "Pagamento registrado.",
      );
  }
  return (
    <Modal title={titles[type]} onClose={onClose}>
      {type === "detail" ? (
        <>
          <div className="detail-person">
            <Avatar large name={item.clients?.name || "Pausa"} />
            <div>
              <h3>{item.clients?.name || "Horário bloqueado"}</h3>
              <Status status={item.status} />
            </div>
          </div>
          <div className="detail-summary">
            <span>Profissional: {professionals.find((p) => p.id === item.professional_id)?.name || studio.professional}</span>
            <span>{item.service_name}</span>
            <strong>{money(item.price)}</strong>
            <span>
              {new Date(item.starts_at).toLocaleDateString("pt-BR", {
                timeZone: "America/Sao_Paulo",
              })}
            </span>
            <strong>
              {time(item.starts_at)} — {time(item.ends_at)}
            </strong>
          </div>
          <ServiceBreakdown
            items={item.service_items}
            startsAt={item.starts_at}
          />
          {item.notes && <div className="note-box">{item.notes}</div>}
          {item.client_id && (
            <AppointmentDuplicateHint
              clientId={item.client_id}
              clients={clients}
              appointments={appointments}
              saving={saving}
              onMerge={(target, sources) =>
                mutate(
                  () => rpc("merge_client_group", { p_target: target, p_sources: sources }),
                  "Cadastros unificados. Histórico preservado.",
                )
              }
            />
          )}
          {paid(item.id) && (
            <div className="notice">
              <CircleCheck size={20} /> Recebido via {paid(item.id).method} ·{" "}
              {money(paid(item.id).amount)}
            </div>
          )}
          {item.status === "confirmed" && (
            <div className="button-row">
              <Button
                className="primary"
                busy={saving}
                icon={Check}
                onClick={() =>
                  mutate(
                    () =>
                      query(
                        supabase
                          .from("appointments")
                          .update({ status: "completed" })
                          .eq("id", item.id).eq("status", "confirmed").select("id").single(),
                      ),
                    "Atendimento concluído.",
                    undefined,
                    "appointment-completed",
                  )
                }
              >
                Concluir atendimento
              </Button>
              {!paid(item.id) && (
                <Button
                  className="secondary"
                  icon={Wallet}
                  onClick={() => open("payment", item)}
                >
                  Registrar pagamento
                </Button>
              )}
            </div>
          )}
          {item.status === "completed" && !paid(item.id) && (
            <Button
              className="primary full"
              onClick={() => open("payment", item)}
            >
              Registrar pagamento
            </Button>
          )}
          {item.clients?.phone && (
            <a
              className="button secondary full"
              href={`https://wa.me/55${item.clients.phone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "")}`}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={17} /> Conversar no WhatsApp
            </a>
          )}
          {["confirmed", "blocked"].includes(item.status) && !paid(item.id) && (
            <div className="detail-actions">
              {item.status === "confirmed" && (
                <Button
                  className="secondary"
                  icon={Flower2}
                  onClick={() => open("appointmentServices", item)}
                >
                  Ajustar serviços
                </Button>
              )}
              <Button
                className="secondary"
                icon={Pencil}
                onClick={() => setAction("reschedule")}
              >
                Remarcar
              </Button>
              <Button
                className="danger"
                icon={Ban}
                onClick={() => setAction("cancel")}
              >
                {item.status === "blocked"
                  ? "Liberar horário"
                  : "Cancelar atendimento"}
              </Button>
            </div>
          )}
          {action === "cancel" && (
            <div className="confirm-box">
              <strong>
                {item.status === "blocked"
                  ? "Liberar este horário?"
                  : "Cancelar este atendimento?"}
              </strong>
              <p>O horário ficará disponível para outras reservas.</p>
              <Button
                busy={saving}
                className="danger"
                onClick={() =>
                  mutate(
                    () =>
                      query(
                        item.status === "blocked"
                          ? supabase
                              .from("appointments")
                              .delete()
                              .eq("id", item.id)
                          : supabase
                              .from("appointments")
                              .update({ status: "cancelled" })
                              .eq("id", item.id),
                      ),
                    "Horário liberado.",
                  )
                }
              >
                Confirmar{" "}
                {item.status === "blocked" ? "liberação" : "cancelamento"}
              </Button>
            </div>
          )}
          {action === "reschedule" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = fieldData(e);
                if (!f.time) { notify("Selecione um horário livre.", true); return; }
                const start = studioInstant(f.date, f.time);
                const update = { starts_at: start, professional_id: f.professional_id };
                if (item.status === "blocked")
                  update.ends_at = new Date(
                    new Date(start).getTime() +
                      new Date(item.ends_at).getTime() -
                      new Date(item.starts_at).getTime(),
                  ).toISOString();
                mutate(
                  () => {
                    const write = () => query(supabase.from("appointments").update(update).eq("id", item.id)
                      .eq("starts_at", item.starts_at).select("id").single());
                    return item.status === "blocked" ? write() : checkedAppointmentWrite(write, item.service_ids, start, f.professional_id, item.id);
                  },
                  "Horário atualizado.",
                  () => { if(item.status!=="blocked") onRescheduled({id:Date.now(),phone:item.clients?.phone,text:rescheduleMessage(item,start,studio,professionals.find(p=>p.id===f.professional_id)?.name)}); },
                );
              }}
            >
              <Field label="Profissional do atendimento">
                <select name="professional_id" required value={editorProfessional} onChange={(e) => { setEditorProfessional(e.target.value); setAppointmentTime(""); }}>
                  {professionals.filter((p) => p.active || p.id === item.professional_id).map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : " (inativa)"}</option>)}
                </select>
              </Field>
              <div className="form-row">
                <Field
                  label="Nova data"
                  name="date"
                  type="date"
                  required
                  min={today()}
                  value={appointmentDate}
                  onChange={(e) => { setAppointmentDate(e.target.value); setAppointmentTime(""); }}
                />
                {item.status === "blocked" ? <Field label="Novo horário" name="time" type="time" required /> :
                  <OwnerSlots studioId={studio.id} professionalId={editorProfessional} services={item.service_ids}
                    date={appointmentDate} appointmentId={item.id} value={appointmentTime} onChange={setAppointmentTime} refresh={slotRefresh} />}
              </div>
              {scheduleError && <p className="note-box" role="alert">{scheduleError}</p>}
              <Button className="primary" busy={saving} disabled={item.status !== "blocked" && !appointmentTime}>
                Confirmar novo horário
              </Button>
            </form>
          )}
        </>
      ) : (
        <form onSubmit={save}>
          {scheduleError && <p className="note-box" role="alert">{scheduleError}</p>}
          {type === "appointmentServices" && (
            <>
              <p>
                Adicione ou remova serviços. O início continua às{" "}
                {time(item.starts_at)}; ao mudar a seleção, o término e o valor
                serão recalculados pelos valores atuais do catálogo.
              </p>
              <ServicePicker
                services={services}
                selected={serviceIds}
                onChange={setServiceIds}
              />
              <SelectionSummary
                items={selectedServices}
                startsAt={item.starts_at}
                buffer={studio.buffer}
                internal
              />
              <div className="note-box">
                Se o novo tempo invadir outro atendimento ou intervalo
                reservado, a alteração será recusada. Você poderá remarcar o
                atendimento.
              </div>
            </>
          )}
          {type === "client" && (
            <>
              <Field
                label="Nome completo"
                name="name"
                defaultValue={item?.name}
                minLength={2}
                maxLength={120}
                required
              />
              <div className="form-row">
                <Field
                  label="E-mail"
                  name="email"
                  type="email"
                  maxLength={254}
                  defaultValue={item?.email}
                />
                <Field
                  label="WhatsApp"
                  name="phone"
                  maxLength={30}
                  defaultValue={item?.phone}
                />
              </div>
              <Field label="Observações internas">
                <textarea
                  name="notes"
                  rows={4}
                  maxLength={5000}
                  defaultValue={item?.notes}
                  placeholder="Preferências e detalhes de atendimento..."
                />
              </Field>
              <p className="micro">
                <LockKeyhole size={12} /> Essas observações ficam apenas no seu
                painel.
              </p>
            </>
          )}
          {type === "service" && (
            <>
              <MediaUpload initial={item?.image_url} notify={notify} />
              <Field
                label="Nome do serviço"
                name="name"
                minLength={2}
                maxLength={120}
                defaultValue={item?.name}
                required
              />
              <ResourceField studioId={studio.id} value={item?.resource_id} />
              <Field label="Categoria">
                <select
                  name="category"
                  defaultValue={item?.category || "Unhas & cuidados"}
                >
                  {[
                    "Unhas & cuidados",
                    "Olhar & beleza",
                    "Bem-estar & spa",
                    "Cabelo & estilo",
                    "Maquiagem & produção",
                    "Estética & depilação",
                    "Outros",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <div className="form-row">
                <Field
                  label="Valor (R$)"
                  name="price"
                  type="number"
                  min="0"
                  step="0.01"
                  max="99999999"
                  defaultValue={item?.price}
                  required
                />
                <Field
                  label="Duração (minutos)"
                  name="duration"
                  type="number"
                  min="5"
                  max="480"
                  step="5"
                  defaultValue={item?.duration || 45}
                  required
                />
              </div>
              <Field label="Descrição">
                <textarea
                  name="description"
                  rows={3}
                  maxLength={1000}
                  defaultValue={item?.description}
                />
              </Field>
              <ServiceParallelFields item={item} />
              <label className="check-field">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={item?.active ?? true}
                />{" "}
                Disponível na página de reservas
              </label>
            </>
          )}
          {type === "appointment" && (
            <>
              <Field label="Cliente">
                <select
                  name="client_id"
                  required
                  defaultValue={item?.client_id || ""}
                >
                  <option value="" disabled>
                    Selecione uma cliente
                  </option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              {!clients.length && (
                <p className="micro">
                  Cadastre uma cliente na seção Clientes antes de agendar.
                </p>
              )}
              <ServicePicker
                services={services}
                selected={serviceIds}
                onChange={setServiceIds}
              />
            </>
          )}
          {["appointment", "block"].includes(type) && (
            <>
              <Field label={type === "block" ? "Bloquear a agenda de" : "Profissional"}>
                <select name="professional_id" required value={editorProfessional} onChange={(e) => { setEditorProfessional(e.target.value); setAppointmentTime(""); }}>
                  <option value="" disabled>Selecione a profissional</option>
                  {professionals.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <div className="form-row">
                <Field
                  label="Data"
                  type="date"
                  name="date"
                  value={appointmentDate}
                  onChange={(e) => { setAppointmentDate(e.target.value); setAppointmentTime(""); }}
                  min={today()}
                  required
                />
                {type === "block" ? <Field label="Horário" type="time" name="time" required value={appointmentTime}
                  onChange={(e) => setAppointmentTime(e.target.value)} /> :
                  <OwnerSlots studioId={studio.id} professionalId={editorProfessional} services={serviceIds}
                    date={appointmentDate} value={appointmentTime} onChange={setAppointmentTime} refresh={slotRefresh} />}
              </div>
              {type === "appointment" && (
                <SelectionSummary
                  items={selectedServices}
                  startsAt={
                    appointmentTime
                      ? studioInstant(appointmentDate, appointmentTime)
                      : undefined
                  }
                  buffer={studio.buffer}
                  internal
                />
              )}
              {type === "block" && (
                <Field
                  label="Até que horário?"
                  type="time"
                  name="end"
                  required
                />
              )}
              <Field
                label={
                  type === "block"
                    ? "Motivo da pausa"
                    : "Observação do atendimento"
                }
              >
                <textarea name="notes" maxLength={2000} rows={2} />
              </Field>
              <div className="note-box">
                <Clock3 size={17} />{" "}
                {type === "block"
                  ? "Esse intervalo ficará indisponível para reservas."
                  : "O atendimento e a limpeza devem caber no expediente, sem conflitos de profissional, sala ou maca. Horários de São Paulo."}
              </div>
            </>
          )}
          {type === "payment" && (
            <>
              <div className="payment-value">
                <span>{item.clients?.name}</span>
                <h2>{money(item.price)}</h2>
                <p>{item.service_name}</p>
              </div>
              <p>Como a cliente pagou?</p>
              <div className="payment-methods">
                {["Pix", "Cartão", "Dinheiro"].map((m) => (
                  <button
                    type="button"
                    key={m}
                    className={method === m ? "selected" : ""}
                    onClick={() => setMethod(m)}
                  >
                    {method === m && <Check size={16} />} {m}
                  </button>
                ))}
              </div>
              <div className="note-box">
                Este registro confirma um pagamento que você já recebeu. Nenhuma
                cobrança será enviada à cliente.
              </div>
            </>
          )}
          <div className="modal-footer">
            <Button type="button" className="secondary" onClick={onClose}>
              Voltar
            </Button>
            <Button
              busy={saving}
              className="primary"
              icon={Check}
              disabled={
                ["appointment", "appointmentServices"].includes(type) &&
                (!serviceIds.length ||
                  selectedServices.some((s) => !s.active) ||
                  (type === "appointment" && (!clients.length || !appointmentTime)))
              }
            >
              {type === "payment" ? "Confirmar recebimento" : "Salvar"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

createRoot(document.getElementById("root")).render(<ErrorBoundary><App /></ErrorBoundary>);
