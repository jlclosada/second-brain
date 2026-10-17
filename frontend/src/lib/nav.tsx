import { addTransitionType, startTransition, ViewTransition, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate, type LinkProps } from "react-router-dom";

// Transiciones de vista con el <ViewTransition> de React.
//  - Ir a un detalle (lista → documento, nota…) desliza hacia delante; volver, hacia atrás.
//  - Cambiar de sección (Hoy → Calendario) solo funde: no hay profundidad que contar.

export type NavType = "nav-forward" | "nav-back";

export function useGo() {
  const navigate = useNavigate();
  return (to: string, type?: NavType, opts?: { replace?: boolean }) =>
    startTransition(() => {
      if (type) addTransitionType(type);
      navigate(to, opts);
    });
}

/** Enlace que añade el tipo de transición (nav-forward / nav-back). */
export function GoLink({ to, type = "nav-forward", onClick, ...rest }: LinkProps & { to: string; type?: NavType }) {
  const go = useGo();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    go(to, type);
  };
  return <Link to={to} onClick={handle} {...rest} />;
}

/** Envuelve cada página: desliza en navegación jerárquica, funde entre secciones. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <ViewTransition
      enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "fade-in" }}
      exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "fade-out" }}
      default="none"
    >
      <div className="min-w-0">{children}</div>
    </ViewTransition>
  );
}

/** Mismo elemento en la lista y en el detalle: el título viaja de un sitio a otro. */
export function Shared({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ViewTransition name={name} share="morph" default="none">
      {children}
    </ViewTransition>
  );
}

/** Ejecuta un cambio de estado como transición para que las listas animen su nuevo orden. */
export const animate = (fn: () => void) => startTransition(fn);
