import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import AdminDashboard from './pages/AdminDashboard'
import CashierPage from './pages/CashierPage'
import CustomerLoginPage from './pages/CustomerLoginPage'
import HomePage from './pages/HomePage'
import InternalModulePage from './pages/InternalModulePage'
import MenuPage from './pages/MenuPage'
import OrdersPage from './pages/OrdersPage'
import PortalLoginPage from './pages/PortalLoginPage'
import StaffDashboard from './pages/StaffDashboard'

const adminOnly = ['admin']
const staffOnly = ['staff', 'operational_staff']
const cashierOnly = ['cashier']

export default function App(){return <Routes>
 <Route path="/" element={<HomePage/>}/><Route path="/login" element={<CustomerLoginPage/>}/><Route path="/menu" element={<MenuPage/>}/><Route path="/orders" element={<OrdersPage/>}/><Route path="/portal" element={<PortalLoginPage/>}/><Route path="/cashier" element={<ProtectedRoute allowedRoles={cashierOnly}><CashierPage/></ProtectedRoute>}/>
 <Route path="/admin" element={<ProtectedRoute allowedRoles={adminOnly}><AdminDashboard/></ProtectedRoute>}/><Route path="/admin/inventory" element={<ProtectedRoute allowedRoles={adminOnly}><InternalModulePage type="inventory"/></ProtectedRoute>}/><Route path="/admin/transactions" element={<ProtectedRoute allowedRoles={adminOnly}><InternalModulePage type="transactions"/></ProtectedRoute>}/><Route path="/admin/reports" element={<ProtectedRoute allowedRoles={adminOnly}><InternalModulePage type="reports"/></ProtectedRoute>}/><Route path="/admin/inventory-report" element={<ProtectedRoute allowedRoles={adminOnly}><InternalModulePage type="inventory-report"/></ProtectedRoute>}/><Route path="/admin/cancellations" element={<ProtectedRoute allowedRoles={adminOnly}><InternalModulePage type="cancellations"/></ProtectedRoute>}/><Route path="/admin/products" element={<ProtectedRoute allowedRoles={adminOnly}><InternalModulePage type="products"/></ProtectedRoute>}/><Route path="/admin/trends" element={<ProtectedRoute allowedRoles={adminOnly}><InternalModulePage type="trends"/></ProtectedRoute>}/><Route path="/admin/team" element={<ProtectedRoute allowedRoles={adminOnly}><InternalModulePage type="team"/></ProtectedRoute>}/><Route path="/admin/settings" element={<ProtectedRoute allowedRoles={adminOnly}><InternalModulePage type="settings"/></ProtectedRoute>}/><Route path="/admin/content" element={<ProtectedRoute allowedRoles={adminOnly}><InternalModulePage type="content"/></ProtectedRoute>}/><Route path="/admin/logs" element={<ProtectedRoute allowedRoles={adminOnly}><InternalModulePage type="logs"/></ProtectedRoute>}/>
 <Route path="/staff" element={<ProtectedRoute allowedRoles={staffOnly}><InternalModulePage type="preparation"/></ProtectedRoute>}/><Route path="/staff/inventory" element={<ProtectedRoute allowedRoles={staffOnly}><InternalModulePage type="staff-inventory"/></ProtectedRoute>}/><Route path="/staff/supplies" element={<ProtectedRoute allowedRoles={staffOnly}><InternalModulePage type="supplies"/></ProtectedRoute>}/><Route path="/staff/menu" element={<ProtectedRoute allowedRoles={staffOnly}><InternalModulePage type="menu"/></ProtectedRoute>}/><Route path="/staff/transactions" element={<ProtectedRoute allowedRoles={staffOnly}><InternalModulePage type="staff-transactions"/></ProtectedRoute>}/><Route path="/staff/orders" element={<ProtectedRoute allowedRoles={staffOnly}><InternalModulePage type="preparation"/></ProtectedRoute>}/><Route path="/staff/reports" element={<ProtectedRoute allowedRoles={staffOnly}><StaffDashboard/></ProtectedRoute>}/>
 <Route path="*" element={<Navigate to="/" replace/>}/>
 </Routes>}



