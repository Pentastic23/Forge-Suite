import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

export interface NavItem<K extends string> {
  key: K;
  label: string;
  icon?: ReactNode;
}

export function AppShell<K extends string>(props: {
  brand: { name: string; logo: string };
  nav: NavItem<K>[];
  footerNav?: NavItem<K>[];
  current: K;
  onNavigate: (key: K) => void;
  children: ReactNode;
}) {
  const item = (n: NavItem<K>) => (
    <button
      key={n.key}
      className="forge-nav-item"
      aria-current={props.current === n.key ? "page" : undefined}
      onClick={() => props.onNavigate(n.key)}
    >
      {n.icon}
      {n.label}
    </button>
  );
  return (
    <div className="forge-shell">
      <nav className="forge-sidebar" aria-label="Main">
        <div className="forge-brand">
          <img src={props.brand.logo} alt="" />
          {props.brand.name}
        </div>
        {props.nav.map(item)}
        <div className="forge-nav-spacer" />
        {props.footerNav?.map(item)}
      </nav>
      <main className="forge-main">{props.children}</main>
    </div>
  );
}

export function PageHeader(props: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
      <div>
        <h1 className="forge-page-title">{props.title}</h1>
        {props.subtitle && <p className="forge-page-sub">{props.subtitle}</p>}
      </div>
      {props.actions && <div style={{ display: "flex", gap: 8 }}>{props.actions}</div>}
    </header>
  );
}

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  const { variant, className, ...rest } = props;
  return <button {...rest} className={["forge-btn", variant, className].filter(Boolean).join(" ")} />;
}

export function Card(props: { children: ReactNode; interactive?: boolean; accent?: string; className?: string }) {
  return (
    <div
      className={["forge-card", props.interactive && "interactive", props.className].filter(Boolean).join(" ")}
      style={props.accent ? ({ "--forge-accent": props.accent } as CSSProperties) : undefined}
    >
      {props.children}
    </div>
  );
}

export function Badge(props: { children: ReactNode; tone?: "good" | "warn" | "bad" }) {
  return <span className={["forge-badge", props.tone].filter(Boolean).join(" ")}>{props.children}</span>;
}

export function EmptyState(props: { title: string; children?: ReactNode }) {
  return (
    <div className="forge-empty">
      <h3>{props.title}</h3>
      {props.children}
    </div>
  );
}
