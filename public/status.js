async function checkHealth() {
  const health = document.querySelector('#health');
  const backend = document.querySelector('#backend');
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) throw new Error('Health check failed');
    const data = await response.json();
    if (data.status !== 'ok') throw new Error('Service unavailable');
    health.textContent = 'The service is online.';
    if (!data.mongodb.configured) {
      backend.textContent = 'The database is not configured yet.';
      return;
    }
    backend.textContent = 'Checking the database connection…';
    const ready = await fetch('/api/ready', { cache: 'no-store' });
    const readiness = await ready.json();
    backend.textContent = ready.ok && readiness.mongodb?.connected
      ? 'The database is connected.'
      : 'The database is currently unavailable.';
  } catch {
    health.textContent = 'The service could not be reached. Try again shortly.';
    backend.textContent = '';
  }
}
checkHealth();
