async function checkHealth() {
  const health = document.querySelector('#health');
  const backend = document.querySelector('#backend');
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    const data = await response.json();
    health.textContent = data.status === 'ok' ? 'The service is online.' : 'The service is online but degraded.';
    backend.textContent = data.mongodb.reachable
      ? `Database connected (${data.mongodb.latencyMs} ms).`
      : data.mongodb.configured
        ? 'Database settings are present but the database could not be reached.'
        : 'The backend is not connected yet.';
  } catch {
    health.textContent = 'The service could not be reached. Try again shortly.';
    backend.textContent = '';
  }
}
checkHealth();
