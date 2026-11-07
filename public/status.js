async function checkHealth() {
  const health = document.querySelector('#health');
  const backend = document.querySelector('#backend');
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) throw new Error('Health check failed');
    const data = await response.json();
    if (data.status !== 'ok') throw new Error('Service unavailable');
    health.textContent = 'The service is online.';
    backend.textContent = data.mongodb.configured
      ? 'Backend settings are present. The database connection has not been tested.'
      : 'The backend is not connected yet.';
  } catch {
    health.textContent = 'The service could not be reached. Try again shortly.';
    backend.textContent = '';
  }
}
checkHealth();
