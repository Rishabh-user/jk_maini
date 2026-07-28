import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './components/ToastProvider'
import { DialogProvider } from './components/DialogProvider'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* ToastProvider/DialogProvider sit outside AuthProvider so login/
          logout can also use toasts + modal dialogs. Order matters:
          both must be renderable during the auth bootstrap flow. */}
      <ToastProvider>
        <DialogProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </DialogProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
)
