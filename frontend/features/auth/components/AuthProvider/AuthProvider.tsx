"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { AuthError, authenticate, endSession, getCurrentUser, refreshSession, updateProfile, type AuthMode, type User } from "../../api";

export type AuthStatus = "loading" | "authenticated" | "anonymous" | "error";

type AuthContextValue = {
  user: User | null;
  status: AuthStatus;
  error: string;
  retry: () => Promise<void>;
  login: (mode: AuthMode, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  saveProfile: (name: string, avatar?: File) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState("");

  const retry = useCallback(async (): Promise<void> => {
    setStatus("loading");
    setError("");
    try {
      await refreshSession();
      const currentUser = await getCurrentUser();
      setUser(currentUser);
      setStatus("authenticated");
    } catch (failure: unknown) {
      if (failure instanceof AuthError && failure.status === 401) {
        setUser(null);
        setStatus("anonymous");
      } else {
        setError("Проверьте соединение с сервером и повторите попытку.");
        setStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    retry();
  }, [retry]);

  async function login(mode: AuthMode, email: string, password: string): Promise<void> {
    const currentUser = await authenticate(mode, email, password);
    setUser(currentUser);
    setStatus("authenticated");
  }

  async function logout(): Promise<void> {
    await endSession();
    setUser(null);
    setStatus("anonymous");
  }

  async function saveProfile(name: string, avatar?: File): Promise<void> {
    try {
      const currentUser = await updateProfile(name, avatar);
      setUser(currentUser);
    } catch (failure: unknown) {
      if (failure instanceof AuthError && failure.status === 401) {
        setUser(null);
        setStatus("anonymous");
      }
      throw failure;
    }
  }

  return (
    <AuthContext.Provider value={{ user, status, error, retry, login, logout, saveProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
