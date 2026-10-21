import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, 
  Circle, 
  ChevronRight, 
  ChevronLeft,
  Calendar, 
  Clock, 
  Trash2, 
  Plus, 
  X, 
  Bell, 
  BellOff, 
  AlertTriangle, 
  Archive, 
  Sparkles, 
  Wifi, 
  WifiOff, 
  Sun, 
  Moon,
  Search,
  Menu,
  Check,
  List,
  CalendarCheck,
  Notebook,
  Activity,
  CalendarDays,
  TrendingUp,
  BarChart2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  db, 
  createTask, 
  completeTask, 
  deferTask, 
  deleteTask, 
  runMidnightRollover, 
  updateTaskStatus,
  getLocalTodayDate,
  addDaysToDate,
  requestNotificationPermission,
  fireSystemNotification,
  createRoutine,
  toggleRoutineInstance,
  deleteRoutine,
  syncRoutinesForDateRange,
  getDatesBetween
} from './db';
import { Task, TaskStatus, RecurrenceFrequency, Routine, RoutineInstance } from './types';

export default function App() {
  // PWA & Environment State
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [hasNotificationPermission, setHasNotificationPermission] = useState<boolean>(() => {
    try {
      return 'Notification' in window && typeof Notification !== 'undefined' && Notification.permission === 'granted';
    } catch (e) {
      return false;
    }
  });

  // Theme Toggle State with calm Spruce green defaults
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme;
    }
    return 'dark'; // Maintain dark default for immersive calm forest vibe
  });

  // Synchronize HTML classes when theme shifts
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Tasks Store State
  const [tasks, setTasks] = useState<Task[]>([]);
  const [rolloverCount, setRolloverCount] = useState<number>(0);
  const [showRolloverToast, setShowRolloverToast] = useState<boolean>(false);

  // Routines Store State
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routineInstances, setRoutineInstances] = useState<RoutineInstance[]>([]);
  const [newRoutineTitle, setNewRoutineTitle] = useState<string>('');
  
  // Date selection state for "My Day" view
  const [selectedDate, setSelectedDate] = useState<string>(getLocalTodayDate());

  // Convert date string to tab labels (yesterday, today, tomorrow, or short date)
  const getTabLabel = (dateStr: string) => {
    const today = getLocalTodayDate();
    if (dateStr === today) return "TODAY";
    if (dateStr === addDaysToDate(today, -1)) return "YESTERDAY";
    if (dateStr === addDaysToDate(today, 1)) return "TOMORROW";
    
    // Format other dates beautifully as (Date)
    const [yr, mo, dy] = dateStr.split('-').map(Number);
    const d = new Date(yr, mo - 1, dy);
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
    const month = d.toLocaleDateString('en-US', { month: 'short' });
    const dayNum = d.getDate();
    return `${weekday}, ${month} ${dayNum}`;
  };

  // Convert date string to a pretty long calendar date label
  const getFormattedPrettyDate = (dateStr: string) => {
    const [yr, mo, dy] = dateStr.split('-').map(Number);
    const d = new Date(yr, mo - 1, dy);
    const opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
    return d.toLocaleDateString('en-US', opts);
  };

  // Navigation: Microsoft Tasks style layout
  const [activeTab, setActiveTab] = useState<'today' | 'planned' | 'completed' | 'cancelled' | 'all' | 'routines'>('today');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);

  // Selected Task for right detail pane drawer orientation
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Inline "Add a task" quick adder state
  const [newTitle, setNewTitle] = useState<string>('');
  const [newTargetDate, setNewTargetDate] = useState<string>(getLocalTodayDate());
  const [newReminderTime, setNewReminderTime] = useState<string>('');
  const [newFrequency, setNewFrequency] = useState<RecurrenceFrequency>('none');
  const [newCustomGapDays, setNewCustomGapDays] = useState<number>(2);
  const [showAdderDetails, setShowAdderDetails] = useState<boolean>(false);

  // Search Filter Term
  const [searchTerm, setSearchTerm] = useState<string>('');

  // UI Feedback States
  const [toastMessage, setToastMessage] = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // 1. Monitor network connection
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 2. Database hydration & automatic midnight rollover on mount
  useEffect(() => {
    async function initializeApp() {
      try {
        const rolledCount = await runMidnightRollover();
        if (rolledCount > 0) {
          setRolloverCount(rolledCount);
          setShowRolloverToast(true);
          setTimeout(() => setShowRolloverToast(false), 8000);
        }
      } catch (err) {
        console.error('Error conducting rollover engine:', err);
      }
      await reloadTasks();
      await reloadRoutines();
    }
    initializeApp();
  }, [activeTab]);

  // 3. Background notification poller daemon (Every 5s check)
  useEffect(() => {
    const alarmInterval = setInterval(() => {
      checkActiveAlarms();
    }, 5000);
    return () => clearInterval(alarmInterval);
  }, [tasks]);

  const checkActiveAlarms = () => {
    const now = new Date();
    let firedList: string[] = [];
    try {
      firedList = JSON.parse(localStorage.getItem('fired_task_reminders') || '[]');
    } catch {
      firedList = [];
    }

    const uncompletedTasksWithReminders = tasks.filter(
      t => t.status !== 'completed' && t.status !== 'cancelled' && t.reminder_time
    );

    uncompletedTasksWithReminders.forEach(t => {
      if (!t.reminder_time) return;
      
      const alarmTime = new Date(t.reminder_time);
      if (now >= alarmTime && !firedList.includes(t.id)) {
        fireSystemNotification(t.id, t.title, t.remark);
        firedList.push(t.id);
        try {
          localStorage.setItem('fired_task_reminders', JSON.stringify(firedList));
        } catch { /* skip */ }
        triggerToast(`⏰ Reminder alert for: "${t.title}"`);
      }
    });
  };

  const reloadTasks = async () => {
    try {
      const allTasks = await db.tasks.toArray();
      // Sorted primarily by created_at descending
      allTasks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setTasks(allTasks);
    } catch (err) {
      console.error('Failed to load tasks from local store:', err);
    }
  };

  const reloadRoutines = async () => {
    try {
      await syncRoutinesForDateRange();
      const allRoutines = await db.routines.toArray();
      const allInstances = await db.routine_instances.toArray();
      setRoutines(allRoutines);
      setRoutineInstances(allInstances);
    } catch (err) {
      console.error('Failed to load routines from local store:', err);
    }
  };

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 4500);
  };

  const handleEnableNotifications = async () => {
    const allowed = await requestNotificationPermission();
    setHasNotificationPermission(allowed);
    if (allowed) {
      triggerToast('🔔 Alerts successfully authorized!');
    } else {
      triggerToast('❌ Authorization denied or unsupported.');
    }
  };

  // Create task using inline quick-add input
  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      const targetDateToUse = activeTab === 'today' ? selectedDate : newTargetDate;
      await createTask(
        newTitle.trim(),
        targetDateToUse,
        '', // Starts with empty remark (type note in details pane)
        newReminderTime || undefined,
        'pending',
        newFrequency,
        newFrequency === 'custom_gap' ? newCustomGapDays : undefined
      );

      triggerToast('✓ Task created successfully!');
      setNewTitle('');
      setNewReminderTime('');
      setNewTargetDate(getLocalTodayDate());
      setNewFrequency('none');
      setShowAdderDetails(false);
      await reloadTasks();
    } catch (err) {
      console.error(err);
      triggerToast('Error inserting task.');
    }
  };

  // -------------------------------------------------------------
  // Routines Action Handlers
  // -------------------------------------------------------------
  const handleCreateRoutine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoutineTitle.trim()) return;

    try {
      await createRoutine(newRoutineTitle);
      triggerToast('✓ New daily routine registered!');
      setNewRoutineTitle('');
      await reloadRoutines();
    } catch (err) {
      console.error(err);
      triggerToast('Error creating routine.');
    }
  };

  const handleToggleRoutine = async (routineId: string, currentStatus: 'completed' | 'skipped' | 'pending', targetDate: string = getLocalTodayDate()) => {
    try {
      let nextStatus: 'completed' | 'skipped' | 'pending' = 'completed';
      if (currentStatus === 'completed') {
        nextStatus = 'pending';
      } else if (currentStatus === 'pending') {
        nextStatus = 'completed';
      }
      
      await toggleRoutineInstance(routineId, targetDate, nextStatus);
      triggerToast(nextStatus === 'completed' ? '✓ Routine completed!' : 'Routine set back to pending.');
      await reloadRoutines();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSkipRoutine = async (routineId: string, currentStatus: 'completed' | 'skipped' | 'pending', targetDate: string = getLocalTodayDate()) => {
    try {
      const nextStatus = currentStatus === 'skipped' ? 'pending' : 'skipped';
      await toggleRoutineInstance(routineId, targetDate, nextStatus);
      triggerToast(nextStatus === 'skipped' ? '✓ Routine skipped.' : 'Routine set back to pending.');
      await reloadRoutines();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteRoutineId = async (routineId: string) => {
    if (!window.confirm("Are you sure you want to permanently delete this routine and all its historical logs?")) {
      return;
    }
    try {
      await deleteRoutine(routineId);
      triggerToast('🗑 Routine deleted permanently.');
      await reloadRoutines();
    } catch (err) {
      console.error(err);
    }
  };

  // Toggle checklist check complete
  const handleCheckTask = async (taskId: string) => {
    try {
      const nextDate = await completeTask(taskId);
      if (nextDate) {
        triggerToast(`🎉 Task completed! Recurring sequence populated for target: ${nextDate}`);
      } else {
        triggerToast('✓ Task complete');
      }
      await reloadTasks();
    } catch (err) {
      console.error(err);
    }
  };

  // Defer task to next day
  const handleDefer = async (taskId: string) => {
    try {
      const deferredDate = await deferTask(taskId);
      triggerToast(`📅 Deferred: Adjusted targeted date to ${deferredDate}`);
      await reloadTasks();
    } catch (err) {
      console.error(err);
    }
  };

  // Trigger permanent purge modal
  const handleDeleteConfirm = (taskId: string) => {
    setConfirmDeleteId(taskId);
  };

  const executeDelete = async () => {
    if (!confirmDeleteId) return;
    try {
      await deleteTask(confirmDeleteId);
      triggerToast('🗑 Task discarded permanently.');
      if (selectedTaskId === confirmDeleteId) {
        setSelectedTaskId(null);
      }
      setConfirmDeleteId(null);
      await reloadTasks();
    } catch (err) {
      console.error(err);
    }
  };

  // Modify task update fields directly
  const handleUpdateTaskField = async (taskId: string, updates: Partial<Task>) => {
    try {
      const existing = tasks.find(t => t.id === taskId);
      if (!existing) return;

      const updatedObj = {
        ...existing,
        ...updates,
        updated_at: new Date().toISOString()
      };

      // If updating status, some specialized side effects are handled cleanly
      if (updates.status === 'completed') {
        await completeTask(taskId);
      } else {
        await db.tasks.update(taskId, updates);
      }

      // Live reactive UI update
      setTasks(prev => prev.map(t => t.id === taskId ? updatedObj : t));
      
      // Quiet reload
      const allTasks = await db.tasks.toArray();
      allTasks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setTasks(allTasks);
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  const todayDateString = getLocalTodayDate();

  // Filter Tasks based on active list navigation tab
  const filteredTasks = tasks.filter(t => {
    // 1. Search filter matches text query
    const matchSearch = 
      t.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (t.remark && t.remark.toLowerCase().includes(searchTerm.toLowerCase()));
    
    if (!matchSearch) return false;

    // 2. Tab segment filters matching Microsoft Task standard
    if (activeTab === 'today') {
      return t.target_date === selectedDate && (t.status === 'pending' || t.status === 'on_hold');
    }
    if (activeTab === 'planned') {
      return t.target_date > todayDateString && (t.status === 'pending' || t.status === 'on_hold');
    }
    if (activeTab === 'completed') {
      return t.status === 'completed';
    }
    if (activeTab === 'cancelled') {
      return t.status === 'cancelled';
    }
    if (activeTab === 'all') {
      return t.status === 'pending' || t.status === 'on_hold';
    }
    return true;
  });

  // Calculate task statistics for Left sidebar navigation counts
  const countToday = tasks.filter(t => t.target_date === todayDateString && (t.status === 'pending' || t.status === 'on_hold')).length;
  const countPlanned = tasks.filter(t => t.target_date > todayDateString && (t.status === 'pending' || t.status === 'on_hold')).length;
  const countCompleted = tasks.filter(t => t.status === 'completed').length;
  const countCancelled = tasks.filter(t => t.status === 'cancelled').length;
  const countAll = tasks.filter(t => t.status === 'pending' || t.status === 'on_hold').length;

  // Selected object properties for detail panel mapping
  const selectedTaskObj = tasks.find(t => t.id === selectedTaskId) || null;

  // Helper to calculate completion statistics for a routine or combined (weekly/monthly/yearly)
  const calculateRoutineStats = (routineId: string | null, daysCount: number) => {
    const today = getLocalTodayDate();
    const startDate = addDaysToDate(today, -daysCount + 1);
    const dates = getDatesBetween(startDate, today);

    let totalOpportunities = 0;
    let completedCount = 0;
    let skippedCount = 0;
    let pendingCount = 0;

    const targetRoutines = routineId
      ? routines.filter(r => r.id === routineId)
      : routines;

    for (const r of targetRoutines) {
      for (const d of dates) {
        if (d >= r.start_date) {
          totalOpportunities++;
          const inst = routineInstances.find(i => i.routine_id === r.id && i.date === d);
          if (inst) {
            if (inst.status === 'completed') {
              completedCount++;
            } else if (inst.status === 'skipped') {
              skippedCount++;
            } else {
              pendingCount++;
            }
          } else {
            if (d === today) {
              pendingCount++;
            } else {
              skippedCount++;
            }
          }
        }
      }
    }

    const completedRate = totalOpportunities > 0
      ? Math.round((completedCount / totalOpportunities) * 100)
      : 0;

    return {
      total: totalOpportunities,
      completed: completedCount,
      skipped: skippedCount,
      pending: pendingCount,
      completedRate
    };
  };

  // Pretty calendar date indicator string
  const getTodayPrettyLabel = () => {
    const d = new Date();
    const opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' };
    return d.toLocaleDateString('en-US', opts);
  };

  return (
    <div className="min-h-screen bg-app-bg text-app-text flex flex-col font-sans transition-all duration-300 antialiased overflow-x-hidden">
      
      {/* Dynamic Top App Banner */}
      <header className="border-b border-app-hdr-bdr bg-app-hdr-bg backdrop-blur-md sticky top-0 z-40 px-4 py-3 sm:px-6 transition-all">
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button 
              id="btn-sidebar-toggle"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-lg hover:bg-app-panel text-app-muted hover:text-app-bold transition-all cursor-pointer"
              title="Toggle List Sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-teal-500 animate-pulse" />
              <h1 className="font-display font-medium text-base text-app-bold tracking-tight">
                Daily
              </h1>
            </div>
          </div>

          {/* Quick-Glance Search Bar in Top Header */}
          <div className="relative max-w-xs w-full hidden sm:block">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <Search className="h-4 w-4 text-app-muted" />
            </span>
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-app-panel border border-app-border rounded-lg pl-9 pr-4 py-1.5 text-xs text-app-text placeholder-app-muted/60 focus:outline-none focus:ring-1 focus:ring-teal-500/40 focus:border-teal-500/50 transition-all"
            />
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[10px] bg-teal-500/10 text-teal-500 px-2 py-0.5 rounded-full font-mono font-medium hidden md:inline">
              IndexedDB Connected
            </span>
          </div>
        </div>
      </header>

      {/* Rollover Notification Banner */}
      <AnimatePresence>
        {showRolloverToast && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 text-center transition-all"
          >
            <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-amber-500 text-xs font-mono">
              <AlertTriangle className="w-4 h-4 animate-bounce" />
              <span>
                <strong>Rollover Logged:</strong> Moved {rolloverCount} overdue task{rolloverCount > 1 ? 's' : ''} to today.
              </span>
              <button 
                onClick={() => setShowRolloverToast(false)} 
                className="ml-auto text-amber-500 hover:text-amber-400 p-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-grow flex w-full relative min-h-0">
        
        {/* Backdrop overlay to dismiss sidebar when clicking outside */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setSidebarOpen(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-[2px] z-35 cursor-pointer"
            />
          )}
        </AnimatePresence>

        {/* ========================================== */}
        {/* LEFT SIDEBAR: Microsoft Tasks Navigation   */}
        {/* ========================================== */}
        <aside 
          className={`absolute left-0 top-0 h-full w-64 bg-app-card/95 backdrop-blur-md border-r border-app-border transition-all duration-300 flex flex-col justify-between z-40 shadow-2xl ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'
          }`}
        >
          <div className="p-4 space-y-6">
            
            {/* List Navigation Menu */}
            <div className="space-y-1">
              <span className="px-3 text-[10px] font-mono text-app-muted tracking-wider uppercase font-semibold">
                Core Views
              </span>
              
              <nav className="space-y-0.5 pt-2">
                <button
                  onClick={() => { setActiveTab('today'); setSelectedTaskId(null); }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                    activeTab === 'today' 
                      ? 'bg-teal-500/10 text-teal-400' 
                      : 'text-app-text hover:bg-app-panel'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <SunIcon active={activeTab === 'today'} />
                    <span>My Day</span>
                  </div>
                  {countToday > 0 && (
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/10">
                      {countToday}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => { setActiveTab('planned'); setSelectedTaskId(null); }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                    activeTab === 'planned' 
                      ? 'bg-teal-500/10 text-teal-400' 
                      : 'text-app-text hover:bg-app-panel'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Calendar className="w-4 h-4 text-app-muted" />
                    <span>Planned Outlet</span>
                  </div>
                  {countPlanned > 0 && (
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-app-bg text-app-muted border border-app-border">
                      {countPlanned}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => { setActiveTab('all'); setSelectedTaskId(null); }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                    activeTab === 'all' 
                      ? 'bg-teal-500/10 text-teal-400' 
                      : 'text-app-text hover:bg-app-panel'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <List className="w-4 h-4 text-app-muted" />
                    <span>All Open</span>
                  </div>
                  {countAll > 0 && (
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-app-bg text-app-muted border border-app-border">
                      {countAll}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => { setActiveTab('routines'); setSelectedTaskId(null); }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                    activeTab === 'routines' 
                      ? 'bg-teal-500/10 text-teal-400' 
                      : 'text-app-text hover:bg-app-panel'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Activity className="w-4 h-4 text-app-muted" />
                    <span>Daily Routines</span>
                  </div>
                  {routines.filter(r => r.is_active).length > 0 && (
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/10">
                      {routines.filter(r => r.is_active).length}
                    </span>
                  )}
                </button>

                <div className="h-px bg-app-border/50 my-2" />

                <button
                  onClick={() => { setActiveTab('completed'); setSelectedTaskId(null); }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                    activeTab === 'completed' 
                      ? 'bg-teal-500/10 text-teal-400' 
                      : 'text-app-text hover:bg-app-panel'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-app-muted" />
                    <span>Completed History</span>
                  </div>
                  {countCompleted > 0 && (
                    <span className="text-[10px] font-mono text-app-muted">
                      {countCompleted}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => { setActiveTab('cancelled'); setSelectedTaskId(null); }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                    activeTab === 'cancelled' 
                      ? 'bg-teal-500/10 text-teal-400' 
                      : 'text-app-text hover:bg-app-panel'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Archive className="w-4 h-4 text-app-muted" />
                    <span>Cancelled Nodes</span>
                  </div>
                  {countCancelled > 0 && (
                    <span className="text-[10px] font-mono text-app-muted">
                      {countCancelled}
                    </span>
                  )}
                </button>
              </nav>
            </div>
            
          </div>

          {/* Bottom Sidebar utilities & Theme configuration */}
          <div className="p-4 border-t border-app-border/80 bg-app-card/40 space-y-4">
            
            {/* Quick telemetry */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] font-mono text-app-muted">
                <span>Synchronized</span>
                <span className="flex items-center gap-1">
                  {isOnline ? (
                    <>
                      <Wifi className="w-3 h-3 text-emerald-500 animate-pulse" />
                      <span className="text-emerald-500 font-bold">Online</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="w-3 h-3 text-amber-500" />
                      <span className="text-amber-500">Offline</span>
                    </>
                  )}
                </span>
              </div>

              {/* Alert Status Indicator block */}
              <button
                onClick={handleEnableNotifications}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-[10px] font-mono border transition-all cursor-pointer ${
                  hasNotificationPermission 
                    ? 'bg-app-panel/40 border-app-border text-app-muted hover:text-app-bold' 
                    : 'bg-teal-950/20 text-teal-400 border-teal-500/20 hover:bg-teal-950/40'
                }`}
                title="OS Notification Reminders toggle"
              >
                <span className="flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5" />
                  <span>OS Notifications</span>
                </span>
                <span className={hasNotificationPermission ? 'text-teal-400 font-bold' : 'text-app-muted'}>
                  {hasNotificationPermission ? 'Active' : 'Enable'}
                </span>
              </button>
            </div>

            {/* Theme switcher */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] font-mono text-app-muted">Color Palette</span>
              <button
                type="button"
                onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-app-border bg-app-card hover:bg-app-panel text-app-muted hover:text-app-bold transition-all cursor-pointer text-[10px] font-mono"
              >
                {theme === 'light' ? (
                  <>
                    <Moon className="w-3 h-3 text-emerald-600" />
                    <span>Midnight Spruce</span>
                  </>
                ) : (
                  <>
                    <Sun className="w-3 h-3 text-amber-400" />
                    <span>Sage Meadow</span>
                  </>
                )}
              </button>
            </div>

          </div>
        </aside>

        {/* ========================================== */}
        {/* CENTER MAIN TASK AREA                      */}
        {/* ========================================== */}
        <main className="flex-grow flex flex-col p-4 sm:p-6 lg:p-8 overflow-y-auto w-full transition-all duration-300">
          <div className="max-w-3xl w-full mx-auto space-y-6 flex-grow flex flex-col">
            
            {/* Ambient Category Header */}
            {activeTab === 'today' ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="font-display font-medium text-2xl tracking-tight text-app-bold">
                      {selectedDate === getLocalTodayDate() ? "My Day" : "Daily Companions"}
                    </h2>
                    {selectedDate !== getLocalTodayDate() && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-teal-500/10 text-teal-400 border border-teal-500/10 animate-pulse">
                        Archive View
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-mono text-app-muted">
                    {filteredTasks.length} {filteredTasks.length === 1 ? 'task' : 'tasks'}
                  </span>
                </div>

                {/* Elegant Sliding Date Switcher Tab System */}
                <div className="bg-app-card border border-app-border rounded-2xl p-1.5 flex items-center justify-between gap-1 shadow-xs">
                  {/* Previous Day Chevron */}
                  <button
                    type="button"
                    onClick={() => setSelectedDate(prev => addDaysToDate(prev, -1))}
                    className="p-2 rounded-xl hover:bg-app-panel text-app-muted hover:text-app-bold transition-all cursor-pointer"
                    title="Previous Day"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  {/* 3 Tabs Row */}
                  <div className="flex-grow grid grid-cols-3 gap-1.5 max-w-md mx-auto">
                    {/* Left Tab (Selected Date - 1) */}
                    <button
                      type="button"
                      onClick={() => setSelectedDate(prev => addDaysToDate(prev, -1))}
                      className="px-1 py-2 rounded-xl text-center text-[10px] sm:text-xs font-mono font-semibold text-app-muted/70 hover:text-app-bold hover:bg-app-panel/40 transition-all truncate"
                    >
                      {getTabLabel(addDaysToDate(selectedDate, -1))}
                    </button>

                    {/* Center Tab (Selected Date) - HIGHLIGHTED */}
                    <button
                      type="button"
                      className="px-2 py-2 rounded-xl text-center text-[10px] sm:text-xs font-mono font-bold bg-teal-600 text-slate-900 shadow-sm transition-all truncate"
                    >
                      {getTabLabel(selectedDate)}
                    </button>

                    {/* Right Tab (Selected Date + 1) */}
                    <button
                      type="button"
                      onClick={() => setSelectedDate(prev => addDaysToDate(prev, 1))}
                      className="px-1 py-2 rounded-xl text-center text-[10px] sm:text-xs font-mono font-semibold text-app-muted/70 hover:text-app-bold hover:bg-app-panel/40 transition-all truncate"
                    >
                      {getTabLabel(addDaysToDate(selectedDate, 1))}
                    </button>
                  </div>

                  {/* Next Day Chevron */}
                  <button
                    type="button"
                    onClick={() => setSelectedDate(prev => addDaysToDate(prev, 1))}
                    className="p-2 rounded-xl hover:bg-app-panel text-app-muted hover:text-app-bold transition-all cursor-pointer"
                    title="Next Day"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Pretty string & Back to Today Reset Option */}
                <div className="flex items-center justify-between text-xs text-app-muted font-sans px-1">
                  <span>{getFormattedPrettyDate(selectedDate)}</span>
                  {selectedDate !== getLocalTodayDate() && (
                    <button
                      type="button"
                      onClick={() => setSelectedDate(getLocalTodayDate())}
                      className="text-teal-400 font-mono hover:underline font-bold transition-all cursor-pointer flex items-center gap-1 text-[11px]"
                    >
                      <span>Back to Today</span>
                      <span className="text-[9px] bg-teal-500/10 px-1 py-0.2 rounded-md">⏎</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <h2 className="font-display font-medium text-2xl tracking-tight text-app-bold">
                    {activeTab === 'planned' && "Planned Planner"}
                    {activeTab === 'all' && "All Active Tasks"}
                    {activeTab === 'completed' && "Completed History"}
                    {activeTab === 'cancelled' && "Discarded Activity Log"}
                    {activeTab === 'routines' && "Daily Routines & Reports"}
                  </h2>
                  <span className="text-xs font-mono text-app-muted">
                    {activeTab === 'routines' ? (
                      `${routines.length} ${routines.length === 1 ? 'routine' : 'routines'}`
                    ) : (
                      `${filteredTasks.length} ${filteredTasks.length === 1 ? 'task' : 'tasks'}`
                    )}
                  </span>
                </div>
                <p className="text-xs text-app-muted font-sans">
                  {activeTab === 'planned' && "Timeline representation of next task deadlines"}
                  {activeTab === 'all' && "Consolidated storage of all current local nodes"}
                  {activeTab === 'completed' && "Checkpoints passed successfully"}
                  {activeTab === 'cancelled' && "Records pulled back or suspended"}
                  {activeTab === 'routines' && "Formulate positive habits, skip dynamically, and monitor long-term logs"}
                </p>
              </div>
            )}

            {/* Mobile Search bar */}
            <div className="relative w-full sm:hidden">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <Search className="h-3.5 w-3.5 text-app-muted" />
              </span>
              <input
                type="text"
                placeholder="Search matching tasks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-app-card border border-app-border rounded-lg pl-9 pr-4 py-2 text-xs text-app-text placeholder-app-muted/60 focus:outline-none"
              />
            </div>

            {/* Microsoft To Do style expandable inline Creator Row */}
            {(activeTab === 'today' || activeTab === 'all' || activeTab === 'planned') && (
              <form 
                onSubmit={handleQuickAdd} 
                className="bg-app-card border border-app-border rounded-xl p-3 shadow-xs space-y-3 transition-all focus-within:shadow-md focus-within:border-teal-500/40"
              >
                <div className="flex items-center gap-3">
                  <div className="p-1 bg-app-panel rounded-lg">
                    <Plus className="w-4 h-4 text-teal-400" />
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="Add a task..."
                    value={newTitle}
                    onChange={(e) => {
                      setNewTitle(e.target.value);
                      if (!showAdderDetails) setShowAdderDetails(true);
                    }}
                    onFocus={() => setShowAdderDetails(true)}
                    className="w-full bg-transparent border-none text-sm text-app-bold placeholder-app-muted focus:outline-none placeholder-emerald-800/40"
                  />
                </div>
                
                {showAdderDetails && (
                  <div className="flex flex-wrap items-center justify-between pt-2 border-t border-app-border/40 gap-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      
                      {/* Due Date block chooser */}
                      <div className="flex items-center gap-1.5 bg-app-bg px-2.5 py-1.5 rounded-lg border border-app-border hover:border-teal-500/20 transition-all">
                        <Calendar className="w-3.5 h-3.5 text-app-muted" />
                        <span className="text-[10px] text-app-muted font-mono">Due:</span>
                        <input
                          type="date"
                          value={newTargetDate}
                          onChange={(e) => setNewTargetDate(e.target.value)}
                          className="bg-transparent border-none text-xs text-app-text focus:outline-none cursor-pointer font-mono"
                        />
                      </div>

                      {/* Optional Alert setup */}
                      <div className="flex items-center gap-1.5 bg-app-bg px-2.5 py-1.5 rounded-lg border border-app-border hover:border-teal-500/20 transition-all">
                        <Clock className="w-3.5 h-3.5 text-app-muted" />
                        <span className="text-[10px] text-app-muted font-mono">Remind:</span>
                        <input
                          type="time"
                          value={newReminderTime}
                          onChange={(e) => setNewReminderTime(e.target.value)}
                          className="bg-transparent border-none text-xs text-app-text focus:outline-none cursor-pointer font-mono"
                          title="Schedule notification reminder alarm"
                        />
                      </div>

                      {/* Recurrence template settings */}
                      <div className="flex items-center gap-1.5 bg-app-bg px-2.5 py-1.5 rounded-lg border border-app-border hover:border-teal-500/20 transition-all">
                        <Sparkles className="w-3.5 h-3.5 text-app-muted" />
                        <select
                          value={newFrequency}
                          onChange={(e) => setNewFrequency(e.target.value as RecurrenceFrequency)}
                          className="bg-transparent border-none text-xs text-app-text focus:outline-none cursor-pointer font-mono"
                        >
                          <option value="none">Once-off</option>
                          <option value="daily">Daily Loop</option>
                          <option value="weekly">Weekly Loop</option>
                          <option value="monthly">Monthly Loop</option>
                          <option value="custom_gap">Custom skip</option>
                        </select>
                        
                        {newFrequency === 'custom_gap' && (
                          <input
                            type="number"
                            min="1"
                            value={newCustomGapDays}
                            onChange={(e) => setNewCustomGapDays(Number(e.target.value))}
                            className="w-10 bg-app-input border border-app-border rounded px-1 py-0.5 text-xs text-center font-mono mt-0.5"
                            title="Custom gap days"
                          />
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ml-auto">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAdderDetails(false);
                          setNewTitle('');
                        }}
                        className="px-2.5 py-1 text-app-muted hover:text-app-bold transition-all cursor-pointer font-mono border border-transparent"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="bg-teal-600 hover:bg-teal-500 text-slate-900 font-semibold px-4 py-1.5 rounded-lg transition-all cursor-pointer disabled:opacity-50"
                        disabled={!newTitle.trim()}
                      >
                        Add Task
                      </button>
                    </div>
                  </div>
                )}
              </form>
            )}

            {/* Today's Daily Routines Section inside My Day */}
            {activeTab === 'today' && routines.filter(r => r.is_active).length > 0 && (
              <div className="space-y-3 bg-app-card/40 border border-app-border/60 p-4 rounded-2xl">
                <div className="flex items-center justify-between border-b border-app-border/40 pb-2">
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-teal-400 flex items-center gap-1.5">
                    <Activity className="w-4 h-4" />
                    Daily Routines
                  </h3>
                  <span className="text-[10px] font-mono text-app-muted">
                    {routines.filter(r => {
                      const inst = routineInstances.find(i => i.routine_id === r.id && i.date === selectedDate);
                      return inst?.status === 'completed';
                    }).length} / {routines.filter(r => r.is_active).length} Done
                  </span>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {routines.filter(r => r.is_active).map(routine => {
                    const todayInstance = routineInstances.find(i => i.routine_id === routine.id && i.date === selectedDate);
                    const status = todayInstance?.status || 'pending';
                    
                    return (
                      <div 
                        key={routine.id}
                        className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                          status === 'completed'
                            ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400/75'
                            : status === 'skipped'
                            ? 'bg-app-card/30 border-app-border/40 text-app-muted'
                            : 'bg-app-card border-app-border hover:border-teal-500/25 text-app-bold'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <button
                            onClick={() => handleToggleRoutine(routine.id, status, selectedDate)}
                            className="flex-shrink-0 cursor-pointer focus:outline-none"
                          >
                            {status === 'completed' ? (
                              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                            ) : status === 'skipped' ? (
                              <X className="w-5 h-5 text-app-muted" />
                            ) : (
                              <Circle className="w-5 h-5 text-app-muted hover:text-teal-400 transition-colors" />
                            )}
                          </button>
                          <span className={`text-xs font-medium truncate ${status === 'completed' ? 'line-through opacity-70' : ''}`}>
                            {routine.title}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-1.5">
                          {status !== 'completed' && (
                            <button
                              onClick={() => handleSkipRoutine(routine.id, status, selectedDate)}
                              className={`text-[10px] font-mono font-bold px-2 py-1 rounded-md transition-all cursor-pointer ${
                                status === 'skipped'
                                  ? 'bg-teal-500/10 text-teal-400'
                                  : 'bg-app-panel text-app-muted hover:bg-app-panel-hover'
                              }`}
                              title={status === 'skipped' ? "Unskip routine" : "Mark as skipped"}
                            >
                              {status === 'skipped' ? "Skipped" : "Skip"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Main Content Area Conditional on Active Tab */}
            {activeTab === 'routines' ? (
              <div className="space-y-6 flex-grow flex flex-col">
                {/* Creator form & Routine lists */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                  
                  {/* LEFT: Quick creator and active routines list */}
                  <div className="md:col-span-2 space-y-4">
                    <div className="bg-app-card border border-app-border rounded-2xl p-4 space-y-4">
                      <h3 className="text-xs font-mono font-bold text-teal-400 uppercase tracking-wider flex items-center gap-2">
                        <Plus className="w-4 h-4" />
                        Add Daily Routine
                      </h3>
                      <form onSubmit={handleCreateRoutine} className="flex gap-2">
                        <input
                          type="text"
                          required
                          placeholder="e.g., Workout, Read 10 mins..."
                          value={newRoutineTitle}
                          onChange={(e) => setNewRoutineTitle(e.target.value)}
                          className="flex-grow bg-app-panel border border-app-border rounded-xl px-3 py-2 text-xs text-app-bold focus:outline-none placeholder-app-muted focus:border-teal-500/50"
                        />
                        <button
                          type="submit"
                          className="bg-teal-600 hover:bg-teal-500 text-slate-900 font-semibold text-xs px-3.5 py-2 rounded-xl transition-all cursor-pointer"
                        >
                          Add
                        </button>
                      </form>
                    </div>

                    <div className="bg-app-card border border-app-border rounded-2xl p-4 space-y-3">
                      <h3 className="text-xs font-mono font-bold text-teal-400 uppercase tracking-wider">
                        Your Daily Routines ({routines.length})
                      </h3>
                      {routines.length === 0 ? (
                        <p className="text-xs text-app-muted font-sans py-2">No daily routines defined yet. Create one above!</p>
                      ) : (
                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                          {routines.map(routine => (
                            <div key={routine.id} className="flex items-center justify-between p-2.5 rounded-xl bg-app-panel/40 border border-app-border text-xs">
                              <div className="min-w-0">
                                <p className="font-semibold text-app-bold truncate">{routine.title}</p>
                                <p className="text-[10px] font-mono text-app-muted">Started: {routine.start_date}</p>
                              </div>
                              <button
                                onClick={() => handleDeleteRoutineId(routine.id)}
                                className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-400 text-app-muted transition-all cursor-pointer"
                                title="Delete routine"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* RIGHT: Combined aggregate overview metrics */}
                  <div className="md:col-span-3 space-y-4">
                    <div className="bg-app-card border border-app-border rounded-2xl p-5 space-y-4">
                      <h3 className="text-xs font-mono font-bold text-teal-400 uppercase tracking-wider flex items-center gap-1.5">
                        <TrendingUp className="w-4 h-4 text-teal-400" />
                        Combined Performance Report
                      </h3>
                      
                      <div className="grid grid-cols-3 gap-3">
                        {/* Weekly combined */}
                        {(() => {
                          const stats = calculateRoutineStats(null, 7);
                          return (
                            <div className="p-3 bg-app-panel/40 border border-app-border rounded-xl text-center space-y-2">
                              <span className="text-[10px] font-mono font-bold text-app-muted uppercase">Weekly (7D)</span>
                              <div className="text-2xl font-bold font-mono text-teal-400">{stats.completedRate}%</div>
                              <div className="text-[10px] text-app-muted">
                                {stats.completed}/{stats.total} instances
                              </div>
                            </div>
                          );
                        })()}

                        {/* Monthly combined */}
                        {(() => {
                          const stats = calculateRoutineStats(null, 30);
                          return (
                            <div className="p-3 bg-app-panel/40 border border-app-border rounded-xl text-center space-y-2">
                              <span className="text-[10px] font-mono font-bold text-app-muted uppercase">Monthly (30D)</span>
                              <div className="text-2xl font-bold font-mono text-teal-400">{stats.completedRate}%</div>
                              <div className="text-[10px] text-app-muted">
                                {stats.completed}/{stats.total} instances
                              </div>
                            </div>
                          );
                        })()}

                        {/* Yearly combined */}
                        {(() => {
                          const stats = calculateRoutineStats(null, 365);
                          return (
                            <div className="p-3 bg-app-panel/40 border border-app-border rounded-xl text-center space-y-2">
                              <span className="text-[10px] font-mono font-bold text-app-muted uppercase">Yearly (365D)</span>
                              <div className="text-2xl font-bold font-mono text-teal-400">{stats.completedRate}%</div>
                              <div className="text-[10px] text-app-muted">
                                {stats.completed}/{stats.total} instances
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      
                      {/* Detailed Progress breakdown info */}
                      <div className="p-3.5 bg-teal-500/5 rounded-xl border border-teal-500/10 text-xs leading-relaxed text-app-muted">
                        Combined routine performance measures your daily execution consistency across all defined items. Skipped slots are registered automatically on day closure.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section for Individual Routine Reports */}
                <div className="bg-app-card border border-app-border rounded-2xl p-5 space-y-4">
                  <h3 className="text-xs font-mono font-bold text-teal-400 uppercase tracking-wider flex items-center gap-1.5">
                    <BarChart2 className="w-4 h-4 text-teal-400" />
                    Individual Routine Reports
                  </h3>
                  
                  {routines.length === 0 ? (
                    <p className="text-xs text-app-muted py-2">Create routines above to review detailed analytics breakdown here.</p>
                  ) : (
                    <div className="space-y-4 divide-y divide-app-border/40">
                      {routines.map(routine => {
                        const weekStats = calculateRoutineStats(routine.id, 7);
                        const monthStats = calculateRoutineStats(routine.id, 30);
                        const yearStats = calculateRoutineStats(routine.id, 365);
                        
                        return (
                          <div key={routine.id} className="pt-4 first:pt-0 space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-semibold text-app-bold">{routine.title}</h4>
                              <span className="text-[10px] font-mono text-app-muted">Started: {routine.start_date}</span>
                            </div>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              {/* Weekly breakdown card */}
                              <div className="p-3 bg-app-panel/30 border border-app-border rounded-xl flex items-center justify-between">
                                <div>
                                  <p className="text-[9px] font-mono font-bold text-app-muted uppercase">Weekly (7D)</p>
                                  <p className="text-xs font-bold text-app-bold mt-1">
                                    Completed: {weekStats.completed} <span className="text-app-muted font-normal">/ {weekStats.total}</span>
                                  </p>
                                  <p className="text-[10px] text-app-muted font-mono">
                                    Skipped: {weekStats.skipped} | Pending: {weekStats.pending}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <span className="text-lg font-bold font-mono text-teal-400">{weekStats.completedRate}%</span>
                                </div>
                              </div>

                              {/* Monthly breakdown card */}
                              <div className="p-3 bg-app-panel/30 border border-app-border rounded-xl flex items-center justify-between">
                                <div>
                                  <p className="text-[9px] font-mono font-bold text-app-muted uppercase">Monthly (30D)</p>
                                  <p className="text-xs font-bold text-app-bold mt-1">
                                    Completed: {monthStats.completed} <span className="text-app-muted font-normal">/ {monthStats.total}</span>
                                  </p>
                                  <p className="text-[10px] text-app-muted font-mono">
                                    Skipped: {monthStats.skipped} | Pending: {monthStats.pending}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <span className="text-lg font-bold font-mono text-teal-400">{monthStats.completedRate}%</span>
                                </div>
                              </div>

                              {/* Yearly breakdown card */}
                              <div className="p-3 bg-app-panel/30 border border-app-border rounded-xl flex items-center justify-between">
                                <div>
                                  <p className="text-[9px] font-mono font-bold text-app-muted uppercase">Yearly (365D)</p>
                                  <p className="text-xs font-bold text-app-bold mt-1">
                                    Completed: {yearStats.completed} <span className="text-app-muted font-normal">/ {yearStats.total}</span>
                                  </p>
                                  <p className="text-[10px] text-app-muted font-mono">
                                    Skipped: {yearStats.skipped} | Pending: {yearStats.pending}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <span className="text-lg font-bold font-mono text-teal-400">{yearStats.completedRate}%</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* List block */
              <div className="flex-grow space-y-4">
                
                {filteredTasks.length === 0 ? (
                  <div className="bg-app-panel/20 border border-dashed border-app-border rounded-2xl p-12 text-center flex flex-col items-center justify-center gap-4">
                    <div className="p-3.5 bg-app-card rounded-full border border-app-border">
                      <CalendarCheck className="w-7 h-7 text-app-muted/50" />
                    </div>
                    <div>
                      <h4 className="font-display font-medium text-app-bold text-sm">List is peaceful</h4>
                      <p className="text-xs text-app-muted max-w-xs mt-1 font-sans">
                        All nodes are accounted for in this viewpoint. Use the bar above to orchestrate something new.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredTasks.map(task => (
                      <TaskItemRow
                        key={task.id}
                        task={task}
                        isSelected={task.id === selectedTaskId}
                        onClickTitle={() => setSelectedTaskId(task.id === selectedTaskId ? null : task.id)}
                        onCheck={handleCheckTask}
                        onDefer={handleDefer}
                        onDeleteConfirm={handleDeleteConfirm}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        </main>

        {/* ========================================== */}
        {/* RIGHT DRAWER DETAIL PANEL: Microsoft style */}
        {/* ========================================== */}
        <AnimatePresence>
          {selectedTaskObj && (
            <TaskDetailsPane
              task={selectedTaskObj}
              onClose={() => setSelectedTaskId(null)}
              onUpdate={handleUpdateTaskField}
              onDefer={handleDefer}
              onDelete={handleDeleteConfirm}
            />
          )}
        </AnimatePresence>

      </div>

      {/* Confirmation Modal Overlay */}
      <AnimatePresence>
        {confirmDeleteId && (
          <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-app-card border border-rose-500/20 max-w-sm w-full rounded-2xl p-6 shadow-2xl"
            >
              <div className="flex items-center gap-3 text-rose-500 mb-3">
                <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                <h3 className="font-display font-bold text-base text-app-bold">Disassemble Node</h3>
              </div>
              <p className="text-app-muted text-xs leading-relaxed mb-6 font-sans">
                Are you absolutely sure you want to permanently discard this task record from local hardware memory? This sequence cannot be synchronized or rolled back.
              </p>
              <div className="flex justify-end gap-3 font-mono text-xs">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="px-4 py-2 bg-app-panel/50 hover:bg-app-panel text-app-text rounded-lg border border-app-border transition-colors cursor-pointer"
                >
                  Keep It
                </button>
                <button
                  id="btn-confirm-delete"
                  type="button"
                  onClick={executeDelete}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-all shadow-md cursor-pointer font-semibold"
                >
                  Discard Permanently
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Activity feedback Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-app-panel border border-teal-500/20 px-4.5 py-3 rounded-xl shadow-2xl flex items-center gap-3 max-w-sm text-xs font-mono text-app-text backdrop-blur-md animate-slideUp">
          <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse flex-shrink-0" />
          <span>{toastMessage}</span>
          <button 
            onClick={() => setToastMessage('')} 
            className="text-app-muted hover:text-app-bold ml-auto cursor-pointer p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Aesthetic minimalist footer */}
      <footer className="border-t border-app-border/40 p-4 bg-app-card text-app-muted text-center text-[10px] font-mono leading-relaxed">
        <div className="max-w-7xl mx-auto flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between opacity-80">
          <p>© 2026 Daily. Hard local storage locked.</p>
          <div className="flex gap-3 justify-center">
            <span>Sandboxed IndexedDB</span>
            <span>•</span>
            <span>PWA Autorecovery Active</span>
          </div>
        </div>
      </footer>

    </div>
  );
}

// -------------------------------------------------------------
// HELPER COMPONENT: MINIMALIST CUSTOM CHECKBOX SVG
// -------------------------------------------------------------
interface TaskItemRowProps {
  key?: string;
  task: Task;
  isSelected: boolean;
  onClickTitle: () => void;
  onCheck: (id: string) => void;
  onDefer: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
}

function TaskItemRow({ task, isSelected, onClickTitle, onCheck, onDefer, onDeleteConfirm }: TaskItemRowProps) {
  const isCompleted = task.status === 'completed';
  const isCancelled = task.status === 'cancelled';
  const isOnHold = task.status === 'on_hold';

  // State-track recurrence template description
  const [recurrenceLabel, setRecurrenceLabel] = useState<string>('');

  useEffect(() => {
    async function fetchTemplateName() {
      if (task.recurring_template_id) {
        try {
          const t = await db.recurring_templates.get(task.recurring_template_id);
          if (t) {
            let desc = '';
            if (t.frequency === 'daily') desc = 'Daily';
            else if (t.frequency === 'weekly') desc = 'Weekly';
            else if (t.frequency === 'monthly') desc = 'Monthly';
            else if (t.frequency === 'custom_gap') desc = `Gap (${t.custom_gap_days}d)`;
            setRecurrenceLabel(desc);
          }
        } catch { /* ignored */ }
      }
    }
    fetchTemplateName();
  }, [task]);

  const getFriendlyDueDateText = () => {
    const today = getLocalTodayDate();
    if (task.target_date === today) return "Today";
    if (task.target_date === addDaysToDate(today, 1)) return "Tomorrow";
    
    const [y, m, d] = task.target_date.split('-').map(Number);
    const jsDate = new Date(y, m - 1, d);
    return jsDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div 
      className={`group w-full flex items-center justify-between p-3.5 rounded-xl border transition-all text-xs focus-within:ring-1 focus-within:ring-teal-500/20 ${
        isSelected 
          ? 'border-teal-500/40 bg-teal-500/5 shadow-xs' 
          : isCompleted 
            ? 'border-transparent opacity-50 bg-app-panel/20'
            : isCancelled
              ? 'border-transparent opacity-45 bg-app-panel/10'
              : 'border-app-border hover:border-app-border/80 bg-app-card hover:bg-app-panel/20'
      }`}
    >
      <div className="flex items-center gap-3.5 flex-grow min-w-0">
        
        {/* Custom Circular Complete Checkbox */}
        <button
          type="button"
          onClick={() => onCheck(task.id)}
          className="focus:outline-none flex-shrink-0 cursor-pointer p-0.5"
          title={isCompleted ? "Revert to pending" : "Complete Task"}
        >
          {isCompleted ? (
            <CheckCircle2 className="w-5 h-5 text-teal-400 stroke-[2.2]" />
          ) : (
            <Circle className="w-5 h-5 text-app-muted hover:text-teal-400 stroke-[1.8] transition-colors" />
          )}
        </button>

        {/* Title button targeting right edit sidebar drawer */}
        <div 
          onClick={onClickTitle}
          className="flex-grow text-left cursor-pointer min-w-0 pr-4"
        >
          <span className={`block font-sans font-medium text-sm transition-colors duration-150 truncate leading-tight ${
            isCompleted 
              ? 'text-app-muted line-through opacity-80' 
              : isSelected 
                ? 'text-teal-400 font-semibold' 
                : 'text-app-bold hover:text-teal-400'
          }`}>
            {task.title}
          </span>
          
          {/* Muted Sub-indicators */}
          <div className="flex flex-wrap items-center gap-2 mt-1.5 opacity-85 text-[10px]">
            
            {/* Due date indicator */}
            <span className="flex items-center gap-1 font-mono text-app-muted shrink-0">
              <Calendar className="w-3 h-3" />
              <span>{getFriendlyDueDateText()}</span>
            </span>

            {/* Hold tag */}
            {isOnHold && (
              <span className="bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase font-semibold">
                On Hold
              </span>
            )}

            {/* Recurrence Template icon */}
            {recurrenceLabel && (
              <span className="text-teal-500 font-mono flex items-center gap-0.5 shrink-0" title="Repeating recurrences enabled">
                <Sparkles className="w-3 h-3 animate-pulse-slow" />
                <span>{recurrenceLabel}</span>
              </span>
            )}

            {/* Reminder time alert */}
            {task.reminder_time && (
              <span className="text-amber-500 font-mono flex items-center gap-1 shrink-0" title="System schedule reminder alarm">
                <Clock className="w-3 h-3" />
                <span>Alarm set</span>
              </span>
            )}

            {/* Has custom remark notes */}
            {task.remark && (
              <span className="text-app-muted flex items-center gap-0.5 shrink-0" title="Has summary detail remark block">
                <Notebook className="w-3 h-3 opacity-60" />
                <span>Notes</span>
              </span>
            )}

          </div>
        </div>

      </div>

      {/* Row shortcuts visible on desktop hover */}
      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-auto">
        
        {!isCompleted && !isCancelled && (
          <button
            onClick={() => onDefer(task.id)}
            className="p-1 px-2.5 rounded-lg text-[10px] font-mono text-app-muted hover:text-teal-400 bg-app-bg hover:bg-teal-500/5 border border-app-border hover:border-teal-500/25 transition-all cursor-pointer"
            title="Defer to tomorrow (+1 Day)"
          >
            <span>+1 Day</span>
          </button>
        )}

        <button
          onClick={() => onDeleteConfirm(task.id)}
          className="p-1.5 rounded-lg text-app-muted hover:text-rose-500 bg-app-bg hover:bg-rose-500/10 border border-app-border hover:border-rose-500/20 transition-all cursor-pointer"
          title="Discard permanently"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

    </div>
  );
}

// -------------------------------------------------------------
// RIGHT PANEL COMPONENT: TASK DETAILED EDITOR DRAWER
// -------------------------------------------------------------
interface TaskDetailsPaneProps {
  task: Task;
  onClose: () => void;
  onUpdate: (taskId: string, updates: Partial<Task>) => void;
  onDefer: (taskId: string) => void;
  onDelete: (taskId: string) => void;
}

function TaskDetailsPane({ task, onClose, onUpdate, onDefer, onDelete }: TaskDetailsPaneProps) {
  // Local inputs editing state
  const [titleVal, setTitleVal] = useState<string>(task.title);
  const [remarkVal, setRemarkVal] = useState<string>(task.remark || '');
  const [targetDateVal, setTargetDateVal] = useState<string>(task.target_date);
  
  // Extract and format hours portion from reminder iso strings
  const getInitialTimeVal = () => {
    if (task.reminder_time) {
      const parts = task.reminder_time.split('T');
      if (parts.length > 1) {
        return parts[1].substring(0, 5); // Return "HH:mm"
      }
    }
    return '';
  };
  const [reminderTimeVal, setReminderTimeVal] = useState<string>(getInitialTimeVal());

  // Track state alterations across task changes
  useEffect(() => {
    setTitleVal(task.title);
    setRemarkVal(task.remark || '');
    setTargetDateVal(task.target_date);
    setReminderTimeVal(getInitialTimeVal());
  }, [task.id, task.reminder_time, task.remark, task.target_date, task.title]);

  const handleTitleBlur = () => {
    if (titleVal.trim() && titleVal !== task.title) {
      onUpdate(task.id, { title: titleVal.trim() });
    }
  };

  const handleRemarkBlur = () => {
    if (remarkVal.trim() !== (task.remark || '')) {
      onUpdate(task.id, { remark: remarkVal.trim() || undefined });
    }
  };

  const handleDateChange = (newDate: string) => {
    setTargetDateVal(newDate);
    const updates: Partial<Task> = { target_date: newDate };
    
    // Move corresponding reminder alert date portion
    if (task.reminder_time) {
      const timeParts = task.reminder_time.split('T');
      if (timeParts.length > 1) {
        updates.reminder_time = `${newDate}T${timeParts[1]}`;
      }
    }
    onUpdate(task.id, updates);
  };

  const handleTimeChange = (newTime: string) => {
    setReminderTimeVal(newTime);
    if (newTime) {
      onUpdate(task.id, { reminder_time: `${targetDateVal}T${newTime}` });
    } else {
      onUpdate(task.id, { reminder_time: undefined });
    }
  };

  const quickSetDay = (daysAhead: number) => {
    const freshDate = addDaysToDate(getLocalTodayDate(), daysAhead);
    handleDateChange(freshDate);
  };

  const getCreatedPrettyString = () => {
    try {
      const d = new Date(task.created_at);
      return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'Unknown';
    }
  };

  return (
    <motion.aside 
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 180 }}
      className="fixed md:sticky top-0 right-0 h-full md:h-[calc(100vh-140px)] w-full sm:w-[380px] bg-app-card border-l border-app-border z-40 flex flex-col justify-between shadow-2xl transition-all"
    >
      <div className="flex-grow overflow-y-auto p-5 space-y-6">
        
        {/* Detail Top Area */}
        <div className="flex items-center justify-between pb-3 border-b border-app-border/60">
          <span className="text-[10px] font-mono text-app-muted uppercase tracking-wider font-semibold">
            Task Configuration
          </span>
          <button 
            type="button"
            onClick={onClose}
            className="p-1 px-2 text-app-muted hover:text-teal-400 bg-app-bg hover:bg-teal-500/5 border border-app-border rounded-lg transition-colors cursor-pointer text-xs font-mono"
          >
            Collapse
          </button>
        </div>

        {/* Title Editor Row */}
        <div className="space-y-1">
          <label className="block text-[10px] font-mono text-app-muted tracking-wider uppercase font-semibold">
            Task Heading
          </label>
          <input
            type="text"
            value={titleVal}
            onChange={(e) => setTitleVal(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') handleTitleBlur(); }}
            placeholder="Edit title..."
            className="w-full bg-app-input border-b border-transparent focus:border-teal-500/30 px-2 py-1.5 font-sans font-semibold text-base text-app-bold focus:outline-none transition-colors"
          />
        </div>

        {/* Active Node Status Toggle Row */}
        <div className="space-y-2">
          <label className="block text-[10px] font-mono text-app-muted tracking-wider uppercase font-semibold">
            Task Status
          </label>
          <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
            <button
              onClick={() => onUpdate(task.id, { status: 'pending' })}
              className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                task.status === 'pending'
                  ? 'bg-teal-500/10 border-teal-500/20 text-teal-400 font-bold'
                  : 'bg-app-bg border-app-border text-app-text hover:bg-app-panel'
              }`}
            >
              Pending
            </button>
            <button
              onClick={() => onUpdate(task.id, { status: 'on_hold' })}
              className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                task.status === 'on_hold'
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-500 font-bold'
                  : 'bg-app-bg border-app-border text-app-text hover:bg-app-panel'
              }`}
            >
              On Hold
            </button>
            <button
              onClick={() => onUpdate(task.id, { status: 'completed' })}
              className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                task.status === 'completed'
                  ? 'bg-teal-900/20 border-teal-500/20 text-teal-500 line-through decoration-teal-500/50'
                  : 'bg-app-bg border-app-border text-app-text hover:bg-app-panel'
              }`}
            >
              Completed
            </button>
            <button
              onClick={() => onUpdate(task.id, { status: 'cancelled' })}
              className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                task.status === 'cancelled'
                  ? 'bg-rose-500/10 border-rose-500/20 text-rose-500'
                  : 'bg-app-bg border-app-border text-app-text hover:bg-app-panel'
              }`}
            >
              Cancelled
            </button>
          </div>
        </div>

        {/* Due Target Date config block */}
        <div className="space-y-2 bg-app-bg/40 p-3 rounded-xl border border-app-border">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-app-muted uppercase tracking-wider font-semibold">
            <Calendar className="w-3.5 h-3.5" />
            <span>Target Deadline</span>
          </div>

          <div className="space-y-3 pt-1">
            <input
              type="date"
              value={targetDateVal}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-full bg-app-input border border-app-input-bdr rounded-lg px-2.5 py-1.5 text-xs text-app-text font-mono focus:outline-none"
            />
            
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => quickSetDay(0)}
                className="flex-grow bg-app-card hover:bg-app-panel text-[10px] font-mono py-1 rounded border border-app-border text-app-text cursor-pointer text-center"
              >
                Today
              </button>
              <button
                onClick={() => quickSetDay(1)}
                className="flex-grow bg-app-card hover:bg-app-panel text-[10px] font-mono py-1 rounded border border-app-border text-app-text cursor-pointer text-center"
              >
                Tomorrow
              </button>
              <button
                onClick={() => onDefer(task.id)}
                className="flex-grow bg-app-card hover:bg-app-panel text-[10px] font-mono py-1 rounded border border-app-border text-teal-400 cursor-pointer text-center"
                title="Shift +1 Day to target"
              >
                +1 Day
              </button>
            </div>
          </div>
        </div>

        {/* System Scheduler Remind alarms */}
        <div className="space-y-2 bg-app-bg/40 p-3 rounded-xl border border-app-border">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-app-muted uppercase tracking-wider font-semibold">
            <Clock className="w-3.5 h-3.5 text-amber-500" />
            <span>Rem remind Alarm</span>
          </div>
          
          <div className="pt-1 space-y-1.5">
            <input
              type="time"
              value={reminderTimeVal}
              onChange={(e) => handleTimeChange(e.target.value)}
              className="w-full bg-app-input border border-app-input-bdr rounded-lg px-2.5 py-1.5 text-xs text-app-text font-mono focus:outline-none"
            />
            <p className="text-[9px] text-app-muted font-mono leading-normal">
              Plays acoustic bell chords and displays local background notifications on trigger date-time matches.
            </p>
          </div>
        </div>

        {/* Deep Descriptive Note editor */}
        <div className="space-y-2">
          <div className="flex items-center gap-1 text-[10px] font-mono text-app-muted uppercase tracking-wider font-semibold">
            <Notebook className="w-3.5 h-3.5" />
            <span>Annotated Notes</span>
          </div>
          <textarea
            value={remarkVal}
            onChange={(e) => setRemarkVal(e.target.value)}
            onBlur={handleRemarkBlur}
            placeholder="Annotate task details, reference links..."
            className="w-full h-32 bg-app-input border border-app-input-bdr/50 rounded-xl p-3 text-xs leading-relaxed text-app-text focus:outline-none focus:ring-1 focus:ring-teal-500 placeholder-app-muted/40 transition-colors py-2 font-sans"
          />
        </div>

      </div>

      {/* Detail Bottom actions panel */}
      <div className="p-4 border-t border-app-border bg-app-card/60 flex items-center justify-between font-mono text-[9px] text-app-muted bg-app-panel/10">
        <span title="Created timestamp node">
          Created: {getCreatedPrettyString()}
        </span>

        <button
          onClick={() => onDelete(task.id)}
          className="flex items-center gap-1 px-3 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 hover:border-rose-500/30 rounded-lg cursor-pointer transition-all"
        >
          <Trash2 className="w-3 h-3" />
          <span>Purge</span>
        </button>
      </div>

    </motion.aside>
  );
}

// -------------------------------------------------------------
// SIDEBAR SUB-ASSET: ANIMATED LITTLE SUN DESIGN
// -------------------------------------------------------------
function SunIcon({ active }: { active: boolean }) {
  return (
    <div className={`relative flex items-center justify-center shrink-0 w-4 h-4 ${active ? 'text-teal-400' : 'text-app-muted'}`}>
      <Sun className="w-4 h-4" />
      {active && (
        <span className="absolute w-1 h-1 bg-teal-400 rounded-full animate-ping" />
      )}
    </div>
  );
}
