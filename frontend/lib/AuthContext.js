"use client";
import { createContext, useContext, useState, useEffect } from "react";
import { authApi } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const raw = localStorage.getItem("user");
    if (raw) {
      try { setUser(JSON.parse(raw)); } catch {}
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    const data = await authApi.login(email, password);
    setUser(data.user);
    return data;
  };

  const logout = async () => {
    await authApi.logout();
    setUser(null);
  };

  const register = async (formData) => {
    const data = await authApi.register(formData);
    setUser(data.user);
    return data;
  };

  // Retourne la route selon le rôle
  const getHomeRoute = (u) => {
    const r = (u || user)?.role;
    if (r === "admin")        return "/admin";
    if (r === "restaurateur") return "/dashboard";
    return "/";
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, register, isAuthenticated: !!user, getHomeRoute }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function useRole() {
  const { user } = useAuth();
  return {
    isClient:       user?.role === "client",
    isRestaurateur: user?.role === "restaurateur",
    isAdmin:        user?.role === "admin",
    role:           user?.role || null,
  };
}
