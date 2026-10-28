import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext();

// The backend returns `company`/`companies`/`business` as siblings of `user`
// on /login, /signup and /switch-company, but merged directly onto the row on
// /me. Normalize both shapes into one `user` object so every component can
// just read user.company / user.companies / user.business.
const mergeUser = (data) => ({ ...data.user, company: data.company, companies: data.companies, business: data.business });

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const persistUser = (u) => {
    localStorage.setItem('user', JSON.stringify(u));
    setUser(u);
  };

  const persistTokens = (data) => {
    localStorage.setItem('token', data.token);
    if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
  };

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

  const wrapAuthError = (err, fallbackMessage) => ({
    ...err,
    status: err.status || err.statusCode || err.response?.status,
    response: err.response || { data: err, status: err.status },
    message: err.message || err.response?.data?.message || fallbackMessage
  });

  const login = async (email, password) => {
    try {
      const cleanEmail = email ? email.trim().toLowerCase() : '';
      if (!cleanEmail || !password) {
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

      const response = await api.post('/auth/login', { email: cleanEmail, password });

      if (response.success || response.data) {
        const data = response.data;
        // Pending token (no companyId yet) when the business has >1 company
        // and no remembered default — still store it so /switch-company works.
        persistTokens(data);

        if (data.requiresCompanySelection) {
          setError(null);
          return data;
        }

        const mergedUser = mergeUser(data);
        persistUser(mergedUser);
        setError(null);
        return data;
      }
    } catch (err) {
      const error = wrapAuthError(err, 'Login failed');
      setError(error);
      throw error;
    }
  };

  const signup = async (businessName, email, password, fullName) => {
    try {
      const response = await api.post('/auth/signup', {
        business_name: businessName,
        email: email ? email.trim().toLowerCase() : '',
        password,
        full_name: fullName,
      });

      if (response.success || response.data) {
        const data = response.data;
        persistTokens(data);
        const mergedUser = mergeUser({ ...data, companies: [data.company] });
        persistUser(mergedUser);
        setError(null);
        return data;
      }
    } catch (err) {
      const error = wrapAuthError(err, 'Signup failed');
      setError(error);
      throw error;
    }
  };

  // Switches which company is active for the session — a silent token swap,
  // no re-login. Used right after login (resolving a pending selection) and
  // from the app-bar company switcher.
  const switchCompany = async (companyId) => {
    try {
      const response = await api.post('/auth/switch-company', { companyId });
      if (response.success || response.data) {
        const data = response.data;
        persistTokens(data);
        // Refresh the full profile (business + companies list) rather than
        // guessing it from this response, which only returns the new company.
        const me = await api.get('/auth/me');
        if (me.success || me.data) {
          persistUser(me.data);
        }
        setError(null);
        return data;
      }
    } catch (err) {
      const error = wrapAuthError(err, 'Failed to switch company');
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
    <AuthContext.Provider value={{ user, loading, error, login, signup, switchCompany, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
