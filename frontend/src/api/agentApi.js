import axios from 'axios';

// Agent API: sends cookies (httpOnly JWT)
export const agentApi = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

agentApi.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// Public API: no credentials needed
export const publicApi = axios.create({
  baseURL: '/api/public',
  withCredentials: false,
});
