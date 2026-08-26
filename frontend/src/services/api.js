import axios from 'axios';
import { errorInterceptor } from './errorInterceptor';
import { getApiBaseUrl } from '../utils/apiUrl';

const getBaseURL = getApiBaseUrl;

const api = axios.create({
  baseURL: getBaseURL(),
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  config.baseURL = getBaseURL();

  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
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
          `${getBaseURL()}/auth/refresh`,
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
          if (data.refreshToken) {
            localStorage.setItem('refreshToken', data.refreshToken);
          }
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

    // Log API errors using the central error interceptor (ignore expected 404s on optional resource lookups)
    if (!error.config?.url?.includes('/errors') && error.response?.status !== 404) {
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
      error.response?.data?.error ||
      (error.message === 'Network Error' ? 'Cannot connect to backend server. Please check your network setup.' : error.message) || 
      'An unexpected error occurred';

    const rejectedError = error.response?.data || { message: errorMessage };
    if (typeof rejectedError === 'object' && rejectedError !== null) {
      rejectedError.status = error.response?.status || error.status || 0;
      rejectedError.response = error.response;
      rejectedError.code = rejectedError.errorCode || rejectedError.code || error.code;
    }

    return Promise.reject(rejectedError);
  }
);

export default api;
