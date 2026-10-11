import React from "react";
export default class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main
          className="panel"
          role="alert"
          style={{ maxWidth: 560, margin: "60px auto", padding: 32 }}
        >
          <h1>Vamos tentar de novo?</h1>
          <p>
            Não foi possível abrir esta tela. Seus dados salvos continuam no seu
            espaço.
          </p>
          <button className="button primary" onClick={() => location.reload()}>
            Recarregar aplicativo
          </button>
        </main>
      );
    return this.props.children;
  }
}
