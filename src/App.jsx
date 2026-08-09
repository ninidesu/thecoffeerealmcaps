import { Navigate, Route, Routes } from 'react-router-dom'
import AuthUiLayer from './components/auth/AuthUiLayer'
import ProtectedRoute from './components/ProtectedRoute'
import CustomerLayout from './components/customer/CustomerLayout'
import CustomerProtectedRoute from './routes/CustomerProtectedRoute'
import AdminDashboard from './pages/AdminDashboard'
import CashierPage from './pages/CashierPage'
import CustomerLoginPage from './pages/CustomerLoginPage'
import HomePage from './pages/HomePage'
import HelpPage from './pages/customer/HelpPage'
import InventoryStockPage from './pages/InventoryStockPage'
import ManageMenuPage from './pages/ManageMenuPage'
import CustomerMessagesPage from './pages/CustomerMessagesPage'
import OrderPreparationPage from './pages/OrderPreparationPage'
import PortalLoginPage from './pages/PortalLoginPage'
import StaffDashboard from './pages/StaffDashboard'
import StaffSettingsPage from './pages/StaffSettingsPage'
import TransactionsPage from './pages/TransactionsPage'
import {
  AboutPage,
  CheckoutPage,
  ContactPage,
  MenuPage,
  MyOrdersPage,
  NotFoundPage,
  OrderConfirmationPage,
  OrderReviewPage,
  OrderTrackingPage,
  ProductPage,
  SettingsPage,
} from './pages/customer/CustomerPages'

const protect = (page) => <CustomerProtectedRoute>{page}</CustomerProtectedRoute>

export default function App() {
  return (
    <>
      <Routes>
        <Route element={<CustomerLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/menu/:slug" element={<ProductPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/checkout" element={protect(<CheckoutPage />)} />
          <Route path="/checkout/review" element={protect(<OrderReviewPage />)} />
          <Route path="/orders" element={protect(<MyOrdersPage />)} />
          <Route path="/orders/:id/confirmation" element={protect(<OrderConfirmationPage />)} />
          <Route path="/orders/:id/track" element={protect(<OrderTrackingPage />)} />
          <Route path="/profile" element={<Navigate to="/settings" replace />} />
          <Route path="/addresses" element={<Navigate to="/settings" replace />} />
          <Route path="/settings" element={protect(<SettingsPage />)} />
        </Route>

        <Route path="/login" element={<CustomerLoginPage />} />
        <Route path="/register" element={<CustomerLoginPage initialMode="register" />} />
        <Route path="/portal" element={<PortalLoginPage />} />

        <Route
          path="/cashier"
          element={<ProtectedRoute allowedRoles={['cashier']}><CashierPage /></ProtectedRoute>}
        />

        <Route
          path="/admin/*"
          element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>}
        />

        <Route
          path="/staff"
          element={<ProtectedRoute allowedRoles={['staff', 'operational_staff']}><OrderPreparationPage /></ProtectedRoute>}
        />
        <Route
          path="/staff/inventory"
          element={<ProtectedRoute allowedRoles={['staff', 'operational_staff']}><InventoryStockPage /></ProtectedRoute>}
        />
        <Route
          path="/staff/menu"
          element={<ProtectedRoute allowedRoles={['staff', 'operational_staff']}><ManageMenuPage /></ProtectedRoute>}
        />
        <Route
          path="/staff/messages"
          element={<ProtectedRoute allowedRoles={['staff', 'operational_staff']}><CustomerMessagesPage /></ProtectedRoute>}
        />
        <Route
          path="/staff/reports"
          element={<ProtectedRoute allowedRoles={['staff', 'operational_staff']}><StaffDashboard /></ProtectedRoute>}
        />
        <Route
          path="/staff/transactions"
          element={<ProtectedRoute allowedRoles={['staff', 'operational_staff']}><TransactionsPage /></ProtectedRoute>}
        />
        <Route
          path="/staff/settings"
          element={<ProtectedRoute allowedRoles={['staff', 'operational_staff']}><StaffSettingsPage /></ProtectedRoute>}
        />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <AuthUiLayer />
    </>
  )
}
