import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const response = await api.get('/auth/me');
        if (response.success || response.data) {
          setUser(response.data);
          localStorage.setItem('user', JSON.stringify(response.data));
          setError(null);
        }
      } catch (error) {
        console.debug('Session expired or not logged in');
        localStorage.removeItem('user');
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
      }
      setLoading(false);
    };

    initAuth();

    const handleAuthError = () => {
      setUser(null);
      setError({ message: 'Session expired. Please log in again.' });
    };
    
    window.addEventListener('auth-error', handleAuthError);
    return () => window.removeEventListener('auth-error', handleAuthError);
  }, []);

  const login = async (email, password) => {
    try {
      if (!email || !password) {
        throw {
          status: 400,
          response: {
            data: {
              errorCode: 'MISSING_FIELDS',
              message: 'Email and password are required'
            }
          }
        };
      }

      const response = await api.post('/auth/login', { email, password });
      
      // Handle success
      if (response.success || response.data) {
        const userData = response.data;
        localStorage.setItem('token', userData.token);
        if (userData.refreshToken) {
          localStorage.setItem('refreshToken', userData.refreshToken);
        }
        localStorage.setItem('user', JSON.stringify(userData.user));
        setUser(userData.user);
        setError(null);
        return userData;
      }
    } catch (err) {
      // Re-throw with enhanced error info
      const error = {
        ...err,
        status: err.status || err.response?.status,
        response: err.response,
        message: err.response?.data?.message || err.message || 'Login failed'
      };
      setError(error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      const storedRefreshToken = localStorage.getItem('refreshToken');
      await api.post('/auth/logout', { refreshToken: storedRefreshToken });
    } catch (e) {
      console.warn('Logout request failed, clearing local data:', e);
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      setUser(null);
      setError(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
