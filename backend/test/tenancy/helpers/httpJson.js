// Tiny fetch wrappers shared by the Phase 3/4A HTTP-level tests.

async function request(baseUrl, method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    // no/invalid JSON body — fine for some responses
  }
  return { status: res.status, body: parsed };
}

const getJson = (baseUrl, path, token) => request(baseUrl, 'GET', path, { token });
const postJson = (baseUrl, path, body, token) => request(baseUrl, 'POST', path, { token, body });
const putJson = (baseUrl, path, body, token) => request(baseUrl, 'PUT', path, { token, body });
const patchJson = (baseUrl, path, body, token) => request(baseUrl, 'PATCH', path, { token, body });
const deleteJson = (baseUrl, path, token) => request(baseUrl, 'DELETE', path, { token });

module.exports = { getJson, postJson, putJson, patchJson, deleteJson };
