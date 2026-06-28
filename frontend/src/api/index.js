import axios from 'axios';

// In development Vite proxies /api → localhost:3001 (see vite.config.js).
// Split-hosted production builds use VITE_API_BASE_URL to reach the external API.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

const api = axios.create({ baseURL: API_BASE_URL });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('cp_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('cp_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const auth = {
  login: (data) => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
  changePassword: (data) => api.post('/auth/change-password', data),
};

export const members = {
  list: () => api.get('/members'),
  get: (id) => api.get(`/members/${id}`),
  create: (data) => api.post('/members', data),
  update: (id, data) => api.patch(`/members/${id}`, data),
};

export const contributions = {
  finePreview: (params) => api.get('/contributions/fine-preview', { params }),
  list: (params) => api.get('/contributions', { params }),
  grid: (year) => api.get(`/contributions/grid/${year}`),
  create: (data) => api.post('/contributions', data),
  update: (id, data) => api.patch(`/contributions/${id}`, data),
  delete: (id) => api.delete(`/contributions/${id}`),
  bulkPaymentPreview: (params) => api.get('/contributions/bulk-payment-preview', { params }),
  bulkPayment: (data) => api.post('/contributions/bulk-payment', data),
};

export const loans = {
  rules: () => api.get('/loans/rules'),
  list: (params) => api.get('/loans', { params }),
  get: (id) => api.get(`/loans/${id}`),
  create: (data) => api.post('/loans', data),
  update: (id, data) => api.patch(`/loans/${id}`, data),
  addRepayment: (id, data) => api.post(`/loans/${id}/repayments`, data),
  repaymentMatrix: (fiscalYear) => api.get('/loans/repayment-matrix', { params: { fiscal_year: fiscalYear } }),
};

export const summary = {
  get: () => api.get('/summary'),
  fines: () => api.get('/summary/fines'),
  createFine: (data) => api.post('/summary/fines', data),
  updateFine: (id, data) => api.patch(`/summary/fines/${id}`, data),
};

export const transactions = {
  list: (params) => api.get('/transactions', { params }),
  create: (data) => api.post('/transactions', data),
};

export const imports = {
  csv: (type, data) => api.post(`/import/${type}`, data, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
};

export const mailer = {
  broadcastReminders:   (data) => api.post('/mailer/broadcast-reminders',   data),
  sendStatement:        (data) => api.post('/mailer/send-statement',         data),
  broadcastStatement:   (data) => api.post('/mailer/broadcast-statement',    data),
  broadcastCredentials: (data) => api.post('/mailer/broadcast-credentials',  data),
};

export const admin = {
  syncCounters: () => api.post('/admin/sync-counters'),
};

export const expenses = {
  list:   (params) => api.get('/expenses', { params }),
  create: (data)   => api.post('/expenses', data),
  update: (id, data) => api.patch(`/expenses/${id}`, data),
  remove: (id)     => api.delete(`/expenses/${id}`),
};

export const investments = {
  list: () => api.get('/investments'),
};

export const rules = {
  list:      ()         => api.get('/rules'),
  get:       (fy)       => api.get(`/rules/${fy}`),
  save:      (fy, data) => api.put(`/rules/${fy}`, data),
  reset:     (fy)       => api.delete(`/rules/${fy}`),
  scanFines: (fy)       => api.post(`/rules/${fy}/scan-fines`),
  recalculateFines: (fy) => api.post(`/rules/${fy}/recalculate-fines`),
};

export default api;
