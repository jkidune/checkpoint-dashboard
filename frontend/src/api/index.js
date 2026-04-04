import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

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
};

export const loans = {
  rules: () => api.get('/loans/rules'),
  list: (params) => api.get('/loans', { params }),
  get: (id) => api.get(`/loans/${id}`),
  create: (data) => api.post('/loans', data),
  update: (id, data) => api.patch(`/loans/${id}`, data),
  addRepayment: (id, data) => api.post(`/loans/${id}/repayments`, data),
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
  broadcastReminders:  (data)  => api.post('/mailer/broadcast-reminders',  data),
  sendStatement:       (data)  => api.post('/mailer/send-statement',        data),
  broadcastStatement:  (data)  => api.post('/mailer/broadcast-statement',   data),
};

export default api;
