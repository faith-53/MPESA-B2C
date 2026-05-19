import React, { useState, Fragment } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Dialog, Transition } from '@headlessui/react';
import { 
  HomeIcon,
  DocumentArrowUpIcon,
  FolderIcon,
  ChartBarIcon,
  UsersIcon,
  UserCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import { useAuth } from '../contexts/AuthContext';
import Sidebar from './Sidebar';
import Header from './Header';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
  { name: 'Upload', href: '/upload', icon: DocumentArrowUpIcon, permission: 'canUpload' },
  { name: 'Batches', href: '/batches', icon: FolderIcon },
  { name: 'Reports', href: '/reports', icon: ChartBarIcon, permission: 'canViewReports' },
  { name: 'Users', href: '/users', icon: UsersIcon, role: 'admin' },
];

const userNavigation = [
  { name: 'Profile', href: '/profile', icon: UserCircleIcon },
];

const Layout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { hasPermission, hasRole } = useAuth();
  const location = useLocation();

  // Filter navigation items based on permissions
  const filteredNavigation = navigation.filter(item => {
    if (item.permission && !hasPermission(item.permission)) {
      return false;
    }
    if (item.role && !hasRole(item.role)) {
      return false;
    }
    return true;
  });

  const currentPage = filteredNavigation.find(item => 
    location.pathname.startsWith(item.href)
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar */}
      <Transition.Root show={sidebarOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50 lg:hidden" onClose={setSidebarOpen}>
          <Transition.Child
            as={Fragment}
            enter="transition-opacity ease-linear duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-linear duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-900/80" />
          </Transition.Child>

          <div className="fixed inset-0 flex">
            <Transition.Child
              as={Fragment}
              enter="transition ease-in-out duration-300 transform"
              enterFrom="-translate-x-full"
              enterTo="translate-x-0"
              leave="transition ease-in-out duration-300 transform"
              leaveFrom="translate-x-0"
              leaveTo="-translate-x-full"
            >
              <Dialog.Panel className="relative mr-16 flex w-full max-w-xs flex-1">
                <Transition.Child
                  as={Fragment}
                  enter="ease-in-out duration-300"
                  enterFrom="opacity-0"
                  enterTo="opacity-100"
                  leave="ease-in-out duration-300"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                >
                  <div className="absolute left-full top-0 flex w-16 justify-center pt-5">
                    <button
                      type="button"
                      className="-m-2.5 p-2.5"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <span className="sr-only">Close sidebar</span>
                      <XMarkIcon className="h-6 w-6 text-white" aria-hidden="true" />
                    </button>
                  </div>
                </Transition.Child>
                
                <Sidebar 
                  navigation={filteredNavigation}
                  userNavigation={userNavigation}
                  currentPath={location.pathname}
                  mobile={true}
                />
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>

      {/* Desktop sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-72 lg:flex-col">
        <Sidebar 
          navigation={filteredNavigation}
          userNavigation={userNavigation}
          currentPath={location.pathname}
          mobile={false}
        />
      </div>

      {/* Main content */}
      <div className="lg:pl-72">
        {/* Header */}
        <Header 
          currentPage={currentPage}
          onMenuClick={() => setSidebarOpen(true)}
        />

        {/* Main content area */}
        <main className="py-6">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;