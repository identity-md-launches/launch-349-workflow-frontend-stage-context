import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { loadRuntime } from './config';
import { App } from './App';
import './style.css';

const root = createRoot(document.getElementById('root')!);
root.render(<main className="boot"><img src="./mark.svg" width="48" height="48" alt=""/><h1>Last Buyer</h1><p role="status">Checking deployment interfaces…</p></main>);
loadRuntime().then(runtime => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });
  root.render(<WagmiProvider config={runtime.wagmi} reconnectOnMount={false}><QueryClientProvider client={queryClient}><App runtime={runtime}/></QueryClientProvider></WagmiProvider>);
}).catch(error => {
  root.render(<main className="boot"><h1>Unable to verify deployment</h1><p role="alert">{String(error.message)}</p><button onClick={() => location.reload()}>Reload deployment</button></main>);
});
