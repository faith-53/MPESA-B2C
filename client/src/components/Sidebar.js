import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { 
  ArrowRightOnRectangleIcon,
  CubeIcon,
} from '@heroicons/react/24/outline';

import { useAuth } from '../contexts/AuthContext';

const Sidebar = ({ navigation, userNavigation, currentPath, mobile }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-white px-6 pb-4 shadow-sm border-r border-gray-200">
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center">
        <div className="flex items-center space-x-2">
          <CubeIcon className="h-8 w-8 text-primary-600" />
          <div>
            <h1 className="text-lg font-bold text-gray-900">MPESA B2C</h1>
            <p className="text-xs text-gray-500">Bulk Payments</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col">
        <ul role="list" className="flex flex-1 flex-col gap-y-7">
          {/* Main navigation */}
          <li>
            <ul role="list" className="-mx-2 space-y-1">
              {navigation.map((item) => {
                const isActive = currentPath === item.href || 
                  (item.href !== '/dashboard' && currentPath.startsWith(item.href));
                
                return (
                  <li key={item.name}>
                    <Link
                      to={item.href}
                      className={clsx(
                        isActive
                          ? 'sidebar-link-active'
                          : 'sidebar-link-inactive',
                        'group flex gap-x-3 rounded-md p-2 text-sm leading-6 font-semibold'
                      )}
                    >
                      <item.icon
                        className={clsx(
                          isActive 
                            ? 'text-primary-600' 
                            : 'text-gray-400 group-hover:text-gray-600',
                          'h-6 w-6 shrink-0'
                        )}
                        aria-hidden="true"
                      />
                      {item.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>

          {/* User section */}
          <li className="mt-auto">
            {/* User info */}
            <div className="mb-4 p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  <div className="h-8 w-8 bg-primary-100 rounded-full flex items-center justify-center">
                    <span className="text-sm font-medium text-primary-700">
                      {user?.firstName?.charAt(0)}{user?.lastName?.charAt(0)}
                    </span>
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {user?.fullName}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {user?.role?.replace('_', ' ')}
                  </p>
                </div>
              </div>
            </div>

            {/* User navigation */}
            <ul role="list" className="-mx-2 space-y-1">
              {userNavigation.map((item) => {
                const isActive = currentPath === item.href;
                
                return (
                  <li key={item.name}>
                    <Link
                      to={item.href}
                      className={clsx(
                        isActive
                          ? 'sidebar-link-active'
                          : 'sidebar-link-inactive',
                        'group flex gap-x-3 rounded-md p-2 text-sm leading-6 font-semibold'
                      )}
                    >
                      <item.icon
                        className={clsx(
                          isActive 
                            ? 'text-primary-600' 
                            : 'text-gray-400 group-hover:text-gray-600',
                          'h-6 w-6 shrink-0'
                        )}
                        aria-hidden="true"
                      />
                      {item.name}
                    </Link>
                  </li>
                );
              })}
              
              {/* Logout */}
              <li>
                <button
                  onClick={handleLogout}
                  className="sidebar-link-inactive group flex w-full gap-x-3 rounded-md p-2 text-sm leading-6 font-semibold"
                >
                  <ArrowRightOnRectangleIcon
                    className="text-gray-400 group-hover:text-gray-600 h-6 w-6 shrink-0"
                    aria-hidden="true"
                  />
                  Logout
                </button>
              </li>
            </ul>
          </li>
        </ul>
      </nav>
    </div>
  );
};

export default Sidebar;
