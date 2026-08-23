import axios from 'axios';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
const api = axios.create({ baseURL: API_BASE_URL });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('cp_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('cp_token');
      window.location.href = '/';
    }
    return Promise.reject(err);
  },
);

export const auth = {
  login: (data) => api.post('/auth/login', data),
  signup: (data) => api.post('/auth/signup', data),
  me: () => api.get('/auth/me'),
  changePassword: (data) => api.post('/auth/change-password', data),
  forgotPassword: (data) => api.post('/auth/forgot-password', data),
  resetPassword: (data) => api.post('/auth/reset-password', data),
};

export const members = {
  list: () => api.get('/members'),
  get: (id) => api.get(`/members/${id}`),
  me: () => api.get('/members/me'),
  create: (data) => api.post('/members', data),
  update: (id, data) => api.patch(`/members/${id}`, data),
};

export const memberFinance = {
  loanEligibility: (params = {}) => api.get('/member/loan-eligibility', { params }),
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
  rules: (params = {}) => api.get('/loans/rules', { params }),
  eligibility: (memberId, params = {}) => api.get(`/loans/eligibility/${memberId}`, { params }),
  list: (params) => api.get('/loans', { params }),
  get: (id) => api.get(`/loans/${id}`),
  create: (data) => api.post('/loans', data),
  update: (id, data) => api.patch(`/loans/${id}`, data),
  addRepayment: (id, data) => api.post(`/loans/${id}/repayments`, data),
};

export const loanRequests = {
  list: (params = {}) => api.get('/forms/loan-request', { params }),
  review: (id, data) => api.patch(`/forms/loan-request/${id}/review`, data),
  convert: (id) => api.post(`/forms/loan-request/${id}/convert`),
};

export const summary = {
  get: () => api.get('/summary'),
  snapshot: () => api.get('/summary/snapshot'),
  fines: () => api.get('/summary/fines'),
  createFine: (data) => api.post('/summary/fines', data),
  updateFine: (id, data) => api.patch(`/summary/fines/${id}`, data),
  deleteFine: (id) => api.delete(`/summary/fines/${id}`),
};

export const fines = {
  list: () => api.get('/summary/fines'),
  create: (data) => api.post('/summary/fines', data),
  update: (id, data) => api.patch(`/summary/fines/${id}`, data),
  delete: (id) => api.delete(`/summary/fines/${id}`),
};

export const transactions = {
  list: (params) => api.get('/transactions', { params }),
  create: (data) => api.post('/transactions', data),
};

export const imports = {
  csv: (type, data) => api.post(`/import/${type}`, data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
};

export const mailer = {
  broadcastReminders: (data) => api.post('/communications/contribution-reminders/send', data),
  sendStatement: (data) => api.post('/mailer/send-statement', data),
  broadcastStatement: (data) => api.post('/mailer/broadcast-statement', data),
};

export const communications = {
  status: () => api.get('/communications/status'),
  verifyEmail: () => api.post('/communications/verify-email'),
  testEmail: (email) => api.post('/communications/test-email', { email }),
  sendInvitation: (memberId) => api.post(`/communications/members/${memberId}/invite`),
  sendMemberMessage: (memberId, data) => api.post(`/communications/members/${memberId}/message`, data),
  sendMonthlyStatement: (memberId, data) => api.post(`/communications/members/${memberId}/monthly-statement`, data),
  contributionReminderPreview: (params) => api.get('/communications/contribution-reminders/preview', { params }),
  sendContributionReminders: (data) => api.post('/communications/contribution-reminders/send', data),
};

export const formIntake = {
  list: (params = {}) => api.get('/forms/intake', { params }),
  review: (id, data) => api.patch(`/forms/intake/${id}/review`, data),
  preview: (id, data = {}) => api.post(`/forms/intake/${id}/preview`, data),
  post: (id, data = {}) => api.post(`/forms/intake/${id}/post`, data),
};

export const admin = {
  syncCounters: () => api.post('/admin/sync-counters'),
};

export const expenses = {
  list: (params) => api.get('/expenses', { params }),
  create: (data) => api.post('/expenses', data),
  update: (id, data) => api.patch(`/expenses/${id}`, data),
  remove: (id) => api.delete(`/expenses/${id}`),
};

export const investments = {
  list: () => api.get('/investments'),
  recordNav: (data) => api.post('/investments/nav', data),
  navHistory: (params) => api.get('/investments/nav-history', { params }),
  growth: () => api.get('/investments/growth'),
};

export const notifications = {
  list: (params) => api.get('/notifications', { params }),
  markRead: (id) => api.patch(`/notifications/${id}/read`),
  markAllRead: (data = {}) => api.patch('/notifications/read-all', data),
  create: (data) => api.post('/notifications', data),
  attention: () => api.get('/notifications/attention'),
};

export const rules = {
  list: () => api.get('/rules'),
  get: (fy) => api.get(`/rules/${fy}`),
  save: (fy, data) => api.put(`/rules/${fy}`, data),
  reset: (fy) => api.delete(`/rules/${fy}`),
  scanFines: (fy) => api.post(`/rules/${fy}/scan-fines`),
  recalculateFines: (fy) => api.post(`/rules/${fy}/recalculate-fines`),
};

export default api;
