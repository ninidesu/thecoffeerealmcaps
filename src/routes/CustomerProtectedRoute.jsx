import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
export default function CustomerProtectedRoute({children}){const {user,loading}=useAuth();const location=useLocation();if(loading)return <main className="customer-state">Checking your account…</main>;return user?children:<Navigate to="/login" replace state={{from:location.pathname}}/>}
