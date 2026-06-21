import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createAdminQueryClient } from './app/query-client.js';
import { createAdminRouter } from './app/router.js';
import './styles/portal.css';

export interface AdminPortalRuntime {
  readonly root: Root;
  readonly queryClient: ReturnType<typeof createAdminQueryClient>;
  readonly router: ReturnType<typeof createAdminRouter>;
  readonly unmount: () => void;
}

export function bootstrapAdminPortal(container: HTMLElement): AdminPortalRuntime {
  const queryClient = createAdminQueryClient();
  const router = createAdminRouter({ queryClient });
  const root = createRoot(container);

  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );

  return {
    root,
    queryClient,
    router,
    unmount: () => {
      root.unmount();
      queryClient.clear();
    },
  };
}

const container = globalThis.document?.getElementById('root');
if (container !== undefined && container !== null) {
  bootstrapAdminPortal(container);
}
