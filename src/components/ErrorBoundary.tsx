import { Component, type ReactNode } from "react";

interface Props {
  /** Nom de la zone, affiché dans le message. */
  area: string;
  children: ReactNode;
  /** Pleine page : propose aussi de réinitialiser les réglages enregistrés. */
  fullPage?: boolean;
  /** Classe du conteneur de remplacement (pour garder sa place dans la mise en page). */
  className?: string;
}

interface State {
  error: Error | null;
}

/**
 * Filet de sécurité : si une partie de l'interface plante, on affiche un message
 * à sa place au lieu de laisser toute la page vide.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.area}]`, error);
  }

  private resetSettings = () => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("market-desk:")) localStorage.removeItem(k);
    } catch {
      /* stockage indisponible */
    }
    location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={this.props.className}>
      <div className={`crash ${this.props.fullPage ? "full" : ""}`}>
        <b>Un problème est survenu dans : {this.props.area}</b>
        <code>{error.message}</code>
        <div className="crash-actions">
          <button className="btn primary" onClick={() => this.setState({ error: null })}>Réessayer</button>
          <button className="btn" onClick={() => location.reload()}>Recharger la page</button>
          {this.props.fullPage && <button className="btn ghost" onClick={this.resetSettings}>Réinitialiser les réglages</button>}
        </div>
      </div>
      </div>
    );
  }
}
