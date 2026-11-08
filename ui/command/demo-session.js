// Leaving a demo reloads the live workspace so no generated state survives.
// A shared demo login cannot be promoted into an operator session.
export async function endDemoSession(role, { request = fetch, navigate = url => location.assign(url) } = {}) {
  if (role === 'demo') {
    const response = await request('/api/session', { method: 'DELETE', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not end the demo session. Try again.');
  }
  navigate('/command-center');
}
