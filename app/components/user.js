'use client';
import { createContext, useContext } from 'react';
export const UserCtx = createContext(null);
export const useUser = () => useContext(UserCtx);
export const hasPerm = (user, p) => !!user && (user.role === 'admin' || user.permissions?.[p] === true);
