// Reload registered records so no public simulation state survives.
// A shared demo login cannot be promoted into an operator session.
export async function endDemoSession(role, { view = null, mode = 'live', request = fetch, navigate = url => location.assign(url) } = {}) {
  if (!['live', 'exercise'].includes(mode)) throw new Error('Choose live or exercise records.');
  if (mode === 'exercise' && role !== 'operator') throw new Error('Sign in as an operator to open exercise records.');
  if (role === 'demo') {
    const response = await request('/api/session', { method: 'DELETE', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not end the demo session. Try again.');
  }
  const query = new URLSearchParams();
  if (mode === 'exercise') query.set('mode', 'exercise');
  if (view === 'review') query.set('view', 'review');
  navigate('/command-center' + (query.size ? '?' + query : ''));
}
