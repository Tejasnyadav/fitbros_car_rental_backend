import { Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import { AuthenticatedRequest } from '../middleware/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'fitbros_premium_secret_key_2026_xyz';
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

const generateTokenAndSetCookie = (res: Response, payload: { id: string; email: string; role: 'CUSTOMER' | 'ADMIN'; name: string }) => {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
  
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    sameSite: (process.env.COOKIE_SAMESITE as any) || (process.env.NODE_ENV === 'production' ? 'none' : 'lax'),
    maxAge: COOKIE_MAX_AGE,
  });

  return token;
};

const generateAdminTokenAndSetCookie = (res: Response, payload: { id: string; email: string; role: 'CUSTOMER' | 'ADMIN'; name: string }) => {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
  
  res.cookie('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    sameSite: (process.env.COOKIE_SAMESITE as any) || (process.env.NODE_ENV === 'production' ? 'none' : 'lax'),
    maxAge: COOKIE_MAX_AGE,
  });

  return token;
};

// User Registration (Default Role: CUSTOMER)
export const register = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required.' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ message: 'An account with this email address already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: hashedPassword,
        role: 'CUSTOMER'
      }
    });

    const userPayload = {
      id: newUser.id,
      email: newUser.email,
      role: newUser.role,
      name: newUser.name
    };

    generateTokenAndSetCookie(res, userPayload);

    return res.status(201).json({
      message: 'Account registered successfully.',
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        role: newUser.role
      }
    });
  } catch (error: any) {
    console.error('Registration Error:', error);
    return res.status(500).json({ message: 'Internal server error during registration.' });
  }
};

// Customer Login
export const userLogin = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.role !== 'CUSTOMER') {
      return res.status(401).json({ message: 'Invalid credentials or user does not exist.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const userPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    };

    generateTokenAndSetCookie(res, userPayload);

    return res.status(200).json({
      message: 'Login successful.',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      }
    });
  } catch (error: any) {
    console.error('Login Error:', error);
    return res.status(500).json({ message: 'Internal server error during login.' });
  }
};

// Admin Login
export const adminLogin = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const admin = await prisma.user.findUnique({ where: { email } });
    if (!admin || admin.role !== 'ADMIN') {
      return res.status(401).json({ message: 'Invalid admin credentials or access denied.' });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid admin credentials.' });
    }

    const adminPayload = {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      name: admin.name
    };

    generateAdminTokenAndSetCookie(res, adminPayload);

    return res.status(200).json({
      message: 'Admin authentication successful.',
      user: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        role: admin.role
      }
    });
  } catch (error: any) {
    console.error('Admin Login Error:', error);
    return res.status(500).json({ message: 'Internal server error during admin login.' });
  }
};

// Get User Profile
export const getProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id.toString() },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true
      }
    });

    if (!user || user.role !== 'CUSTOMER') {
      return res.status(403).json({ message: 'User profile not found or role mismatch.' });
    }

    return res.status(200).json({ user });
  } catch (error: any) {
    console.error('Profile Error:', error);
    return res.status(500).json({ message: 'Internal server error fetching profile.' });
  }
};

// Get Admin Profile
export const getAdminProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    const admin = await prisma.user.findUnique({
      where: { id: req.user.id.toString() },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true
      }
    });

    if (!admin || admin.role !== 'ADMIN') {
      return res.status(404).json({ message: 'Admin profile not found.' });
    }

    return res.status(200).json({ user: admin });
  } catch (error: any) {
    console.error('Admin Profile Error:', error);
    return res.status(500).json({ message: 'Internal server error fetching admin profile.' });
  }
};

// Logout
export const logout = (req: AuthenticatedRequest, res: Response) => {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    sameSite: (process.env.COOKIE_SAMESITE as any) || (process.env.NODE_ENV === 'production' ? 'none' : 'lax'),
    path: '/'
  };

  res.clearCookie('token', cookieOptions);
  res.clearCookie('admin_token', cookieOptions);
  return res.status(200).json({ message: 'Logged out successfully.' });
};
