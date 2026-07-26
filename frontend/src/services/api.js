import axios from 'axios';
import { errorInterceptor } from './errorInterceptor';

const savedServerIP = localStorage.getItem('serverIP');
const defaultAPI = import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000/api';
const baseURL = savedServerIP ? `http://${savedServerIP}:5000/api` : defaultAPI;

const api = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  // Prevent double slashes when combining baseURL and url
  if (config.url && config.url.startsWith('/')) {
    config.url = config.url.substring(1);
  }

  return config;
});

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const originalRequest = error.config;
    const isAuthEndpoint = originalRequest.url?.includes('auth/login') || originalRequest.url?.includes('auth/refresh');

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      if (isRefreshing) {
        return new Promise(function(resolve, reject) {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers['Authorization'] = 'Bearer ' + token;
          return api(originalRequest);
        }).catch(err => {
          return Promise.reject(err);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const storedRefreshToken = localStorage.getItem('refreshToken');
        const { data } = await axios.post(
          `${baseURL}/auth/refresh`,
          { refreshToken: storedRefreshToken },
          {
            withCredentials: true,
            headers: {
              'x-refresh-token': storedRefreshToken || ''
            }
          }
        );
        
        if (data.success && data.token) {
          localStorage.setItem('token', data.token);
          api.defaults.headers.common['Authorization'] = 'Bearer ' + data.token;
          originalRequest.headers['Authorization'] = 'Bearer ' + data.token;
          processQueue(null, data.token);
          return api(originalRequest);
        } else {
          throw new Error('Refresh failed');
        }
      } catch (err) {
        processQueue(err, null);
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        window.dispatchEvent(new Event('auth-error'));
        return Promise.reject(err?.response?.data || err);
      } finally {
        isRefreshing = false;
      }
    } else if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      window.dispatchEvent(new Event('auth-error'));
    }

    // Log all API errors using the central error interceptor
    if (!error.config?.url?.includes('/errors')) {
      errorInterceptor.logFrontendError({
        error_type: `API Error ${error.response?.status || 'Network'}`,
        error_message: error.response?.data?.message || error.message || 'API call failed',
        stack_trace: error.stack,
        endpoint: error.config?.url,
        method: error.config?.method?.toUpperCase(),
        additional_data: {
          status_code: error.response?.status,
          status_text: error.response?.statusText,
          response_data: error.response?.data
        }
      });
    }

    const errorMessage = error.response?.data?.message || 
      (error.message === 'Network Error' ? 'Cannot connect to backend server. Please check your network setup.' : error.message) || 
      'An unexpected error occurred';

    return Promise.reject(error.response?.data || { message: errorMessage });
  }
);

export default api;
