import { useQuery } from '@tanstack/react-query';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { adminSessionQueryOptions } from '../session-query.js';
import { isAuthNotConfiguredError } from '../auth-session.js';

export function AuthenticatedAdminLayout() {
  const sessionQuery = useQuery(adminSessionQueryOptions());

  if (sessionQuery.isPending) {
    return (
      <main className="auth-state auth-state--pending">
        <p className="eyebrow">Better Auth session</p>
        <h1>Verifying operator session…</h1>
        <p>The admin shell waits for the real Better Auth cookie session before rendering.</p>
      </main>
    );
  }

  if (sessionQuery.isError) {
    // Local-development-only preview. `import.meta.env.DEV` is statically replaced
    // with `false` by `vite build`, so this whole branch (and LocalDevPreviewShell)
    // is dead-code-eliminated from production bundles and can never render there.
    // It also requires the Control API to report AUTH_NOT_CONFIGURED, which only
    // happens when no Better Auth database adapter is wired.
    if (import.meta.env.DEV && isAuthNotConfiguredError(sessionQuery.error)) {
      return <LocalDevPreviewShell />;
    }

    return (
      <main className="auth-state auth-state--error" role="alert">
        <p className="eyebrow">Fail closed</p>
        <h1>Session check unavailable.</h1>
        <p>{sessionQuery.error.message}</p>
      </main>
    );
  }

  if (sessionQuery.data === null) {
    return (
      <main className="auth-state auth-state--signed-out">
        <p className="eyebrow">Authentication required</p>
        <h1>No admin session found.</h1>
        <p>Sign in through the Control API Better Auth flow before opening the portal.</p>
        <a href="/api/auth/sign-in" className="auth-state__link">
          Open Better Auth sign-in
        </a>
      </main>
    );
  }

  return (
    <div className="admin-shell">
      <NavigationRail />

      <div className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">DevGateway Admin</p>
            <strong>Admin session verified</strong>
          </div>
          <div className="operator-chip" aria-label="Authenticated operator">
            <span>{sessionQuery.data.user.name}</span>
            <small>{sessionQuery.data.user.email} · {sessionQuery.data.user.role}</small>
          </div>
        </header>

        <Outlet />
      </div>
    </div>
  );
}

function LocalDevPreviewShell() {
  return (
    <div className="admin-shell">
      <NavigationRail />

      <div className="workspace workspace--preview">
        <div className="preview-banner" role="status">
          <strong>Local dev — unauthenticated preview</strong>
          <span>
            Production stays fail-closed (Better Auth admin session + TOTP required). The Control API reports
            AUTH_NOT_CONFIGURED, so secret-bearing routes remain denied and only read-only snapshots render.
          </span>
        </div>

        <header className="topbar">
          <div>
            <p className="eyebrow">DevGateway Admin</p>
            <strong>Operational preview</strong>
          </div>
          <div className="operator-chip" aria-label="Local development preview">
            <span>local-dev</span>
            <small>no admin session · read-only</small>
          </div>
        </header>

        <Outlet />
      </div>
    </div>
  );
}

function NavigationRail() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <aside className="rail" aria-label="Admin portal navigation">
      <div className="rail__mark" aria-hidden="true">
        DG
      </div>
      <nav>
        <a aria-current={pathname === '/' ? 'page' : undefined} href="/">
          Command
        </a>
        <a aria-current={pathname === '/trace' ? 'page' : undefined} href="/trace">
          Trace
        </a>
        <a aria-current={pathname === '/approvals' ? 'page' : undefined} href="/approvals">
          Approvals
        </a>
        <a aria-current={pathname === '/durable-operations' ? 'page' : undefined} href="/durable-operations">
          Durable
        </a>
        <span>Routes</span>
        <span>Keys</span>
        <span>Budgets</span>
      </nav>
    </aside>
  );
}
