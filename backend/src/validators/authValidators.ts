import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const refreshSchema = z.object({
  refreshToken: z.string(),
});

export const logoutSchema = z.object({
  refreshToken: z.string().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
});

export const updateProfileSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
});

export const updatePreferencesSchema = z.object({
  theme: z.string().optional(),
  emailNotifications: z.boolean().optional(),
  timezone: z.string().optional(),
});

export const requestPasswordResetSchema = z.object({
  email: z.string().email(),
});

export const confirmPasswordResetSchema = z.object({
  token: z.string(),
  newPassword: z.string().min(8),
});
